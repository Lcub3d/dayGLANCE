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
        DayDialEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (DayDialEntry) -> Void) {
        completion(DayDialEntry(date: Date(), snapshot: loadSnapshot()))
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
                let key = DialFaceCache.key(input: input, nowMin: nowMin, size: size, scale: scale)
                prefixes.insert(DialFaceCache.facePrefix(input: input, size: size, scale: scale))
                guard !seen.contains(key) else { continue }
                seen.insert(key)
                if case let .rendered(ms, _) = DialFaceCache.image(input: input, nowMin: nowMin, size: size, scale: scale).outcome {
                    cold += 1
                    coldMs += ms
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
            Self.logger.notice("timeline entries=\(dates.count, privacy: .public) days=\(days.count, privacy: .public) boundaries=\(boundaries, privacy: .public) faces=\(seen.count, privacy: .public) cold=\(cold, privacy: .public) coldMs=\(coldMs, format: .fixed(precision: 0), privacy: .public) cache=\(usage.files, privacy: .public) files/\(usage.bytes, privacy: .public) bytes builtMs=\(ms, format: .fixed(precision: 0), privacy: .public) sky=\(sky, privacy: .public) first=\(first, privacy: .public) last=\(last, privacy: .public)")

            let entries = dates.map { DayDialEntry(date: $0, snapshot: snapshot) }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }
}

struct DayDialWidgetView: View {
    let entry: DayDialEntry
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let calendar = Calendar.current
        let day = ResolvedWidgetDay.resolve(entry.snapshot, at: entry.date, calendar: calendar)
        let input = DialFaceInput(day: day)
        let nowMin = DayDialClock.minuteOfDay(entry.date, calendar: calendar)
        let hub = DialHub.resolve(blocks: input.blocks, nowMin: nowMin)
        let countdownEnd = hub.current.flatMap { endDate(minute: $0.endMin, of: entry.date, calendar: calendar) }
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                DialCachedFaceView(input: input, nowMin: nowMin,
                                   face: DialFaceCache.image(input: input, nowMin: nowMin, size: geo.size, scale: displayScale).image,
                                   hubDate: entry.date, use24Hour: entry.snapshot?.use24Hour,
                                   countdownEnd: day.isStale ? nil : countdownEnd)
                    .staleDimmed(day.freshness)
                if day.isStale {
                    StaleBanner(freshness: day.freshness, use24Hour: entry.snapshot?.use24Hour)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color(hex: DialSpec.backgroundHex).opacity(0.85), in: Capsule())
                        .padding(.bottom, 6)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .containerBackground(Color(hex: DialSpec.backgroundHex), for: .widget)
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
