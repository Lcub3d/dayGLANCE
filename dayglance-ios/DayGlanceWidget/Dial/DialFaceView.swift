import SwiftUI
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Day Dial — the static face, Phase 2 (docs/day-dial-widget-handoff.md §9).
//
// Everything that does not move with the needle, drawn in the spec's own
// coordinates (364×382pt, centre 182,189): sky ring, sunrise/sunset/moon
// glyphs, block track, tick ring, hour labels, block band (variant C of the
// palette study), separators. The hub stays empty until Phase 3.
//
// Every coordinate comes from DayDialGeometry — DialSpec for the radii and
// rules, DialGeometry for points and angles, DialBand for what each block
// is drawn as. This file only turns those into Paths. Paths, not Canvas:
// Canvas does not render in WidgetKit (handoff §7).
//
// SwiftUI's `addArc(clockwise:)` is named for an unflipped plane; in the
// y-down plane the dial lives in, `clockwise: false` sweeps the angle up,
// which IS clockwise on screen. Verified on device by the Phase 0 spike.
// ─────────────────────────────────────────────────────────────────────────────

private let dialCenter = CGPoint(x: DialSpec.cx, y: DialSpec.cy)

private func cg(_ p: DialPoint) -> CGPoint { CGPoint(x: p.x, y: p.y) }
private func rad(_ minutes: Double) -> Angle { .radians(DialGeometry.canvasAngle(minutes: minutes)) }

private extension Path {
    /// The bounding square of a circle on the dial centre.
    static func dialCircle(r: Double) -> Path {
        Path(ellipseIn: CGRect(x: dialCenter.x - r, y: dialCenter.y - r, width: 2 * r, height: 2 * r))
    }

    /// Stroke-only arc at radius r from startMin to endMin, clockwise.
    static func dialArc(r: Double, startMin: Double, endMin: Double) -> Path {
        var p = Path()
        p.addArc(center: dialCenter, radius: r, startAngle: rad(startMin), endAngle: rad(endMin), clockwise: false)
        return p
    }

    /// Closed annular sector: outer arc clockwise, inner arc back.
    static func dialSector(rInner: Double, rOuter: Double, startMin: Double, endMin: Double) -> Path {
        var p = Path()
        p.addArc(center: dialCenter, radius: rOuter, startAngle: rad(startMin), endAngle: rad(endMin), clockwise: false)
        p.addArc(center: dialCenter, radius: rInner, startAngle: rad(endMin), endAngle: rad(startMin), clockwise: true)
        p.closeSubpath()
        return p
    }

    static func line(_ a: DialPoint, _ b: DialPoint) -> Path {
        var p = Path()
        p.move(to: cg(a)); p.addLine(to: cg(b))
        return p
    }

    mutating func addLine(_ a: DialPoint, _ b: DialPoint) {
        move(to: cg(a)); addLine(to: cg(b))
    }
}

/// The face at its spec size. Wrap in `DialCanvas` to fit a widget.
struct DialFaceView: View {
    let input: DialFaceInput
    /// The entry's minute: decides past/future for the band (and nothing
    /// else on the face).
    let nowMin: Double

    var body: some View {
        let styles = DialBand.styles(input.blocks, nowMin: nowMin, projectedDay: input.projectedDay)
        ZStack(alignment: .topLeading) {
            skyRing
            glyphs
            track
            ticks
            blocks(styles)
            separators(styles)
            labels
        }
        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
    }

    // MARK: sky ring (handoff §4): one band, colour and opacity by strength, width constant
    //
    // No sky data (the app has no geocoded location yet, so the snapshot's
    // `sky` is null): the ring is drawn UNLIT, a neutral track at the sky
    // radius in the block track's tone, never left out. An empty band at
    // r = 119 looked like a rendering fault on a phone; a quiet ring says
    // "nothing lit" and keeps the face's silhouette. No glyphs without a
    // sky: rise, set and moon are facts about a place, and there is none.

    @ViewBuilder private var skyRing: some View {
        if input.sky.isEmpty {
            Path.dialCircle(r: DialSpec.skyRadius)
                .stroke(Color.white.opacity(DialSpec.skyUnlitOpacity), lineWidth: DialSpec.skyWidth)
        } else {
            ForEach(input.sky, id: \.hour) { seg in
                Path.dialArc(r: DialSpec.skyRadius, startMin: seg.startMin, endMin: seg.endMin)
                    .stroke(Color(hex: seg.body == .sun ? DialSpec.skySunColorHex : DialSpec.skyMoonColorHex).opacity(seg.opacity),
                            style: StrokeStyle(lineWidth: DialSpec.skyWidth, lineCap: .butt))
            }
        }
    }

