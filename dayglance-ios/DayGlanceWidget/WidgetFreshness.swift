import SwiftUI
import WidgetKit

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot freshness — the one place that decides whether the stored snapshot
// still describes the current local day.
//
// Only the WebView effect in App.jsx writes task content, and a backgrounded
// app never re-runs it. So a phone left alone across midnight wakes up with
// every widget holding yesterday's agenda; the 15-minute timeline reload and
// the BGAppRefreshTask both re-read the same stored bytes. Nothing in the
// extension can refresh that content (docs/widget-background-refresh-plan.md
// covers what could). What the extension CAN do is stop presenting it as
// current, and do it the same way in every widget — the Day Dial inherits
// this file.
//
// "Stale" is a calendar-day fact, not an age. A snapshot from 23:50 is fresh
// at 23:59 and stale at 00:00; a two-hour-old one on the same day is the
// normal state of an app sitting in the background and is not stale. Views
// evaluate it against their ENTRY's date, not the wall clock, which is how
// WidgetKit is meant to be used and what lets a timeline carry a midnight
// entry that flips on the minute (see `WidgetTimelineDates`).
// ─────────────────────────────────────────────────────────────────────────────

struct WidgetFreshness {
    /// The snapshot's day differs from the entry's local day.
    let isStale: Bool
    /// Whole local days from the snapshot's day to the entry's day. 0 when
    /// fresh; negative when the clock moved back (travel west across midnight).
    let daysOld: Int
    /// Start of the day the snapshot describes, or nil when it did not say.
    let snapshotDay: Date?
    /// When the content was captured (the snapshot's `updatedAt`), or nil.
    let capturedAt: Date?

    /// A snapshot that did not say what day it is — never flagged.
    static let unknown = WidgetFreshness(isStale: false, daysOld: 0, snapshotDay: nil, capturedAt: nil)

    static func of(_ snapshot: WidgetSnapshot?, at now: Date, calendar: Calendar = .current) -> WidgetFreshness {
        guard let snapshot else { return .unknown }
        return evaluate(snapshotDate: snapshot.date, updatedAtMs: snapshot.updatedAt, now: now, calendar: calendar)
    }

