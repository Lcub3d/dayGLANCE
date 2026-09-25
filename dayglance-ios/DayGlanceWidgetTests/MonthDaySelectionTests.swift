import XCTest
import SwiftUI
import UIKit
import AppIntents

// The extra-large month widget's selected day and its arrows. What CI cannot
// check — that the intent runs inside the widget process on a device with the
// app not running — is what the on-device spike checks (MonthDaySelection's
// handledBy, shown in the panel).

final class MonthDaySelectionTests: XCTestCase {

    private var calendar: Calendar { MonthGridModelTests.calendar }
    private let locale = MonthGridModelTests.locale

    private func cells(from: String = "2026-09-20", weekStart: Int = 0) -> [MonthGridCell] {
        let window = MonthGridModelTests.window(from: from, weekStart: weekStart)
        return Array(window.days.prefix(42)).enumerated().map {
            MonthGridCell.make($0.element, index: $0.offset, today: nil, calendar: calendar, locale: locale)
        }
    }

    // MARK: Resolution

    func testNoSelectionIsToday() {
        XCTAssertEqual(MonthDaySelection.resolve(nil, cells: cells(), entryDay: "2026-09-23"), "2026-09-23")
    }

    func testASelectionMadeTodayHolds() {
        let s = MonthDaySelection(date: "2026-10-14", setOn: "2026-09-23")
        XCTAssertEqual(MonthDaySelection.resolve(s, cells: cells(), entryDay: "2026-09-23"), "2026-10-14")
    }

    /// The midnight reset: the same record, read on the next day's entry,
    /// is today again — nothing had to be written at midnight.
    func testASelectionFromAnotherDayResetsToToday() {
        let s = MonthDaySelection(date: "2026-10-30", setOn: "2026-09-23")
        XCTAssertEqual(MonthDaySelection.resolve(s, cells: cells(), entryDay: "2026-09-24"), "2026-09-24")
    }

    func testASelectionOffTheGridFallsBackToToday() {
        let s = MonthDaySelection(date: "2026-12-25", setOn: "2026-09-23")
        XCTAssertEqual(MonthDaySelection.resolve(s, cells: cells(), entryDay: "2026-09-23"), "2026-09-23")
    }

    func testAStaleGridWithoutTodaySelectsItsFirstDay() {
        XCTAssertEqual(MonthDaySelection.resolve(nil, cells: cells(), entryDay: "2026-12-01"), "2026-09-20")
    }

    /// The timeline's midnight entries carry the record read at reload; each
    /// resolves against its own day.
    func testTheTimelinesMidnightEntriesReturnToToday() throws {
        let (snapshot, window) = try MonthGridModelTests.fixture()
        let selection = MonthDaySelection(date: "2026-10-01", setOn: "2026-09-21")
        let dates = MonthGridTimeline.entryDates(now: MonthGridModelTests.at("2026-09-21", 20), window: window, calendar: calendar)
        let resolved = dates.prefix(3).map { date -> String? in
            let state = MonthGridState.resolve(snapshot: snapshot, window: window, at: date, calendar: calendar, locale: locale)
            return state.flatMap { MonthDaySelection.resolve(selection, cells: $0.cells, entryDay: MonthGrid.isoDay(date, calendar: calendar)) }
        }
        XCTAssertEqual(resolved, ["2026-10-01", "2026-09-22", "2026-09-23"])
    }

    // MARK: Arrows

    func testTheArrowsPageAcrossTheGridAndStopAtItsEnds() {
        let c = cells()
        XCTAssertEqual(MonthDaySelection.neighbours(of: "2026-10-14", cells: c).previous, "2026-10-13")
        XCTAssertEqual(MonthDaySelection.neighbours(of: "2026-10-14", cells: c).next, "2026-10-15")
        XCTAssertNil(MonthDaySelection.neighbours(of: "2026-09-20", cells: c).previous, "first cell")
        XCTAssertEqual(MonthDaySelection.neighbours(of: "2026-09-20", cells: c).next, "2026-09-21")
        XCTAssertNil(MonthDaySelection.neighbours(of: "2026-10-31", cells: c).next, "last cell")
        XCTAssertNil(MonthDaySelection.neighbours(of: "2027-01-01", cells: c).next, "not on the grid")
    }

    func testTheIntentWritesTheSelectionForToday() async throws {
        let defaults = UserDefaults(suiteName: kAppGroupSuite)
        let saved = defaults?.data(forKey: MonthDaySelection.defaultsKey)
        defer { defaults?.set(saved, forKey: MonthDaySelection.defaultsKey) }

        _ = try await SelectMonthDayIntent(date: "2026-10-14").perform()
        let s = try XCTUnwrap(MonthDaySelection.load(defaults))
        XCTAssertEqual(s.date, "2026-10-14")
        XCTAssertEqual(s.setOn, MonthGrid.isoDay(Date(), calendar: .current))
        XCTAssertNotNil(s.handledAt)
        XCTAssertFalse(SelectMonthDayIntent.openAppWhenRun, "the arrows must not launch the app")
    }

    // MARK: Rendering