    // MARK: glyphs, upright at r = 104

    @ViewBuilder private var glyphs: some View {
        if let rise = input.sunriseMin {
            SunGlyphView(rising: true).offset(DialSpec.glyphPoint(minutes: rise))
        }
        if let set = input.sunsetMin {
            SunGlyphView(rising: false).offset(DialSpec.glyphPoint(minutes: set))
        }
        if let moon = input.moon {
            MoonGlyphView(moon: moon).offset(DialSpec.glyphPoint(minutes: moon.minutes))
        }
    }

    // MARK: block track, white at 4.5 % beneath the blocks

    private var track: some View {
        Path.dialCircle(r: DialSpec.blockRadius)
            .stroke(Color.white.opacity(DialSpec.trackOpacity), lineWidth: DialSpec.blockWidth)
    }

    // MARK: ticks: 24 major, 3 minor per hour (the spec's 15-minute schedule)

    private var ticks: some View {
        var major = Path()
        var minor = Path()
        for tick in DialSpec.ticks {
            let line = DialSpec.tickLine(tick)
            if tick.kind == .hour { major.addLine(line.inner, line.outer) } else { minor.addLine(line.inner, line.outer) }
        }
        return ZStack {
            major.stroke(Color.white.opacity(DialSpec.tickMajorOpacity),
                         style: StrokeStyle(lineWidth: DialSpec.tickMajorWidth, lineCap: .round))
            minor.stroke(Color.white.opacity(DialSpec.tickMinorOpacity),
                         style: StrokeStyle(lineWidth: DialSpec.tickMinorWidth, lineCap: .butt))
        }
    }

    // MARK: block band, variant C: sector fill + rim on the outer edge, inside the band

    private func blocks(_ styles: [DialBlockStyle]) -> some View {
        ForEach(Array(styles.enumerated()), id: \.offset) { _, s in
            let color = Color(hex: s.colorHex)
            ZStack {
                if s.fillOpacity > 0 {
                    Path.dialSector(rInner: s.rInner, rOuter: s.rOuter, startMin: s.startMin, endMin: s.endMin)
                        .fill(color.opacity(s.fillOpacity))
                }
                Path.dialArc(r: s.rimRadius, startMin: s.startMin, endMin: s.endMin)
                    .stroke(color.opacity(s.rimOpacity), style: StrokeStyle(lineWidth: s.rimWidth, lineCap: .butt))
            }
        }
    }

    // MARK: separators: a background-colour cut where two blocks touch, drawn last (handoff §3)

    private func separators(_ styles: [DialBlockStyle]) -> some View {
        var p = Path()
        for m in DialSpec.separatorMinutes(styles: styles) {
            let line = DialSpec.separatorLine(minutes: m)
            p.addLine(line.inner, line.outer)
        }
        return p.stroke(Color(hex: DialSpec.backgroundHex), style: StrokeStyle(lineWidth: DialSpec.separatorLineWidth, lineCap: .butt))
    }

    // MARK: the six hour labels

    private var labels: some View {
        ForEach(DialSpec.hourLabels, id: \.minutes) { label in
            let p = DialSpec.labelPoint(label)
            Text(verbatim: label.text)
                .font(.system(size: DialSpec.labelFontSize, weight: .medium))
                .tracking(DialSpec.labelTracking)
                .foregroundStyle(Color.white.opacity(DialSpec.labelOpacity))
                .position(x: p.x, y: p.y)
        }
    }
}

/// The needle for one entry, in the same spec coordinates as the face:
/// 126–159 at 2.6pt with a 3.4pt dot on the outer end. Drawn from its
/// minute rather than rotated, so it needs no anchor arithmetic — the dial
/// centre is not the canvas centre.
struct DialNeedleView: View {
    let nowMin: Double

    var body: some View {
        let needle = DialSpec.needle(minutes: nowMin)
        let color = Color(hex: DialSpec.needleColorHex)
        ZStack(alignment: .topLeading) {
            Path.line(needle.inner, needle.outer)
                .stroke(color, style: StrokeStyle(lineWidth: DialSpec.needleWidth, lineCap: .round))
            Path(ellipseIn: CGRect(x: needle.outer.x - DialSpec.needleDotRadius, y: needle.outer.y - DialSpec.needleDotRadius,
                                   width: 2 * DialSpec.needleDotRadius, height: 2 * DialSpec.needleDotRadius))
                .fill(color)
        }
        .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
    }
}

