import WidgetKit
import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial render-budget spike
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT THIS IS
//   docs/day-dial-widget-handoff.md §6 gates the whole widget on one question
//   that only a device can answer: does a Path-heavy dial survive WidgetKit's
//   render budget across a 96-entry timeline on an A15? This widget exists to
//   ask it. It draws a synthetic day at the real dial's element counts —
//   ~981 static shapes and 18 moving — 96 times, 15 minutes apart, under one
//   of two strategies chosen at compile time (DialSpikeSupport.swift):
//
//     cachedImage  (default)      static face → ImageRenderer once → PNG in the
//                                 App Group; each entry = image + rotated needle
//                                 + one past-dimming sector (~20 views)
//     livePaths    (DIAL_SPIKE_LIVE_PATHS)   each entry draws all ~1000 views
//
//   Nothing here is meant to be looked at. It is meant to be measured.
//
// HOW TO BUILD IT
//   The widget is only registered under DIAL_SPIKE. Generate the project with
//   the flag(s) in DG_WIDGET_FLAGS and archive/run as usual:
//
//     DG_WIDGET_FLAGS="DIAL_SPIKE"                        npm run ios   # cached
//     DG_WIDGET_FLAGS="DIAL_SPIKE DIAL_SPIKE_LIVE_PATHS"  npm run ios   # live
//
//   Install on the A15 device, add the "Dial Spike" widget (systemLarge) to
//   the home screen. Adding it is what triggers getTimeline; so does any app
//   snapshot push (WidgetBridge calls reloadAllTimelines) and the Xcode
//   "Run" of the widget extension scheme.
//
// HOW TO READ IT
//   Console.app, device selected, filter:
//       subsystem:com.dayglance.app  category:dialspike
//   Lines, in order:
//     "timeline"   mode, entry count, static/moving element counts, and how
//                  long getTimeline took; in cachedImage mode also whether the
//                  base image was a cache hit or a fresh ImageRenderer pass,
//                  and that pass's ms and pixel size.
//     "entry i/96" one per entry as WidgetKit evaluates its body: how long
//                  the body took to BUILD (bodyMs), the process footprint and
//                  the memory still available (availMB) at that moment.
//
//   What bodyMs is NOT: rasterisation. WidgetKit rasterises and archives each
//   entry's view AFTER the body returns, in this same process, one entry at a
//   time. So the cost you care about is the gap BETWEEN consecutive entry
//   lines' timestamps, minus the second one's bodyMs. In Instruments this is
//   plain to see: File ▸ New ▸ Blank, add "os_signpost" and "Time Profiler",
//   target the DayGlanceWidget extension process, then add the widget. The
//   "entryBody" intervals are the body builds; the space between them is
//   WidgetKit's render+archive of the previous entry; "baseImage" is the
//   ImageRenderer pass; "timeline" brackets the provider call.
//
//   The widget itself prints "mode · i/96 · hh:mm" in its corner, so a glance
//   at the home screen against a clock tells you whether entries are being
//   shown on schedule.
//
// WHAT FAILING LOOKS LIKE
//   • The entry lines stop before 96 (or never start) and Console, filtered
//     to process chronod, says the extension timed out or failed to archive.
//   • availMB trends to single digits, then a line from ReportCrash /
//     a JetsamEvent-*.ips under Settings ▸ Privacy & Security ▸ Analytics
//     Data names DayGlanceWidget with reason per-process-limit. The 30 MB
//     WidgetBridge.swift talks about is that limit.
//   • The widget on the home screen shows the placeholder, or its corner
//     index lags the clock by more than one 15-minute step.
//   • Working thresholds, for the numbers rather than the crashes: on the
//     A15, an inter-entry gap over ~50 ms median, a total under "timeline" +
//     96 gaps over ~5 s, or a footprint over ~20 MB at any point means the
//     strategy is not one to build on — it has no headroom for real data,
//     text, or a second widget instance.
//
// DECIDING
//   docs/day-dial-widget-handoff.md §6 "Deciding between the two paths" is
//   the rule. In short: cached image clean → cached. Cached image defective
//   and live fast+light → live. Cached image defective and live slow or
//   heavy → neither is ready; stop and talk. A cache defect reopens the
//   question on its own; it does not need live to also pass.
// ─────────────────────────────────────────────────────────────────────────────

