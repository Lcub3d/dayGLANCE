import WidgetKit
import SwiftUI
import os
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — the widget (Phase 4: timeline and needle).
//
// A real TimelineProvider over the day-keyed payload, through the same
// resolution tiers the other widgets use (ResolvedWidgetDay, #1721): the
// pushed day, then each projected day at its midnight, then Outdated when
// the payload runs out. Each entry resolves its own day against the ENTRY's
// date, so the midnight entries switch days with no reload, and the face
// cache's projected-day rule (Phase 2) follows the tier.
//
// THE ENTRY SET is not a plain grid (DialTimeline): every 15 minutes for 24
// hours for the needle, plus an exact entry at every block start and end in
// range (the hub's current block, the band's past tone and the cache bucket
// all change there), plus each local midnight the payload can render, plus
// the midnight after the last day, which is the Outdated flip. ~100 entries
// on a typical day, ~145 on a day of 24 blocks at odd minutes.
//
// WHAT AN ENTRY CARRIES: the date and the decoded snapshot (one struct, its
// arrays shared). Never a UIImage: a face at 3× is ~5 MB decoded and there
// are 8–12 buckets a day against a ~30 MB extension budget. The provider
// warms every face this timeline needs onto disk; the view fetches one at
// render time through DialFaceCache, which keeps a single decoded face.
//
// RELOADS come from the app: WidgetBridge.updateSnapshot calls
// reloadAllTimelines only for a push whose `reloadWidgets` flag is true,
// which the JS side sets only when today, tomorrow or the invariants
// changed (utils/widgetSnapshotDedupe.js). Nothing here adds a second gate;
// the timeline's own policy is .atEnd.
// ─────────────────────────────────────────────────────────────────────────────

struct DayDialEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    /// The gallery and pre-data render (Phase 5): the placeholder face and a
    /// hub with the weekday and date only. Never true for a real timeline.
    var isPlaceholder: Bool = false
}

/// The minute of the day an entry renders, on the wall clock.
enum DayDialClock {
    static func minuteOfDay(_ date: Date, calendar: Calendar = .current) -> Double {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0))
    }
}

struct DayDialProvider: TimelineProvider {
    static let logger = Logger(subsystem: "com.dayglance.app", category: "daydial")

    func placeholder(in context: Context) -> DayDialEntry {
        DayDialEntry(date: Date(), snapshot: nil, isPlaceholder: true)
    }

