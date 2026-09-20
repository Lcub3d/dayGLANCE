import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The widget's own geometry: the constants at the top of the script in
// docs/day-dial-widget-spec.html, verbatim, and the spec's rules that differ
// from the web dial's. Where dayDial.js and the spec disagree, the spec wins
// for the widget; the differences are named where they occur.
// ─────────────────────────────────────────────────────────────────────────────

public enum DialSpec {
    // Canvas 364×382pt; centre (182, 189). 24-hour, midnight at top, clockwise.
    public static let canvasWidth: Double = 364
    public static let canvasHeight: Double = 382
    public static let cx: Double = 182
    public static let cy: Double = 189

    // Rings, radius to the stroke's centre and stroke width.
    public static let skyRadius: Double = 119
    public static let skyWidth: Double = 6
    public static let blockRadius: Double = 140
    public static let blockWidth: Double = 22
    public static var blockInnerRadius: Double { blockRadius - blockWidth / 2 }
    public static var blockOuterRadius: Double { blockRadius + blockWidth / 2 }

    // Ticks: 24 major from 155 to 166 at 1.5pt, 3 minor per hour from 161 at 1pt.
    public static let tickInnerRadius: Double = 155
    public static let tickOuterRadius: Double = 166
    public static let tickMinorRadius: Double = 161
    public static let tickMajorWidth: Double = 1.5
    public static let tickMinorWidth: Double = 1.0

    // Hour labels: cardinals at 172, diagonals pushed out 9pt to clear the
    // ticks (the collision is with the label box's corner, not its centre).
    public static let labelCardinalRadius: Double = 172
    public static let labelDiagonalRadius: Double = 181

    // Glyphs sit upright at 104; the needle runs 126–159 with a 3.4pt dot.
    public static let glyphRadius: Double = 104
    public static let needleInnerRadius: Double = 126
    public static let needleOuterRadius: Double = 159
    public static let needleWidth: Double = 2.6
    public static let needleDotRadius: Double = 3.4

    // Where two blocks touch, a radial cut in the background colour across
    // the band — blocks keep their exact spans (handoff §3). The web dial pads
    // each arc instead (DialSegments.pad); the spec rejected that.
    public static let separatorLineWidth: Double = 1.6

    // Hub rule, collinear with the 06/18 tick row.
    public static var hubRuleY: Double { cy }

    /// The spec's tick schedule: major on the hour, minor at 15 minutes, 96 in
    /// all. The web dial's 5-minute schedule (`DialTicks.schedule()`) is what
    /// the vectors pin; the widget draws this one.
    public static var ticks: [DialTick] { DialTicks.schedule(stepMinutes: 15) }

    /// The spec's six hour labels. No `06` / `18`: at r = 172 a label at the
    /// horizontal positions overflows the 364pt width by ~14pt, and that space
    /// carries the sun glyphs. The web dial shows eight labels every three
    /// hours and hides one within 30 minutes of a sun glyph
    /// (dialLabelYieldsToSun); the widget's glyphs sit at 104, inside the
    /// block band, so there is nothing to yield to and no such rule here.
    public struct HourLabel: Equatable {
        public var minutes: Int
        public var text: String
        public var radius: Double
        public var isCardinal: Bool
    }
    public static let hourLabels: [HourLabel] = [
        HourLabel(minutes: 0, text: "00", radius: labelCardinalRadius, isCardinal: true),
        HourLabel(minutes: 180, text: "03", radius: labelDiagonalRadius, isCardinal: false),
        HourLabel(minutes: 540, text: "09", radius: labelDiagonalRadius, isCardinal: false),
        HourLabel(minutes: 720, text: "12", radius: labelCardinalRadius, isCardinal: true),
        HourLabel(minutes: 900, text: "15", radius: labelDiagonalRadius, isCardinal: false),
        HourLabel(minutes: 1260, text: "21", radius: labelDiagonalRadius, isCardinal: false),
    ]

    /// Where a label's centre goes.
    public static func labelPoint(_ label: HourLabel) -> DialPoint {
        DialGeometry.point(cx: cx, cy: cy, r: label.radius, minutes: Double(label.minutes))
    }

