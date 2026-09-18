import SwiftUI
import Foundation

// Day Dial render-budget spike — the scene: a fixed day's worth of dial
// elements at the REAL dial's element counts, drawn roughly. The geometry is
// DayDial.jsx's (1000-unit viewBox, centre 500,500, radii from that file),
// not the widget spec's — this file exists to load the renderer the way the
// full dial would, not to look like the shipping widget. See
// DialSpikeWidget.swift for the counts this reproduces and why.

struct DialSpikeElement: Identifiable {
    enum Geometry {
        /// Filled annular wedge between two radii over a span of minutes.
        case sector(rInner: Double, rOuter: Double, startMin: Double, endMin: Double)
        /// Stroked arc at one radius (rendered as a filled stroked path).
        case arc(r: Double, startMin: Double, endMin: Double, width: Double)
        /// Radial line at one minute — a tick or the needle.
        case radial(rInner: Double, rOuter: Double, minute: Double, width: Double)
        /// Disc of radius r centred on the ring at (atR, minute).
        case disc(r: Double, atR: Double, minute: Double)
        /// Full circle stroke.
        case ring(r: Double, width: Double)
        /// Text placed on the ring; drawn with Text, not Path.
        case label(text: String, atR: Double, minute: Double, size: Double)
    }
    let id: Int
    let geometry: Geometry
    let color: Color
    let opacity: Double
}

/// Maps a 1000-unit dial coordinate system onto whatever rect the view has.
/// Midnight at the top, clockwise; SwiftUI's y grows downward, so a rising
/// angle IS clockwise on screen and `clockwise:` is passed inverted.
struct DialSpikeShape: Shape {
    let geometry: DialSpikeElement.Geometry

    func path(in rect: CGRect) -> Path {
        // Everything here is Double on purpose. Mixing a CGFloat scale into
        // `r * s * cos(a)` makes `cos` ambiguous between the CoreGraphics
        // (CGFloat) and Darwin (Double) overloads, which is a compile error.
        let s = Double(min(rect.width, rect.height)) / 1000
        let cx = Double(rect.midX)
        let cy = Double(rect.midY)
        let c = CGPoint(x: cx, y: cy)
        func angle(_ minute: Double) -> Angle { .degrees(minute / 1440 * 360 - 90) }
        func point(_ r: Double, _ minute: Double) -> CGPoint {
            let a: Double = angle(minute).radians
            return CGPoint(x: cx + r * s * Foundation.cos(a), y: cy + r * s * Foundation.sin(a))
        }
        func square(_ center: CGPoint, _ r: Double) -> CGRect {
            CGRect(x: Double(center.x) - r * s, y: Double(center.y) - r * s, width: 2 * r * s, height: 2 * r * s)
        }

        var p = Path()
        switch geometry {
        case let .sector(rInner, rOuter, startMin, endMin):
            p.addArc(center: c, radius: rOuter * s, startAngle: angle(startMin), endAngle: angle(endMin), clockwise: false)
            p.addArc(center: c, radius: rInner * s, startAngle: angle(endMin), endAngle: angle(startMin), clockwise: true)
            p.closeSubpath()
        case let .arc(r, startMin, endMin, width):
            var a = Path()
            a.addArc(center: c, radius: r * s, startAngle: angle(startMin), endAngle: angle(endMin), clockwise: false)
            p = a.strokedPath(StrokeStyle(lineWidth: max(0.5, width * s), lineCap: .round))
        case let .radial(rInner, rOuter, minute, width):
            var l = Path()
            l.move(to: point(rInner, minute))
            l.addLine(to: point(rOuter, minute))
            p = l.strokedPath(StrokeStyle(lineWidth: max(0.5, width * s), lineCap: .round))
        case let .disc(r, atR, minute):
            p.addEllipse(in: square(point(atR, minute), r))
        case let .ring(r, width):
            var ring = Path()
            ring.addEllipse(in: square(c, r))
            p = ring.strokedPath(StrokeStyle(lineWidth: max(0.5, width * s)))
        case .label:
            break
        }
        return p
    }
}