struct DialSpikeEntry: TimelineEntry {
    let date: Date
    /// Minutes past local midnight the needle points at.
    let nowMin: Double
    let index: Int
    let total: Int
}

// MARK: - Cache (cachedImage mode)

/// The static face, rendered once per (fixture, size, scale) and kept both in
/// memory for this process and as a PNG in the App Group for the next one.
enum DialSpikeCache {
    static var image: UIImage?
    static var key = ""

    static func directory() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: kAppGroupSuite)?
            .appendingPathComponent("dial-spike", isDirectory: true)
    }

    static func key(size: CGSize, scale: CGFloat) -> String {
        DialSpikeLog.digest("\(DialSpikeFixture.hashSeed)|\(Int(size.width))x\(Int(size.height))@\(scale)")
    }

    /// Ensures `image` is ready for this size. Returns how it got there, for
    /// the log. Must run on the main actor: ImageRenderer requires it.
    @MainActor
    static func prepare(size: CGSize, scale: CGFloat) -> String {
        let k = key(size: size, scale: scale)
        if image != nil, key == k { return "memory hit" }

        let file = directory()?.appendingPathComponent("\(k).png")
        if let file, let data = try? Data(contentsOf: file), let img = UIImage(data: data, scale: scale) {
            image = img; key = k
            return "disk hit (\(data.count) bytes)"
        }

        let sp = DialSpikeLog.signposter
        let state = sp.beginInterval("baseImage", id: sp.makeSignpostID())
        let t0 = CFAbsoluteTimeGetCurrent()
        let renderer = ImageRenderer(content:
            DialSpikeFace(elements: DialSpikeFixture.staticElements(nowMin: nil))
                .frame(width: size.width, height: size.height)
                .background(DialSpikeFixture.background))
        renderer.scale = scale
        guard let rendered = renderer.uiImage else {
            sp.endInterval("baseImage", state)
            DialSpikeLog.logger.error("baseImage: ImageRenderer returned nil — entries will fall back to live paths")
            return "render FAILED"
        }
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        sp.endInterval("baseImage", state)
        image = rendered; key = k

        var stored = "not stored"
        if let file, let dir = directory(), let png = rendered.pngData() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            if (try? png.write(to: file, options: .atomic)) != nil { stored = "\(png.count) bytes on disk" }
        }
        let px = "\(Int(rendered.size.width * rendered.scale))x\(Int(rendered.size.height * rendered.scale))"
        return "rendered in \(Int(ms.rounded())) ms, \(px) px @\(Int(rendered.scale))x, \(stored)"
    }
}

// MARK: - Provider

struct DialSpikeProvider: TimelineProvider {
    static let entryCount = 96
    static let stepMinutes = 15