    /// Where a glyph (sunrise, sunset, moon) is centred for a minute of day.
    /// Glyphs are drawn upright and translated here, never rotated.
    public static func glyphPoint(minutes: Double) -> DialPoint {
        DialGeometry.point(cx: cx, cy: cy, r: glyphRadius, minutes: minutes)
    }

    /// The needle for a minute of day: inner end, outer end (the dot sits on it).
    public static func needle(minutes: Double) -> (inner: DialPoint, outer: DialPoint) {
        (DialGeometry.point(cx: cx, cy: cy, r: needleInnerRadius, minutes: minutes),
         DialGeometry.point(cx: cx, cy: cy, r: needleOuterRadius, minutes: minutes))
    }

    /// A tick's two ends.
    public static func tickLine(_ tick: DialTick) -> (inner: DialPoint, outer: DialPoint) {
        let rIn = tick.kind == .hour ? tickInnerRadius : tickMinorRadius
        return (DialGeometry.point(cx: cx, cy: cy, r: rIn, minutes: Double(tick.minutes)),
                DialGeometry.point(cx: cx, cy: cy, r: tickOuterRadius, minutes: Double(tick.minutes)))
    }

    /// The separator cut at a boundary minute, across the block band.
    public static func separatorLine(minutes: Double) -> (inner: DialPoint, outer: DialPoint) {
        (DialGeometry.point(cx: cx, cy: cy, r: blockInnerRadius, minutes: minutes),
         DialGeometry.point(cx: cx, cy: cy, r: blockOuterRadius, minutes: minutes))
    }

    /// Boundaries between touching blocks (a.end == b.start) in a start-sorted
    /// list: where the separator cuts go. Exact equality, as the spec's
    /// `nxt.s !== b.e` — a one-minute gap is a gap, not a boundary.
    public static func separatorMinutes(blocks: [DialRingBlock]) -> [Double] {
        var out: [Double] = []
        for (i, b) in blocks.enumerated().dropLast() where blocks[i + 1].startMin == b.endMin {
            out.append(b.endMin)
        }
        return out
    }

    // MARK: Sky ring

    /// One hour's segment of the sky ring. Colour and opacity are driven by
    /// strength, width is constant (handoff §4). Per hour, the strength is
    /// the value the snapshot sampled at hh:30; whichever of sun/moon is
    /// greater picks the body, sun on a tie.
    public struct SkySegment: Equatable {
        public enum Body { case sun, moon }
        public var hour: Int
        public var startMin: Double
        public var endMin: Double
        public var body: Body
        public var strength: Double
        public var opacity: Double
    }

    public static let skySunColorHex = "#d9b33c"
    public static let skyMoonColorHex = "#c3c3e8"

    /// `0.10 + strength × 0.66` for the sun, `0.09 + strength × 0.52` for the moon.
    public static func skyOpacity(body: SkySegment.Body, strength: Double) -> Double {
        switch body {
        case .sun: return 0.10 + strength * 0.66
        case .moon: return 0.09 + strength * 0.52
        }
    }

    /// The 24 segments from the snapshot's `sky.hours` (index = hour, values
    /// sampled at hh:30 by computeSkySnapshot on the JS side — consumed, never
    /// re-solved; docs/day-dial-widget-handoff.md §4). Fewer than 24 entries
    /// yields that many segments; a missing strength counts as 0.
    public static func skySegments(hours: [(sun: Double?, moon: Double?)]) -> [SkySegment] {
        hours.prefix(24).enumerated().map { h, v in
            let sun = v.sun ?? 0
            let moon = v.moon ?? 0
            let body: SkySegment.Body = sun >= moon ? .sun : .moon
            let strength = body == .sun ? sun : moon
            return SkySegment(hour: h, startMin: Double(h * 60), endMin: Double(h * 60 + 60),
                              body: body, strength: strength, opacity: skyOpacity(body: body, strength: strength))
        }
    }

    /// The arc one sky segment is stroked along (radius 119, butt caps).
    public static func skyArc(_ segment: SkySegment) -> DialArc {
        DialGeometry.arc(cx: cx, cy: cy, r: skyRadius, startMin: segment.startMin, endMin: segment.endMin)
    }

    /// The arc one block is stroked along at the band's centre radius.
    public static func blockArc(_ block: DialRingBlock) -> DialArc {
        DialGeometry.arc(cx: cx, cy: cy, r: blockRadius, startMin: block.startMin, endMin: block.endMin)
    }
}
