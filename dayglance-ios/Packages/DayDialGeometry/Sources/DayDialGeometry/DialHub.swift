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

public struct DialHubState: Equatable {
    /// nil when nothing is running: the title, tag, countdown and runway
    /// rows stay empty (Phase 5 defines the copy for that).
    public var current: DialHubCurrent?
    /// Minutes between the current block's end and the next block's start,
    /// only when that gap is at least `DialSpec.Hub.runwayMinimumMinutes`;
    /// nil otherwise, and nil when nothing follows today.
    public var runwayMinutes: Double?
    public init(current: DialHubCurrent?, runwayMinutes: Double?) {
        self.current = current
        self.runwayMinutes = runwayMinutes
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

    /// The gap from `endMin` to the first narrated block that starts at or
    /// after it (the spec's `after = blocks.filter(b => b.s >= CUR_END)`), or
    /// nil when nothing follows today.
    public static func gapAfter(endMin: Double, in blocks: [DialFaceBlock]) -> Double? {
        let next = blocks.filter { isNarrated($0) && $0.startMin >= endMin }.min { $0.startMin < $1.startMin }
        return next.map { $0.startMin - endMin }
    }

    public static func resolve(blocks: [DialFaceBlock], nowMin: Double) -> DialHubState {
        guard let b = currentBlock(in: blocks, nowMin: nowMin) else {
            return DialHubState(current: nil, runwayMinutes: nil)
        }
        let end = b.trueEndMin
        let current = DialHubCurrent(id: b.id, title: b.title ?? "", tag: b.tag.flatMap { $0.isEmpty ? nil : $0 },
                                     startMin: b.startMin, endMin: end, minutesLeft: end - nowMin)
        // A block that runs into tomorrow has no runway on this day's dial.
        var runway: Double? = nil
        if !b.endsNextDay, let gap = gapAfter(endMin: end, in: blocks), gap >= DialSpec.Hub.runwayMinimumMinutes {
            runway = gap
        }
        return DialHubState(current: current, runwayMinutes: runway)
    }
}