    /// The gallery preview: the real payload when there is one, else the
    /// placeholder face (never the "open dayGLANCE" line in a gallery).
    func getSnapshot(in context: Context, completion: @escaping (DayDialEntry) -> Void) {
        let snapshot = loadSnapshot()
        completion(DayDialEntry(date: Date(), snapshot: snapshot, isPlaceholder: snapshot == nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayDialEntry>) -> Void) {
        let t0 = CFAbsoluteTimeGetCurrent()
        let snapshot = loadSnapshot()
        let calendar = Calendar.current
        let now = Date()
        let size = context.displaySize

        // The days this payload can render, each with its block boundaries
        // on its own clock, and the midnight after the last one.
        var days: [DialTimeline.Day] = []
        if let snapshot {
            if let start = WidgetFreshness.parseDay(snapshot.date, calendar: calendar) {
                let input = DialFaceInput(dial: snapshot.dial, sky: nil, projectedDay: false)
                days.append(DialTimeline.Day(start: start, boundaryMinutes: DialTimeline.boundaryMinutes(input.blocks)))
            }
            for day in snapshot.days ?? [] {
                guard let start = WidgetFreshness.parseDay(day.date, calendar: calendar) else { continue }
                let input = DialFaceInput(dial: day.dial, sky: nil, projectedDay: true)
                days.append(DialTimeline.Day(start: start, boundaryMinutes: DialTimeline.boundaryMinutes(input.blocks)))
            }
        }
        let lastDay = days.map(\.start).max()
        let payloadEnd = lastDay.flatMap { calendar.date(byAdding: .day, value: 1, to: $0) }
        let dates = DialTimeline.entryDates(now: now, days: days, payloadEnd: payloadEnd, calendar: calendar)
        let boundaries = days.reduce(0) { $0 + $1.boundaryMinutes.count }
        // The rendering modes this widget may be shown in: full colour always;
        // accented too on a tinted or clear Home Screen (iOS 18+), which needs
        // the mono face (DialFaceCache's header). Warm each so the first
        // tinted render is as warm as a full-colour one.
        let modes = context.environmentVariants.widgetRenderingMode ?? [.fullColor]
        let variants: [Bool] = modes.contains { $0 != .fullColor } ? [false, true] : [false]

        Task { @MainActor in
            // Warm every face this timeline can show onto disk, one bucket at a
            // time, so entries render from the cache and the App Group holds
            // exactly this timeline's faces afterwards.
            let scale = UIScreen.main.scale
            var seen = Set<String>()
            var prefixes = Set<String>()
            var cold = 0
            var coldMs = 0.0
            for date in dates {
                let day = ResolvedWidgetDay.resolve(snapshot, at: date, calendar: calendar)
                let input = DialFaceInput(day: day)
                let nowMin = DayDialClock.minuteOfDay(date, calendar: calendar)
                for mono in variants {
                    let key = DialFaceCache.key(input: input, nowMin: nowMin, size: size, scale: scale, mono: mono)
                    prefixes.insert(DialFaceCache.facePrefix(input: input, size: size, scale: scale, mono: mono))
                    guard !seen.contains(key) else { continue }
                    seen.insert(key)
                    if case let .rendered(ms, _) = DialFaceCache.image(input: input, nowMin: nowMin, size: size, scale: scale, mono: mono).outcome {
                        cold += 1
                        coldMs += ms
                    }
                }
            }
            DialFaceCache.retain(prefixes: prefixes)
            let usage = DialFaceCache.usage()
            let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
            let first = dates.first?.formatted(date: .omitted, time: .shortened) ?? "-"
            let last = dates.last?.formatted(date: .abbreviated, time: .shortened) ?? "-"
            // Whether the day being rendered right now has a sky: "none"
            // means the payload's `sky` is null (no geocoded location in the
            // app), and the face is drawing the unlit ring on purpose.
            let nowInput = DialFaceInput(day: ResolvedWidgetDay.resolve(snapshot, at: now, calendar: calendar))
            let sky = nowInput.sky.isEmpty ? "none" : "\(nowInput.sky.count)h rise=\(nowInput.sunriseMin.map { "\(Int($0))" } ?? "-") set=\(nowInput.sunsetMin.map { "\(Int($0))" } ?? "-") moon=\(nowInput.moon == nil ? "no" : "yes")"
            let zone = "\(snapshot?.timezone ?? "-")\(WidgetFreshness.zoneChanged(snapshotZone: snapshot?.timezone, at: now) ? " CHANGED" : "")"
            Self.logger.notice("timeline entries=\(dates.count, privacy: .public) days=\(days.count, privacy: .public) boundaries=\(boundaries, privacy: .public) modes=\(variants.count, privacy: .public) faces=\(seen.count, privacy: .public) cold=\(cold, privacy: .public) coldMs=\(coldMs, format: .fixed(precision: 0), privacy: .public) cache=\(usage.files, privacy: .public) files/\(usage.bytes, privacy: .public) bytes builtMs=\(ms, format: .fixed(precision: 0), privacy: .public) sky=\(sky, privacy: .public) zone=\(zone, privacy: .public) first=\(first, privacy: .public) last=\(last, privacy: .public)")

            let entries = dates.map { DayDialEntry(date: $0, snapshot: snapshot) }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }
}

struct DayDialWidgetView: View {
    let entry: DayDialEntry
    /// The preview's fixed-time scenarios pass false: a relative Text counts
    /// from the real clock, which a fixture instant is not.
    var liveCountdown: Bool = true
    @Environment(\.displayScale) private var displayScale
    /// `.accented` on a tinted or clear Home Screen (iOS 18+): the face is
    /// the mono PNG (DialFaceCache's header), and the hub and needle, drawn
    /// live, are painted white by the system at their own opacities. The
    /// needle and the teal rows are accentable: the two coloured things in
    /// the full-colour design take the accent group's colour where the
    /// platform gives it one (white on iOS, the theme's on other platforms).
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        let calendar = Calendar.current
        let day = ResolvedWidgetDay.resolve(entry.snapshot, at: entry.date, calendar: calendar)
        // Phase 5 states. Placeholder and no-data draw the placeholder face
        // (a plausible sky, no blocks); everything else draws the day.
        let hasData = entry.snapshot != nil && !entry.isPlaceholder
        let input = hasData ? DialFaceInput(day: day) : DialFaceInput.placeholder
        let nowMin = DayDialClock.minuteOfDay(entry.date, calendar: calendar)
        let hub = hasData ? DialHub.resolve(blocks: input.blocks, nowMin: nowMin)
                          : DialHubState(current: nil, runwayMinutes: nil)
        let zoneChanged = hasData && WidgetFreshness.zoneChanged(snapshotZone: entry.snapshot?.timezone, at: entry.date)
        let status: DialHubStatus = entry.isPlaceholder ? .placeholder
            : !hasData ? .setUp
            : day.isStale ? .outdated(detail: day.freshness.detailLabel(use24Hour: entry.snapshot?.use24Hour))
            : zoneChanged ? .zoneChanged
            : .live
        // A stale or mis-zoned payload dims the FACE only: the hub carries
        // the label and the needle stays, because the time itself is right.
        let dimmed = day.isStale || zoneChanged
        let live = liveCountdown && status == .live
        let countdownEnd = live ? hub.current.flatMap { endDate(minute: $0.endMin, of: entry.date, calendar: calendar) } : nil
        let openEnd = live ? hub.open?.endMin.flatMap { endDate(minute: $0, of: entry.date, calendar: calendar) } : nil
        let plannedAsOf = (status == .live && day.isProjected)
            ? day.freshness.plannedAsOfLabel(use24Hour: entry.snapshot?.use24Hour) : nil
        let use24Hour = entry.snapshot?.use24Hour
        let mono = renderingMode != .fullColor

        GeometryReader { geo in
            DialCanvas {
                ZStack(alignment: .topLeading) {
                    face(input: input, nowMin: nowMin, size: geo.size, mono: mono)
                        .opacity(dimmed ? 0.45 : 1)
                        .grayscale(dimmed ? 0.5 : 0)
                    DialHubView(date: entry.date, state: hub, use24Hour: use24Hour,
                                countdownEnd: countdownEnd, openEnd: openEnd,
                                status: status, plannedAsOf: plannedAsOf)
                    DialNeedleView(nowMin: nowMin)
                        .widgetAccentable()
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .containerBackground(Color(hex: DialSpec.backgroundHex), for: .widget)
        .widgetURL(Self.tapURL(day: day, entryDate: entry.date, calendar: calendar))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DialHubView.summary(date: entry.date, state: hub, use24Hour: use24Hour,
                                                               status: status, plannedAsOf: plannedAsOf)))
    }

    /// The cached face, or a live draw when the cache has nothing. No
    /// `widgetAccentedRenderingMode` on the image: the default (the primary
    /// colour at the image's own alpha) is exactly what the mono PNG is for.
    @ViewBuilder
    private func face(input: DialFaceInput, nowMin: Double, size: CGSize, mono: Bool) -> some View {
        if let image = DialFaceCache.image(input: input, nowMin: nowMin, size: size, scale: displayScale, mono: mono).image {
            Image(uiImage: image).resizable()
                .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
        } else {
            DialFaceView(input: input, nowMin: nowMin, mono: mono)
        }
    }

    /// The block's true end as a Date on the entry's day (or the next, past
    /// 1440), for the live countdown.
    private func endDate(minute: Double, of date: Date, calendar: Calendar) -> Date? {
        var dayStart = calendar.startOfDay(for: date)
        var m = minute
        if m >= DialGeometry.dayMinutes {
            guard let next = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return nil }
            dayStart = next
            m -= DialGeometry.dayMinutes
        }
        return DialTimeline.date(minute: m, of: dayStart, calendar: calendar)
    }

    /// A tap opens the app on the day the widget is showing, in the Day
    /// Dial (App.jsx's `day` route: `date` selects the day, `view=dial`
    /// opens the dial over it). With no payload, just the app.
    static func tapURL(day: ResolvedWidgetDay, entryDate: Date, calendar: Calendar) -> URL? {
        var parts = URLComponents()
        parts.scheme = "dayglance"
        parts.host = "day"
        let shown = day.date ?? Self.isoDay(entryDate, calendar: calendar)
        parts.queryItems = [URLQueryItem(name: "date", value: shown), URLQueryItem(name: "view", value: "dial")]
        return parts.url
    }

    private static func isoDay(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

struct DayDialWidget: Widget {
    let kind = "DayDialWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DayDialProvider()) { entry in
            DayDialWidgetView(entry: entry)
        }
        .configurationDisplayName("Day Dial")
        .description("Your day as a dial.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
