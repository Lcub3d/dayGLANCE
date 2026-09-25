import Foundation
import CoreGraphics

// ─────────────────────────────────────────────────────────────────────────────
// Month grid — the model. Everything the systemLarge month widget decides is
// here, free of SwiftUI, so it is testable on its own: which 42 days to draw
// for an entry, which tier they are in, what each cell says, and where each
// bar lands. MonthGridWidget.swift only draws what this returns.
//
// THE PAYLOAD is the snapshot's `monthWindow` (src/utils/widgetMonthWindow.js):
// 49 days from the start of the push's week — six grid weeks plus a one-week
// rollover tail — each with bars {s, d, c} and per-day `allDay` / `deadlines`
// colour lists. It is baked at push time; nothing runs JS at midnight.
//
// IT IS DECODED SEPARATELY from WidgetSnapshot, on purpose. That decode is
// whole-or-nothing (decodeSnapshot's header): one field in an unexpected
// shape blanks every widget. The month window is the newest and largest block
// in the payload, so it gets its own lenient envelope — a malformed window
// costs this widget its grid and nothing else. Bar minutes decode as Double
// for the same reason: a fractional duration must not reject the window.
//
// WHICH 42: resolveMonthWindow in the JS module is the reference. The grid
// starts on the first day of the week containing the ENTRY's day, by the
// payload's `weekStart`, and the days are looked up by date, never by index
// from "now". So an entry past a week boundary draws the next six weeks from
// the tail with no push.
//
// STALENESS is coverage, not age. The grid is live on any day whose whole
// six-week grid the stored window covers, and stale from the first day it
// does not. That is deliberately NOT the Up Next and dial widgets' horizon
// (the last projected day, push + 3): those show one day and have nothing
// past it, while this window carries 49 days precisely so the grid outlives
// a push. With `from` the start of the push's week, a day's grid is covered
// while its week starts no later than from + 7: live through the end of the
// week AFTER the push's — from + 13 — which is 13 days past a push on the
// first day of the week and 7 past one on the last.
//   pushed     the entry's day is the day the snapshot was built
//   projected  any other covered day: "Planned as of …"
//   stale      not covered: the PUSH's own grid, dimmed, labelled, no today
//              marker — never a partial grid
//   unknown    the snapshot did not say what day it is: drawn as pushed
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Payload

struct MonthWindowPayload: Decodable, Equatable {
    /// First day of the push's week, 'yyyy-MM-dd'.
    var from: String?
    /// 0 = Sunday, 1 = Monday: the app's week-start setting at push time.
    var weekStart: Int?
    var days: [MonthWindowDay]

    init(from: String?, weekStart: Int?, days: [MonthWindowDay]) {
        self.from = from
        self.weekStart = weekStart
        self.days = days
    }
}

struct MonthWindowDay: Decodable, Equatable {
    var date: String
    /// Start-sorted, already clipped at midnight (an overnight block's
    /// remainder opens the next day at 0).
    var bars: [MonthWindowBar]
    /// One hex per all-day item / deadline. Only presence is drawn here.
    var allDay: [String]
    var deadlines: [String]

    init(date: String, bars: [MonthWindowBar] = [], allDay: [String] = [], deadlines: [String] = []) {
        self.date = date
        self.bars = bars
        self.allDay = allDay
        self.deadlines = deadlines
    }

    private enum CodingKeys: String, CodingKey { case date, bars, allDay, deadlines }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        bars = (try? c.decodeIfPresent([MonthWindowBar].self, forKey: .bars)) ?? []
        allDay = (try? c.decodeIfPresent([String].self, forKey: .allDay)) ?? []
        deadlines = (try? c.decodeIfPresent([String].self, forKey: .deadlines)) ?? []
    }
}

struct MonthWindowBar: Decodable, Equatable {
    /// Start, minutes past local midnight.
    var s: Double
    /// Duration in minutes.
    var d: Double
    /// Resolved hex colour.
    var c: String
}

enum MonthWindowStore {
    private struct Envelope: Decodable { var monthWindow: MonthWindowPayload? }

    /// The window from the stored snapshot bytes, or nil — absent (an app
    /// build from before the field), null (not a native push), or malformed.
    static func decode(_ data: Data) -> MonthWindowPayload? {
        (try? JSONDecoder().decode(Envelope.self, from: data))?.monthWindow
    }

