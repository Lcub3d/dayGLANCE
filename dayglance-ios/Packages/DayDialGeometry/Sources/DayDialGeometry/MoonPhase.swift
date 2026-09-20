import Foundation

/// The lit portion of a moon disc as arc geometry (moonPhasePath in
/// dayDial.js): the limb on one side, the terminator — a semi-ellipse whose
/// x-radius collapses to nothing at the quarters — on the other. Past half,
/// the terminator bulges away from the lit limb, which is a change of arc
/// direction, not of radius. The spec's moon glyph ("an outlined circle with
/// the lit fraction filled", handoff §4) is this shape at r = 3.6.
public struct MoonPhaseGeometry: Equatable {
    public var radius: Double
    /// The terminator ellipse's x-radius, rounded to three decimals as the JS
    /// does — "the whole shape in one number".
    public var terminatorRx: Double
    /// SVG sweep flags of the limb arc and the terminator arc.
    public var limbSweep: Int
    public var terminatorSweep: Int

    /// The JS path string: M 0 -r A r r 0 0 s 0 r A rx r 0 0 t 0 -r Z.
    public var svgPathData: String {
        "M 0 \(JSNumber.plain(-radius)) A \(JSNumber.plain(radius)) \(JSNumber.plain(radius)) 0 0 \(limbSweep) 0 \(JSNumber.plain(radius))"
            + " A \(JSNumber.plain(terminatorRx)) \(JSNumber.plain(radius)) 0 0 \(terminatorSweep) 0 \(JSNumber.plain(-radius)) Z"
    }
}

public enum MoonPhase {
    /// - Parameters:
    ///   - r: disc radius.
    ///   - fraction: lit portion, 0 (new) to 1 (full); clamped.
    ///   - waxing: lit on the right (northern hemisphere) when true.
    ///   - mirror: flip the lit side, for southern-hemisphere observers.
    public static func geometry(r: Double, fraction: Double, waxing: Bool, mirror: Bool = false) -> MoonPhaseGeometry {
        let k = Swift.max(0, Swift.min(1, fraction))
        let rx = (r * abs(1 - 2 * k) * 1e3).rounded(.toNearestOrAwayFromZero) / 1e3
        let sweep = k < 0.5 ? 0 : 1
        let litRight = (waxing == !mirror)
        return MoonPhaseGeometry(
            radius: r,
            terminatorRx: rx,
            limbSweep: litRight ? 1 : 0,
            terminatorSweep: litRight ? sweep : 1 - sweep
        )
    }
}
