import WidgetKit
import SwiftUI
import UIKit
import AppIntents
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — preview: every state of the dial from FIXTURE days, on the home
// screen. One widget; long-press → Edit Widget picks the scenario.
//
// Two kinds of scenario:
//
//   FACE scenarios (Phase 2/3) draw a DialFaceInput straight through
//   DialCachedFaceView at a fixed 11:20 on Tuesday, July 7 — the palette
//   study's NOW — so the face can be held against
//   docs/day-dial-palette-study.html and the hub against the spec render:
//     Dense · short title, Dense · long title, Sparse · runway,
//     Dense · no runway.
//
//   STATE scenarios (Phase 5) build a whole WidgetSnapshot and render it
//   through DayDialWidgetView — the SAME view, resolution and face cache the
//   real widget uses — at a chosen instant, so what the preview shows is
//   what a user sees:
//     Open time             sparse day at 13:00: "4h open · until Gym at 17:00"
//     Open until sleep      sparse day at 19:30: "3h 30m open · until sleep at 23:00"
//     Nothing else today    a day whose last block has passed, no sleep
//     Sleeping              dense day at 05:00: "Sleep · until 06:25"
//     Projected day         the dense day from days[], "Planned as of …"
//     Outdated              a payload three days old: dimmed face, label, needle
//     Time zone changed     the payload's zone differs from the device's
//     Southern moon         the moon glyph mirrored for a southern observer
//     Placeholder           the gallery render
//     No data               installed, never opened
//     Screenshot day        TODAY, live: the App Store shot. Shoot between
//                           10:00 and 12:30 for "Write API documentation"
//                           with a live countdown and "then 1h 30m open".
//
// The corner reads the scenario, the face source and cold render time (face
// scenarios), whether the date row is really Lora, and the rendering mode.
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
    // Face scenarios (fixed 11:20, DialFaceInput → DialCachedFaceView).
    case shortTitle, longTitle, sparse, dense
    // State scenarios (a WidgetSnapshot → DayDialWidgetView).
    case openTime, openUntilSleep, nothingElse, sleeping, projected, outdated, zoneChanged, southernMoon,
         placeholder, noData, screenshot

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scenario"
    static var caseDisplayRepresentations: [DialPreviewScenario: DisplayRepresentation] = [
        .shortTitle: "Dense · short title",
        .longTitle: "Dense · long title",
        .sparse: "Sparse · runway",
        .dense: "Dense · no runway",
        .openTime: "Open time",
        .openUntilSleep: "Open until sleep",
        .nothingElse: "Nothing else today",
        .sleeping: "Sleeping",
        .projected: "Projected day",
        .outdated: "Outdated",
        .zoneChanged: "Time zone changed",
        .southernMoon: "Southern moon",
        .placeholder: "Placeholder",
        .noData: "No data",
        .screenshot: "Screenshot day (shoot 10:00–12:30)",
    ]

    var isFaceScenario: Bool {
        switch self {
        case .shortTitle, .longTitle, .sparse, .dense: return true
        default: return false
        }
    }
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
    /// Face scenarios carry nothing but the scenario: the view fetches the
    /// face from the cache when it renders (a cold render the first time,
    /// ~28 ms, then disk), exactly as DayDialWidgetView does. See the
    /// provider for why nothing is pre-rendered here.
    /// State scenarios: the payload the real view resolves, and the entry it
    /// is rendered as. `date` is that entry's instant.
    var snapshot: WidgetSnapshot? = nil
    var isPlaceholder: Bool = false
}