    static func load() -> MonthWindowPayload? {
        guard let defaults = UserDefaults(suiteName: kAppGroupSuite),
              let data = defaults.data(forKey: kSnapshotKey) else { return nil }
        return decode(data)
    }
}

// MARK: - Constants

enum MonthGrid {
    /// The widget's kind, here rather than on MonthGridWidget: a Widget is
    /// main-actor isolated, and SelectMonthDayIntent.perform() — which runs
    /// off the main actor — reloads by this name (a Swift 6 error otherwise).
    static let widgetKind = "MonthGridWidget"

    static let columns = 7
    static let rows = 6
    static let cellCount = columns * rows

    /// The hours a cell's track maps to its full height, in minutes. The in-app
    /// month cell's window (MONTH_CELL_LAYOUT.window, src/constants/monthView.js),
    /// so a bar sits at the same relative height here as in the app's month view.
    static let windowStartMinutes: Double = 7 * 60
    static let windowEndMinutes: Double = 21 * 60

    /// Bars drawn per day; the rest are reported as `+N`.
    static let barCap = 4

    /// A bar never draws thinner than this, in points. The in-app cell's 4px
    /// minimum (MONTH_CELL_LAYOUT.minBandHeight) is ~4.4% of a ~90px phone
    /// cell; this is the same share of the widget's track (~36pt on a 6.1"
    /// iPhone, ~28pt on iPad mini), where an absolute 4pt would be a seventh
    /// of the track and swallow two hours. 2pt is 6px at 3×: a 15-minute
    /// item stays a visible line.
    static let minBarHeight: CGFloat = 2

    /// 'yyyy-MM-dd' of a date in `calendar`'s zone.
    static func isoDay(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// First day of the week containing `day`, by `weekStart` (0 = Sunday) —
    /// monthWindowStart in the JS module.
    static func gridStart(for day: Date, weekStart: Int, calendar: Calendar) -> Date {
        let start = calendar.startOfDay(for: day)
        let weekday0 = calendar.component(.weekday, from: start) - 1   // 0 = Sunday
        let ws = ((weekStart % 7) + 7) % 7
        let back = (weekday0 - ws + 7) % 7
        return calendar.date(byAdding: .day, value: -back, to: start) ?? start
    }

    /// The 42 days to draw on local day `day`, or nil when the window does not
    /// cover that day's whole grid — resolveMonthWindow in the JS module.
    static func days(in window: MonthWindowPayload, for day: Date, calendar: Calendar) -> [MonthWindowDay]? {
        let start = isoDay(gridStart(for: day, weekStart: window.weekStart ?? 0, calendar: calendar), calendar: calendar)
        guard let i = window.days.firstIndex(where: { $0.date == start }),
              i + cellCount <= window.days.count else { return nil }
        return Array(window.days[i..<(i + cellCount)])
    }

    /// Day-of-week initials in grid order, starting at `weekStart`.
    static func weekdayInitials(weekStart: Int, calendar: Calendar) -> [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols   // Sunday first
        guard symbols.count == 7 else { return Array(repeating: "", count: 7) }
        let ws = ((weekStart % 7) + 7) % 7
        return (0..<7).map { symbols[(ws + $0) % 7] }
    }

    /// Where a tap on a cell goes: the app's `day` route with `view=month`,
    /// which opens MONTH with the day selected — its sheet on a phone, the
    /// docked panel on a wide screen — or the default view when MONTH is off
    /// (src/utils/dayLink.js).
    static func tapURL(date: String) -> URL? {
        var parts = URLComponents()
        parts.scheme = "dayglance"
        parts.host = "day"
        parts.queryItems = [URLQueryItem(name: "date", value: date), URLQueryItem(name: "view", value: "month")]
        return parts.url
    }
}

// MARK: - Bars

struct MonthBarFrame: Equatable {
    /// Top of the bar from the top of the track, in points.
    var y: CGFloat
    var height: CGFloat
}

extension MonthGrid {
    /// A bar's vertical frame in a track `trackHeight` tall. The item is
    /// clipped to the hour window first, so one that starts before 7:00 or
    /// ends after 21:00 keeps its in-window part; one wholly outside clamps to
    /// the nearest edge at the minimum height. Never taller than the track,
    /// never out of it.
    static func barFrame(_ bar: MonthWindowBar, trackHeight: CGFloat, minHeight: CGFloat = minBarHeight) -> MonthBarFrame {
        guard trackHeight > 0 else { return MonthBarFrame(y: 0, height: 0) }
        let span = windowEndMinutes - windowStartMinutes
        let start = bar.s
        let end = bar.s + max(0, bar.d)
        let clippedStart = min(max(start, windowStartMinutes), windowEndMinutes)
        let clippedEnd = min(max(end, windowStartMinutes), windowEndMinutes)
        let top = CGFloat((clippedStart - windowStartMinutes) / span) * trackHeight
        let natural = CGFloat((clippedEnd - clippedStart) / span) * trackHeight
        let height = min(trackHeight, max(minHeight, natural))
        let y = max(0, min(top, trackHeight - height))
        return MonthBarFrame(y: y, height: height)
    }
}

// MARK: - Cells

struct MonthGridCell: Equatable {
    let date: String
    let dayOfMonth: Int
    /// "Oct 1" in the widget's locale — shown only when `showsMonthLabel`.
    let monthDayLabel: String
    let isToday: Bool
    let isFirstOfMonth: Bool
    /// The first cell of the displayed grid.
    let isWindowFirst: Bool
    /// Anything in `allDay` or `deadlines`: one pip whatever the count or kind.
    let hasPip: Bool
    /// At most `MonthGrid.barCap`, earliest first.
    let bars: [MonthWindowBar]
    /// Bars beyond the cap, drawn as `+N`.
    let overflow: Int
    /// Every bar the day has, for the accessibility count.
    let totalBars: Int

