import WidgetKit
import SwiftUI
import UIKit
import AppIntents
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — preview: the face (Phase 2) and the hub (Phase 3) from FIXTURE
// days, on the home screen. One widget; long-press → Edit Widget picks the
// scenario:
//
//   Dense · short title     the palette study's dense day at 11:20, current
//                           block "Standup", lunch starts the minute it ends:
//                           no runway line
//   Dense · long title      the same day, a title long enough to shrink to
//                           0.8× and then truncate with an ellipsis
//   Sparse · runway         the study's sparse day: docs until 12:30, next
//                           block at 17:00 → "then 4h 30m open"
//   Dense · no runway       the study's dense day with its own title,
//                           "Write API documentation"
//   Projected day           the dense day on a projected tier: past blocks
//                           take the past-event tone, routines that have
//                           passed the done opacity; the hub is unchanged
//
// The needle and the hub are fixed at 11:20 on Tuesday, July 7 (the study's
// NOW), so the widget can be held against docs/day-dial-palette-study.html
// and the hub against the spec render. The corner reads the image source
// and cold render time, and whether the date row is really Lora: the
// system serif is close enough to fool a glance.
//
// HOW TO BUILD IT
//   Registered only under DIAL_PREVIEW. Generate the project with the flag
//   and run the DayGlance scheme on a device (or archive as usual):
//
//     DG_WIDGET_FLAGS="DIAL_PREVIEW" npm run ios
//
//   then add the "Dial Preview" widget (systemLarge) from the gallery, add
//   it as many times as you want scenarios, and long-press each → Edit
//   Widget → Scenario. Never set the flag for a release; project.yml says
//   the same.
// ─────────────────────────────────────────────────────────────────────────────

enum DialPreviewScenario: String, AppEnum, CaseIterable {
    case shortTitle, longTitle, sparse, dense, projected

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scenario"
    static var caseDisplayRepresentations: [DialPreviewScenario: DisplayRepresentation] = [
        .shortTitle: "Dense · short title",
        .longTitle: "Dense · long title",
        .sparse: "Sparse · runway",
        .dense: "Dense · no runway",
        .projected: "Projected day",
    ]
}

struct DialPreviewIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Dial Preview"
    static var description = IntentDescription("Which fixture day the preview renders.")

    @Parameter(title: "Scenario", default: .dense)
    var scenario: DialPreviewScenario
}

struct DialPreviewEntry: TimelineEntry {
    let date: Date
    let scenario: DialPreviewScenario
    /// The cached face for this entry, resolved in the provider (as Phase 4's
    /// timeline will), and how it was obtained. Nil → the view draws live.
    let face: UIImage?
    let outcome: DialFaceCache.Outcome
}

struct DialPreviewProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DialPreviewEntry {
        DialPreviewEntry(date: DialPreviewFixture.date, scenario: .dense, face: nil, outcome: .failed)
    }

    func snapshot(for configuration: DialPreviewIntent, in context: Context) async -> DialPreviewEntry {
        DialPreviewEntry(date: DialPreviewFixture.date, scenario: configuration.scenario, face: nil, outcome: .failed)
    }

    func timeline(for configuration: DialPreviewIntent, in context: Context) async -> Timeline<DialPreviewEntry> {
        let scenario = configuration.scenario
        let size = context.displaySize
        let input = DialPreviewFixture.input(for: scenario)
        let scale = await MainActor.run { UIScreen.main.scale }
        let result = await MainActor.run {
            DialFaceCache.image(input: input, nowMin: DialPreviewFixture.nowMin, size: size, scale: scale)
        }
        let entry = DialPreviewEntry(date: DialPreviewFixture.date, scenario: scenario, face: result.image, outcome: result.outcome)
        return Timeline(entries: [entry], policy: .never)
    }
}

struct DialPreviewView: View {
    let entry: DialPreviewEntry

    var body: some View {
        let input = DialPreviewFixture.input(for: entry.scenario)
        ZStack(alignment: .bottomLeading) {
            DialCachedFaceView(input: input, nowMin: DialPreviewFixture.nowMin, face: entry.face,
                               hubDate: entry.date, use24Hour: true)
            Text(verbatim: "preview · \(entry.scenario.rawValue) · fixture 11:20 · \(entry.outcome.summary) · \(DialHubTypography.loraIsInstalled ? "Lora ✓" : "Lora MISSING")")
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.5))
                .padding(6)
        }
        .containerBackground(Color(hex: DialSpec.backgroundHex), for: .widget)
    }
}

/// The cached face, the hub overlay and the needle for one entry, with a
/// live-drawn face as fallback so the widget never shows a hole
/// (placeholder, gallery, a failed render). What the Day Dial's timeline
/// entries are built from (DayDialWidget). `hubDate` nil draws no hub;
/// `countdownEnd` set makes the hub's countdown a live Text (see
/// DialHubView), nil keeps it static, which the preview and screenshots
/// want.
struct DialCachedFaceView: View {
    let input: DialFaceInput
    let nowMin: Double
    let face: UIImage?
    var hubDate: Date? = nil
    var use24Hour: Bool? = nil
    var countdownEnd: Date? = nil

    var body: some View {
        DialCanvas {
            ZStack(alignment: .topLeading) {
                if let face {
                    Image(uiImage: face).resizable()
                        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
                } else {
                    DialFaceView(input: input, nowMin: nowMin)
                }
                if let hubDate {
                    DialHubView(date: hubDate, state: DialHub.resolve(blocks: input.blocks, nowMin: nowMin),
                                use24Hour: use24Hour, countdownEnd: countdownEnd)
                }
                DialNeedleView(nowMin: nowMin)
            }
        }
    }
}

