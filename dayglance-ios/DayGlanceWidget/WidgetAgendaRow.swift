import SwiftUI

// One agenda row, shared by Up Next (its "upcoming" rows) and the extra-large
// Month widget's day list, so the two cannot drift into two styles. Moved out
// of UpNextWidget verbatim: a 3 × 14 colour bar, the title, the time on the
// right. `completed` adds SCHED's completed treatment (SchedTaskCard: a green
// check, the title struck through, the row at 55%); off, it draws nothing
// extra, and Up Next's rows render exactly as before (WidgetAgendaRowTests
// compares them pixel for pixel against the pre-refactor code).

struct WidgetAgendaRow: View {
    let colorHex: String?
    let title: String
    let time: String?
    var completed: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: colorHex ?? "#3b82f6"))
                .frame(width: 3, height: 14)
            if completed {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundColor(.green)
            }
            Text(title)
                .font(.caption2)
                .lineLimit(1)
                .strikethrough(completed)
            Spacer()
            if let time {
                Text(time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .opacity(completed ? 0.55 : 1)
    }
}

/// Start time plus duration, e.g. "9:00AM · 30m" — Up Next's format, moved
/// here verbatim so the Month agenda prints times the same way.
enum WidgetTimeLabel {
    static func label(startTime: String?, duration: Int?, use24Hour: Bool) -> String? {
        guard let time = formattedTime(startTime, use24Hour: use24Hour) else { return nil }
        if let d = duration, d > 0 { return "\(time) · \(formattedDuration(d))" }
        return time
    }

    /// Minutes past midnight as the 'HH:mm' the formatter reads.
    static func hhmm(_ minutes: Double) -> String {
        let m = max(0, Int(minutes.rounded()))
        return String(format: "%02d:%02d", (m / 60) % 24, m % 60)
    }

    static func formattedDuration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)m" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h)h" : "\(h)h\(m)m"
    }

    static func formattedTime(_ startTime: String?, use24Hour: Bool) -> String? {
        guard let st = startTime, !st.isEmpty else { return nil }
        let parts = st.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return st }
        let h = parts[0], m = parts[1]
        if use24Hour { return String(format: "%02d:%02d", h, m) }
        let period = h < 12 ? "AM" : "PM"
        let h12 = h == 0 ? 12 : (h > 12 ? h - 12 : h)
        return m == 0 ? "\(h12)\(period)" : "\(h12):\(String(format: "%02d", m))\(period)"
    }
}