/// Draws a list of elements as individual SwiftUI views — one Shape or Text
/// per element, deliberately unbatched. That is the worst case a naive port
/// produces, and the worst case is what the spike must survive; batching
/// same-style elements into one Path is the first lever if it does not.
struct DialSpikeFace: View {
    let elements: [DialSpikeElement]

    var body: some View {
        GeometryReader { geo in
            // Double throughout, for the same overload reason as DialSpikeShape.
            let s = Double(min(geo.size.width, geo.size.height)) / 1000
            let cx = Double(geo.size.width) / 2
            let cy = Double(geo.size.height) / 2
            ZStack {
                ForEach(elements) { el in
                    if case let .label(text, atR, minute, size) = el.geometry {
                        let a: Double = (minute / 1440 * 360 - 90) * Double.pi / 180
                        Text(text)
                            .font(.system(size: size * s, weight: .medium, design: .rounded))
                            .foregroundStyle(el.color.opacity(el.opacity))
                            .position(x: cx + atR * s * Foundation.cos(a), y: cy + atR * s * Foundation.sin(a))
                    } else {
                        DialSpikeShape(geometry: el.geometry)
                            .fill(el.color.opacity(el.opacity))
                    }
                }
            }
        }
    }
}

/// The 18 elements that move with the needle, built ONCE at minute 0 and
/// rotated into place — the technique the handoff proposes, being tested.
/// (The real dial clamps the trail at midnight for the first hour; the spike
/// does not bother, the load is what matters.)
struct DialSpikeNeedle: View {
    let nowMin: Double

    var body: some View {
        DialSpikeFace(elements: DialSpikeFixture.movingElements())
            .rotationEffect(.degrees(nowMin / 1440 * 360))
    }
}

// MARK: - Fixture

enum DialSpikeFixture {
    // DayDial.jsx's radii.
    static let rInner = 300.0, rEdge = 385.0, rBezel = 424.0
    static let daylightBand = (282.0, 302.0)
    static let focusRail = (307.0, 315.0)
    static let routineBand = (404.0, 432.0)
    static let precipR = 292.0
    static let tempLabelR = 250.0
    static let background = Color(red: 0.043, green: 0.043, blue: 0.055) // #0b0b0e, the spec's ground

    /// A synthetic day sized to the element counts measured in
    /// docs/day-dial-widget-feasibility.md §4 (an equinox in Chicago).
    /// The values are not astronomy — a ramp stands in for the sun curve — the
    /// COUNTS are what load the renderer.
    static let sunriseMin = 360.0, sunsetMin = 1112.0   // 752 min ÷ 4 = 188 daylight steps
    static let moonStartMin = 1200.0, moonEndMin = 1280.0 // 80 min ÷ 4 = 20 moon steps
    static let stepMin = 4.0
    static let feather: [(Double, Double, Double)] = [(0, 0.25, 0.35), (0.25, 0.75, 1), (0.75, 1, 0.35)]

    /// The widget spec's dense day, with the spec's category colours.
    static let blocks: [(start: Double, end: Double, hex: String, alpha: Double)] = [
        (0, 385, "#6f6f9e", 0.34), (385, 420, "#4ec9b0", 0.85), (435, 480, "#a08a5b", 0.70),
        (480, 540, "#5f6b8f", 0.72), (540, 600, "#5f6b8f", 0.72), (600, 750, "#5b7fa8", 0.80),
        (750, 810, "#4ec9b0", 0.70), (810, 870, "#5f6b8f", 0.72), (870, 915, "#a08a5b", 0.70),
        (915, 1035, "#5b7fa8", 0.80), (1035, 1080, "#4ec9b0", 0.70), (1080, 1140, "#8a6ba8", 0.70),
        (1140, 1185, "#a08a5b", 0.70), (1185, 1290, "#8a6ba8", 0.70), (1290, 1330, "#4ec9b0", 0.85),
        (1350, 1440, "#6f6f9e", 0.34),
    ]
    static let routines: [(Double, Double)] = [(420, 435), (1260, 1275), (1290, 1320)]
    static let focusSpans: [(Double, Double)] = [(600, 660), (915, 975)]
    static let sleep: [(Double, Double)] = [(0, 385), (1350, 1440)]
    static let precipRuns: [(Double, Double)] = [(60, 120), (180, 220), (1000, 1040)]

