import XCTest
@testable import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// The entry set (Phase 4): the grid, the exact block boundaries, the
// midnights, the Outdated flip, and the counts on a typical and a busy day.
// A fixed calendar and zone, so the numbers are the same everywhere.
// ─────────────────────────────────────────────────────────────────────────────

final class TimelineTests: XCTestCase {

    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Chicago")!
        return c
    }()

    private func date(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Date {
        var c = DateComponents(); c.year = y; c.month = mo; c.day = d; c.hour = h; c.minute = mi
        return cal.date(from: c)!
    }

    private func clock(_ date: Date) -> String {
        let c = cal.dateComponents([.month, .day, .hour, .minute], from: date)
        return String(format: "%02d-%02d %02d:%02d", c.month!, c.day!, c.hour!, c.minute!)
    }

    private func block(_ s: Double, _ e: Double, kind: DialBlockKind = .task) -> DialFaceBlock {
        DialFaceBlock(id: "\(s)-\(e)", kind: kind, startMin: s, endMin: e)
    }

    /// The palette study's dense day.
    private var denseBlocks: [DialFaceBlock] {
        [block(0, 385, kind: .sleep), block(385, 420, kind: .routine), block(435, 480), block(480, 540), block(540, 600),
         block(600, 750), block(750, 810), block(810, 870), block(870, 915), block(915, 1035), block(1035, 1080),
         block(1080, 1140), block(1140, 1185), block(1185, 1290), block(1290, 1330, kind: .routine), block(1350, 1440, kind: .sleep)]
    }

    // MARK: boundaries

    func testBoundariesAreEveryStartAndEndButNotTheMidnights() {
        let b = DialTimeline.boundaryMinutes([block(0, 385, kind: .sleep), block(385, 420), block(600, 750), block(1350, 1440, kind: .sleep)])
        XCTAssertEqual(b, [385, 420, 600, 750, 1350])
    }

    // MARK: the grid

    func testGridStartFloorsToTheStepOnTheWallClock() {
        XCTAssertEqual(clock(DialTimeline.gridStart(date(2026, 9, 21, 11, 20), calendar: cal)), "09-21 11:15")
        XCTAssertEqual(clock(DialTimeline.gridStart(date(2026, 9, 21, 11, 15), calendar: cal)), "09-21 11:15")
        XCTAssertEqual(clock(DialTimeline.gridStart(date(2026, 9, 21, 0, 4), calendar: cal)), "09-21 00:00")
    }

    func testAPlainGridIsNinetySixEntriesOverTwentyFourHours() {
        let now = date(2026, 9, 21, 11, 20)
        let entries = DialTimeline.entryDates(now: now, days: [], payloadEnd: nil, calendar: cal)
        XCTAssertEqual(entries.count, 96)
        XCTAssertEqual(clock(entries.first!), "09-21 11:15")
        XCTAssertEqual(clock(entries.last!), "09-22 11:00")
        XCTAssertEqual(entries, entries.sorted())
        XCTAssertEqual(Set(entries).count, entries.count)
    }

    // MARK: boundaries land exactly, midnights switch the day, the payload end flips to Outdated

    func testABlockBoundaryOffTheGridGetsItsOwnEntry() {
        let now = date(2026, 9, 21, 5, 50)
        let today = cal.startOfDay(for: now)
        let days = [DialTimeline.Day(start: today, boundaryMinutes: DialTimeline.boundaryMinutes([block(385, 420), block(420, 480)]))]
        let entries = DialTimeline.entryDates(now: now, days: days, payloadEnd: nil, calendar: cal)
        let clocks = entries.map(clock)
        XCTAssertTrue(clocks.contains("09-21 06:25"), "06:25 is a boundary, not the next 15-minute mark")
        XCTAssertTrue(clocks.contains("09-21 07:00"))
        XCTAssertTrue(clocks.contains("09-21 08:00"))
        // On-grid boundaries do not duplicate the grid.
        XCTAssertEqual(clocks.filter { $0 == "09-21 07:00" }.count, 1)
        XCTAssertEqual(entries.count, 96 + 1, "96 grid plus 06:25; the midnight is on the grid")
    }

    func testBoundariesBeforeNowOrPastTheHorizonAreDropped() {
        let now = date(2026, 9, 21, 11, 20)
        let today = cal.startOfDay(for: now)
        let tomorrow = cal.date(byAdding: .day, value: 1, to: today)!
        let days = [DialTimeline.Day(start: today, boundaryMinutes: [385, 1330]),      // 06:25 is past; 22:10 ahead
                    DialTimeline.Day(start: tomorrow, boundaryMinutes: [385, 1330])]   // 06:25 ahead; 22:10 past the horizon
        let clocks = DialTimeline.entryDates(now: now, days: days, payloadEnd: nil, calendar: cal).map(clock)
        XCTAssertFalse(clocks.contains("09-21 06:25"))
        XCTAssertTrue(clocks.contains("09-21 22:10"))
        XCTAssertTrue(clocks.contains("09-22 06:25"))
        XCTAssertFalse(clocks.contains("09-22 22:10"))
    }

    func testMidnightsThroughThePayloadEndAndTheEndItselfIsTheOutdatedFlip() {
        // Pushed day only, no days[]: the payload ends at the next midnight.
        let now = date(2026, 9, 21, 20, 0)
        let today = cal.startOfDay(for: now)
        let end = cal.date(byAdding: .day, value: 1, to: today)!
        let entries = DialTimeline.entryDates(now: now, days: [DialTimeline.Day(start: today, boundaryMinutes: [])], payloadEnd: end, calendar: cal)
        XCTAssertTrue(entries.contains(end), "the midnight after the last day is in the set: the entry that renders Outdated")
        XCTAssertEqual(entries.filter { $0 == end }.count, 1)
        // With three projected days the horizon holds only tonight's midnight.
        let far = cal.date(byAdding: .day, value: 4, to: today)!
        let more = DialTimeline.entryDates(now: now, days: [DialTimeline.Day(start: today, boundaryMinutes: [])], payloadEnd: far, calendar: cal)
        XCTAssertTrue(more.contains(end))
        XCTAssertFalse(more.contains(far))
        XCTAssertEqual(more.count, 96, "midnight 00:00 is on the grid")
    }

    func testNoPayloadEndStillSwitchesAtMidnight() {
        let now = date(2026, 9, 21, 23, 50)
        let midnight = date(2026, 9, 22, 0, 0)
        let entries = DialTimeline.entryDates(now: now, days: [], payloadEnd: nil, calendar: cal)
        XCTAssertTrue(entries.contains(midnight))
    }

    // MARK: the counts

    func testTypicalDayCount() {
        // The study's dense day today and again tomorrow (projected), at 11:20.
        let now = date(2026, 9, 21, 11, 20)
        let today = cal.startOfDay(for: now)
        let tomorrow = cal.date(byAdding: .day, value: 1, to: today)!
        let b = DialTimeline.boundaryMinutes(denseBlocks)
        let days = [DialTimeline.Day(start: today, boundaryMinutes: b), DialTimeline.Day(start: tomorrow, boundaryMinutes: b)]
        let end = cal.date(byAdding: .day, value: 4, to: today)!
        let entries = DialTimeline.entryDates(now: now, days: days, payloadEnd: end, calendar: cal)
        // 96 grid + off-grid boundaries in range: today 22:10; tomorrow 06:25 (and 07:15 is on-grid).
        XCTAssertEqual(entries.count, 98)
        XCTAssertLessThanOrEqual(entries.count, 100)
    }

    func testBusyDayCountStaysBounded() {
        // 24 blocks a day at odd minutes: every boundary is off the grid.
        var blocks: [DialFaceBlock] = []
        for i in 0..<24 {
            let s = Double(i * 60 + 7), e = Double(i * 60 + 53)
            blocks.append(block(s, e))
        }
        let now = date(2026, 9, 21, 11, 20)
        let today = cal.startOfDay(for: now)
        let tomorrow = cal.date(byAdding: .day, value: 1, to: today)!
        let b = DialTimeline.boundaryMinutes(blocks)
        XCTAssertEqual(b.count, 48)
        let days = [DialTimeline.Day(start: today, boundaryMinutes: b), DialTimeline.Day(start: tomorrow, boundaryMinutes: b)]
        let entries = DialTimeline.entryDates(now: now, days: days, payloadEnd: cal.date(byAdding: .day, value: 4, to: today), calendar: cal)
        // 96 grid + 48 boundaries in the 24-hour window (every hour has two, all off-grid).
        XCTAssertEqual(entries.count, 96 + 48)
        // The bound: grid + 2 boundaries per block in range + the midnights.
        XCTAssertLessThanOrEqual(entries.count, 96 + 2 * 24 + 2)
    }
}
