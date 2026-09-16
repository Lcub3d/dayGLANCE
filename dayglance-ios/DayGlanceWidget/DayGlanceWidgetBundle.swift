import WidgetKit
import SwiftUI

@main
struct DayGlanceWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        GoalWidget()
        ProjectWidget()
        DaySummaryLiveActivity()
        // Day Dial render-budget spike — measurement only, never shipped.
        // Built in only with DG_WIDGET_FLAGS="DIAL_SPIKE" (see project.yml and
        // Spike/DialSpikeWidget.swift).
        #if DIAL_SPIKE
        DialSpikeWidget()
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
