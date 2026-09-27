import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Frames on the dial (docs/day-dial-frames-spec.html): each of the day's
// frames drawn as an ENCLOSURE around the span of the block band it covers,
// an outline just outside each edge of the band joined by radial end caps.
// The port of dayDial.js's frame section (dialFrameRadii, dialCurrentFrame,
// dialFrameAvailableMinutes, muteDialFrameColor), held to the same vectors.
//
// What is NOT here, on purpose: nesting depth and the Frames percentage.
// The app decides both (computeDialFrames) and ships them in the snapshot's
// `dial.frames[].depth` and `dial.totals.framesPercent`, so no platform
// re-derives them.
// ─────────────────────────────────────────────────────────────────────────────

/// One frame as the snapshot's `dial.frames[]` carries it.
public struct DialFrame: Equatable {
    public var name: String
    public var colorHex: String?
    public var startMin: Double
    public var endMin: Double
    /// 0 for a top-level frame; already capped at `DialFrames.maxDepth`.
    public var depth: Int
    /// Free time inside the frame, NOT floored at now: each entry takes
    /// "still available" at its own minute.
    public var slots: [DialFrameSlot]

    public init(name: String, colorHex: String?, startMin: Double, endMin: Double, depth: Int = 0,
                slots: [DialFrameSlot] = []) {
        self.name = name
        self.colorHex = colorHex
        self.startMin = startMin
        self.endMin = endMin
        self.depth = depth
        self.slots = slots
    }
}

public struct DialFrameSlot: Equatable {
    public var startMin: Double
    public var endMin: Double
    public init(startMin: Double, endMin: Double) {
        self.startMin = startMin
        self.endMin = endMin
    }
}

/// The outline's two radii and its stroke width.
public struct DialFrameRadii: Equatable {
    public var inner: Double
    public var outer: Double
    public var width: Double
    public init(inner: Double, outer: Double, width: Double) {
        self.inner = inner
        self.outer = outer
        self.width = width
    }
}

public enum DialFrames {
    // Fractions of the block band's width, from the widget spec's 22pt band:
    // 3pt inside its inner edge, 2pt outside its outer edge, 3.2pt in per
    // nesting level, a 1.8pt stroke (the spec's 1.2pt read too faint on
    // device).
    public static let innerGap = 3.0 / 22
    public static let outerGap = 2.0 / 22
    public static let step = 3.2 / 22
    public static let stroke = 1.8 / 22
    public static let opacity = 0.45
    /// One level of nesting is drawn; a second step would put the outline
    /// through the wedges. Deeper frames draw at this level.
    public static let maxDepth = 1
    /// Shorter frames are not drawn as an enclosure (the hub still sees them).
    public static let minMinutes: Double = 10
    // The softened mute (DIAL_FRAME_MUTE).
    public static let saturationCap = 0.28
    public static let lightness = 0.62

    /// dialFrameRadii.
    public static func radii(bandInner: Double, bandOuter: Double, depth: Int) -> DialFrameRadii {
        let w = bandOuter - bandInner
        let d = Double(Swift.max(0, Swift.min(maxDepth, depth)))
        return DialFrameRadii(inner: bandInner - innerGap * w + d * step * w,
                              outer: bandOuter + outerGap * w - d * step * w,
                              width: stroke * w)
    }

    /// The widget's own band (DialSpec).
    public static func radii(depth: Int) -> DialFrameRadii {
        radii(bandInner: DialSpec.blockInnerRadius, bandOuter: DialSpec.blockOuterRadius, depth: depth)
    }

    /// Whether a frame is long enough to draw as an enclosure.
    public static func drawn(_ frame: DialFrame) -> Bool {
        frame.endMin - frame.startMin >= minMinutes
    }

    /// dialCurrentFrame: the innermost frame `nowMin` is inside (deepest,
    /// then the latest start), or nil.
    public static func current(_ frames: [DialFrame], nowMin: Double) -> DialFrame? {
        var pick: DialFrame?
        for f in frames where f.startMin <= nowMin && nowMin < f.endMin {
            if let p = pick, !(f.depth > p.depth || (f.depth == p.depth && f.startMin >= p.startMin)) { continue }
            pick = f
        }
        return pick
    }

    /// dialFrameAvailableMinutes: each slot from the later of its start and now.
    public static func availableMinutes(_ frame: DialFrame, nowMin: Double) -> Double {
        frame.slots.reduce(0) { $0 + Swift.max(0, $1.endMin - Swift.max($1.startMin, nowMin)) }
    }
}
