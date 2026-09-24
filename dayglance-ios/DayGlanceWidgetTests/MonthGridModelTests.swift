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

    // MARK: DST
    //
    // The model picks its 42 days by date string and slices by index, so a
    // grid that merely CONTAINS a transition cannot go wrong (first test). The
    // two places a transition can break it are the date arithmetic: the grid
    // start (a subtraction of whole days from the entry's day) and the
    // timeline's midnights (a walk forward one day at a time). Both are done
    // in calendar days; each of the last two tests fails if either is ever
    // done in seconds.

    func testAGridContainingTheDSTChangeIsFortyTwoConsecutiveDays() throws {
        // Denver leaves DST at 02:00 on Sunday 1 Nov 2026 (the day is 25h).
        // Grid 18 Oct … 28 Nov: the change falls in its third week, index 14.
        let window = Self.window(from: "2026-10-18", weekStart: 0)
        let days = try XCTUnwrap(MonthGrid.days(in: window, for: Self.at("2026-10-20"), calendar: calendar))
        XCTAssertEqual(days.count, 42)
        XCTAssertEqual(days.first?.date, "2026-10-18")
        XCTAssertEqual(days[14].date, "2026-11-01")
        XCTAssertEqual(days.last?.date, "2026-11-28")
        let tz = calendar.timeZone
        let transition = try XCTUnwrap(tz.nextDaylightSavingTimeTransition(after: Self.at("2026-10-18")))
        XCTAssertEqual(MonthGrid.isoDay(transition, calendar: calendar), "2026-11-01", "the transition is inside this grid")
        let parsed = days.compactMap { WidgetFreshness.parseDay($0.date, calendar: calendar) }
        for (a, b) in zip(parsed, parsed.dropFirst()) {
            XCTAssertEqual(calendar.dateComponents([.day], from: a, to: b).day, 1, "\(a) → \(b)")
        }
    }

    /// The grid start across a transition. With Sunday or Monday weeks it can
    /// never cross one in the US or the EU — both change early on a Sunday,
    /// the first or last day of such a week — so this uses a zone that
    /// changes midweek: Cairo springs forward at midnight into Friday 24 April
    /// 2026 (00:00 → 01:00). Saturday 25 April's week starts Sunday 19 April;
    /// subtracting 6 × 86 400 s from Saturday's midnight lands on 18 April at
    /// 23:00, the day before.
    func testTheGridStartIsCalendarDaysAcrossASpringForward() throws {
        var cairo = Calendar(identifier: .gregorian)
        cairo.timeZone = try XCTUnwrap(TimeZone(identifier: "Africa/Cairo"))
        let sat = try XCTUnwrap(WidgetFreshness.parseDay("2026-04-25", calendar: cairo))
        let transition = try XCTUnwrap(cairo.timeZone.nextDaylightSavingTimeTransition(after: sat.addingTimeInterval(-6 * 86_400)))
        XCTAssertEqual(MonthGrid.isoDay(transition, calendar: cairo), "2026-04-24",
                       "precondition: this device's tz data has Cairo's 2026 spring-forward inside the week")
        XCTAssertEqual(MonthGrid.isoDay(MonthGrid.gridStart(for: sat, weekStart: 0, calendar: cairo), calendar: cairo), "2026-04-19")
        // And the window lookup that depends on it.
        let window = MonthWindowPayload(from: "2026-04-19", weekStart: 0, days: (0..<49).map { i in
            MonthWindowDay(date: MonthGrid.isoDay(cairo.date(byAdding: .day, value: i, to: WidgetFreshness.parseDay("2026-04-19", calendar: cairo)!)!, calendar: cairo))
        })
        XCTAssertEqual(MonthGrid.days(in: window, for: sat, calendar: cairo)?.first?.date, "2026-04-19")
    }

    /// The timeline across Denver's fall-back: every entry is a local
    /// midnight, including the one after the 25-hour day. Stepping 86 400 s
    /// from 1 Nov 00:00 would land on 1 Nov 23:00 and move the grid an hour
    /// early.
    func testTimelineMidnightsSurviveTheFallBack() throws {
        let window = Self.window(from: "2026-10-25", weekStart: 0)          // Sunday weeks
        let now = Self.at("2026-10-31", 20)                                  // Saturday evening
        let dates = MonthGridTimeline.entryDates(now: now, window: window, calendar: calendar)
        let midnights = Array(dates.dropFirst())
        XCTAssertEqual(midnights.first, Self.at("2026-11-01", 0, 0))
        XCTAssertEqual(midnights.dropFirst().first, Self.at("2026-11-02", 0, 0))
        XCTAssertEqual(midnights[1].timeIntervalSince(midnights[0]), 25 * 3600, "the transition is between these two entries")
        for d in midnights {
            let c = calendar.dateComponents([.hour, .minute], from: d)
            XCTAssertEqual(c.hour, 0, "\(d)"); XCTAssertEqual(c.minute, 0, "\(d)")
        }
        // And the entry after the change draws the right day as today.
        let state = try XCTUnwrap(resolve(Self.snapshot(date: "2026-10-31", days: []), window, at: midnights[1]))
        XCTAssertEqual(state.cells.first(where: \.isToday)?.date, "2026-11-02")
    }

    // MARK: Tiers and rollover

    func testTheFixtureAcrossItsDays() throws {
        // Pushed Monday 21 Sep, Monday weeks: the window is 21 Sep … 8 Nov,
        // so grids starting 21 Sep and 28 Sep are covered — live through
        // Sunday 4 Oct, thirteen days past the push.
        let (snapshot, window) = try Self.fixture()

        let mon = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-21", 10)))
        XCTAssertEqual(mon.tier, .pushed)
        XCTAssertEqual(mon.cells.count, 42)
        XCTAssertEqual(mon.cells.firstIndex(where: \.isToday), 0)

        // Every later day of the push's week: the same grid, today moving.
        for offset in 1...6 {
            let day = calendar.date(byAdding: .day, value: offset, to: Self.at("2026-09-21", 0, 0))!
            let s = try XCTUnwrap(resolve(snapshot, window, at: day))
            XCTAssertEqual(s.tier, .projected, "\(day)")
            XCTAssertFalse(s.freshness.isStale)
            XCTAssertEqual(s.cells.first?.date, "2026-09-21")
            XCTAssertEqual(s.cells.firstIndex(where: \.isToday), offset)
        }
        // The next week: the grid moves down a row, the last row from the tail.
        let nextMon = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-09-28", 0, 0)))
        XCTAssertEqual(nextMon.tier, .projected)
        XCTAssertEqual(nextMon.cells.first?.date, "2026-09-28")
        XCTAssertEqual(nextMon.cells.last?.date, "2026-11-08")
        // Past the dial's horizon (it goes Outdated on the 25th) and still live.
        XCTAssertEqual(resolve(snapshot, window, at: Self.at("2026-09-25", 0, 0))?.tier, .projected)
        let lastLive = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-10-04", 23, 59)))
        XCTAssertEqual(lastLive.tier, .projected)
        XCTAssertEqual(lastLive.cells.firstIndex(where: \.isToday), 6)

        // The first day whose grid the window cannot cover: stale, and the
        // push's own grid, not a partial one.
        let stale = try XCTUnwrap(resolve(snapshot, window, at: Self.at("2026-10-05", 0, 0)))
        XCTAssertEqual(stale.tier, .stale)
        XCTAssertTrue(stale.freshness.isStale)
        XCTAssertEqual(stale.freshness.daysOld, 14)
        XCTAssertEqual(stale.cells.count, 42)
        XCTAssertEqual(stale.cells.first?.date, "2026-09-21")
        XCTAssertNil(stale.cells.firstIndex(where: \.isToday))

        // Clock moved back before the window: stale too.
        XCTAssertEqual(resolve(snapshot, window, at: Self.at("2026-09-20"))?.tier, .stale)
    }

    /// How long the grid stays live depends only on where in its week the
    /// push landed: through the end of the NEXT week, so 13 days past a push
    /// on the first day of the week down to 7 past one on the last. Every
    /// weekday, both week starts.
    func testTheGridLivesUntilTheEndOfTheWeekAfterThePush() throws {
        for (weekStart, from) in [(0, "2026-09-20"), (1, "2026-09-21")] {
            let window = Self.window(from: from, weekStart: weekStart)
            let w0 = Self.at(from, 0, 0)
            for k in 0...6 {
                let pushDay = calendar.date(byAdding: .day, value: k, to: w0)!
                let snapshot = Self.snapshot(date: MonthGrid.isoDay(pushDay, calendar: calendar), days: [])
                var live = 0
                var day = pushDay
                while resolve(snapshot, window, at: day)?.tier != .stale, live < 60 {
                    live += 1
                    day = calendar.date(byAdding: .day, value: 1, to: day)!
                }
                let label = "weekStart \(weekStart), push on day \(k) of the week"
                // Across the week boundary the grid moves down a row, its last
                // row from the rollover tail.
                let nextWeek = calendar.date(byAdding: .day, value: 7, to: w0)!
                let rolled = try XCTUnwrap(resolve(snapshot, window, at: nextWeek), label)
                XCTAssertEqual(rolled.cells.first?.date, MonthGrid.isoDay(nextWeek, calendar: calendar), label)
                XCTAssertEqual(rolled.cells.last?.date, window.days.last?.date, label)
                XCTAssertEqual(rolled.cells.firstIndex(where: \.isToday), 0, label)
                XCTAssertEqual(live - 1, 13 - k, "\(label): days live past the push")
                XCTAssertEqual(MonthGrid.isoDay(day, calendar: calendar),
                               MonthGrid.isoDay(calendar.date(byAdding: .day, value: 14, to: w0)!, calendar: calendar),
                               "\(label): stale from the Monday/Sunday two weeks on")
                // The timeline reaches exactly that far: every live midnight, then the flip.
                let dates = MonthGridTimeline.entryDates(now: pushDay.addingTimeInterval(3600), window: window, calendar: calendar)
                XCTAssertEqual(dates.count, 1 + (13 - k) + 1, label)
                XCTAssertEqual(dates.last, day, "\(label): the last entry is the Outdated flip")
            }
        }
    }

    func testNoWindowMeansNothingToDraw() throws {
        let (snapshot, _) = try Self.fixture()
        XCTAssertNil(resolve(snapshot, nil, at: Self.at("2026-09-21")))
        XCTAssertNil(resolve(snapshot, MonthWindowPayload(from: nil, weekStart: 0, days: []), at: Self.at("2026-09-21")))
    }

    func testTimelineEntriesAreTheLiveMidnights() throws {
        let (_, window) = try Self.fixture()
        let now = Self.at("2026-09-21", 10, 7)
        let dates = MonthGridTimeline.entryDates(now: now, window: window, calendar: calendar)
        XCTAssertEqual(dates.first, now)
        let expected = (1...14).map { calendar.date(byAdding: .day, value: $0, to: Self.at("2026-09-21", 0, 0))! }
        XCTAssertEqual(Array(dates.dropFirst()), expected, "22 Sep … 4 Oct, then 5 Oct: the Outdated flip")
        XCTAssertNil(MonthGridTimeline.nextReload(after: dates, now: now, calendar: calendar), ".atEnd while there are midnights ahead")

        // Already past the flip: one entry, and a reload at the next midnight
        // rather than .atEnd, which would ask again immediately.
        let late = Self.at("2026-10-06", 15)
        let stale = MonthGridTimeline.entryDates(now: late, window: window, calendar: calendar)
        XCTAssertEqual(stale, [late])
        XCTAssertEqual(MonthGridTimeline.nextReload(after: stale, now: late, calendar: calendar), Self.at("2026-10-07", 0, 0))
        XCTAssertEqual(MonthGridTimeline.entryDates(now: late, window: nil, calendar: calendar), [late])
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

    func testTapURLOpensTheDayInMonth() {
        XCTAssertEqual(MonthGrid.tapURL(date: "2026-10-01")?.absoluteString, "dayglance://day?date=2026-10-01&view=month")
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
