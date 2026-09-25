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
// touches only the App Group defaults. Whether that is enough on 18.4+ is
// exactly what the first on-device test checks: the selection record carries
// the process that ran it (MonthDaySelection.handledBy), shown in the panel.

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
        MonthDaySelection(date: date, setOn: today, handledAt: Date(), handledBy: process).save()
        Self.logger.notice("select day=\(date, privacy: .public) setOn=\(today, privacy: .public) process=\(process, privacy: .public)")
        WidgetCenter.shared.reloadTimelines(ofKind: MonthGridWidget.kindIdentifier)
        return .result()
    }
}
