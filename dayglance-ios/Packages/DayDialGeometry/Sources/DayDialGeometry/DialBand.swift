import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The block band, variant C of docs/day-dial-palette-study.html: each block
// is an annular sector fill across the 22pt band plus a rim stroke on the
// band's OUTER edge, drawn inside it; the app's duration curve with the
// fills raised 3.5× and the rim given a minimum weight, so short blocks do
// not disappear at widget scale; the app's state multipliers on top.
// Separators (a background-colour cut where two blocks touch) are the
// spec's, DialSpec.separatorMinutes. The web dial's blurred glow does not
// survive (handoff §7): flat fills only.
//
// This file resolves a day's blocks into draw instructions — radii, span,
// colour, opacities, rim weight — so the view layer only turns them into
// paths. Everything here is pure and vector-tested.
// ─────────────────────────────────────────────────────────────────────────────

public enum DialBandTreatment {
    /// The study's fill lift over the web curve (0.05–0.16 → 0.18–0.56).
    public static let fillScale = 3.5
    /// Rim weight in points, 1.5 at a sliver to 2.5 at three hours.
    public static let rimWidthMin = 1.5
    public static let rimWidthMax = 2.5

    /// `min(1, (0.05 + 0.11t) × 3.5 × stateFill)`.
    public static func fillOpacity(t: Double, stateFill: Double) -> Double {
        Swift.min(1, (0.05 + 0.11 * t) * fillScale * stateFill)
    }

    /// `1.5 + 1.0t` points.
    public static func rimWidth(t: Double) -> Double {
        rimWidthMin + (rimWidthMax - rimWidthMin) * t
    }

    /// `min(1, (0.45 + 0.55t) × stateEdge)`.
    public static func rimOpacity(t: Double, stateEdge: Double) -> Double {
        Swift.min(1, (0.45 + 0.55 * t) * stateEdge)
    }
}

/// One block as the face needs it: the snapshot's `dial.blocks[]` entry
/// with its drawn span resolved to minutes.
public struct DialFaceBlock: Equatable {
    public var id: String
    public var kind: DialBlockKind
    /// The DRAWN span, clipped at midnight (`startMin`, `startMin + durationMin`).
    public var startMin: Double
    public var endMin: Double
    public var endsNextDay: Bool
    public var startedPrevDay: Bool
    public var completed: Bool
    /// Tasks and events only; routine and sleep take fixed colours.
    public var colorHex: String?
    public var lane: Int
    public var laneCount: Int
    /// The TRUE end when `endsNextDay`, minutes into the next day (the
    /// snapshot's `endMinTrue`). The hub counts down to it; the band does not
    /// draw it.
    public var endMinTrue: Double?
    /// Display title and first tag (without `#`), for the hub. Absent on
    /// sleep; the face never reads them, so they are not in the cache key.
    public var title: String?
    public var tag: String?

    public init(id: String, kind: DialBlockKind, startMin: Double, endMin: Double,
                endsNextDay: Bool = false, startedPrevDay: Bool = false, completed: Bool = false,
                colorHex: String? = nil, lane: Int = 0, laneCount: Int = 1,
                endMinTrue: Double? = nil, title: String? = nil, tag: String? = nil) {
        self.id = id
        self.kind = kind
        self.startMin = startMin
        self.endMin = endMin
        self.endsNextDay = endsNextDay
        self.startedPrevDay = startedPrevDay
        self.completed = completed
        self.colorHex = colorHex
        self.lane = lane
        self.laneCount = laneCount
        self.endMinTrue = endMinTrue
        self.title = title
        self.tag = tag
    }

    /// Minutes from midnight to the block's real end: past 1440 for a block
    /// that runs into tomorrow (DayDial.jsx `endsAt`).
    public var trueEndMin: Double {
        if endsNextDay, let endMinTrue { return DialGeometry.dayMinutes + endMinTrue }
        return endMin
    }
}

