import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The systemExtraLarge month widget's selected day: which day its agenda half
// shows. Changed only by the arrow buttons (SelectMonthDayIntent), which write
// it to the App Group; everything else here is pure.
//
// MIDNIGHT RESET WITHOUT A WRITE. The record carries the day it was set on.
// A selection read on any other day resolves to today, so the existing
// midnight timeline entries (MonthGridTimeline) put the widget back on today
// by themselves — nothing has to run at midnight to clear it, and a widget
// left on the 30th does not stay there.
// ─────────────────────────────────────────────────────────────────────────────

struct MonthDaySelection: Codable, Equatable {
    /// The selected day, 'yyyy-MM-dd'.
    var date: String
    /// The local day the selection was made, 'yyyy-MM-dd'.
    var setOn: String

    static let defaultsKey = "monthWidgetSelection"

    static func load(_ defaults: UserDefaults? = UserDefaults(suiteName: kAppGroupSuite)) -> MonthDaySelection? {
        guard let data = defaults?.data(forKey: defaultsKey) else { return nil }
        return try? JSONDecoder().decode(MonthDaySelection.self, from: data)
    }

    func save(_ defaults: UserDefaults? = UserDefaults(suiteName: kAppGroupSuite)) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults?.set(data, forKey: Self.defaultsKey)
    }

    /// The day the agenda shows for an entry: the stored selection if it was
    /// made on the entry's day and is on the grid; else today if today is on
    /// the grid; else the grid's first day (a stale grid that no longer
    /// contains today — the push's own grid can still contain it).
    static func resolve(_ stored: MonthDaySelection?, cells: [MonthGridCell], entryDay: String) -> String? {
        let onGrid = Set(cells.map(\.date))
        if let stored, stored.setOn == entryDay, onGrid.contains(stored.date) { return stored.date }
        if onGrid.contains(entryDay) { return entryDay }
        return cells.first?.date
    }

    /// The days the arrows move to, or nil at either end of the grid: the
    /// arrows page across exactly the days the grid shows.
    static func neighbours(of date: String, cells: [MonthGridCell]) -> (previous: String?, next: String?) {
        guard let i = cells.firstIndex(where: { $0.date == date }) else { return (nil, nil) }
        return (i > 0 ? cells[i - 1].date : nil, i + 1 < cells.count ? cells[i + 1].date : nil)
    }
}
