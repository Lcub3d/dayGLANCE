import AppIntents
import WidgetKit
import os

// The systemExtraLarge month widget's arrows. Unlike CompleteTaskIntent and
// StartFocusIntent (WidgetIntents.swift), this one does NOT open the app and
// is NOT a ForegroundContinuableIntent: it runs in the widget extension,
// writes the selected day to the App Group — which the extension is entitled
// to — and returns. WidgetKit reloads the widget after perform() on its own;
// the explicit reload is belt and braces.
//
// iOS 18.4 tightened what an intent running in the widget process may touch
// when the app is not alive (the comment in WidgetIntents.swift). This intent
// touches only the App Group defaults, and that is enough: verified on an
// iPad on iOS 18.4+ with the app force-quit, the tap runs in the widget
// extension (the log line below names the process) and never launches the app.

@available(iOS 17.0, *)
struct SelectMonthDayIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Day"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = false

    static let logger = Logger(subsystem: "com.dayglance.app", category: "monthwidget")

    /// The day to show, 'yyyy-MM-dd'. Computed by the view (the arrows'
    /// neighbours), so a repeated tap is idempotent.
    @Parameter(title: "Date")
    var date: String

    init() {}
    init(date: String) { self.date = date }

    func perform() async throws -> some IntentResult {
        let today = MonthGrid.isoDay(Date(), calendar: .current)
        let process = ProcessInfo.processInfo.processName
        MonthDaySelection(date: date, setOn: today).save()
        Self.logger.notice("select day=\(date, privacy: .public) setOn=\(today, privacy: .public) process=\(process, privacy: .public)")
        WidgetCenter.shared.reloadTimelines(ofKind: MonthGrid.widgetKind)
        return .result()
    }
}

/// The header's "Today" pill: clears the stored selection, which resolves to
/// today (MonthDaySelection.resolve) — the day it is when the widget reads it,
/// so a tap just after midnight cannot land on yesterday the way a date baked
/// into the button could. Runs in the widget extension like the arrows and
/// never opens the app.
@available(iOS 17.0, *)
struct ShowTodayIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Today"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
        MonthDaySelection.clear()
        SelectMonthDayIntent.logger.notice("select today process=\(ProcessInfo.processInfo.processName, privacy: .public)")
        WidgetCenter.shared.reloadTimelines(ofKind: MonthGrid.widgetKind)
        return .result()
    }
}