/// Fits spec-sized content (364×382pt) into whatever the widget gives,
/// uniformly scaled and centred. The only scaling on the way to the screen.
struct DialCanvas<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width / DialSpec.canvasWidth, geo.size.height / DialSpec.canvasHeight)
            content()
                .frame(width: DialSpec.canvasWidth, height: DialSpec.canvasHeight)
                .scaleEffect(s)
                .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

// MARK: - Glyphs (DialSpec.SunGlyph / DialSpec.MoonGlyph, in glyph-local coordinates)

private extension View {
    /// Places a glyph drawn about the origin at a point on the dial.
    func offset(_ p: DialPoint) -> some View { offset(x: p.x, y: p.y) }
}

/// Half-disc on a horizon with three rays and a chevron: up above the disc
/// for sunrise, down below the horizon for sunset.
struct SunGlyphView: View {
    let rising: Bool

    var body: some View {
        typealias G = DialSpec.SunGlyph
        let color = Color(hex: rising ? G.sunriseColorHex : G.sunsetColorHex)
        let stroke = StrokeStyle(lineWidth: G.strokeWidth, lineCap: .round, lineJoin: .round)

        var strokes = Path()
        for r in G.rays {
            strokes.move(to: CGPoint(x: r.x1, y: r.y1)); strokes.addLine(to: CGPoint(x: r.x2, y: r.y2))
        }
        let chevron = rising ? G.sunriseChevron : G.sunsetChevron
        strokes.move(to: cg(chevron[0]))
        for p in chevron.dropFirst() { strokes.addLine(to: cg(p)) }

        var horizon = Path()
        horizon.move(to: CGPoint(x: G.horizon.x1, y: G.horizon.y1)); horizon.addLine(to: CGPoint(x: G.horizon.x2, y: G.horizon.y2))

        // "M -3.4 5 A 3.4 3.4 0 0 1 3.4 5 Z": the upper half of the disc, its
        // flat side on the horizon — angles π → 2π sweep up through the top.
        var disc = Path()
        disc.move(to: CGPoint(x: -G.discRadius, y: G.horizonY))
        disc.addArc(center: CGPoint(x: 0, y: G.horizonY), radius: G.discRadius,
                    startAngle: .radians(Double.pi), endAngle: .radians(2 * Double.pi), clockwise: false)
        disc.closeSubpath()

        return ZStack {
            strokes.stroke(color.opacity(G.strokeOpacity), style: stroke)
            disc.fill(color.opacity(G.discFillOpacity))
            horizon.stroke(color.opacity(G.horizonOpacity), style: stroke)
        }
        .frame(width: 0, height: 0)   // the paths sit about the origin; the frame is a point
    }
}

/// An outlined circle with the lit fraction filled (MoonPhase, the same
/// shape the in-app dial draws). Northern-hemisphere orientation: the
/// snapshot does not carry the observer's hemisphere.
struct MoonGlyphView: View {
    let moon: DialMoonGlyph

    var body: some View {
        typealias G = DialSpec.MoonGlyph
        let color = Color(hex: G.colorHex)
        let r = G.radius
        let geometry = MoonPhase.geometry(r: r, fraction: moon.fraction, waxing: moon.waxing)

        // "M 0 -r A r r 0 0 s 0 r A rx r 0 0 t 0 -r Z". SVG sweep 1 is
        // clockwise on screen, which is `clockwise: false` here (see the
        // file header); the terminator is the same arc squeezed in x.
        var lit = Path()
        lit.move(to: CGPoint(x: 0, y: -r))
        lit.addArc(center: .zero, radius: r, startAngle: .radians(-Double.pi / 2), endAngle: .radians(Double.pi / 2),
                   clockwise: geometry.limbSweep == 0)
        if geometry.terminatorRx > 0 {
            lit.addArc(center: .zero, radius: r, startAngle: .radians(Double.pi / 2), endAngle: .radians(-Double.pi / 2),
                       clockwise: geometry.terminatorSweep == 0,
                       transform: CGAffineTransform(scaleX: geometry.terminatorRx / r, y: 1))
        }
        lit.closeSubpath()

        return ZStack {
            Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
                .stroke(color.opacity(G.strokeOpacity), lineWidth: G.strokeWidth)
            lit.fill(color.opacity(G.fillOpacity))
        }
        .frame(width: 0, height: 0)
    }
}
