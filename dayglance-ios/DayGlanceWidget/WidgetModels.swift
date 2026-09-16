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
    var updatedAt: Double?
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