    /// systemExtraLarge sizes, iPad only (Apple's per-device widget table):
    /// the systemLarge square's height, a little over twice its width.
    static let extraLargeSizes: [(devices: String, w: CGFloat, h: CGFloat)] = [
        ("iPad mini, 9.7\" iPad, Air 2", 634, 306),
        ("iPad 10.2\"", 672, 321),
        ("iPad 10.5\", Air 3", 686, 328),
        ("iPad Pro 11\", Air 4/5, 10.9\"", 715, 342),
        ("iPad Pro 12.9\" / 13\"", 795, 379),
    ]

    @MainActor
    private func render(_ entry: MonthGridEntry, w: CGFloat, h: CGFloat, scale: CGFloat) throws -> CGImage {
        let view = MonthGridExtraLargeContent(entry: entry, calendar: calendar, locale: locale)
            .frame(width: w, height: h)
            .background(MonthPalette.background)
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        return try XCTUnwrap(renderer.cgImage)
    }

    /// The left half is the systemLarge grid at half the width: a bar the
    /// sweep draws lands where MonthGridMetrics puts it in that half.
    @MainActor
    func testTheLeftHalfIsTheLargeGridAtEveryExtraLargeSize() throws {
        var window = MonthGridModelTests.window(from: "2026-09-20", weekStart: 0)
        for i in window.days.indices { window.days[i].bars = [] }
        window.days[9].bars = [MonthWindowBar(s: 540, d: 240, c: "#ff0000")]
        let snapshot = MonthGridModelTests.snapshot(date: "2026-09-23", days: [])
        let entry = MonthGridEntry(date: MonthGridModelTests.at("2026-09-23", 12), snapshot: snapshot, window: window)
        for size in Self.extraLargeSizes {
            let image = try render(entry, w: size.w, h: size.h, scale: 2)
            let half = CGSize(width: size.w / 2, height: size.h)
            let m = MonthGridMetrics(gridSize: MonthGridMetrics.gridSize(widget: half))
            let o = MonthGridMetrics.cellOrigin(index: 9, widget: half)
            let f = MonthGrid.barFrame(window.days[9].bars[0], trackHeight: m.trackHeight)
            let p = CGPoint(x: o.x + MonthGridMetrics.cellInset + m.trackWidth / 2, y: o.y + MonthGridMetrics.trackTop + f.y + f.height / 2)
            let px = RenderingModeTests.pixel(image, x: Int(p.x * 2), y: Int(p.y * 2))
            XCTAssertTrue(px.r > 0.9 && px.g < 0.1 && px.b < 0.1, "\(size.devices): the bar in the left half, got \(px)")
            XCTAssertGreaterThanOrEqual(m.trackHeight, 24, size.devices)
        }
    }

    /// Screenshots for review: today, a paged-ahead day, the grid's last day
    /// (next arrow disabled), and the stale state — at the smallest and
    /// largest extra-large sizes.
    @MainActor
    func testScreenshots() throws {
        let data = try MonthGridModelTests.fixtureData()
        let snapshot = try XCTUnwrap(decodeSnapshot(data))
        let window = try XCTUnwrap(MonthWindowStore.decode(data))
        let now = MonthGridModelTests.at("2026-09-21", 10)
        let tapped = MonthGridModelTests.at("2026-09-21", 9, 58)
        let entries: [(String, MonthGridEntry)] = [
            ("today", MonthGridEntry(date: now, snapshot: snapshot, window: window)),
            ("paged-ahead-oct-1", MonthGridEntry(date: now, snapshot: snapshot, window: window,
                selection: MonthDaySelection(date: "2026-10-01", setOn: "2026-09-21", handledAt: tapped, handledBy: "DayGlanceWidgetExtension"))),
            ("edge-last-cell-nov-1", MonthGridEntry(date: now, snapshot: snapshot, window: window,
                selection: MonthDaySelection(date: "2026-11-01", setOn: "2026-09-21", handledAt: tapped, handledBy: "DayGlanceWidgetExtension"))),
            ("stale-oct-5", MonthGridEntry(date: MonthGridModelTests.at("2026-10-05", 10), snapshot: snapshot, window: window)),
        ]
        let printBase64 = ProcessInfo.processInfo.environment["DG_MONTH_SHOTS"] == "1"
        for (name, entry) in entries {
            for size in [Self.extraLargeSizes.first!, Self.extraLargeSizes.last!] {
                let image = try render(entry, w: size.w, h: size.h, scale: 2)
                let png = try XCTUnwrap(UIImage(cgImage: image).pngData())
                let label = "xl-\(name)-\(Int(size.w))x\(Int(size.h))"
                let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
                attachment.name = "\(label).png"
                attachment.lifetime = .keepAlways
                add(attachment)
                if printBase64 {
                    print("MONTHSHOT-BEGIN \(label)")
                    let b64 = png.base64EncodedString()
                    var i = b64.startIndex
                    while i < b64.endIndex {
                        let j = b64.index(i, offsetBy: 4000, limitedBy: b64.endIndex) ?? b64.endIndex
                        print("MONTHSHOT \(b64[i..<j])")
                        i = j
                    }
                    print("MONTHSHOT-END \(label)")
                }
            }
        }
    }
}
