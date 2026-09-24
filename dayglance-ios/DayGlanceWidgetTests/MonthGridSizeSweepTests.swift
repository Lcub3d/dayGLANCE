import XCTest
import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// The month grid at every systemLarge size (the dial's table, SizeSweepTests).
// Content margins are disabled, so the widget's size is the canvas; the
// 11pt padding, 14pt rows and 2pt insets are fixed, and the cells take what
// is left — which makes the smallest widget the real test.
//
// Each size renders the real view through ImageRenderer and samples the
// pixels a rule says must be there: a long bar where the hour window puts it,
// a 15-minute bar at the minimum height, a late bar clamped to the bottom
// edge, an overlap drawn with the later item on top, today's fill. The widest
// month label ("Sep 28"-class, bold, in today's fill) is measured against
// the narrowest cell.
//
// Screenshots of the live fixture are attached to the result bundle (ios.yml
// uploads them). With TEST_RUNNER_DG_MONTH_SHOTS=1 they are also printed to
// the log as base64, for a reviewer who can read the log but not the bundle.
// ─────────────────────────────────────────────────────────────────────────────

final class MonthGridSizeSweepTests: XCTestCase {

    private var calendar: Calendar { MonthGridModelTests.calendar }
    private let locale = MonthGridModelTests.locale
    private static let renderScale: CGFloat = 2

    // Synthetic grid: Sunday weeks from 20 Sep, today Wednesday 23 (cell 3).
    static let red = "#ff0000", green = "#00ff00", blue = "#0000ff", yellow = "#ffff00", magenta = "#ff00ff"
    static let longCell = 9       // Tue 29 Sep: 09:00–13:00
    static let shortCell = 17     // Wed 7 Oct: 07:00–07:15, the minimum height
    static let lateCell = 25      // Thu 15 Oct: 22:00–23:00, clamped to the bottom
    static let overlapCell = 33   // Fri 23 Oct: 10:00–12:00 under 11:00–11:30
    static let todayCell = 3
    static let firstOfMonthCell = 11  // Thu 1 Oct

    private func sweepEntry() -> MonthGridEntry {
        var window = MonthGridModelTests.window(from: "2026-09-20", weekStart: 0)
        for i in window.days.indices { window.days[i].bars = [] }
        window.days[Self.longCell].bars = [MonthWindowBar(s: 540, d: 240, c: Self.red)]
        window.days[Self.shortCell].bars = [MonthWindowBar(s: 420, d: 15, c: Self.green)]
        window.days[Self.lateCell].bars = [MonthWindowBar(s: 1320, d: 60, c: Self.blue)]
        window.days[Self.overlapCell].bars = [MonthWindowBar(s: 600, d: 120, c: Self.yellow), MonthWindowBar(s: 660, d: 30, c: Self.magenta)]
        let snapshot = MonthGridModelTests.snapshot(date: "2026-09-23", days: ["2026-09-24", "2026-09-25", "2026-09-26"])
        return MonthGridEntry(date: MonthGridModelTests.at("2026-09-23", 12), snapshot: snapshot, window: window)
    }

    @MainActor
    private func render(_ entry: MonthGridEntry, w: CGFloat, h: CGFloat, scale: CGFloat = MonthGridSizeSweepTests.renderScale) throws -> CGImage {
        let view = MonthGridContent(entry: entry, calendar: calendar, locale: locale)
            .frame(width: w, height: h)
            .background(MonthPalette.background)
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        return try XCTUnwrap(renderer.cgImage, "no image at \(w)×\(h)")
    }

    private func rgb(_ image: CGImage, _ p: CGPoint) -> RenderingModeTests.RGBA {
        RenderingModeTests.pixel(image, x: Int((p.x * Self.renderScale).rounded(.down)), y: Int((p.y * Self.renderScale).rounded(.down)))
    }