struct DialPreviewProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DialPreviewEntry {
        DialPreviewEntry(date: DialPreviewFixture.date, scenario: .dense)
    }

    func snapshot(for configuration: DialPreviewIntent, in context: Context) async -> DialPreviewEntry {
        entry(for: configuration.scenario, size: context.displaySize)
    }

    /// Returns at once, for every scenario. Earlier versions pre-rendered the
    /// face scenarios' PNG here with `await MainActor.run { DialFaceCache
    /// .image(…) }`, and on device that timeline never arrived: the widget
    /// sat on its redacted placeholder while the state scenarios, which do
    /// not hop, rendered. The real widget warms its faces from
    /// `getTimeline(completion:)` in an unstructured `Task { @MainActor in }`
    /// and calls `completion` from there, which works; a hop to the main
    /// actor from inside the async `timeline(for:in:)` does not come back.
    /// So this provider does no rendering at all, and the first render of a
    /// face scenario is a cold one in the view, like the real widget's own
    /// fallback path.
    func timeline(for configuration: DialPreviewIntent, in context: Context) async -> Timeline<DialPreviewEntry> {
        let scenario = configuration.scenario
        let entry = entry(for: scenario, size: context.displaySize)
        // The screenshot day follows the clock: keep the needle moving like
        // the real widget. Every other state is a frozen instant.
        let policy: TimelineReloadPolicy = scenario == .screenshot
            ? .after(Date().addingTimeInterval(15 * 60)) : .never
        return Timeline(entries: [entry], policy: policy)
    }

    private func entry(for scenario: DialPreviewScenario, size: CGSize) -> DialPreviewEntry {
        if scenario.isFaceScenario {
            return DialPreviewEntry(date: DialPreviewFixture.date, scenario: scenario)
        }
        let state = DialPreviewFixture.state(for: scenario)
        return DialPreviewEntry(date: state.now, scenario: scenario, snapshot: state.snapshot, isPlaceholder: state.isPlaceholder)
    }
}

struct DialPreviewView: View {
    let entry: DialPreviewEntry
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if entry.scenario.isFaceScenario {
                let input = DialPreviewFixture.input(for: entry.scenario)
                let mono = renderingMode != .fullColor
                GeometryReader { geo in
                    // The same fetch the real widget makes in its body: memory,
                    // the App Group PNG, or a cold render the first time.
                    let face = DialFaceCache.image(input: input, nowMin: DialPreviewFixture.nowMin, size: geo.size,
                                                   scale: displayScale, mono: mono)
                    DialCachedFaceView(input: input, nowMin: DialPreviewFixture.nowMin, face: face.image,
                                       hubDate: entry.date, use24Hour: true, mono: mono)
                        .frame(width: geo.size.width, height: geo.size.height)
                    corner("preview · \(entry.scenario.rawValue) · fixture 11:20 · \(face.outcome.summary) · \(lora) · \(mode)")
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .bottomLeading)
                }
            } else {
                DayDialWidgetView(entry: DayDialEntry(date: entry.date, snapshot: entry.snapshot, isPlaceholder: entry.isPlaceholder),
                                  liveCountdown: entry.scenario == .screenshot)
                // The screenshot day is the store shot: no readout on it. Every
                // other scenario keeps the corner, the only way to tell the
                // face source, the date face and the rendering mode apart.
                if entry.scenario != .screenshot {
                    corner("preview · \(entry.scenario.rawValue) · fixture · \(lora) · \(mode)")
                }
            }
        }
        .containerBackground(Color(hex: DialSpec.backgroundHex), for: .widget)
    }

    private var lora: String { DialHubTypography.loraIsInstalled ? "Lora ✓" : "Lora MISSING" }

    private var mode: String {
        switch renderingMode {
        case .accented: return "accented"
        case .vibrant: return "vibrant"
        default: return "fullColor"
        }
    }

    private func corner(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundStyle(.white.opacity(0.5))
            .padding(6)
    }
}

/// The cached face, the hub overlay and the needle for one entry, with a
/// live-drawn face as fallback so the widget never shows a hole
/// (placeholder, gallery, a failed render). What the Day Dial's timeline
/// entries are built from (DayDialWidget). `hubDate` nil draws no hub.
struct DialCachedFaceView: View {
    let input: DialFaceInput
    let nowMin: Double
    let face: UIImage?
    var hubDate: Date? = nil
    var use24Hour: Bool? = nil
    /// The accented mode's face when `face` is nil (DialFaceView.mono).
    var mono: Bool = false