    /// Bold weight: the first of a month and the grid's first day.
    var isBold: Bool { isFirstOfMonth || isWindowFirst }
    /// Those two carry the month ("Oct 1") unless the header is already busy
    /// with a pip or a `+N` — then the bare number, and the weight carries it.
    var showsMonthLabel: Bool { isBold && !hasPip && overflow == 0 }
    var label: String { showsMonthLabel ? monthDayLabel : String(dayOfMonth) }
    var url: URL? { MonthGrid.tapURL(date: date) }

    static func make(_ day: MonthWindowDay, index: Int, today: String?, calendar: Calendar, locale: Locale) -> MonthGridCell {
        let parsed = WidgetFreshness.parseDay(day.date, calendar: calendar)
        let dom = parsed.map { calendar.component(.day, from: $0) } ?? Int(day.date.suffix(2)) ?? 0
        var style = Date.FormatStyle().month(.abbreviated).day()
        style.calendar = calendar
        style.timeZone = calendar.timeZone
        let label = parsed.map { $0.formatted(style.locale(locale)) } ?? String(dom)
        let shown = Array(day.bars.sorted { $0.s < $1.s }.prefix(MonthGrid.barCap))
        return MonthGridCell(
            date: day.date,
            dayOfMonth: dom,
            monthDayLabel: label,
            isToday: day.date == today,
            isFirstOfMonth: dom == 1,
            isWindowFirst: index == 0,
            hasPip: !day.allDay.isEmpty || !day.deadlines.isEmpty,
            bars: shown,
            overflow: max(0, day.bars.count - MonthGrid.barCap),
            totalBars: day.bars.count
        )
    }
}

// MARK: - Resolution

enum MonthGridTier: Equatable { case pushed, projected, stale, unknown }

struct MonthGridState {
    let tier: MonthGridTier
    /// Freshness of what is drawn: stale only for `.stale`.
    let freshness: WidgetFreshness
    let weekStart: Int
    let cells: [MonthGridCell]

    var isStale: Bool { tier == .stale }
    var isProjected: Bool { tier == .projected }