    private func assertColour(_ image: CGImage, _ p: CGPoint, _ hex: String, _ what: String,
                              file: StaticString = #filePath, line: UInt = #line) {
        let want = Self.components(hex)
        let got = rgb(image, p)
        let close = abs(got.r - want.r) < 0.1 && abs(got.g - want.g) < 0.1 && abs(got.b - want.b) < 0.1 && got.a > 0.9
        XCTAssertTrue(close, "\(what): wanted \(hex) at \(p), got r\(got.r) g\(got.g) b\(got.b) a\(got.a)", file: file, line: line)
    }

    static func components(_ hex: String) -> (r: Double, g: Double, b: Double) {
        var v: UInt64 = 0
        Scanner(string: String(hex.dropFirst())).scanHexInt64(&v)
        return (Double((v >> 16) & 0xff) / 255, Double((v >> 8) & 0xff) / 255, Double(v & 0xff) / 255)
    }

    /// The centre of a bar's frame in widget coordinates.
    private func barCentre(cell: Int, bar: MonthWindowBar, size: CGSize) -> CGPoint {
        let m = MonthGridMetrics(gridSize: MonthGridMetrics.gridSize(widget: size))
        let o = MonthGridMetrics.cellOrigin(index: cell, widget: size)
        let f = MonthGrid.barFrame(bar, trackHeight: m.trackHeight)
        return CGPoint(x: o.x + MonthGridMetrics.cellInset + m.trackWidth / 2,
                       y: o.y + MonthGridMetrics.trackTop + f.y + f.height / 2)
    }

    @MainActor
    func testTheGridDrawsTheSameRulesAtEverySystemLargeSize() throws {
        let entry = sweepEntry()
        let days = try XCTUnwrap(entry.window?.days)
        for size in SizeSweepTests.sizes {
            let widget = CGSize(width: size.w, height: size.h)
            let image = try render(entry, w: size.w, h: size.h)
            XCTAssertEqual(image.width, Int(size.w * Self.renderScale), size.devices)
            XCTAssertEqual(image.height, Int(size.h * Self.renderScale), size.devices)

            // The long bar, where 07:00–21:00 puts 09:00–13:00.
            assertColour(image, barCentre(cell: Self.longCell, bar: days[Self.longCell].bars[0], size: widget), Self.red,
                         "\(size.devices): 09:00–13:00")
            // The 15-minute bar, visible at the minimum height.
            assertColour(image, barCentre(cell: Self.shortCell, bar: days[Self.shortCell].bars[0], size: widget), Self.green,
                         "\(size.devices): a 15-minute bar at the minimum height")
            // The late bar, clamped to the track's bottom edge…
            let late = barCentre(cell: Self.lateCell, bar: days[Self.lateCell].bars[0], size: widget)
            assertColour(image, late, Self.blue, "\(size.devices): 22:00 clamped to the bottom")
            // …and nothing above it: it is the edge, not a band.
            assertColour(image, CGPoint(x: late.x, y: late.y - 3), "#161b22", "\(size.devices): nothing above the clamped bar")
            // The overlap: the later item on top, the earlier showing around it.
            let bars = days[Self.overlapCell].bars
            assertColour(image, barCentre(cell: Self.overlapCell, bar: bars[1], size: widget), Self.magenta,
                         "\(size.devices): the later overlapping item is on top")
            let m = MonthGridMetrics(gridSize: MonthGridMetrics.gridSize(widget: widget))
            let under = MonthGrid.barFrame(bars[0], trackHeight: m.trackHeight)
            let o = MonthGridMetrics.cellOrigin(index: Self.overlapCell, widget: widget)
            assertColour(image, CGPoint(x: o.x + MonthGridMetrics.cellInset + m.trackWidth / 2,
                                        y: o.y + MonthGridMetrics.trackTop + under.y + 1),
                         Self.yellow, "\(size.devices): the earlier item shows above the overlap")
            // Full cell width: both edges of the long bar's track are drawn.
            let long = barCentre(cell: Self.longCell, bar: days[Self.longCell].bars[0], size: widget)
            let lo = MonthGridMetrics.cellOrigin(index: Self.longCell, widget: widget)
            assertColour(image, CGPoint(x: lo.x + MonthGridMetrics.cellInset + 1, y: long.y), Self.red, "\(size.devices): bar's left edge")
            assertColour(image, CGPoint(x: lo.x + MonthGridMetrics.cellInset + m.trackWidth - 1, y: long.y), Self.red,
                         "\(size.devices): bar's right edge")
            // Today's fill, in the 3pt of padding left of the number.
            let t = MonthGridMetrics.cellOrigin(index: Self.todayCell, widget: widget)
            assertColour(image, CGPoint(x: t.x + 2.5, y: t.y + MonthGridMetrics.headerHeight / 2), "#1f6feb",
                         "\(size.devices): today's fill")
            // The hairline box on the first of the month: something drawn on
            // the cell's bottom edge that an ordinary cell leaves bare.
            let f1 = MonthGridMetrics.cellOrigin(index: Self.firstOfMonthCell, widget: widget)
            XCTAssertTrue(edgeDrawn(image, x: f1.x + m.cellWidth / 2, y: f1.y + m.cellHeight),
                          "\(size.devices): first-of-month box")
            let plain = MonthGridMetrics.cellOrigin(index: Self.firstOfMonthCell + 1, widget: widget)
            XCTAssertFalse(edgeDrawn(image, x: plain.x + m.cellWidth / 2, y: plain.y + m.cellHeight),
                           "\(size.devices): no box on an ordinary cell")
        }
    }