/// A block resolved to what gets drawn.
public struct DialBlockStyle: Equatable {
    public var id: String
    public var kind: DialBlockKind
    public var startMin: Double
    public var endMin: Double
    /// The lane's band; the fill is the annular sector between them.
    public var rInner: Double
    public var rOuter: Double
    /// The drawn colour: muted for tasks and events, fixed for routine and sleep.
    public var colorHex: String
    /// 0 for a routine (rim only).
    public var fillOpacity: Double
    /// The rim's centre radius: inside the band's outer edge by half its width.
    public var rimRadius: Double
    public var rimWidth: Double
    public var rimOpacity: Double
    public var isPast: Bool
    public var tone: DialTone
}

public enum DialBand {
    /// teal-300, the app's routine colour everywhere (ROUTINE_COLOR). Not muted.
    public static let routineColorHex = "#5eead4"
    /// violet-300, DIAL_COLORS.sleep. Not muted.
    public static let sleepColorHex = "#c4b5fd"

    /// Wholly behind the needle. A block that runs past midnight is never
    /// past on the day it started (DayDial.jsx `endsAt`), and a block ending
    /// exactly at the entry's minute is past (`endMin <= nowMin`).
    public static func isPast(_ block: DialFaceBlock, nowMin: Double) -> Bool {
        !block.endsNextDay && block.endMin <= nowMin
    }

    /// The colour a block is drawn in.
    public static func colorHex(for block: DialFaceBlock) -> String {
        switch block.kind {
        case .routine: return routineColorHex
        case .sleep: return sleepColorHex
        case .task, .event: return WidgetDialPalette.mute(hex: block.colorHex)
        }
    }

    /// One block → its draw instructions for an entry at `nowMin` on a day
    /// of the given tier.
    public static func style(_ block: DialFaceBlock, nowMin: Double, projectedDay: Bool) -> DialBlockStyle {
        let past = isPast(block, nowMin: nowMin)
        let tone = WidgetDialPalette.tone(DialToneInput(kind: block.kind, completed: block.completed, past: past,
                                                        startedPrevDay: block.startedPrevDay, projectedDay: projectedDay))
        let t = WidgetDialPalette.t(durationMinutes: block.endMin - block.startMin)
        let band = DialSegments.laneBand(rInner: DialSpec.blockInnerRadius, rOuter: DialSpec.blockOuterRadius,
                                         lane: block.lane, laneCount: block.laneCount)
        let rimWidth = DialBandTreatment.rimWidth(t: t)
        let fill: Double
        let rim: Double
        switch block.kind {
        case .routine:
            fill = 0
            rim = tone.edge
        case .task, .event, .sleep:
            fill = DialBandTreatment.fillOpacity(t: t, stateFill: tone.fill)
            rim = DialBandTreatment.rimOpacity(t: t, stateEdge: tone.edge)
        }
        return DialBlockStyle(id: block.id, kind: block.kind, startMin: block.startMin, endMin: block.endMin,
                              rInner: band.rInner, rOuter: band.rOuter, colorHex: colorHex(for: block),
                              fillOpacity: fill, rimRadius: band.rOuter - rimWidth / 2, rimWidth: rimWidth,
                              rimOpacity: rim, isPast: past, tone: tone)
    }

    /// Every block, in input order (the snapshot is start-sorted, and the
    /// separators are read off consecutive pairs).
    public static func styles(_ blocks: [DialFaceBlock], nowMin: Double, projectedDay: Bool) -> [DialBlockStyle] {
        blocks.map { style($0, nowMin: nowMin, projectedDay: projectedDay) }
    }

    /// The cache bucket for the static face. Past/future is a function of
    /// the time, not only of the snapshot: a block changes state when it
    /// ends. The set of ended blocks is `{ b : endMin <= nowMin }`, a prefix
    /// of the blocks in end order, so its size names it; two entries with
    /// the same bucket draw the same face for the same snapshot. Steps by
    /// one at each distinct end minute — 8–12 re-renders on a full day.
    public static func pastBucket(_ blocks: [DialFaceBlock], nowMin: Double) -> Int {
        blocks.reduce(0) { $0 + (isPast($1, nowMin: nowMin) ? 1 : 0) }
    }
}