    /// Pure: `snapshotDate` is the "yyyy-MM-dd" LOCAL day App.jsx writes
    /// (dateToString in utils/taskUtils.js); `updatedAtMs` is its `Date.now()`.
    static func evaluate(snapshotDate: String?, updatedAtMs: Double?, now: Date, calendar: Calendar) -> WidgetFreshness {
        let captured: Date? = updatedAtMs.flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0 / 1000) : nil }
        guard let day = parseDay(snapshotDate, calendar: calendar) else {
            return WidgetFreshness(isStale: false, daysOld: 0, snapshotDay: nil, capturedAt: captured)
        }
        let today = calendar.startOfDay(for: now)
        let days = calendar.dateComponents([.day], from: day, to: today).day ?? 0
        return WidgetFreshness(isStale: days != 0, daysOld: days, snapshotDay: day, capturedAt: captured)
    }

    /// Strict "yyyy-MM-dd" in the calendar's own zone; anything else is "did
    /// not say" rather than an error, so a malformed field can never flag a
    /// widget stale.
    static func parseDay(_ value: String?, calendar: Calendar) -> Date? {
        guard let raw = value?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
        let parts = raw.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        var comps = DateComponents()
        comps.year = y
        comps.month = m
        comps.day = d
        guard let date = calendar.date(from: comps) else { return nil }
        // Reject 2026-02-31 and friends, which `date(from:)` rolls forward.
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == y, back.month == m, back.day == d else { return nil }
        return calendar.startOfDay(for: date)
    }

    /// "Outdated · as of Thu, Sep 17, 8:42 PM", plus "· 3 days old" from two
    /// days on, so a phone left over a weekend never reads as "Thu" alone.
    /// Absolute on purpose: "2 hours ago" invites misreading and breaks down
    /// past a day. Day/month order follows the locale; the clock follows the
    /// snapshot's preference when it carries one, else the device.
    func label(use24Hour: Bool?) -> String {
        var parts = [String(localized: "Outdated")]
        if let capturedAt {
            var style = Date.FormatStyle().weekday(.abbreviated).month(.abbreviated).day().minute()
            switch use24Hour {
            case .some(true): style = style.hour(.twoDigits(amPM: .omitted))
            case .some(false): style = style.hour(.defaultDigits(amPM: .abbreviated))
            case .none: style = style.hour()
            }
            parts.append(String(localized: "as of \(capturedAt.formatted(style))"))
        } else if let snapshotDay {
            let style = Date.FormatStyle().weekday(.abbreviated).month(.abbreviated).day()
            parts.append(String(localized: "as of \(snapshotDay.formatted(style))"))
        }
        if daysOld >= 2 {
            parts.append(String(localized: "\(daysOld) days old"))
        }
        return parts.joined(separator: "  ·  ")
    }

    /// The soft tier's line: "Planned as of Thu 8:42 PM". A projected day is
    /// right about the shape of the day and silent about anything that
    /// changed since the push; this says when that was, and nothing more.
    func plannedAsOfLabel(use24Hour: Bool?) -> String {
        guard let capturedAt else { return String(localized: "Planned in advance") }
        var style = Date.FormatStyle().weekday(.abbreviated).minute()
        switch use24Hour {
        case .some(true): style = style.hour(.twoDigits(amPM: .omitted))
        case .some(false): style = style.hour(.defaultDigits(amPM: .abbreviated))
        case .none: style = style.hour()
        }
        return String(localized: "Planned as of \(capturedAt.formatted(style))")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Day resolution — which day of the payload an entry renders, and how honest
// its label has to be.
//
//   pushed     the entry's day is the day the snapshot was built: full
//              content, no label.
//   projected  the entry's day is one of `days`, built in advance: the day's
//              shape, "Planned as of …", nothing dimmed. Up Next is promoted
//              through the day's list by the entry's clock, because a day
//              built at 20:00 yesterday cannot know it is 15:10 now.
//   stale      beyond the payload (or before it): the hard "Outdated" state
//              from the first fix, unchanged — dimmed, labelled, no actions.
//   unknown    the snapshot did not say what day it is: rendered as pushed.
// ─────────────────────────────────────────────────────────────────────────────

enum WidgetDayTier { case pushed, projected, stale, unknown }

struct ResolvedWidgetDay {
    let tier: WidgetDayTier
    /// Freshness of what is RENDERED: stale only for `.stale`. A projected day
    /// rendered on its own day is not stale.
    let freshness: WidgetFreshness
    /// When the payload was built — the "as of" for the projected tier.
    let capturedAt: Date?
    let date: String?
    let dateLabel: String?
    let nextTask: NextTaskData?
    let upcomingTasks: [UpcomingTaskData]
    let sky: SkySnapshot?
    let dial: DialSnapshot?

    var isStale: Bool { tier == .stale }
    var isProjected: Bool { tier == .projected }

    static func resolve(_ snapshot: WidgetSnapshot?, at now: Date, calendar: Calendar = .current) -> ResolvedWidgetDay {
        let pushed = WidgetFreshness.of(snapshot, at: now, calendar: calendar)
        guard let snapshot else {
            return ResolvedWidgetDay(tier: .unknown, freshness: pushed, capturedAt: nil, date: nil, dateLabel: nil,
                                     nextTask: nil, upcomingTasks: [], sky: nil, dial: nil)
        }
        let fromPushed = { (tier: WidgetDayTier, freshness: WidgetFreshness) in
            ResolvedWidgetDay(tier: tier, freshness: freshness, capturedAt: pushed.capturedAt,
                              date: snapshot.date, dateLabel: snapshot.dateLabel,
                              nextTask: snapshot.nextTask, upcomingTasks: snapshot.upcomingTasks ?? [],
                              sky: snapshot.sky, dial: snapshot.dial)
        }
        if pushed.snapshotDay == nil { return fromPushed(.unknown, pushed) }
        if !pushed.isStale { return fromPushed(.pushed, pushed) }

        let entryDay = calendar.startOfDay(for: now)
        if let day = snapshot.days?.first(where: { WidgetFreshness.parseDay($0.date, calendar: calendar) == entryDay }) {
            // Promote Up Next by the entry's clock: the first task whose end
            // is still ahead. A zero-length task counts until its start.
            var all: [UpcomingTaskData] = []
            if let first = day.nextTask { all.append(UpcomingTaskData(promoting: first)) }
            all.append(contentsOf: day.upcomingTasks ?? [])
            let nowMin = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
            let remaining = all.drop(while: { row in
                guard let start = minutes(row.startTime) else { return false }
                let dur = row.duration ?? 0
                return dur > 0 ? start + dur <= nowMin : start < nowMin
            })
            let next: NextTaskData? = remaining.first.map { NextTaskData(promoted: $0) }
            let fresh = WidgetFreshness(isStale: false, daysOld: 0, snapshotDay: entryDay, capturedAt: pushed.capturedAt)
            return ResolvedWidgetDay(tier: .projected, freshness: fresh, capturedAt: pushed.capturedAt,
                                     date: day.date, dateLabel: day.dateLabel,
                                     nextTask: next, upcomingTasks: Array(remaining.dropFirst()),
                                     sky: day.sky, dial: day.dial)
        }
        return fromPushed(.stale, pushed)
    }

    /// Whole days from the entry's day to a 'yyyy-MM-dd' target — the due
    /// badge computed at RENDER time, so it is right on any tier and never
    /// carries a push-time "Due today" into tomorrow.
    static func daysUntil(_ target: String?, from now: Date, calendar: Calendar = .current) -> Int? {
        guard let day = WidgetFreshness.parseDay(target, calendar: calendar) else { return nil }
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: day).day
    }

    private static func minutes(_ hhmm: String?) -> Int? {
        guard let hhmm, !hhmm.isEmpty else { return nil }
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }
}

