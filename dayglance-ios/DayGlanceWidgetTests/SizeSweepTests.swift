import XCTest
import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Sizes (Phase 5, item 8). The face is drawn once in the spec's coordinates
// (364×382pt) and DialCanvas scales it uniformly to whatever systemLarge is
// on the device — the only scaling on the way to the screen. This renders
// the canvas at every systemLarge size iOS and iPadOS hand out (content
// margins are disabled, so the widget's size IS the canvas) and checks the
// picture: the block band lands at the same scaled radius on both axes
// (uniform, not stretched), sits inside the widget, and the cache's pixel
// scale is the same factor. Sizes from Apple's per-device tables.
// ─────────────────────────────────────────────────────────────────────────────

final class SizeSweepTests: XCTestCase {

    /// systemLarge in points, by the screens that produce it.
    static let sizes: [(devices: String, w: CGFloat, h: CGFloat)] = [
        ("iPhone SE (2nd/3rd gen), 8, 7 — 375×667", 321, 324),
        ("iPhone 12/13 mini, X, XS, 11 Pro — 375×812, 360×780", 329, 345),
        ("iPhone 12–16, 14/15/16 Pro — 390×844, 393×852", 338, 354),
        ("iPhone 8 Plus, 7 Plus — 414×736", 348, 351),
        ("iPhone XR, 11, XS Max, 11 Pro Max — 414×896", 360, 379),
        ("iPhone Pro Max, Plus, 16 Pro — 428–440 wide", 364, 382),
        ("iPad mini, 9.7\" iPad, Air 2", 306, 306),
        ("iPad 10.2\"", 321, 321),
        ("iPad 10.5\", Air 3", 328, 328),
        ("iPad Pro 11\", Air 4/5, 10.9\"", 342, 342),
        ("iPad Pro 12.9\" / 13\"", 379, 379),
    ]

    /// Four blocks straddling the cardinal minutes, so the band is drawn
    /// where the sweep samples; no sky, so the ring cannot confuse a sample.
    private let input = DialFaceInput(blocks: [
        DialFaceBlock(id: "n", kind: .task, startMin: 0, endMin: 60, colorHex: "#3b82f6"),
        DialFaceBlock(id: "e", kind: .task, startMin: 330, endMin: 420, colorHex: "#ef4444"),
        DialFaceBlock(id: "s", kind: .task, startMin: 690, endMin: 780, colorHex: "#22c55e"),
        DialFaceBlock(id: "w", kind: .task, startMin: 1050, endMin: 1140, colorHex: "#a855f7"),
    ])

    /// Sampled 7 minutes past each cardinal: inside every block, on no tick.
    private let cardinals: [Double] = [7, 367, 727, 1087]

    /// The canvas's scale factor for a widget size (DialCanvas's own rule).
    static func factor(_ w: CGFloat, _ h: CGFloat) -> CGFloat {
        min(w / DialSpec.canvasWidth, h / DialSpec.canvasHeight)
    }

    /// Where the dial centre lands in a widget of this size: the canvas is
    /// scaled about its own centre and centred in the widget, and the dial
    /// centre is 2pt above the canvas centre (189 vs 191).
    static func dialCentre(_ w: CGFloat, _ h: CGFloat) -> CGPoint {
        let s = factor(w, h)
        return CGPoint(x: w / 2 + (DialSpec.cx - DialSpec.canvasWidth / 2) * s,
                       y: h / 2 + (DialSpec.cy - DialSpec.canvasHeight / 2) * s)
    }

    /// The mono face (transparent ground) through DialCanvas at a widget
    /// size, at 2×, so "drawn" is simply alpha.
    @MainActor
    private func render(w: CGFloat, h: CGFloat) throws -> CGImage {
        let renderer = ImageRenderer(content:
            DialCanvas { DialFaceView(input: input, nowMin: 0, mono: true) }
                .frame(width: w, height: h))
        renderer.scale = 2
        return try XCTUnwrap(renderer.cgImage, "no image at \(w)×\(h)")
    }

    private func alpha(_ image: CGImage, at p: CGPoint) -> Double {
        RenderingModeTests.pixel(image, x: Int((p.x * 2).rounded()), y: Int((p.y * 2).rounded())).a
    }

    private func point(centre c: CGPoint, r: CGFloat, minutes: Double) -> CGPoint {
        let a = DialGeometry.canvasAngle(minutes: minutes)
        return CGPoint(x: c.x + r * CGFloat(cos(a)), y: c.y + r * CGFloat(sin(a)))
    }

    @MainActor
    func testTheFaceScalesUniformlyAtEverySystemLargeSize() throws {
        for size in Self.sizes {
            let (w, h) = (size.w, size.h)
            let s = Self.factor(w, h)
            let c = Self.dialCentre(w, h)
            let image = try render(w: w, h: h)
            XCTAssertEqual(image.width, Int(w * 2)); XCTAssertEqual(image.height, Int(h * 2))

            for m in cardinals {
                // The band's centre radius, scaled: drawn on every axis.
                let on = alpha(image, at: point(centre: c, r: DialSpec.blockRadius * s, minutes: m))
                XCTAssertGreaterThan(on, 0.15, "\(size.devices): band at \(m) min, \(w)×\(h), s=\(s)")
                // 2.5pt beyond the band's outer edge, scaled: nothing. If the
                // scale differed between the axes, one of the four would land
                // on the band (horizontal or vertical) while the others miss.
                let off = alpha(image, at: point(centre: c, r: (DialSpec.blockOuterRadius + 2.5) * s, minutes: m))
                XCTAssertLessThan(off, 0.08, "\(size.devices): the band ends at the same scaled radius at \(m) min")
                let inside = alpha(image, at: point(centre: c, r: (DialSpec.blockInnerRadius - 2.5) * s, minutes: m))
                XCTAssertLessThan(inside, 0.08, "\(size.devices): the band starts at the same scaled radius at \(m) min")
            }

            // The whole canvas fits: the scaled canvas is no larger than the widget.
            XCTAssertLessThanOrEqual(DialSpec.canvasWidth * s, w + 0.001, size.devices)
            XCTAssertLessThanOrEqual(DialSpec.canvasHeight * s, h + 0.001, size.devices)
            // And the cache renders at the same factor the canvas shows.
            XCTAssertEqual(DialFaceCache.pixelScale(size: CGSize(width: w, height: h), scale: 3), 3 * s, accuracy: 1e-9, size.devices)
        }
    }

    func testTheSpecSizeIsDrawnAtOneToOne() {
        XCTAssertEqual(Self.factor(364, 382), 1)
        XCTAssertEqual(Self.dialCentre(364, 382), CGPoint(x: DialSpec.cx, y: DialSpec.cy))
    }

    /// What the sweep implies for type: the smallest row at the smallest
    /// widget. Printed for the handoff, asserted so the floor is a decision.
    func testTheSmallestEffectiveTypeSize() {
        let smallest = Self.sizes.map { Self.factor($0.w, $0.h) }.min()!
        let note = DialSpec.Hub.noteFontSize * smallest
        let label = DialSpec.labelFontSize * smallest
        print("size sweep: smallest factor \(smallest) → note \(note)pt, hour labels \(label)pt, countdown \(DialSpec.Hub.countdownFontSize * smallest)pt")
        XCTAssertGreaterThanOrEqual(smallest, 0.80, "iPad mini's 306×306 is the floor")
        XCTAssertGreaterThanOrEqual(note, 7.0, "the projected note stays above 7pt before its own minimum scale")
    }
}
