import XCTest
import SwiftUI
import UIKit

// Up Next's upcoming rows moved into WidgetAgendaRow (shared with the Month
// widget's agenda). These tests hold the refactor to "renders identically":
// the pre-refactor row and time formatter are kept below VERBATIM, and the
// shared ones must match them pixel for pixel and string for string.

/// UpNextWidget's upcoming row before the extraction, copied verbatim.
private struct PreRefactorUpNextRow: View {
    let colorHex: String?
    let title: String?
    let time: String?

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: colorHex ?? "#3b82f6"))
                .frame(width: 3, height: 14)
            Text(title ?? "")
                .font(.caption2)
                .lineLimit(1)
            Spacer()
            if let time {
                Text(time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
    }
}

/// UpNextWidget's time helpers before the extraction, copied verbatim.
private enum PreRefactorTime {
    static func timeLabel(startTime: String?, duration: Int?, use24: Bool) -> String? {
        guard let time = formattedTime(startTime, use24: use24) else { return nil }
        if let d = duration, d > 0 { return "\(time) · \(formattedDuration(d))" }
        return time
    }

    static func formattedDuration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)m" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h)h" : "\(h)h\(m)m"
    }

    static func formattedTime(_ startTime: String?, use24: Bool) -> String? {
        guard let st = startTime, !st.isEmpty else { return nil }
        let parts = st.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return st }
        let h = parts[0], m = parts[1]
        if use24 { return String(format: "%02d:%02d", h, m) }
        let period = h < 12 ? "AM" : "PM"
        let h12 = h == 0 ? 12 : (h > 12 ? h - 12 : h)
        return m == 0 ? "\(h12)\(period)" : "\(h12):\(String(format: "%02d", m))\(period)"
    }
}

final class WidgetAgendaRowTests: XCTestCase {

    func testTimeLabelsAreUnchanged() {
        let starts: [String?] = [nil, "", "0:00", "00:05", "09:00", "9:30", "12:00", "12:45", "13:05", "23:59", "bogus", "7"]
        let durations: [Int?] = [nil, 0, 5, 45, 60, 90, 125, 600]
        for start in starts {
            for duration in durations {
                for use24 in [false, true] {
                    XCTAssertEqual(WidgetTimeLabel.label(startTime: start, duration: duration, use24Hour: use24),
                                   PreRefactorTime.timeLabel(startTime: start, duration: duration, use24: use24),
                                   "\(start ?? "nil") \(duration.map(String.init) ?? "nil") 24h=\(use24)")
                }
            }
        }
    }

    @MainActor
    private func pngData<V: View>(_ view: V, scheme: ColorScheme) throws -> Data {
        let renderer = ImageRenderer(content: view
            .frame(width: 300, height: 18)
            .background(scheme == .dark ? Color.black : Color.white)
            .environment(\.colorScheme, scheme))
        renderer.scale = 3
        let image = try XCTUnwrap(renderer.uiImage)
        return try XCTUnwrap(image.pngData())
    }

    /// The shared row, as Up Next now uses it, against the verbatim old one:
    /// identical PNG bytes for every case, light and dark.
    @MainActor
    func testUpNextRowsRenderIdentically() throws {
        let cases: [(String?, String?, String?)] = [
            ("#3b82f6", "Standup", "9:30AM · 15m"),
            (nil, "Lunch with Priya", "12:15PM · 45m"),
            ("#f43f5e", "Quarterly planning — draft goals for the next two quarters and circulate", "2PM · 1h30m"),
            ("#10b981", nil, "18:30 · 1h"),
            ("#a855f7", "No time", nil),
        ]
        for (color, title, time) in cases {
            for scheme in [ColorScheme.light, .dark] {
                let shared = try pngData(WidgetAgendaRow(colorHex: color, title: title ?? "", time: time), scheme: scheme)
                let before = try pngData(PreRefactorUpNextRow(colorHex: color, title: title, time: time), scheme: scheme)
                XCTAssertEqual(shared, before, "\(title ?? "nil") / \(time ?? "nil") / \(scheme)")
            }
        }
    }

    /// And the completed treatment actually changes the pixels (it is not a
    /// no-op that would make the identity test above vacuous).
    @MainActor
    func testTheCompletedRowIsDrawnDifferently() throws {
        let plain = try pngData(WidgetAgendaRow(colorHex: "#3b82f6", title: "Standup", time: "9AM"), scheme: .dark)
        let done = try pngData(WidgetAgendaRow(colorHex: "#3b82f6", title: "Standup", time: "9AM", completed: true), scheme: .dark)
        XCTAssertNotEqual(plain, done)
    }
}