    /// Anything that changes the static face must change this, because it
    /// names the cached image. Bumped to v2 so an install over the first
    /// device run renders the base image cold instead of hitting the PNG that
    /// run left in the App Group — the ImageRenderer cost is one of the
    /// numbers the spike exists to produce, and a disk hit hides it.
    static var hashSeed: String {
        "v2|\(blocks.count)|\(sunriseMin)-\(sunsetMin)|\(moonStartMin)-\(moonEndMin)|\(routines.count)|\(focusSpans.count)"
    }

    /// The face: everything that does not move with the needle.
    /// `nowMin` nil → no past-dimming (the cached base image); a value dims
    /// blocks that have ended to 42%, the way the live path must per entry.
    static func staticElements(nowMin: Double?) -> [DialSpikeElement] {
        var out: [DialSpikeElement] = []
        var id = 0
        func add(_ g: DialSpikeElement.Geometry, _ color: Color, _ opacity: Double) {
            out.append(DialSpikeElement(id: id, geometry: g, color: color, opacity: opacity)); id += 1
        }
        let white = Color.white

        // 2 — chapter ring + block track
        add(.ring(r: rBezel, width: 1), white, 0.08)
        add(.ring(r: (rInner + rEdge) / 2, width: rEdge - rInner), white, 0.045)

        // 288 — ticks: 24 hour, 72 quarter, 192 minor (dialTicks())
        var m = 0.0
        while m < 1440 {
            let mi = Int(m)
            if mi % 60 == 0 { add(.radial(rInner: 400, rOuter: 436, minute: m, width: 2.5), white, 0.45) }
            else if mi % 15 == 0 { add(.radial(rInner: 404, rOuter: 428, minute: m, width: 1.6), white, 0.22) }
            else { add(.radial(rInner: 407, rOuter: 421, minute: m, width: 1.0), white, 0.10) }
            m += 5
        }

        // 564 — daylight: 188 four-minute steps × 3 feathered sub-bands
        let amber = Color(hex: "#fcd34d")
        var t = sunriseMin
        while t < sunsetMin {
            let stop = min(t + stepMin, sunsetMin)
            let frac = (t - sunriseMin) / (sunsetMin - sunriseMin)
            let lit = 1 - abs(frac * 2 - 1)           // a ramp, standing in for the sun curve
            let opacity = 0.05 + 0.15 * lit
            for (a, b, w) in feather {
                let span = daylightBand.1 - daylightBand.0
                add(.sector(rInner: daylightBand.0 + span * a, rOuter: daylightBand.0 + span * b,
                            startMin: t, endMin: stop), amber, opacity * w)
            }
            t = stop
        }

        // 60 — moon: 20 steps × 3
        let moonColor = Color(hex: "#c3c3e8")
        t = moonStartMin
        while t < moonEndMin {
            let stop = min(t + stepMin, moonEndMin)
            for (a, b, w) in feather {
                let span = daylightBand.1 - daylightBand.0
                add(.sector(rInner: daylightBand.0 + span * a, rOuter: daylightBand.0 + span * b,
                            startMin: t, endMin: stop), moonColor, 0.06 * w)
            }
            t = stop
        }
        // 2 — moon glyph (disc + terminator stand-in)
        add(.disc(r: 9, atR: 292, minute: 1240), moonColor, 0.35)
        add(.disc(r: 6, atR: 292, minute: 1240), background, 1)

        // 6 — precipitation arc segments (2 per run)
        for (a, b) in precipRuns {
            let mid = (a + b) / 2
            add(.arc(r: precipR, startMin: a + 4, endMin: mid - 7, width: 4), Color(hex: "#7dd3fc"), 0.5)
            add(.arc(r: precipR, startMin: mid + 7, endMin: b - 4, width: 4), Color(hex: "#7dd3fc"), 0.5)
        }

        // 2 — sleep segments (drawn under the wedges as dim violet)
        for (a, b) in sleep {
            add(.sector(rInner: rInner, rOuter: rEdge, startMin: a, endMin: b), Color(hex: "#a78bfa"), 0.06)
        }

        // 32 — wedges: fill + luminous edge, dimmed to 42% once past
        for blk in blocks {
            let past = nowMin.map { blk.end <= $0 } ?? false
            let dim = past ? 0.42 : 1.0
            let color = Color(hex: blk.hex)
            add(.sector(rInner: rInner, rOuter: rEdge, startMin: blk.start + 1.5, endMin: blk.end - 1.5), color, blk.alpha * 0.55 * dim)
            add(.arc(r: rEdge - 2, startMin: blk.start + 1.5, endMin: blk.end - 1.5, width: 4), color, min(1, blk.alpha + 0.2) * dim)
        }

        // 2 — focus rail
        for (a, b) in focusSpans {
            add(.sector(rInner: focusRail.0, rOuter: focusRail.1, startMin: a, endMin: b), white, 0.42)
        }

        // 3 — routine bars
        for (a, b) in routines {
            add(.arc(r: (routineBand.0 + routineBand.1) / 2, startMin: a, endMin: b, width: 14), Color(hex: "#5eead4"), 0.5)
        }

        // 8 — chapter labels every 3 hours
        for h in stride(from: 0, to: 24, by: 3) {
            add(.label(text: String(format: "%02d", h), atR: 462, minute: Double(h * 60), size: 28), white, h % 6 == 0 ? 0.55 : 0.3)
        }
        // 12 — temperature labels every 2 hours
        for h in stride(from: 1, to: 24, by: 2) {
            add(.label(text: "\(48 + (h * 3) % 20)°", atR: tempLabelR, minute: Double(h * 60), size: 22), white, 0.4)
        }

        return out
    }