    var body: some View {
        DialCanvas {
            ZStack(alignment: .topLeading) {
                // Unredacted for the same reason as DayDialWidgetView.face: a
                // redacted placeholder would show the face as one grey slab.
                Group {
                    if let face {
                        Image(uiImage: face).resizable()
                            .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
                    } else {
                        DialFaceView(input: input, nowMin: nowMin, mono: mono)
                    }
                }
                .unredacted()
                if let hubDate {
                    DialHubView(date: hubDate, state: DialHub.resolve(blocks: input.blocks, nowMin: nowMin), use24Hour: use24Hour)
                }
                DialNeedleView(nowMin: nowMin)
                    .widgetAccentable()
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
        case .sparse: return make(sparseDay, projected: false)
        default: return make(denseDay(currentTitle: "Write API documentation"), projected: false)
        }
    }

    // MARK: state scenarios — whole payloads through the real widget view

    struct State {
        var snapshot: WidgetSnapshot?
        var now: Date
        var isPlaceholder = false
    }

    /// July 7, 2026 at a clock minute, in the device's calendar.
    static func fixtureInstant(minute: Int, dayOffset: Int = 0) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 7; c.day = 7 + dayOffset; c.hour = minute / 60; c.minute = minute % 60
        return Calendar.current.date(from: c) ?? Date()
    }

