import WidgetKit
import SwiftUI

@main
struct DayGlanceWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        GoalWidget()
        ProjectWidget()
        DayDialWidget()
        MonthGridWidget()
        DaySummaryLiveActivity()
        // Day Dial preview — the face and hub from fixture days, scenario
        // chosen per instance in Edit Widget; also how App Store screenshots
        // are captured from a curated day. Built in only with
        // DG_WIDGET_FLAGS="DIAL_PREVIEW" (see project.yml and
        // Dial/DialPreviewWidget.swift). Kept alongside the real widget.
        #if DIAL_PREVIEW
        DialPreviewWidget()
        #endif
        // Control Center controls — iOS 18+ only (the Controls API doesn't exist
        // before then). Mirror the Home Screen Quick Actions.
        if #available(iOS 18.0, *) {
            AddScheduledTaskControl()
            AddInboxTaskControl()
            VoiceInputControl()
        }
    }
}