    /// The needle group at minute 0: 15 afterglow sectors, the needle, its
    /// leading dot, and a wider low-opacity disc standing in for the glow.
    static func movingElements() -> [DialSpikeElement] {
        var out: [DialSpikeElement] = []
        let orange = Color(hex: "#f5a623")
        for i in 0..<15 {
            let back = 4.0 * Double(i + 1) // 60 minutes over 15 steps
            out.append(DialSpikeElement(id: 100_000 + i,
                geometry: .sector(rInner: rInner, rOuter: rEdge, startMin: 1440 - back, endMin: 1440),
                color: orange, opacity: 0.011))
        }
        out.append(DialSpikeElement(id: 100_015, geometry: .radial(rInner: 265, rOuter: rBezel - 14, minute: 0, width: 3), color: orange, opacity: 0.9))
        out.append(DialSpikeElement(id: 100_016, geometry: .disc(r: 22, atR: rEdge, minute: 0), color: orange, opacity: 0.10))
        out.append(DialSpikeElement(id: 100_017, geometry: .disc(r: 13, atR: rEdge, minute: 0), color: orange, opacity: 0.28))
        return out
    }

    /// Cached-image mode's stand-in for per-block dimming: one sector over
    /// the block band from midnight to now, in the ground colour at 58%, so
    /// whatever is under it reads at 42%.
    static func pastMask(nowMin: Double) -> DialSpikeElement {
        DialSpikeElement(id: 200_000,
            geometry: .sector(rInner: rInner - 1, rOuter: rEdge + 3, startMin: 0, endMin: max(0.5, nowMin)),
            color: background, opacity: 0.58)
    }
}
