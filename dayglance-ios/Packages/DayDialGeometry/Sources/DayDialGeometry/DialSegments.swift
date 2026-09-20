import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Segment padding and lane geometry. Ports of padDialSegment, DIAL_LANE_GAP,
// dialLaneBand and (via IntervalLanes) assignDialLanes.
// ─────────────────────────────────────────────────────────────────────────────

public enum DialSegments {
    /// Shrink a segment so adjacent blocks separate on the ring. The gap
    /// yields for short blocks (never more than a sixth of one per side) so
    /// slivers stay visible; a flagged side stays flush, which is how the
    /// declared night meets itself at midnight without a seam.
    ///
    /// The widget spec draws blocks at exact spans and cuts a 1.6pt separator
    /// instead (handoff §3); this stays ported because the vectors pin it and
    /// the web dial uses it. DialSpec.separatorLineWidth is the spec's answer.
    public static func pad(startMin: Double, endMin: Double, gapMin: Double = 3, padStart: Bool = true, padEnd: Bool = true) -> (start: Double, end: Double) {
        let pad = Swift.min(gapMin, (endMin - startMin) / 6)
        return (startMin + (padStart ? pad : 0), endMin - (padEnd ? pad : 0))
    }

    /// Radial breathing room between lanes, in the dial's own units.
    public static let laneGap: Double = 6

    /// The radial band one lane occupies inside a ring. A single lane takes
    /// the whole band. Rounded to three decimals exactly as the JS does
    /// (`fmt`), so the vectors match to the bit rather than to a tolerance.
    public static func laneBand(rInner: Double, rOuter: Double, lane: Int = 0, laneCount: Int = 1) -> (rInner: Double, rOuter: Double) {
        guard laneCount > 1 else { return (rInner, rOuter) }
        let span = rOuter - rInner
        let gap = Swift.min(laneGap, span / (Double(laneCount) * 5))
        let depth = (span - gap * Double(laneCount - 1)) / Double(laneCount)
        let base = rInner + Double(lane) * (depth + gap)
        return (JSNumber.round3(base), JSNumber.round3(base + depth))
    }
}

/// A half-open span [startMin, endMin) on the ring, for lane packing.
public struct LaneSpan: Equatable {
    public var startMin: Double
    public var endMin: Double
    public init(startMin: Double, endMin: Double) { self.startMin = startMin; self.endMin = endMin }
}

public struct LaneAssignment: Equatable {
    public var lane: Int
    public var laneCount: Int
    public init(lane: Int, laneCount: Int) { self.lane = lane; self.laneCount = laneCount }
}

/// Port of src/utils/intervalLanes.js — the one place dayGLANCE decides how
/// overlapping blocks stack. A single sweep over start-sorted input: spans
/// that chain together form one overlap cluster, each member takes the first
/// lane that has freed up, and the lane count is scoped to the cluster so a
/// pile-up at noon does not thin a lone block at four. Back-to-back spans
/// touch but do not overlap. A span with no positive length (or a NaN bound)
/// is a moment: lane 0 of 1, emitted in place, never joining a cluster.
public enum IntervalLanes {
    public static func assign(_ spans: [LaneSpan]) -> [LaneAssignment] {
        var out = Array(repeating: LaneAssignment(lane: 0, laneCount: 1), count: spans.count)
        var cluster: [(index: Int, lane: Int, solo: Bool)] = []
        var clusterEnd = -Double.infinity
        var laneEnds: [Double] = []

        func flush() {
            for member in cluster where !member.solo {
                out[member.index] = LaneAssignment(lane: member.lane, laneCount: laneEnds.count)
            }
            cluster.removeAll()
            laneEnds.removeAll()
        }

        for (i, b) in spans.enumerated() {
            guard b.endMin > b.startMin else {           // also false for NaN
                cluster.append((index: i, lane: 0, solo: true))
                continue
            }
            if b.startMin >= clusterEnd {
                flush()
                clusterEnd = b.endMin
            } else {
                clusterEnd = Swift.max(clusterEnd, b.endMin)
            }
            var lane = laneEnds.firstIndex(where: { $0 <= b.startMin }) ?? -1
            if lane == -1 {
                lane = laneEnds.count
                laneEnds.append(b.endMin)
            } else {
                laneEnds[lane] = b.endMin
            }
            cluster.append((index: i, lane: lane, solo: false))
        }
        flush()
        return out
    }
}
