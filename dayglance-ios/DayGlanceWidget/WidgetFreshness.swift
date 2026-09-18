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
        let startOfToday = calendar.startOfDay(for: now)
        guard let midnight = calendar.date(byAdding: .day, value: 1, to: startOfToday), midnight > now else {
            return [now]
        }
        return [now, midnight]
    }
}
