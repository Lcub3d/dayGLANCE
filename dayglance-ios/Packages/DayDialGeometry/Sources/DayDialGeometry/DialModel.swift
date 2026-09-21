import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Block span resolution and the day window. The geometric half of
// computeDialModel and computeDialRoutines in dayDial.js: where a block sits
// on the ring, how it is clipped at midnight, how last night's overrun is
// carried into this morning, which blocks share a lane, and where the
// declared night falls. The data half — energy kind, colour, completability,
// the day's totals — is the JS side's and arrives in the widget snapshot
// (`dial.blocks`, projectDialSnapshot); it is not re-derived here.
// ─────────────────────────────────────────────────────────────────────────────

/// A timed item as the resolver needs it. `startMinutes` nil means "no time
/// set" (the JS's empty / null startTime); such items never reach the ring.
public struct DialSpanInput: Equatable {
    public var id: String
    public var startMinutes: Int?
    public var durationMinutes: Int
    public var isAllDay: Bool

    public init(id: String, startMinutes: Int?, durationMinutes: Int, isAllDay: Bool = false) {
        self.id = id
        self.startMinutes = startMinutes
        self.durationMinutes = durationMinutes
        self.isAllDay = isAllDay
    }

    /// "HH:mm" / "H:m" → minutes; the JS `timeToMin` (`|| 0` on each part).
    public static func minutes(fromClock clock: String?) -> Int? {
        guard let clock, !clock.isEmpty else { return nil }
        let parts = clock.split(separator: ":", omittingEmptySubsequences: false)
        let h = Int(parts.first ?? "") ?? 0
        let m = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
        return h * 60 + m
    }
}

/// A block on the ring. `startMin`/`endMin` are the DRAWN span, clipped to
/// one revolution; the true bounds are kept for every readout, because a
/// block running to 01:00 ends at one o'clock and not at the boundary.
public struct DialRingBlock: Equatable {
    public var id: String
    public var startMin: Double
    public var endMin: Double
    /// Set on a block that runs past midnight; `endMinTrue` is minutes into
    /// the next day.
    public var endsNextDay: Bool
    public var endMinTrue: Double?
    /// Set on last night's overrun, drawn from midnight; `startMinTrue` is its
    /// start on the previous day's clock.
    public var startedPrevDay: Bool
    public var startMinTrue: Double?
    public var lane: Int
    public var laneCount: Int

    public init(id: String, startMin: Double, endMin: Double, endsNextDay: Bool = false, endMinTrue: Double? = nil,
                startedPrevDay: Bool = false, startMinTrue: Double? = nil, lane: Int = 0, laneCount: Int = 1) {
        self.id = id
        self.startMin = startMin
        self.endMin = endMin
        self.endsNextDay = endsNextDay
        self.endMinTrue = endMinTrue
        self.startedPrevDay = startedPrevDay
        self.startMinTrue = startMinTrue
        self.lane = lane
        self.laneCount = laneCount
    }
}

public struct DialSleepSegment: Equatable {
    public var startMin: Double
    public var endMin: Double
    public init(startMin: Double, endMin: Double) { self.startMin = startMin; self.endMin = endMin }
}

/// The resolved day window: minutes past midnight, or nil for an undeclared
/// side. Sleep is drawn only from a FULL window with stop after start.
public struct DialDayWindow: Equatable {
    public var startMinutes: Int?
    public var stopMinutes: Int?
    public init(startMinutes: Int?, stopMinutes: Int?) { self.startMinutes = startMinutes; self.stopMinutes = stopMinutes }
}

public struct DialRingModel: Equatable {
    public var blocks: [DialRingBlock]
    public var sleep: [DialSleepSegment]
    /// nil when there is no full window: nothing honest to show.
    public var sleepMinutes: Int?
    public init(blocks: [DialRingBlock], sleep: [DialSleepSegment], sleepMinutes: Int?) {
        self.blocks = blocks; self.sleep = sleep; self.sleepMinutes = sleepMinutes
    }
}

