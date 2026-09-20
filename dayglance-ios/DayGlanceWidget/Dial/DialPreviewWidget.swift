import WidgetKit
import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — Phase 2 preview: the static face from a FIXTURE snapshot, on
// the home screen, hub empty. Two widgets so both tiers sit side by side:
//
//   "Dial Preview · pushed"      the palette study's dense day as the pushed
//                                day: completion flags read (the 09:00 red
//                                block is past and undone: full rim, hollow
//                                fill; 07:15 blue is done: quiet mass)
//   "Dial Preview · projected"   the same day as a projected day: every past
//                                block takes the past-event tone, routines
//                                that have passed the done opacity
//
// The needle is fixed at 11:20, the study's NOW, so the widget can be held
// against docs/day-dial-palette-study.html (variant C, "Dense", "Pushed day"
// / "Projected, neutral past"). Rendered through DialFaceCache exactly as
// the shipping widget will be, so the corner also reads the image source
// and the cold render time.
//
// HOW TO BUILD IT
//   Registered only under DIAL_PREVIEW. Generate the project with the flag
//   and run the DayGlance scheme on a device (or archive as usual):
//
//     DG_WIDGET_FLAGS="DIAL_PREVIEW" npm run ios
//
//   then add the two "Dial Preview" widgets (systemLarge) from the gallery.
//   Never set the flag for a release; project.yml says the same.
// ─────────────────────────────────────────────────────────────────────────────

struct DialPreviewEntry: TimelineEntry {
    let date: Date
    let projected: Bool
    /// The cached face for this entry, resolved in the provider (as Phase 4's
    /// timeline will), and how it was obtained. Nil → the view draws live.
    let face: UIImage?
    let outcome: DialFaceCache.Outcome
}

struct DialPreviewProvider: TimelineProvider {
    let projected: Bool

    private func entry(size: CGSize?) -> DialPreviewEntry {
        // Placeholder / gallery: no size worth rendering for; draw live.
        DialPreviewEntry(date: Date(), projected: projected, face: nil, outcome: .failed)
    }

    func placeholder(in context: Context) -> DialPreviewEntry { entry(size: nil) }

    func getSnapshot(in context: Context, completion: @escaping (DialPreviewEntry) -> Void) {
        completion(entry(size: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DialPreviewEntry>) -> Void) {
        let size = context.displaySize
        let scale = UIScreen.main.scale
        let input = DialPreviewFixture.studyDenseDay(projected: projected)
        Task { @MainActor in
            let result = DialFaceCache.image(input: input, nowMin: DialPreviewFixture.nowMin, size: size, scale: scale)
            let e = DialPreviewEntry(date: Date(), projected: projected, face: result.image, outcome: result.outcome)
            completion(Timeline(entries: [e], policy: .never))
        }
    }
}

struct DialPreviewView: View {
    let entry: DialPreviewEntry

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            DialCachedFaceView(input: DialPreviewFixture.studyDenseDay(projected: entry.projected),
                               nowMin: DialPreviewFixture.nowMin, face: entry.face)
            Text(verbatim: "preview · \(entry.projected ? "projected" : "pushed") · fixture 11:20 · \(entry.outcome.summary)")
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.5))
                .padding(6)
        }
        .containerBackground(Color(hex: DialSpec.backgroundHex), for: .widget)
    }
}

/// The cached face plus the needle for one entry, with a live-drawn
/// fallback so the widget never shows a hole (placeholder, gallery, a
/// failed render). What Phase 4's timeline entries will be built from.
struct DialCachedFaceView: View {
    let input: DialFaceInput
    let nowMin: Double
    let face: UIImage?

    var body: some View {
        DialCanvas {
            ZStack(alignment: .topLeading) {
                if let face {
                    Image(uiImage: face).resizable()
                        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
                } else {
                    DialFaceView(input: input, nowMin: nowMin)
                }
                DialNeedleView(nowMin: nowMin)
            }
        }
    }
}

struct DialPreviewWidget: Widget {
    var projected = false
    var kind: String { projected ? "DialPreviewProjected" : "DialPreviewPushed" }

    init() {}
    init(projected: Bool) { self.projected = projected }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DialPreviewProvider(projected: projected)) { entry in
            DialPreviewView(entry: entry)
        }
        .configurationDisplayName(projected ? "Dial Preview · projected" : "Dial Preview · pushed")
        .description("Phase 2 static face from a fixture day. Not for release.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}

// MARK: - Fixture: the palette study's dense day

enum DialPreviewFixture {
    /// The study's NOW, 11:20.
    static let nowMin: Double = 11 * 60 + 20

    /// docs/day-dial-palette-study.html DAYS.dense, with its RAW hexes and
    /// `done` flags; the study's sky (sunrise 05:37, sunset 20:31, a half
    /// moon up 21:30–06:30, glyph at the window's midpoint) sampled at hh:30
    /// the way computeSkySnapshot ships it.
    static func studyDenseDay(projected: Bool) -> DialFaceInput {
        let raw = ["blue": "#3b82f6", "ics": "#2563eb", "red": "#ef4444", "green": "#22c55e", "purple": "#a855f7",
                   "yellow": "#eab308", "pink": "#ec4899", "indigo": "#6366f1", "orange": "#f97316", "teal": "#14b8a6"]
        // (start, end, kind, colour key, completed)
        let rows: [(Double, Double, DialBlockKind, String?, Bool)] = [
            (0, 385, .sleep, nil, false),
            (385, 420, .routine, nil, true),
            (435, 480, .task, "blue", true),
            (480, 540, .event, "ics", false),
            (540, 600, .task, "red", false),
            (600, 750, .task, "blue", false),
            (750, 810, .task, "green", false),
            (810, 870, .event, "ics", false),
            (870, 915, .task, "yellow", false),
            (915, 1035, .task, "purple", false),
            (1035, 1080, .task, "green", false),
            (1080, 1140, .task, "pink", false),
            (1140, 1185, .task, "red", false),
            (1185, 1290, .task, "indigo", false),
            (1290, 1330, .routine, nil, false),
            (1350, 1440, .sleep, nil, false),
        ]
        let blocks = rows.enumerated().map { i, r in
            DialFaceBlock(id: "fixture-\(i)", kind: r.2, startMin: r.0, endMin: r.1,
                          completed: r.4, colorHex: r.3.flatMap { raw[$0] })
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