    /// The grid for an entry, or nil when there is nothing to draw (no window).
    static func resolve(snapshot: WidgetSnapshot?, window: MonthWindowPayload?, at now: Date,
                        calendar: Calendar = .current, locale: Locale = .current) -> MonthGridState? {
        guard let window, !window.days.isEmpty else { return nil }
        let pushed = WidgetFreshness.of(snapshot, at: now, calendar: calendar)
        let entryDay = calendar.startOfDay(for: now)
        let weekStart = window.weekStart ?? 0

        func state(_ tier: MonthGridTier, _ freshness: WidgetFreshness, _ days: [MonthWindowDay], today: Date?) -> MonthGridState {
            let todayStr = today.map { MonthGrid.isoDay($0, calendar: calendar) }
            let cells = days.enumerated().map {
                MonthGridCell.make($0.element, index: $0.offset, today: todayStr, calendar: calendar, locale: locale)
            }
            return MonthGridState(tier: tier, freshness: freshness, weekStart: weekStart, cells: cells)
        }

        // The push's own grid: what a stale widget shows, dimmed.
        func pushGrid() -> [MonthWindowDay] {
            if let day = pushed.snapshotDay, let days = MonthGrid.days(in: window, for: day, calendar: calendar) { return days }
            return Array(window.days.prefix(MonthGrid.cellCount))
        }

        // Live for as long as the stored window covers the entry's whole
        // grid — nothing else ages it. Never a partial grid.
        if let days = MonthGrid.days(in: window, for: entryDay, calendar: calendar) {
            guard let snapshotDay = pushed.snapshotDay else { return state(.unknown, pushed, days, today: entryDay) }
            if entryDay == snapshotDay { return state(.pushed, pushed, days, today: entryDay) }
            let fresh = WidgetFreshness(isStale: false, daysOld: 0, snapshotDay: entryDay, capturedAt: pushed.capturedAt)
            return state(.projected, fresh, days, today: entryDay)
        }
        let stale = WidgetFreshness(isStale: true, daysOld: pushed.daysOld, snapshotDay: pushed.snapshotDay, capturedAt: pushed.capturedAt)
        return state(.stale, stale, pushGrid(), today: nil)
    }

    /// The gallery / pre-data grid: this week's six weeks, dates only.
    static func placeholder(at now: Date, calendar: Calendar = .current, locale: Locale = .current) -> MonthGridState {
        let weekStart = calendar.firstWeekday - 1
        let start = MonthGrid.gridStart(for: now, weekStart: weekStart, calendar: calendar)
        let days = (0..<MonthGrid.cellCount).compactMap { i in
            calendar.date(byAdding: .day, value: i, to: start).map { MonthWindowDay(date: MonthGrid.isoDay($0, calendar: calendar)) }
        }
        let window = MonthWindowPayload(from: days.first?.date, weekStart: weekStart, days: days)
        let today = MonthGrid.isoDay(now, calendar: calendar)
        let cells = window.days.enumerated().map {
            MonthGridCell.make($0.element, index: $0.offset, today: today, calendar: calendar, locale: locale)
        }
        return MonthGridState(tier: .unknown, freshness: .unknown, weekStart: weekStart, cells: cells)
    }
}

// MARK: - Timeline

enum MonthGridTimeline {
    /// Now, plus every local midnight while the stored window still covers
    /// that day's grid, plus the first midnight it does not — the Outdated
    /// flip. The dial's rule (entries at payload midnights) without its
    /// 15-minute needle grid, which a month grid does not need. Each entry
    /// moves the today marker and, across a week boundary, the whole grid,
    /// with no push. Bounded by the window's length.
    static func entryDates(now: Date, window: MonthWindowPayload?, calendar: Calendar = .current) -> [Date] {
        var dates = [now]
        guard let window else { return dates }
        var day = calendar.startOfDay(for: now)
        guard MonthGrid.days(in: window, for: day, calendar: calendar) != nil else { return dates }
        for _ in 0..<window.days.count {
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
            dates.append(next)
            if MonthGrid.days(in: window, for: next, calendar: calendar) == nil { break }
        }
        return dates
    }

    /// When the timeline after `dates` should be asked for again: at its end
    /// while it still has a midnight to reach, else at the next midnight, so an
    /// Outdated widget's "N days old" keeps counting without a reload loop.
    static func nextReload(after dates: [Date], now: Date, calendar: Calendar = .current) -> Date? {
        if dates.count > 1 { return nil }   // .atEnd
        return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
    }
}

// MARK: - Labels

extension WidgetFreshness {
    /// The month grid's "Planned as of …", WITH the date: "Planned as of Mon,
    /// Sep 21 at 6:00 PM". The shared label (plannedAsOfLabel) names only the
    /// weekday, which is unambiguous across the day-keyed projection's three
    /// days but not across this grid's thirteen, where "Mon" can be either of
    /// two Mondays. Same localized key, so every translation still applies;
    /// the shared label is left as it is for the other widgets.
    func monthPlannedAsOfLabel(use24Hour: Bool?, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        guard let capturedAt else { return String(localized: "Planned in advance") }
        var style = ClockPreference.hour(Date.FormatStyle().weekday(.abbreviated).month(.abbreviated).day().minute(),
                                         use24Hour: use24Hour)
            .locale(ClockPreference.locale(use24Hour: use24Hour, base: locale))
        style.timeZone = timeZone
        return String(localized: "Planned as of \(capturedAt.formatted(style))")
    }
}
