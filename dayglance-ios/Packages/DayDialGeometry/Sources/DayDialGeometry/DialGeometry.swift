import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Angle mapping and arc construction.
//
// Port of dialAngle / dialPoint / dialArcPath / dialSectorPath in
// src/utils/dayDial.js. One revolution is one day: midnight at the top,
// clockwise, y grows downward (SVG and UIKit alike). The JS emits SVG path
// strings; the widget draws with Path, so these return the points and flags
// and offer the path string only for parity and debugging. The vector test
// compares `numbers`, the same token order the JS strings carry.
//
// Arithmetic is kept in the JS's exact order — (min / 1440) * 2 * π, then
// sin/cos — so the two agree to the last bit on the angle and to the trig
// library's last ulp on the coordinates.
// ─────────────────────────────────────────────────────────────────────────────

public enum DialGeometry {
    /// Minutes in one revolution. DIAL_DAY_MINUTES in dayDial.js.
    public static let dayMinutes: Double = 1440

    /// Minutes past midnight → radians, clockwise from the top.
    public static func angle(minutes: Double) -> Double {
        (minutes / dayMinutes) * 2 * Double.pi
    }

    /// Point at radius `r` for a minute-of-day around (cx, cy).
    public static func point(cx: Double, cy: Double, r: Double, minutes: Double) -> DialPoint {
        let a = angle(minutes: minutes)
        return DialPoint(x: cx + r * sin(a), y: cy - r * cos(a))
    }

    /// Whether a span is more than half a revolution — the SVG large-arc flag.
    /// Strictly greater, as the JS: exactly 720 minutes is a half circle and
    /// takes the short flag, 721 the long one.
    public static func isLargeArc(startMin: Double, endMin: Double) -> Bool {
        endMin - startMin > dayMinutes / 2
    }

    /// Stroke-only arc from startMin to endMin, clockwise. Callers keep spans
    /// under a full revolution; a full circle is a circle, not an arc.
    public static func arc(cx: Double, cy: Double, r: Double, startMin: Double, endMin: Double) -> DialArc {
        DialArc(
            start: point(cx: cx, cy: cy, r: r, minutes: startMin),
            end: point(cx: cx, cy: cy, r: r, minutes: endMin),
            radius: r,
            largeArc: isLargeArc(startMin: startMin, endMin: endMin)
        )
    }

    /// Closed annular sector between rInner and rOuter: outer arc clockwise,
    /// inner arc back counter-clockwise.
    public static func sector(cx: Double, cy: Double, rInner: Double, rOuter: Double, startMin: Double, endMin: Double) -> DialSector {
        DialSector(
            outerStart: point(cx: cx, cy: cy, r: rOuter, minutes: startMin),
            outerEnd: point(cx: cx, cy: cy, r: rOuter, minutes: endMin),
            innerEnd: point(cx: cx, cy: cy, r: rInner, minutes: endMin),
            innerStart: point(cx: cx, cy: cy, r: rInner, minutes: startMin),
            rInner: rInner,
            rOuter: rOuter,
            largeArc: isLargeArc(startMin: startMin, endMin: endMin)
        )
    }
}

public struct DialPoint: Equatable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public struct DialArc: Equatable {
    public var start: DialPoint
    public var end: DialPoint
    public var radius: Double
    public var largeArc: Bool

    /// Every numeric token of the JS path, in order:
    /// M x y A r r 0 largeArc 1 x y.
    public var numbers: [Double] {
        [start.x, start.y, radius, radius, 0, largeArc ? 1 : 0, 1, end.x, end.y]
    }

    /// The JS string, for parity and debugging (coordinates rounded to 3 dp
    /// as dayDial.js's `fmt` does; the radius is printed as given).
    public var svgPathData: String {
        "M \(JSNumber.fixed3(start.x)) \(JSNumber.fixed3(start.y)) A \(JSNumber.plain(radius)) \(JSNumber.plain(radius)) 0 \(largeArc ? 1 : 0) 1 \(JSNumber.fixed3(end.x)) \(JSNumber.fixed3(end.y))"
    }
}

public struct DialSector: Equatable {
    public var outerStart: DialPoint
    public var outerEnd: DialPoint
    public var innerEnd: DialPoint
    public var innerStart: DialPoint
    public var rInner: Double
    public var rOuter: Double
    public var largeArc: Bool

    /// Every numeric token of the JS path, in order:
    /// M o1 A rO rO 0 large 1 o2 L i1 A rI rI 0 large 0 i2 (Z carries none).
    public var numbers: [Double] {
        let l: Double = largeArc ? 1 : 0
        return [outerStart.x, outerStart.y, rOuter, rOuter, 0, l, 1, outerEnd.x, outerEnd.y,
                innerEnd.x, innerEnd.y, rInner, rInner, 0, l, 0, innerStart.x, innerStart.y]
    }

    public var svgPathData: String {
        let l = largeArc ? 1 : 0
        return [
            "M \(JSNumber.fixed3(outerStart.x)) \(JSNumber.fixed3(outerStart.y))",
            "A \(JSNumber.plain(rOuter)) \(JSNumber.plain(rOuter)) 0 \(l) 1 \(JSNumber.fixed3(outerEnd.x)) \(JSNumber.fixed3(outerEnd.y))",
            "L \(JSNumber.fixed3(innerEnd.x)) \(JSNumber.fixed3(innerEnd.y))",
            "A \(JSNumber.plain(rInner)) \(JSNumber.plain(rInner)) 0 \(l) 0 \(JSNumber.fixed3(innerStart.x)) \(JSNumber.fixed3(innerStart.y))",
            "Z",
        ].joined(separator: " ")
    }
}

/// How JavaScript prints the numbers dayDial.js puts in strings, so the
/// parity strings above read the same as the vectors' `d`. Only used for
/// strings; every comparison in the tests is numeric.
enum JSNumber {
    /// `Number(n.toFixed(3))` then template-string interpolation: three
    /// decimals, trailing zeros dropped, integers bare, and -0 printed as 0.
    static func fixed3(_ v: Double) -> String {
        plain(round3(v))
    }

    /// Round to three decimals the way `Math.round(x * 1e3) / 1e3` and
    /// `toFixed(3)` both do for the non-negative, non-tie inputs the dial
    /// produces: nearest, ties away from zero.
    static func round3(_ v: Double) -> Double {
        (v * 1000).rounded(.toNearestOrAwayFromZero) / 1000
    }

    /// A JS number in a template string: no exponent for these magnitudes,
    /// no trailing zeros, no trailing point, and never "-0".
    static func plain(_ v: Double) -> String {
        if v == 0 { return "0" }
        if v == v.rounded(), abs(v) < 1e15 { return String(Int64(v)) }
        var s = String(format: "%.3f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }
}
