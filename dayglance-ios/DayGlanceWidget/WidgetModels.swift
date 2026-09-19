import Foundation

// Shared App Group suite name — must match entitlements and WidgetBridge.swift
let kAppGroupSuite = "group.com.dayglance.app"
let kSnapshotKey   = "widgetSnapshot"

struct WidgetSnapshot: Codable {
    var date: String?
    var dateLabel: String?
    var use24Hour: Bool?
    var nextTask: NextTaskData?
    var upcomingTasks: [UpcomingTaskData]?
    var allGoals: [GoalData]?
    var allProjects: [ProjectData]?
    var sky: SkySnapshot?
    var dial: DialSnapshot?
    /// today+1 … today+N, projected in advance (utils/widgetDayProjection.js)
    /// so a timeline can switch days at midnight with the app in the
    /// background. Resolved against the entry's local day by
    /// `ResolvedWidgetDay` (WidgetFreshness.swift); never read directly.
    var days: [WidgetDay]?
    var updatedAt: Double?
}

/// One projected day: the per-day fields only. The day-invariant blocks
/// (goals, projects, clock preference) live once on the snapshot. A projected
/// day is right about the SHAPE of the day and silent about state that cannot
/// exist yet — see the JS module's header. Its `nextTask` is the first
/// incomplete timed task of the day and `upcomingTasks` the whole rest of the
/// list, uncapped: the view promotes through it by the clock when the day
/// arrives, which a day built in advance cannot do.
struct WidgetDay: Codable {
    var date: String?
    var dateLabel: String?
    var nextTask: NextTaskData?
    var upcomingTasks: [UpcomingTaskData]?
    var sky: SkySnapshot?
    var dial: DialSnapshot?
}

// The Day Dial widget's sky ring, derived on the JS side from the same solar
// and lunar math the in-app dial draws with (computeSkySnapshot in
// src/utils/dayDial.js). Consumed, never re-solved here — see
// docs/day-dial-widget-handoff.md §4. Nil until the app has a geocoded
// location, in which case the ring is simply not drawn.
struct SkySnapshot: Codable {
    /// Minutes past local midnight; nil on a polar day/night (see `polar`).
    var sunriseMin: Int?
    var sunsetMin: Int?
    /// "day" (sun never sets), "night" (never rises), or nil for an ordinary day.
    var polar: String?
    /// 24 entries, each sampled at hh:30. Strengths in 0...1; the consumer
    /// applies its own opacity mapping. Moon is 0 while the sun is up.
    var hours: [SkyHour]?
    var moon: SkyMoon?
}

struct SkyHour: Codable {
    var sun: Double?
    var moon: Double?
}

struct SkyMoon: Codable {
    /// Lit portion of the disc, 0 (new) to 1 (full).
    var fraction: Double?
    var waxing: Bool?
    /// Where the dial places the moon glyph, minutes past midnight; nil when
    /// no night stretch is long enough to carry one.
    var glyphMin: Int?
}

// Lightweight task used to fill leftover space in the Up Next widget when the
// primary task has no subtasks/notes of its own.
struct UpcomingTaskData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var startTime: String?
    var duration: Int?
    /// Present on a projected day's rows (kept at full richness there so a
    /// promoted row loses nothing); absent on the pushed day's light rows.
    var tags: [String]?
    var projectName: String?
}

struct NextTaskData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var startTime: String?
    var duration: Int?
    var tags: [String]?
    var notes: String?
    var subtasks: [SubtaskData]?
    var projectName: String?
}

struct SubtaskData: Codable {
    var title: String
    var completed: Bool
}

struct GoalData: Codable {
    var id: String?
    var title: String?
    var colorHex: String?
    var targetDate: String?
    var daysUntilDue: Int?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
    var projects: [ProjectSummary]?
}

struct ProjectSummary: Codable {
    var id: String?
    var title: String?
    var status: String?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
}

struct ProjectData: Codable {
    var id: String?
    var title: String?
    var status: String?
    var goalId: String?
    var goalTitle: String?
    var goalColorHex: String?
    var progressPct: Int?
    var totalTasks: Int?
    var completedTasks: Int?
    var tasks: [TaskSummary]?
}

struct TaskSummary: Codable {
    var id: String?
    var title: String?
    var completed: Bool?
}

// Read the latest snapshot from the App Group UserDefaults.
// Returns nil if no snapshot has been written yet.
func loadSnapshot() -> WidgetSnapshot? {
    guard let defaults = UserDefaults(suiteName: kAppGroupSuite),
          let data = defaults.data(forKey: kSnapshotKey) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

// The whole local day for the Day Dial widget's ring — every timed block
// regardless of completion or elapse, plus sleep and routines — projected on
// the JS side by projectDialSnapshot (src/utils/dayDial.js) from the same
// model the in-app dial renders. Built from the unfiltered day, NOT from the
// agenda that hides completed past tasks. See docs/day-dial-widget-handoff.md §5.
struct DialSnapshot: Codable {
    var date: String?
    /// Start-sorted. `durationMin` is the DRAWN span, already clipped at
    /// midnight; `endMinTrue` carries the real end when `endsNextDay`.
    var blocks: [DialBlock]?
}

struct DialBlock: Codable {
    /// "task" | "event" (read-only imported calendar) | "routine" | "sleep".
    var type: String?
    var id: String?
    /// Cleaned for display: no wikilinks, no #tags. Absent on sleep.
    var title: String?
    /// The first #tag, for the hub's italic line. Absent on routine/sleep.
    var tag: String?
    var startMin: Int?
    var durationMin: Int?
    /// "effort" | "restore" — the energy axis. Tasks/events only.
    var kind: String?
    var completed: Bool?
    /// Tasks/events only; routine and sleep take the widget's fixed colours.
    var colorHex: String?
    /// Concentric lane for overlapping blocks; a lone block is 0 of 1.
    var lane: Int?
    var laneCount: Int?
    var endsNextDay: Bool?
    var endMinTrue: Int?
    var startedPrevDay: Bool?
}