private extension UpcomingTaskData {
    init(promoting t: NextTaskData) {
        self.init(id: t.id, title: t.title, colorHex: t.colorHex, startTime: t.startTime, duration: t.duration,
                  tags: t.tags, projectName: t.projectName)
    }
}

private extension NextTaskData {
    /// A projected row promoted to the primary slot. Notes and subtasks were
    /// trimmed from projected days on purpose; tags and project survive.
    init(promoted r: UpcomingTaskData) {
        self.init(id: r.id, title: r.title, colorHex: r.colorHex, startTime: r.startTime, duration: r.duration,
                  tags: r.tags, notes: nil, subtasks: nil, projectName: r.projectName)
    }
}

/// The soft line for a projected day. Secondary, not a warning: the day is
/// right in shape and only its state is unknown.
struct PlannedBanner: View {
    let day: ResolvedWidgetDay
    let use24Hour: Bool?

    var body: some View {
        Text(day.freshness.plannedAsOfLabel(use24Hour: use24Hour))
            .font(.caption2)
            .foregroundColor(.secondary)
            .lineLimit(1)
            .padding(.bottom, 2)
    }
}

/// The stale line every widget shows under its header. Warning tint, never the
/// overdue red; two lines at most so a long locale never pushes content off.
struct StaleBanner: View {
    let freshness: WidgetFreshness
    let use24Hour: Bool?

    var body: some View {
        Text(freshness.label(use24Hour: use24Hour))
            .font(.caption2).fontWeight(.semibold)
            .foregroundColor(.orange)
            .lineLimit(2)
            .padding(.bottom, 2)
    }
}

extension View {
    /// Content of a stale widget: readable, but inactive at a glance, before
    /// any text is parsed. Headers and the banner itself stay at full strength.
    @ViewBuilder
    func staleDimmed(_ freshness: WidgetFreshness) -> some View {
        if freshness.isStale {
            self.opacity(0.45).grayscale(0.5)
        } else {
            self
        }
    }
}

enum WidgetTimelineDates {
    /// Entry dates for a one-snapshot timeline: now, plus the next local
    /// midnight. The second entry carries the same snapshot; its later date is
    /// what makes `WidgetFreshness.of(_:at:)` flip it to stale exactly at
    /// 00:00, even when WidgetKit defers the 15-minute `.after` reload past it
    /// (it does, on a budget, and always overnight when nothing else wakes the
    /// device). Costs one extra archived view per timeline.
    static func withMidnightRollover(from now: Date = Date(), calendar: Calendar = .current) -> [Date] {
        rolloverDates(from: now, midnights: 1, calendar: calendar)
    }

    /// Now plus the next `midnights` local midnights. With the day-keyed
    /// payload each midnight entry renders the NEXT day of `days` (or the
    /// stale state past the last one) with no reload at all, so a provider
    /// passes `1 + days.count`: every projected day gets its boundary entry,
    /// and one more flips to Outdated when the payload runs out. Four
    /// archived views for N = 3; still one snapshot decode.
    static func rolloverDates(from now: Date = Date(), midnights: Int, calendar: Calendar = .current) -> [Date] {
        var dates = [now]
        var day = calendar.startOfDay(for: now)
        for _ in 0..<max(0, midnights) {
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
            if next > now { dates.append(next) }
        }
        return dates
    }
}