    /// Whether any pixel within a point of (x, y) differs from the ground.
    private func edgeDrawn(_ image: CGImage, x: CGFloat, y: CGFloat) -> Bool {
        let ground = Self.components("#161b22")
        let px = Int((x * Self.renderScale).rounded()), py = Int((y * Self.renderScale).rounded())
        for dy in -3...1 {
            let c = RenderingModeTests.pixel(image, x: px, y: min(image.height - 1, max(0, py + dy)))
            if abs(c.r - ground.r) > 0.03 || abs(c.g - ground.g) > 0.03 || abs(c.b - ground.b) > 0.03 { return true }
        }
        return false
    }

    /// The type floor: at every size the widest label a cell can carry fits
    /// inside the cell, and the track keeps a usable height.
    func testLabelsAndTrackFitTheSmallestCell() {
        let font = UIFont.systemFont(ofSize: MonthGridMetrics.dateFontSize, weight: .medium)
        var widest: CGFloat = 0
        var widestLabel = ""
        var style = Date.FormatStyle().month(.abbreviated).day()
        style.calendar = calendar
        style.timeZone = calendar.timeZone
        for month in 1...12 {
            let d = calendar.date(from: DateComponents(year: 2026, month: month, day: 28))!
            let label = d.formatted(style.locale(locale))
            let w = (label as NSString).size(withAttributes: [.font: font]).width
            if w > widest { widest = w; widestLabel = label }
        }
        // Today's fill adds 3pt a side and pulls 2pt left; the header insets 1 + 2pt, and 2pt right.
        let needed = widest + 2 * MonthGridMetrics.todayPadding - 2 + 1 + 2 * MonthGridMetrics.cellInset

        var rows: [String] = []
        for size in SizeSweepTests.sizes {
            let m = MonthGridMetrics(gridSize: MonthGridMetrics.gridSize(widget: CGSize(width: size.w, height: size.h)))
            rows.append(String(format: "%3.0f×%3.0f  cell %.1f×%.1f  track %.1f  (%@)", size.w, size.h, m.cellWidth, m.cellHeight,
                               m.trackHeight, size.devices))
            // The label may shrink to its minimum scale (0.8) but never truncates.
            XCTAssertLessThanOrEqual(needed * 0.8, m.cellWidth, "\(size.devices): \"\(widestLabel)\" in today's fill fits a \(m.cellWidth)pt cell")
            if needed > m.cellWidth { rows.append("  ↳ \"\(widestLabel)\" in today's fill scales to \(String(format: "%.2f", m.cellWidth / needed)) here") }
            XCTAssertGreaterThanOrEqual(m.trackHeight, 24, "\(size.devices): the track keeps room for four bars")
            // Four stacked minimum bars never fill the track: the cap is drawable.
            XCTAssertLessThan(4 * MonthGrid.minBarHeight, m.trackHeight / 3, size.devices)
        }
        print("month sweep: widest label \"\(widestLabel)\" needs \(needed)pt\n" + rows.joined(separator: "\n"))
    }

