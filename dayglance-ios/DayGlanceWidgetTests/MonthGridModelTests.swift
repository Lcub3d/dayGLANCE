import XCTest
import CoreGraphics

// ─────────────────────────────────────────────────────────────────────────────
// The month grid's rules, through the live-shaped fixture the JS producers
// write (widgetSnapshot.live.json: pushed Monday 2026-09-21 in Denver, Monday
// weeks, a crowded 1 October) and through small synthetic windows where a
// rule needs a shape the fixture does not have.
// ─────────────────────────────────────────────────────────────────────────────

final class MonthGridModelTests: XCTestCase {

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Denver")!
        return c
    }()
    static let locale = Locale(identifier: "en_US")
    private var calendar: Calendar { Self.calendar }

    static func fixtureData() throws -> Data {
        let url = try XCTUnwrap(Bundle(for: MonthGridModelTests.self).url(forResource: "widgetSnapshot.live", withExtension: "json"))
        return try Data(contentsOf: url)
    }

    static func fixture() throws -> (WidgetSnapshot, MonthWindowPayload) {
        let data = try fixtureData()
        let snapshot = try XCTUnwrap(decodeSnapshot(data), "the whole snapshot still decodes with monthWindow in it")
        let window = try XCTUnwrap(MonthWindowStore.decode(data), "the month window decodes from the live payload")
        return (snapshot, window)
    }

    /// Local time on a 'yyyy-MM-dd' day.
    static func at(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Date {
        let d = WidgetFreshness.parseDay(day, calendar: calendar)!
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: d)!
    }

    /// A synthetic 49-day window from `from`, with a bar on every day so a
    /// cell can be traced to its date.
    static func window(from: String, weekStart: Int, days count: Int = 49) -> MonthWindowPayload {
        let start = WidgetFreshness.parseDay(from, calendar: calendar)!
        let days = (0..<count).map { i -> MonthWindowDay in
            let d = calendar.date(byAdding: .day, value: i, to: start)!
            return MonthWindowDay(date: MonthGrid.isoDay(d, calendar: calendar), bars: [MonthWindowBar(s: 540, d: 60, c: "#3b82f6")])
        }
        return MonthWindowPayload(from: from, weekStart: weekStart, days: days)
    }

    static func snapshot(date: String, days: [String], updatedAt: Date? = nil) -> WidgetSnapshot {
        var s = WidgetSnapshot()
        s.date = date
        s.days = days.map { WidgetDay(date: $0) }
        s.updatedAt = (updatedAt ?? at(date, 8)).timeIntervalSince1970 * 1000
        return s
    }

    private func resolve(_ snapshot: WidgetSnapshot?, _ window: MonthWindowPayload?, at now: Date) -> MonthGridState? {
        MonthGridState.resolve(snapshot: snapshot, window: window, at: now, calendar: calendar, locale: Self.locale)
    }

    // MARK: Decoding

    func testTheFixtureWindowIsWhatTheProducersBuilt() throws {
        let (_, window) = try Self.fixture()
        XCTAssertEqual(window.from, "2026-09-21")
        XCTAssertEqual(window.weekStart, 1)
        XCTAssertEqual(window.days.count, 49, "six weeks plus the rollover tail")
        XCTAssertEqual(window.days.first?.date, "2026-09-21")
        XCTAssertEqual(window.days.last?.date, "2026-11-08")
    }

    /// The month window is decoded on its own: a malformed one costs this
    /// widget its grid, never the other widgets their snapshot.
    func testAMalformedWindowLeavesTheSnapshotAlone() throws {
        let json = """
        {"date":"2026-09-21","updatedAt":1,"monthWindow":{"from":"2026-09-21","weekStart":1,"days":"oops"}}
        """.data(using: .utf8)!
        XCTAssertNotNil(decodeSnapshot(json), "the rest of the payload is untouched")
        XCTAssertNil(MonthWindowStore.decode(json))
    }

    func testAnAbsentOrNullWindowIsNil() {
        XCTAssertNil(MonthWindowStore.decode(#"{"date":"2026-09-21"}"#.data(using: .utf8)!))
        XCTAssertNil(MonthWindowStore.decode(#"{"date":"2026-09-21","monthWindow":null}"#.data(using: .utf8)!))
    }

    func testFractionalMinutesAndMissingListsStillDecode() throws {
        // ##-delimited: the hex's `"#` would close a #-delimited raw string.
        let json = ##"{"monthWindow":{"weekStart":0,"days":[{"date":"2026-09-20","bars":[{"s":540.5,"d":22.5,"c":"#fff000"}]}]}}"##
        let window = try XCTUnwrap(MonthWindowStore.decode(json.data(using: .utf8)!))
        XCTAssertEqual(window.days[0].bars, [MonthWindowBar(s: 540.5, d: 22.5, c: "#fff000")])
        XCTAssertEqual(window.days[0].allDay, [])
        XCTAssertEqual(window.days[0].deadlines, [])
    }

    // MARK: Which 42 days

    func testTheGridStartsOnThePayloadsWeekStartNotSunday() {
        let thu = Self.at("2026-09-24")
        XCTAssertEqual(MonthGrid.isoDay(MonthGrid.gridStart(for: thu, weekStart: 0, calendar: calendar), calendar: calendar), "2026-09-20")
        XCTAssertEqual(MonthGrid.isoDay(MonthGrid.gridStart(for: thu, weekStart: 1, calendar: calendar), calendar: calendar), "2026-09-21")
        // A Sunday with Monday weeks belongs to the week that started six days earlier.
        let sun = Self.at("2026-09-27")
        XCTAssertEqual(MonthGrid.isoDay(MonthGrid.gridStart(for: sun, weekStart: 1, calendar: calendar), calendar: calendar), "2026-09-21")
        XCTAssertEqual(MonthGrid.weekdayInitials(weekStart: 1, calendar: calendar).count, 7)
        XCTAssertEqual(MonthGrid.weekdayInitials(weekStart: 1, calendar: calendar).first,
                       calendar.veryShortStandaloneWeekdaySymbols[1], "Monday first")
        XCTAssertEqual(MonthGrid.weekdayInitials(weekStart: 0, calendar: calendar).first,
                       calendar.veryShortStandaloneWeekdaySymbols[0], "Sunday first")
    }

    /// resolveMonthWindow's contract: the week containing the day, by date.
    func testDaysMirrorResolveMonthWindow() throws {
        let window = Self.window(from: "2026-09-20", weekStart: 0)
        let sat = try XCTUnwrap(MonthGrid.days(in: window, for: Self.at("2026-09-26"), calendar: calendar))
        XCTAssertEqual(sat.first?.date, "2026-09-20")
        XCTAssertEqual(sat.last?.date, "2026-10-31")
        // Across the week boundary: the next six weeks, the last row from the tail.
        let sun = try XCTUnwrap(MonthGrid.days(in: window, for: Self.at("2026-09-27"), calendar: calendar))
        XCTAssertEqual(sun.count, 42)
        XCTAssertEqual(sun.first?.date, "2026-09-27")
        XCTAssertEqual(sun.last?.date, "2026-11-07")
        // Two boundaries on, or before the window: not covered.
        XCTAssertNil(MonthGrid.days(in: window, for: Self.at("2026-10-04"), calendar: calendar))
        XCTAssertNil(MonthGrid.days(in: window, for: Self.at("2026-09-19"), calendar: calendar))
        // A window without its tail cannot serve the boundary: never a partial grid.
        let short = Self.window(from: "2026-09-20", weekStart: 0, days: 42)
        XCTAssertNil(MonthGrid.days(in: short, for: Self.at("2026-09-27"), calendar: calendar))
    }

    func testDaysSurviveTheDSTChange() throws {
        // Denver leaves DST on 1 Nov 2026; a grid across it is still 42 whole days.
        let window = Self.window(from: "2026-10-18", weekStart: 0)
        let days = try XCTUnwrap(MonthGrid.days(in: window, for: Self.at("2026-11-02"), calendar: calendar))
        XCTAssertEqual(days.first?.date, "2026-11-01")
        XCTAssertEqual(days.count, 42)
    }

    // MARK: Tiers and rollover

    func testTheFixtureAcrossItsDays() throws {
        let (snapshot, window) = try Self.fixture()

        let mon = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-21", 10)))
        XCTAssertEqual(mon.tier, .pushed)
        XCTAssertEqual(mon.cells.count, 42)
        XCTAssertEqual(mon.cells.firstIndex(where: \.isToday), 0)

        // The projected days move the today marker with no push.
        for (day, index) in [("2026-09-22", 1), ("2026-09-23", 2), ("2026-09-24", 3)] {
            let s = try XCTUnwrap(resolve(snapshot, window, at: Self.at(day, 0, 0)))
            XCTAssertEqual(s.tier, .projected, day)
            XCTAssertFalse(s.freshness.isStale, day)
            XCTAssertEqual(s.cells.first?.date, "2026-09-21", day)
            XCTAssertEqual(s.cells.firstIndex(where: \.isToday), index, day)
        }

        // Past the payload's horizon (the last projected day), Outdated — even
        // though this window could still draw Friday's grid. The other widgets
        // go Outdated on the same midnight; this one must not read as current.
        let fri = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-25", 0, 0)))
        XCTAssertEqual(fri.tier, .stale)
        XCTAssertTrue(fri.freshness.isStale)
        XCTAssertEqual(fri.cells.first?.date, "2026-09-21", "the push's own grid, dimmed")
        XCTAssertNil(fri.cells.firstIndex(where: \.isToday), "no today marker on a stale grid")

        // Clock moved back before the push: stale, like the other widgets.
        XCTAssertEqual(resolve(snapshot, window, at: Self.at("2026-09-20"))?.tier, .stale)
    }

    /// A push on a Saturday with Sunday weeks: the next midnight is a week
    /// boundary, and the whole grid moves down a row from the tail.
    func testAWeekBoundaryInsideTheHorizonRollsTheGrid() throws {
        let window = Self.window(from: "2026-09-20", weekStart: 0)
        let snapshot = Self.snapshot(date: "2026-09-26", days: ["2026-09-27", "2026-09-28", "2026-09-29"])

        let sat = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-26", 21)))
        XCTAssertEqual(sat.tier, .pushed)
        XCTAssertEqual(sat.cells.first?.date, "2026-09-20")
        XCTAssertEqual(sat.cells.firstIndex(where: \.isToday), 6)

        let sun = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-27", 0, 0)))
        XCTAssertEqual(sun.tier, .projected)
        XCTAssertEqual(sun.cells.first?.date, "2026-09-27")
        XCTAssertEqual(sun.cells.last?.date, "2026-11-07")
        XCTAssertEqual(sun.cells.firstIndex(where: \.isToday), 0)
        XCTAssertTrue(sun.cells[0].isWindowFirst)

        let tue = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-29", 23, 59)))
        XCTAssertEqual(tue.tier, .projected)
        XCTAssertEqual(tue.cells.firstIndex(where: \.isToday), 2)

        XCTAssertEqual(resolve(snapshot, window, at: Self.at("2026-09-30", 0, 0))?.tier, .stale)
    }

    func testNoWindowMeansNothingToDraw() throws {
        let (snapshot, _) = try Self.fixture()
        XCTAssertNil(resolve(snapshot, nil, at: Self.at("2026-09-21")))
        XCTAssertNil(resolve(snapshot, MonthWindowPayload(from: nil, weekStart: 0, days: []), at: Self.at("2026-09-21")))
    }

    func testTimelineEntriesAreThePayloadsMidnights() throws {
        let (snapshot, _) = try Self.fixture()
        let now = Self.at("2026-09-21", 10, 7)
        let dates = MonthGridTimeline.entryDates(now: now, snapshot: snapshot, calendar: calendar)
        XCTAssertEqual(dates.first, now)
        XCTAssertEqual(Array(dates.dropFirst()), ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map { Self.at($0, 0, 0) },
                       "each projected day's midnight, then the Outdated flip")
        XCTAssertNil(MonthGridTimeline.nextReload(after: dates, now: now, calendar: calendar), ".atEnd while there are midnights ahead")

        // Already past the flip: one entry, and a reload at the next midnight
        // rather than .atEnd, which would ask again immediately.
        let late = Self.at("2026-09-27", 15)
        let stale = MonthGridTimeline.entryDates(now: late, snapshot: snapshot, calendar: calendar)
        XCTAssertEqual(stale, [late])
        XCTAssertEqual(MonthGridTimeline.nextReload(after: stale, now: late, calendar: calendar), Self.at("2026-09-28", 0, 0))
    }

    // MARK: Cells

    func testTheFixturesCells() throws {
        let (snapshot, window) = try Self.fixture()
        let cells = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-21", 10))).cells

        // Sep 21: today AND the window's first day, six bars → capped, +2,
        // so the label drops to the bare number and the weight carries it.
        let first = cells[0]
        XCTAssertTrue(first.isToday); XCTAssertTrue(first.isWindowFirst); XCTAssertTrue(first.isBold)
        XCTAssertEqual(first.bars.count, 4)
        XCTAssertEqual(first.overflow, 2, "five tasks and today's placed routine")
        XCTAssertEqual(first.label, "21")

        // Oct 1: the crowded first of the month — seven bars, an all-day item
        // and a deadline. One pip, +3, bare number, bold.
        let oct1 = try XCTUnwrap(cells.first { $0.date == "2026-10-01" })
        XCTAssertTrue(oct1.isFirstOfMonth); XCTAssertTrue(oct1.isBold)
        XCTAssertTrue(oct1.hasPip)
        XCTAssertEqual(oct1.bars.map(\.s), [510, 600, 690, 810], "the four earliest")
        XCTAssertEqual(oct1.overflow, 3)
        XCTAssertEqual(oct1.label, "1")

        // Nov 1: a quiet first of the month keeps its month.
        let nov1 = try XCTUnwrap(cells.first { $0.date == "2026-11-01" })
        XCTAssertTrue(nov1.isFirstOfMonth)
        XCTAssertFalse(nov1.hasPip)
        XCTAssertEqual(nov1.overflow, 0)
        XCTAssertEqual(nov1.label, "Nov 1")

        // An all-day item alone is a pip; so is a deadline alone.
        XCTAssertTrue(try XCTUnwrap(cells.first { $0.date == "2026-09-24" }).hasPip, "all-day")
        XCTAssertTrue(try XCTUnwrap(cells.first { $0.date == "2026-09-27" }).hasPip, "deadline")
        // An ordinary day: plain weight, no month, no pip.
        let plain = try XCTUnwrap(cells.first { $0.date == "2026-09-28" })
        XCTAssertFalse(plain.isBold); XCTAssertFalse(plain.hasPip); XCTAssertEqual(plain.label, "28")
        // No other cell is marked first-of-window.
        XCTAssertEqual(cells.filter(\.isWindowFirst).count, 1)
    }

    func testAQuietWindowFirstDayCarriesTheMonth() {
        let day = MonthWindowDay(date: "2026-09-20", bars: [MonthWindowBar(s: 540, d: 30, c: "#fff000")])
        let cell = MonthGridCell.make(day, index: 0, today: nil, calendar: calendar, locale: Self.locale)
        XCTAssertTrue(cell.isBold)
        XCTAssertFalse(cell.isFirstOfMonth, "the window's first day gets no box")
        XCTAssertEqual(cell.label, "Sep 20")
    }

    func testTapURLOpensTheDayWithoutForcingAView() {
        XCTAssertEqual(MonthGrid.tapURL(date: "2026-10-01")?.absoluteString, "dayglance://day?date=2026-10-01")
    }

    // MARK: Bars

    private func frame(_ s: Double, _ d: Double, track: CGFloat = 140) -> MonthBarFrame {
        MonthGrid.barFrame(MonthWindowBar(s: s, d: d, c: "#000000"), trackHeight: track)
    }

    /// Frames compare to a hair: 120/840 × 140 is not exactly 20 in binary.
    private func assertFrame(_ f: MonthBarFrame, _ y: CGFloat, _ h: CGFloat, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(f.y, y, accuracy: 1e-9, "y", file: file, line: line)
        XCTAssertEqual(f.height, h, accuracy: 1e-9, "height", file: file, line: line)
    }

    func testBarsMapTheHourWindowToTheTrack() {
        // 14 hours on a 140pt track: 10pt per hour.
        assertFrame(frame(7 * 60, 60), 0, 10)
        assertFrame(frame(9 * 60, 120), 20, 20)
        assertFrame(frame(20 * 60, 60), 130, 10)
    }

    func testShortItemsKeepTheMinimumHeight() {
        assertFrame(frame(12 * 60, 15), 50, 2.5)
        assertFrame(frame(12 * 60, 5), 50, MonthGrid.minBarHeight)
        assertFrame(frame(12 * 60, 0), 50, MonthGrid.minBarHeight)
        // The minimum never pushes a bar out of the bottom.
        assertFrame(frame(21 * 60 - 5, 5), 140 - MonthGrid.minBarHeight, MonthGrid.minBarHeight)
    }

    func testItemsOutsideTheWindowClampToTheEdges() {
        // Wholly before 7:00 → a minimum bar at the top.
        assertFrame(frame(6 * 60, 45), 0, MonthGrid.minBarHeight)
        // Wholly after 21:00 → a minimum bar at the bottom.
        assertFrame(frame(22 * 60 + 30, 90), 140 - MonthGrid.minBarHeight, MonthGrid.minBarHeight)
        // Straddling 7:00 keeps its in-window part.
        assertFrame(frame(6 * 60, 120), 0, 10)
        // Straddling 21:00 likewise.
        assertFrame(frame(20 * 60 + 30, 120), 135, 5)
        // All day long → the whole track.
        assertFrame(frame(0, 1440), 0, 140)
    }

    func testAZeroTrackDrawsNothing() {
        assertFrame(frame(540, 60, track: 0), 0, 0)
    }
}