public enum DialModel {
    /// One day's timed items + the previous day's + the window → the ring.
    /// Order and lanes follow computeDialModel exactly: carried overruns and
    /// owned blocks together, start-sorted (then end), ties keeping input
    /// order with the carried first, then packed into lanes.
    public static func resolve(dayTasks: [DialSpanInput], prevDayTasks: [DialSpanInput] = [], window: DialDayWindow? = nil) -> DialRingModel {
        let day = DialGeometry.dayMinutes

        var raw: [DialRingBlock] = []
        for t in prevDayTasks where isTimed(t) {
            let start = Double(t.startMinutes!)
            let rawEnd = start + Double(t.durationMinutes)
            let block = DialRingBlock(id: t.id, startMin: 0, endMin: Swift.min(day, rawEnd - day),
                                      endsNextDay: false, endMinTrue: nil,
                                      startedPrevDay: true, startMinTrue: start, lane: 0, laneCount: 1)
            if block.endMin > 0 { raw.append(block) }
        }
        for t in dayTasks where isTimed(t) {
            let start = Double(t.startMinutes!)
            let rawEnd = start + Double(t.durationMinutes)
            raw.append(DialRingBlock(id: t.id, startMin: start, endMin: Swift.min(day, rawEnd),
                                     endsNextDay: rawEnd > day, endMinTrue: rawEnd > day ? rawEnd - day : nil,
                                     startedPrevDay: false, startMinTrue: nil, lane: 0, laneCount: 1))
        }

        let blocks = packLanes(raw.filter { $0.endMin > $0.startMin })

        var sleep: [DialSleepSegment] = []
        var sleepMinutes: Int? = nil
        if let s = window?.startMinutes, let e = window?.stopMinutes, e > s {
            if s > 0 { sleep.append(DialSleepSegment(startMin: 0, endMin: Double(s))) }
            if Double(e) < day { sleep.append(DialSleepSegment(startMin: Double(e), endMin: day)) }
            sleepMinutes = s + (Int(day) - e)
        }
        return DialRingModel(blocks: blocks, sleep: sleep, sleepMinutes: sleepMinutes)
    }

    /// Routines → bars on the outer track (computeDialRoutines): all-day and
    /// zero-length routines are skipped, spans clip at midnight like blocks,
    /// and overlapping routines take lanes exactly as blocks do.
    public static func routineBars(_ routines: [DialSpanInput]) -> [DialRingBlock] {
        let day = DialGeometry.dayMinutes
        var raw: [DialRingBlock] = []
        for r in routines where isTimed(r) {
            let start = Double(r.startMinutes!)
            let rawEnd = start + Double(r.durationMinutes)
            raw.append(DialRingBlock(id: r.id, startMin: start, endMin: Swift.min(day, rawEnd),
                                     endsNextDay: rawEnd > day, endMinTrue: rawEnd > day ? rawEnd - day : nil,
                                     startedPrevDay: false, startMinTrue: nil, lane: 0, laneCount: 1))
        }
        return packLanes(raw.filter { $0.endMin > $0.startMin })
    }

    /// The block the hub narrates (findDialFocusBlock): the running block at
    /// `nowMin` — the LATEST-starting one when blocks nest, so a block inside
    /// a container wins — else the next block up, else nil.
    public static func focusBlock(in blocks: [DialRingBlock], nowMin: Double) -> (index: Int, current: Bool)? {
        var running: Int? = nil
        for (i, b) in blocks.enumerated() where b.startMin <= nowMin && nowMin < b.endMin {
            if let r = running {
                if b.startMin >= blocks[r].startMin { running = i }
            } else {
                running = i
            }
        }
        if let r = running { return (r, true) }
        if let next = blocks.firstIndex(where: { $0.startMin > nowMin }) { return (next, false) }
        return nil
    }

    // The JS `timedOnly`: not all-day, has a start time, positive duration.
    private static func isTimed(_ t: DialSpanInput) -> Bool {
        !t.isAllDay && t.startMinutes != nil && t.durationMinutes > 0
    }

    // Start-sorted (then end), STABLE — V8's sort is stable and the JS relies
    // on it for ties, so the index is the final key here.
    private static func packLanes(_ blocks: [DialRingBlock]) -> [DialRingBlock] {
        let sorted = blocks.enumerated().sorted { a, b in
            if a.element.startMin != b.element.startMin { return a.element.startMin < b.element.startMin }
            if a.element.endMin != b.element.endMin { return a.element.endMin < b.element.endMin }
            return a.offset < b.offset
        }.map { $0.element }
        let lanes = IntervalLanes.assign(sorted.map { LaneSpan(startMin: $0.startMin, endMin: $0.endMin) })
        return zip(sorted, lanes).map { block, lane in
            var b = block
            b.lane = lane.lane
            b.laneCount = lane.laneCount
            return b
        }
    }
}