    // MARK: Screenshots

    /// The live fixture on its pushed day (today is the window's first day and
    /// over the cap; 1 Oct is the crowded first of the month), at the smallest
    /// and largest systemLarge sizes; then the crowded first of the month as
    /// TODAY (box, fill, pip and +N in one header); then the stale state.
    @MainActor
    func testScreenshots() throws {
        let data = try MonthGridModelTests.fixtureData()
        let snapshot = try XCTUnwrap(decodeSnapshot(data))
        let window = try XCTUnwrap(MonthWindowStore.decode(data))
        let pushed = MonthGridEntry(date: MonthGridModelTests.at("2026-09-21", 10), snapshot: snapshot, window: window)

        var oct1 = snapshot
        oct1.date = "2026-10-01"
        oct1.days = []
        let crowdedToday = MonthGridEntry(date: MonthGridModelTests.at("2026-10-01", 10), snapshot: oct1, window: window)
        // The last live day (13 days past a Monday push, the grid moved down a
        // row) and the first stale one, under the coverage rule.
        let lastLive = MonthGridEntry(date: MonthGridModelTests.at("2026-10-04", 10), snapshot: snapshot, window: window)
        let stale = MonthGridEntry(date: MonthGridModelTests.at("2026-10-05", 10), snapshot: snapshot, window: window)
        XCTAssertEqual(MonthGridState.resolve(snapshot: snapshot, window: window, at: lastLive.date, calendar: calendar)?.tier, .projected)
        XCTAssertEqual(MonthGridState.resolve(snapshot: snapshot, window: window, at: stale.date, calendar: calendar)?.tier, .stale)
        XCTAssertEqual(MonthGridState.resolve(snapshot: oct1, window: window, at: crowdedToday.date, calendar: calendar)?.tier, .pushed)

        let shots: [(String, MonthGridEntry, CGFloat, CGFloat)] = [
            ("smallest-ipad-mini-306x306", pushed, 306, 306),
            ("smallest-iphone-se-321x324", pushed, 321, 324),
            ("largest-iphone-pro-max-364x382", pushed, 364, 382),
            ("largest-ipad-pro-13-379x379", pushed, 379, 379),
            ("crowded-first-is-today-306x306", crowdedToday, 306, 306),
            ("last-live-oct-4-338x354", lastLive, 338, 354),
            ("stale-oct-5-338x354", stale, 338, 354),
        ]
        let printBase64 = ProcessInfo.processInfo.environment["DG_MONTH_SHOTS"] == "1"
        for (name, entry, w, h) in shots {
            let image = try render(entry, w: w, h: h, scale: 3)
            let png = try XCTUnwrap(UIImage(cgImage: image).pngData())
            let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
            attachment.name = "month-\(name).png"
            attachment.lifetime = .keepAlways
            add(attachment)
            if printBase64 {
                print("MONTHSHOT-BEGIN \(name)")
                let b64 = png.base64EncodedString()
                var i = b64.startIndex
                while i < b64.endIndex {
                    let j = b64.index(i, offsetBy: 4000, limitedBy: b64.endIndex) ?? b64.endIndex
                    print("MONTHSHOT \(b64[i..<j])")
                    i = j
                }
                print("MONTHSHOT-END \(name)")
            }
        }
    }
}