    static func isoDay(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func state(for scenario: DialPreviewScenario) -> State {
        let july7 = isoDay(fixtureInstant(minute: 0))
        switch scenario {
        case .openTime:
            return State(snapshot: snapshot(date: july7, rows: sparseDay, capturedAt: fixtureInstant(minute: 7 * 60 + 5)),
                         now: fixtureInstant(minute: 13 * 60))
        case .openUntilSleep:
            return State(snapshot: snapshot(date: july7, rows: sparseDay, capturedAt: fixtureInstant(minute: 7 * 60 + 5)),
                         now: fixtureInstant(minute: 19 * 60 + 30))
        case .nothingElse:
            let rows = [Row(s: 0, e: 420, kind: .sleep), Row(s: 600, e: 750, kind: .task, color: "blue", title: "Write API documentation", tag: "work")]
            return State(snapshot: snapshot(date: july7, rows: rows, capturedAt: fixtureInstant(minute: 7 * 60 + 5)),
                         now: fixtureInstant(minute: 16 * 60))
        case .sleeping:
            return State(snapshot: snapshot(date: july7, rows: denseDay(currentTitle: "Write API documentation"), capturedAt: fixtureInstant(minute: 22 * 60, dayOffset: -1)),
                         now: fixtureInstant(minute: 5 * 60))
        case .projected:
            // Pushed on Monday the 6th at 20:42 with Tuesday in days[]: the
            // entry on Tuesday resolves to the projected tier.
            let july6 = isoDay(fixtureInstant(minute: 0, dayOffset: -1))
            var snap = snapshot(date: july6, rows: sparseDay, capturedAt: fixtureInstant(minute: 20 * 60 + 42, dayOffset: -1))
            snap.days = [WidgetDay(date: july7, dateLabel: nil, nextTask: nil, upcomingTasks: nil, sky: fixtureSky(),
                                   dial: DialSnapshot(date: july7, blocks: blocks(denseDay(currentTitle: "Write API documentation"))))]
            return State(snapshot: snap, now: fixtureInstant(minute: 11 * 60 + 20))
        case .outdated:
            let july4 = isoDay(fixtureInstant(minute: 0, dayOffset: -3))
            return State(snapshot: snapshot(date: july4, rows: denseDay(currentTitle: "Write API documentation"), capturedAt: fixtureInstant(minute: 20 * 60 + 42, dayOffset: -3)),
                         now: fixtureInstant(minute: 11 * 60 + 20))
        case .zoneChanged:
            var snap = snapshot(date: july7, rows: denseDay(currentTitle: "Write API documentation"), capturedAt: fixtureInstant(minute: 7 * 60 + 5))
            snap.timezone = otherZone(than: .current, at: fixtureInstant(minute: 11 * 60 + 20))
            return State(snapshot: snap, now: fixtureInstant(minute: 11 * 60 + 20))
        case .southernMoon:
            var snap = snapshot(date: july7, rows: denseDay(currentTitle: "Write API documentation"), capturedAt: fixtureInstant(minute: 22 * 60, dayOffset: -1))
            snap.sky = fixtureSky(southern: true, fraction: 0.3)
            return State(snapshot: snap, now: fixtureInstant(minute: 2 * 60 + 30))
        case .placeholder:
            return State(snapshot: nil, now: fixtureInstant(minute: 11 * 60 + 20), isPlaceholder: true)
        case .noData:
            return State(snapshot: nil, now: fixtureInstant(minute: 11 * 60 + 20))
        case .screenshot:
            let now = Date()
            return State(snapshot: snapshot(date: isoDay(now), rows: screenshotDay, capturedAt: now), now: now)
        default:
            return State(snapshot: nil, now: fixtureInstant(minute: 11 * 60 + 20), isPlaceholder: true)
        }
    }

    /// The App Store day: a full ring, a current task whose title reads
    /// well from 10:00 to 12:30, a real runway after it, evening blocks so the
    /// ring is busy at any hour the shot is taken.
    static let screenshotDay: [Row] = [
        Row(s: 0, e: 400, kind: .sleep),
        Row(s: 400, e: 430, kind: .routine, done: true, title: "Stretch"),
        Row(s: 450, e: 510, kind: .task, color: "blue", done: true, title: "Email", tag: "admin"),
        Row(s: 510, e: 540, kind: .event, color: "ics", done: true, title: "Standup", tag: "work"),
        Row(s: 540, e: 600, kind: .task, color: "red", done: true, title: "Planning", tag: "work"),
        Row(s: 600, e: 750, kind: .task, color: "blue", title: "Write API documentation", tag: "work"),
        Row(s: 840, e: 900, kind: .event, color: "ics", title: "Design review", tag: "work"),
        Row(s: 915, e: 1020, kind: .task, color: "purple", title: "Deep work", tag: "work"),
        Row(s: 1050, e: 1110, kind: .task, color: "pink", title: "Gym", tag: "health"),
        Row(s: 1140, e: 1200, kind: .task, color: "orange", title: "Dinner"),
        Row(s: 1230, e: 1320, kind: .task, color: "indigo", title: "Reading"),
        Row(s: 1320, e: 1350, kind: .routine, title: "Journal"),
        Row(s: 1380, e: 1440, kind: .sleep),
    ]

    /// A zone whose offset differs from `zone` at `now`, so the mismatch is real.
    static func otherZone(than zone: TimeZone, at now: Date) -> String {
        for id in ["Asia/Tokyo", "America/Chicago", "Europe/Berlin"] {
            if let z = TimeZone(identifier: id), z.secondsFromGMT(for: now) != zone.secondsFromGMT(for: now) { return id }
        }
        return "Pacific/Auckland"
    }

    static func blocks(_ rows: [Row]) -> [DialBlock] {
        rows.enumerated().map { i, r in
            DialBlock(type: r.kind.rawValue, id: "fixture-\(i)", title: r.title, tag: r.tag,
                      startMin: Int(r.s), durationMin: Int(r.e - r.s), kind: nil, completed: r.done,
                      colorHex: r.color.flatMap { raw[$0] }, lane: 0, laneCount: 1,
                      endsNextDay: nil, endMinTrue: nil, startedPrevDay: nil)
        }
    }

    /// The study's sky as the snapshot ships it (DialFaceInput.placeholder
    /// draws the same one).
    static func fixtureSky(southern: Bool = false, fraction: Double = 0.5) -> SkySnapshot {
        SkySnapshot(sunriseMin: 5 * 60 + 37, sunsetMin: 20 * 60 + 31, polar: nil,
                    hours: DialFaceInput.placeholderSkyHours.map { SkyHour(sun: $0.sun, moon: $0.moon) },
                    moon: SkyMoon(fraction: fraction, waxing: true, glyphMin: 120), southern: southern)
    }

    /// A whole payload for one day, in this device's zone, 24-hour clock.
    static func snapshot(date: String, rows: [Row], capturedAt: Date) -> WidgetSnapshot {
        WidgetSnapshot(date: date, dateLabel: nil, use24Hour: true, nextTask: nil, upcomingTasks: nil,
                       allGoals: nil, allProjects: nil, sky: fixtureSky(),
                       dial: DialSnapshot(date: date, blocks: blocks(rows)), days: nil,
                       updatedAt: capturedAt.timeIntervalSince1970 * 1000, timezone: TimeZone.current.identifier)
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
        return DialFaceInput(blocks: blocks,
                             sky: DialSpec.skySegments(hours: DialFaceInput.placeholderSkyHours),
                             sunriseMin: 5 * 60 + 37, sunsetMin: 20 * 60 + 31,
                             moon: DialMoonGlyph(fraction: 0.5, waxing: true, minutes: 120),
                             projectedDay: projected)
    }
}