struct DialPreviewWidget: Widget {
    let kind = "DialPreview"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: DialPreviewIntent.self, provider: DialPreviewProvider()) { entry in
            DialPreviewView(entry: entry)
        }
        .configurationDisplayName("Dial Preview")
        .description("Day Dial face and hub from a fixture day. Not for release.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}

// MARK: - Fixtures: the palette study's days, with titles for the hub

enum DialPreviewFixture {
    /// The study's NOW, 11:20.
    static let nowMin: Double = 11 * 60 + 20

    /// Tuesday, July 7 (the spec's hub), at 11:20 local.
    static let date: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 7; c.day = 7; c.hour = 11; c.minute = 20
        return Calendar.current.date(from: c) ?? Date()
    }()

    static let raw = ["blue": "#3b82f6", "ics": "#2563eb", "red": "#ef4444", "green": "#22c55e", "purple": "#a855f7",
                      "yellow": "#eab308", "pink": "#ec4899", "indigo": "#6366f1", "orange": "#f97316", "teal": "#14b8a6"]

    struct Row {
        var s: Double, e: Double, kind: DialBlockKind
        var color: String? = nil, done = false, title: String? = nil, tag: String? = nil
    }

    static func input(for scenario: DialPreviewScenario) -> DialFaceInput {
        switch scenario {
        case .shortTitle: return make(denseDay(currentTitle: "Standup"), projected: false)
        case .longTitle: return make(denseDay(currentTitle: "Write the API documentation for the new sync endpoints and review it"), projected: false)
        case .dense: return make(denseDay(currentTitle: "Write API documentation"), projected: false)
        case .projected: return make(denseDay(currentTitle: "Write API documentation"), projected: true)
        case .sparse: return make(sparseDay, projected: false)
        }
    }

    /// docs/day-dial-palette-study.html DAYS.dense, with its RAW hexes and
    /// `done` flags, plus titles and tags the study did not need.
    static func denseDay(currentTitle: String) -> [Row] {
        [
            Row(s: 0, e: 385, kind: .sleep),
            Row(s: 385, e: 420, kind: .routine, done: true, title: "Stretch"),
            Row(s: 435, e: 480, kind: .task, color: "blue", done: true, title: "Email", tag: "admin"),
            Row(s: 480, e: 540, kind: .event, color: "ics", title: "Standup", tag: "work"),
            Row(s: 540, e: 600, kind: .task, color: "red", title: "Planning", tag: "work"),
            Row(s: 600, e: 750, kind: .task, color: "blue", title: currentTitle, tag: "work"),
            Row(s: 750, e: 810, kind: .task, color: "green", title: "Lunch", tag: "break"),
            Row(s: 810, e: 870, kind: .event, color: "ics", title: "Review", tag: "work"),
            Row(s: 870, e: 915, kind: .task, color: "yellow", title: "Expenses", tag: "admin"),
            Row(s: 915, e: 1035, kind: .task, color: "purple", title: "Deep work", tag: "work"),
            Row(s: 1035, e: 1080, kind: .task, color: "green", title: "Errands"),
            Row(s: 1080, e: 1140, kind: .task, color: "pink", title: "Gym", tag: "health"),
            Row(s: 1140, e: 1185, kind: .task, color: "red", title: "Dinner"),
            Row(s: 1185, e: 1290, kind: .task, color: "indigo", title: "Reading"),
            Row(s: 1290, e: 1330, kind: .routine, title: "Journal"),
            Row(s: 1350, e: 1440, kind: .sleep),
        ]
    }

    /// DAYS.sparse: a 4 h 30 m gap after the current block.
    static let sparseDay: [Row] = [
        Row(s: 0, e: 420, kind: .sleep),
        Row(s: 420, e: 455, kind: .routine, done: true, title: "Stretch"),
        Row(s: 600, e: 750, kind: .task, color: "blue", title: "Write API documentation", tag: "work"),
        Row(s: 1020, e: 1140, kind: .task, color: "green", title: "Gym", tag: "health"),
        Row(s: 1380, e: 1440, kind: .sleep),
    ]

    /// The study's sky (sunrise 05:37, sunset 20:31, a half moon up
    /// 21:30–06:30, glyph at the window's midpoint) sampled at hh:30 the way
    /// computeSkySnapshot ships it.
    static func make(_ rows: [Row], projected: Bool) -> DialFaceInput {
        let blocks = rows.enumerated().map { i, r in
            DialFaceBlock(id: "fixture-\(i)", kind: r.kind, startMin: r.s, endMin: r.e,
                          completed: r.done, colorHex: r.color.flatMap { raw[$0] },
                          title: r.title, tag: r.tag)
        }
        let sun: [Double] = [0, 0, 0, 0, 0, 0, 0.1852, 0.3867, 0.5712, 0.7303, 0.8571, 0.9459,
                             0.9929, 0.9958, 0.9547, 0.8712, 0.7492, 0.594, 0.4125, 0.2127, 0.0035, 0, 0, 0]
        let moon: [Double] = [0.433, 0.4924, 0.4924, 0.433, 0.3214, 0.171, 0, 0, 0, 0, 0, 0,
                              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.171, 0.3214]
        let hours = zip(sun, moon).map { (sun: Optional($0.0), moon: Optional($0.1)) }
        return DialFaceInput(blocks: blocks,
                             sky: DialSpec.skySegments(hours: hours),
                             sunriseMin: 5 * 60 + 37, sunsetMin: 20 * 60 + 31,
                             moon: DialMoonGlyph(fraction: 0.5, waxing: true, minutes: 120),
                             projectedDay: projected)
    }
}
