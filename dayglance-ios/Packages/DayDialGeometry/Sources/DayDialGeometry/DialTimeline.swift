import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The timeline's entry set (Phase 4). Not a plain 15-minute grid: the union of
//
//   - every `stepMinutes` for the next `horizonMinutes` (the needle);
//   - an exact entry at each block boundary in range (a block's state changes
//     when it starts — the hub's current block — and when it ends — the
//     band's past tone and the face cache's bucket; a block ending at 06:25
//     would otherwise keep its future treatment until 06:30);
//   - an entry at each local midnight the payload can render (the day
//     switch, as the other widgets do with WidgetTimelineDates);
//   - one entry at the midnight after the last renderable day, which is the
//     moment the resolution tiers flip the widget to Outdated.
//
// Deduplicated and sorted, nothing before the grid's first entry and nothing
// past the horizon. Pure: dates in, dates out, through the caller's Calendar.
// ─────────────────────────────────────────────────────────────────────────────

public enum DialTimeline {
    public static let stepMinutes = 15
    public static let horizonMinutes = 24 * 60

    /// One day the payload can render: its local midnight and the block
    /// boundaries on its clock.
    public struct Day: Equatable {
        public var start: Date
        public var boundaryMinutes: [Double]
        public init(start: Date, boundaryMinutes: [Double]) {
            self.start = start
            self.boundaryMinutes = boundaryMinutes
        }
    }

    /// The minutes at which a day's face or hub changes: every block's drawn
    /// start and end, sleep included (its end is when the band's tone
    /// changes). 0 and 1440 are midnights and come from the midnight entries
    /// instead. Sorted, unique.
    public static func boundaryMinutes(_ blocks: [DialFaceBlock]) -> [Double] {
        var set = Set<Double>()
        for b in blocks {
            for m in [b.startMin, b.endMin] where m > 0 && m < DialGeometry.dayMinutes {
                set.insert(m)
            }
        }
        return set.sorted()
    }

    /// `now` floored to the grid, on the wall clock.
    public static func gridStart(_ now: Date, calendar: Calendar, stepMinutes: Int = stepMinutes) -> Date {
        let c = calendar.dateComponents([.hour, .minute], from: now)
        let minute = (c.minute ?? 0) - ((c.minute ?? 0) % stepMinutes)
        return calendar.date(bySettingHour: c.hour ?? 0, minute: minute, second: 0, of: now) ?? now
    }

    /// A day's clock minute as a Date, on the WALL clock (the snapshot's
    /// minutes are local clock minutes, so 540 is 09:00 even on a DST day).
    public static func date(minute: Double, of day: Date, calendar: Calendar) -> Date? {
        let m = Int(minute.rounded())
        guard m >= 0, m < Int(DialGeometry.dayMinutes) else { return nil }
        return calendar.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: day)
    }

    /// The entry dates for one timeline.
    /// - Parameters:
    ///   - now: the provider's clock.
    ///   - days: every day the payload can render (the pushed day and each of
    ///     `days[]`), each with its boundaries.
    ///   - payloadEnd: the midnight after the last renderable day, nil when
    ///     the payload carries no date at all.
    public static func entryDates(now: Date, days: [Day], payloadEnd: Date?, calendar: Calendar,
                                  stepMinutes: Int = stepMinutes, horizonMinutes: Int = horizonMinutes) -> [Date] {
        let first = gridStart(now, calendar: calendar, stepMinutes: stepMinutes)
        let horizonEnd = first.addingTimeInterval(TimeInterval(horizonMinutes * 60))
        var set = Set<Date>()

        // The needle's grid.
        var k = 0
        while k * stepMinutes < horizonMinutes {
            set.insert(first.addingTimeInterval(TimeInterval(k * stepMinutes * 60)))
            k += 1
        }

        // Block boundaries, on each day's own clock.
        for day in days {
            for m in day.boundaryMinutes {
                if let d = date(minute: m, of: day.start, calendar: calendar) { set.insert(d) }
            }
        }

        // Every local midnight from the next one up to and including the
        // payload's end — the last one is the Outdated flip.
        var midnight = calendar.startOfDay(for: now)
        for _ in 0..<(days.count + 2) {
            guard let next = calendar.date(byAdding: .day, value: 1, to: midnight) else { break }
            midnight = next
            if let end = payloadEnd, midnight > end { break }
            set.insert(midnight)
            if let end = payloadEnd, midnight == end { break }
        }

        return set.filter { $0 >= first && $0 <= horizonEnd }.sorted()
    }
}
