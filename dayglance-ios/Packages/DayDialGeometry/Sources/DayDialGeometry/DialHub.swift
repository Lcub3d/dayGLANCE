import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The hub's facts for one entry (handoff §5 "Hub"): which block the centre
// stack narrates, how long it has left, and how much open time follows it.
// Derived from the day's blocks PER ENTRY, never from the snapshot's
// push-time `upNext`, because which block is current changes with the
// entry's clock, not with when the snapshot was pushed.
//
// Pure and tested; the view only formats what this returns.
// ─────────────────────────────────────────────────────────────────────────────

/// The block the hub is about.
public struct DialHubCurrent: Equatable {
    public var id: String
    public var title: String
    /// The first tag, without its `#`.
    public var tag: String?
    public var startMin: Double
    /// The real end, minutes from THIS day's midnight (past 1440 when the
    /// block runs into tomorrow).
    public var endMin: Double
    /// Whole minutes from the entry to the end. Always positive: the block
    /// is running.
    public var minutesLeft: Double
    public init(id: String, title: String, tag: String?, startMin: Double, endMin: Double, minutesLeft: Double) {
        self.id = id
        self.title = title
        self.tag = tag
        self.startMin = startMin
        self.endMin = endMin
        self.minutesLeft = minutesLeft
    }
}

/// Open time (Phase 5): nothing narrated is running and the hub says how
/// long until the next thing, and what that thing is.
public struct DialHubOpen: Equatable {
    /// Whole minutes from the entry to `endMin`, or to midnight when nothing
    /// else is scheduled today.
    public var minutesUntil: Double
    /// When the open time ends: the next block's start (sleep included), or
    /// nil when nothing else is scheduled today.
    public var endMin: Double?
    /// The block that ends it, for "until <title> at 14:00"; nil when it is
    /// sleep ("until sleep at 23:00") or nothing.
    public var nextTitle: String?
    public var nextIsSleep: Bool
    public init(minutesUntil: Double, endMin: Double?, nextTitle: String?, nextIsSleep: Bool) {
        self.minutesUntil = minutesUntil
        self.endMin = endMin
        self.nextTitle = nextTitle
        self.nextIsSleep = nextIsSleep
    }
}

/// Inside a sleep block (Phase 5): "Sleep" and when it ends.
public struct DialHubSleep: Equatable {
    /// The real end, minutes from this day's midnight (past 1440 when the
    /// block runs into tomorrow).
    public var endMin: Double
    public var minutesLeft: Double
    public init(endMin: Double, minutesLeft: Double) {
        self.endMin = endMin
        self.minutesLeft = minutesLeft
    }
}

public struct DialHubState: Equatable {
    /// The running narrated block, or nil.
    public var current: DialHubCurrent?
    /// Minutes between the current block's end and the next block's start
    /// (a task, event, routine OR sleep — Phase 5 let the runway end at
    /// sleep), only when that gap is at least
    /// `DialSpec.Hub.runwayMinimumMinutes`; nil otherwise, and nil when
    /// nothing follows today.
    public var runwayMinutes: Double?
    /// The runway ends at a sleep block: "then 2h 30m until sleep" rather
    /// than "then 2h 30m open".
    public var runwayEndsAtSleep: Bool
    /// Set when the entry falls inside a sleep block and nothing narrated
    /// is running.
    public var sleep: DialHubSleep?
    /// Set when nothing is running at all: the open-time copy.
    public var open: DialHubOpen?

    public init(current: DialHubCurrent?, runwayMinutes: Double?, runwayEndsAtSleep: Bool = false,
                sleep: DialHubSleep? = nil, open: DialHubOpen? = nil) {
        self.current = current
        self.runwayMinutes = runwayMinutes
        self.runwayEndsAtSleep = runwayEndsAtSleep
        self.sleep = sleep
        self.open = open
    }
}

public enum DialHub {
    /// Which blocks the hub narrates: tasks, events and routines. Sleep is
    /// context, never schedule — it is never "current" and it is not what
    /// follows a block ("open" time is waking time).
    public static func isNarrated(_ block: DialFaceBlock) -> Bool {
        block.kind != .sleep
    }