    private func minuteOfDay(_ date: Date) -> Double {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0))
    }

    func placeholder(in context: Context) -> DialSpikeEntry {
        DialSpikeEntry(date: Date(), nowMin: 680, index: -1, total: 1)
    }

    func getSnapshot(in context: Context, completion: @escaping (DialSpikeEntry) -> Void) {
        let now = Date()
        completion(DialSpikeEntry(date: now, nowMin: minuteOfDay(now), index: -1, total: 1))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DialSpikeEntry>) -> Void) {
        let sp = DialSpikeLog.signposter
        let state = sp.beginInterval("timeline", id: sp.makeSignpostID())
        let t0 = CFAbsoluteTimeGetCurrent()
        let size = context.displaySize
        let scale = UIScreen.main.scale

        // Entries start on the current quarter hour, so the needle steps on
        // the clock's own grid rather than on whenever the widget was added.
        let now = Date()
        let cal = Calendar.current
        let minute = cal.component(.minute, from: now)
        let start = cal.date(byAdding: .minute, value: -(minute % Self.stepMinutes), to: now).map {
            cal.date(bySetting: .second, value: 0, of: $0) ?? $0
        } ?? now

        Task { @MainActor in
            var imageNote = "n/a (live paths)"
            if dialSpikeMode == .cachedImage {
                imageNote = DialSpikeCache.prepare(size: size, scale: scale)
            }
            let entries = (0..<Self.entryCount).map { i -> DialSpikeEntry in
                let d = start.addingTimeInterval(Double(i * Self.stepMinutes) * 60)
                return DialSpikeEntry(date: d, nowMin: minuteOfDay(d), index: i, total: Self.entryCount)
            }
            let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
            DialSpikeLog.logger.notice("timeline mode=\(dialSpikeMode.rawValue, privacy: .public) entries=\(entries.count, privacy: .public) static=\(DialSpikeFixture.staticElements(nowMin: nil).count, privacy: .public) moving=\(DialSpikeFixture.movingElements().count, privacy: .public) size=\(Int(size.width), privacy: .public)x\(Int(size.height), privacy: .public)pt@\(Int(scale), privacy: .public)x builtMs=\(ms, format: .fixed(precision: 1), privacy: .public) baseImage=\(imageNote, privacy: .public) footprintMB=\(DialSpikeLog.footprintMB(), format: .fixed(precision: 1), privacy: .public) availMB=\(DialSpikeLog.availableMemoryMB(), format: .fixed(precision: 1), privacy: .public)")
            sp.endInterval("timeline", state)
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }
}

// MARK: - View

struct DialSpikeWidgetView: View {
    let entry: DialSpikeEntry

    var body: some View {
        timed {
            ZStack(alignment: .bottomLeading) {
                Group {
                    switch dialSpikeMode {
                    case .livePaths:
                        DialSpikeFace(elements: DialSpikeFixture.staticElements(nowMin: entry.nowMin))
                    case .cachedImage:
                        if let image = DialSpikeCache.image {
                            Image(uiImage: image).resizable().scaledToFit()
                            DialSpikeFace(elements: [DialSpikeFixture.pastMask(nowMin: entry.nowMin)])
                        } else {
                            // No base image (placeholder, gallery, or a failed
                            // render): draw live so the widget never shows a hole.
                            DialSpikeFace(elements: DialSpikeFixture.staticElements(nowMin: entry.nowMin))
                        }
                    }
                    DialSpikeNeedle(nowMin: entry.nowMin)
                }
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                Text("\(dialSpikeMode == .livePaths ? "live" : "cached") · \(entry.index + 1)/\(entry.total) · \(entry.date, format: .dateTime.hour().minute())")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(6)
            }
        }
        .containerBackground(DialSpikeFixture.background, for: .widget)
    }

    /// Brackets the body build in a signpost and a log line. This measures
    /// construction, not rasterisation — see the header for how to read the
    /// gap between two entries' lines, which is the rasterisation.
    private func timed<V: View>(@ViewBuilder _ make: () -> V) -> V {
        let sp = DialSpikeLog.signposter
        let state = sp.beginInterval("entryBody", id: sp.makeSignpostID())
        let t0 = CFAbsoluteTimeGetCurrent()
        let view = make()
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        sp.endInterval("entryBody", state)
        DialSpikeLog.logger.notice("entry \(entry.index + 1, privacy: .public)/\(entry.total, privacy: .public) mode=\(dialSpikeMode.rawValue, privacy: .public) nowMin=\(Int(entry.nowMin), privacy: .public) bodyMs=\(ms, format: .fixed(precision: 2), privacy: .public) footprintMB=\(DialSpikeLog.footprintMB(), format: .fixed(precision: 1), privacy: .public) availMB=\(DialSpikeLog.availableMemoryMB(), format: .fixed(precision: 1), privacy: .public)")
        return view
    }
}

// MARK: - Widget

struct DialSpikeWidget: Widget {
    let kind = "DialSpikeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DialSpikeProvider()) { entry in
            DialSpikeWidgetView(entry: entry)
        }
        .configurationDisplayName("Dial Spike")
        .description("Render-budget test build. Not for release.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