    /// The running block at `nowMin` — `startMin <= now < endMin` on the DRAWN
    /// span — and, when blocks nest, the LATEST-starting one, so a block
    /// inside a container wins (findDialFocusBlock's rule, as
    /// DialModel.focusBlock). Ties keep the earlier in list order. No "next
    /// up" fallback: an idle hub is Phase 5's.
    public static func currentBlock(in blocks: [DialFaceBlock], nowMin: Double) -> DialFaceBlock? {
        var running: DialFaceBlock? = nil
        for b in blocks where isNarrated(b) && b.startMin <= nowMin && nowMin < b.endMin {
            if let r = running {
                if b.startMin > r.startMin { running = b }
            } else {
                running = b
            }
        }
        return running
    }

    /// The first block of ANY kind that starts at or after `minute` (the
    /// spec's `after = blocks.filter(b => b.s >= CUR_END)`, widened in Phase
    /// 5 to sleep: what ends open time can be bedtime). Nil when nothing
    /// follows today. Ties keep list order.
    public static func nextBlock(startingAtOrAfter minute: Double, in blocks: [DialFaceBlock]) -> DialFaceBlock? {
        var best: DialFaceBlock? = nil
        for b in blocks where b.startMin >= minute {
            if let cur = best { if b.startMin < cur.startMin { best = b } } else { best = b }
        }
        return best
    }

    /// The gap from `endMin` to the next block (sleep included), or nil when
    /// nothing follows today.
    public static func gapAfter(endMin: Double, in blocks: [DialFaceBlock]) -> Double? {
        nextBlock(startingAtOrAfter: endMin, in: blocks).map { $0.startMin - endMin }
    }

    /// The sleep block the entry falls inside, on the drawn span.
    public static func sleepBlock(in blocks: [DialFaceBlock], nowMin: Double) -> DialFaceBlock? {
        blocks.first { $0.kind == .sleep && $0.startMin <= nowMin && nowMin < $0.endMin }
    }

    public static func resolve(blocks: [DialFaceBlock], nowMin: Double) -> DialHubState {
        if let b = currentBlock(in: blocks, nowMin: nowMin) {
            let end = b.trueEndMin
            let current = DialHubCurrent(id: b.id, title: b.title ?? "", tag: b.tag.flatMap { $0.isEmpty ? nil : $0 },
                                         startMin: b.startMin, endMin: end, minutesLeft: end - nowMin)
            // A block that runs into tomorrow has no runway on this day's dial.
            var runway: Double? = nil
            var toSleep = false
            if !b.endsNextDay, let next = nextBlock(startingAtOrAfter: end, in: blocks),
               next.startMin - end >= DialSpec.Hub.runwayMinimumMinutes {
                runway = next.startMin - end
                toSleep = next.kind == .sleep
            }
            return DialHubState(current: current, runwayMinutes: runway, runwayEndsAtSleep: toSleep)
        }
        if let s = sleepBlock(in: blocks, nowMin: nowMin) {
            let end = s.trueEndMin
            return DialHubState(current: nil, runwayMinutes: nil,
                                sleep: DialHubSleep(endMin: end, minutesLeft: end - nowMin))
        }
        // Open time: until the next block of any kind that starts after now
        // (one starting AT now would be current or sleep above), else until
        // midnight with nothing else today.
        let open: DialHubOpen
        if let next = nextBlock(startingAtOrAfter: nowMin, in: blocks), next.startMin > nowMin {
            open = DialHubOpen(minutesUntil: next.startMin - nowMin, endMin: next.startMin,
                               nextTitle: next.kind == .sleep ? nil : (next.title ?? ""), nextIsSleep: next.kind == .sleep)
        } else {
            open = DialHubOpen(minutesUntil: DialGeometry.dayMinutes - nowMin, endMin: nil, nextTitle: nil, nextIsSleep: false)
        }
        return DialHubState(current: nil, runwayMinutes: nil, open: open)
    }
}
