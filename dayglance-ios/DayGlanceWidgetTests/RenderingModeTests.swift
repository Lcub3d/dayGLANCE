import XCTest
import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// The accented rendering mode's face (a tinted or clear Home Screen, iOS 18+).
//
// The system paints every view white at its own opacity there, images
// included, so an OPAQUE face PNG becomes one white rectangle and the white
// hub text and needle over it vanish: the blank tinted dial. The mono face
// is the fix — white at the spec's opacities on a transparent ground, with
// the separators cut out rather than painted in the background colour — and
// these tests render it through the same ImageRenderer pass the cache uses
// and read the ALPHA back: transparent where nothing is drawn, opaque-ish
// where the band is, cut at a separator, and keyed apart from the colour face.
// ─────────────────────────────────────────────────────────────────────────────

final class RenderingModeTests: XCTestCase {

    /// Two blocks that touch at 10:30 (a separator there), one apart, a
    /// sleep, and the placeholder's sky so the ring and glyphs are lit.
    private let input: DialFaceInput = {
        let blocks = [
            DialFaceBlock(id: "sleep", kind: .sleep, startMin: 0, endMin: 390),
            DialFaceBlock(id: "a", kind: .task, startMin: 540, endMin: 630, colorHex: "#3b82f6"),
            DialFaceBlock(id: "b", kind: .task, startMin: 630, endMin: 720, colorHex: "#ef4444"),
            DialFaceBlock(id: "c", kind: .task, startMin: 900, endMin: 960, colorHex: "#22c55e"),
        ]
        let sky = DialFaceInput.placeholder
        return DialFaceInput(blocks: blocks, sky: sky.sky, sunriseMin: sky.sunriseMin, sunsetMin: sky.sunsetMin, moon: sky.moon)
    }()

    private let nowMin: Double = 8 * 60   // everything is still ahead

    // MARK: rendering and sampling

    /// The face at 1×, spec size: the colour face over the widget's
    /// background (what the cache renders), the mono face on nothing.
    @MainActor
    private func render(mono: Bool) throws -> CGImage {
        let face = DialFaceView(input: input, nowMin: nowMin, mono: mono)
        if mono {
            let renderer = ImageRenderer(content: face)
            renderer.scale = 1
            return try XCTUnwrap(renderer.cgImage)
        }
        let renderer = ImageRenderer(content: face.background(Color(hex: DialSpec.backgroundHex)))
        renderer.scale = 1
        return try XCTUnwrap(renderer.cgImage)
    }

    struct RGBA { let r: Double, g: Double, b: Double, a: Double }

    /// One pixel, top-left origin, straight (un-premultiplied) colour.
    static func pixel(_ image: CGImage, x: Int, y: Int) -> RGBA {
        var px = [UInt8](repeating: 0, count: 4)
        px.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.draw(image, in: CGRect(x: -CGFloat(x), y: -CGFloat(image.height - 1 - y),
                                       width: CGFloat(image.width), height: CGFloat(image.height)))
        }
        let a = Double(px[3]) / 255
        let un = { (c: UInt8) in a > 0 ? min(1, Double(c) / 255 / a) : 0 }
        return RGBA(r: un(px[0]), g: un(px[1]), b: un(px[2]), a: a)
    }

    /// The least and greatest alpha in a small window around a point: a
    /// 1.6pt line is not reliably centred on one pixel.
    private func alphaRange(_ image: CGImage, around p: DialPoint, radius: Int = 2) -> (min: Double, max: Double) {
        var lo = 1.0, hi = 0.0
        for dx in -radius...radius {
            for dy in -radius...radius {
                let a = Self.pixel(image, x: Int(p.x.rounded()) + dx, y: Int(p.y.rounded()) + dy).a
                lo = min(lo, a); hi = max(hi, a)
            }
        }
        return (lo, hi)
    }

    private func bandPoint(minutes: Double) -> DialPoint {
        DialGeometry.point(cx: DialSpec.cx, cy: DialSpec.cy, r: DialSpec.blockRadius, minutes: minutes)
    }

    // MARK: the mono face

    @MainActor
    func testTheMonoFaceIsWhiteOnATransparentGround() throws {
        let image = try render(mono: true)
        XCTAssertEqual(image.width, Int(DialSpec.canvasWidth))
        XCTAssertEqual(image.height, Int(DialSpec.canvasHeight))

        // Nothing is drawn in the corner or at the hub's centre.
        XCTAssertEqual(Self.pixel(image, x: 2, y: 2).a, 0, accuracy: 0.01, "the ground is transparent")
        XCTAssertEqual(Self.pixel(image, x: Int(DialSpec.cx), y: Int(DialSpec.cy)).a, 0, accuracy: 0.01, "the hub is empty on the face")

        // The band, where block "a" is (09:45): drawn, and drawn white.
        let a = Self.pixel(image, x: Int(bandPoint(minutes: 585).x.rounded()), y: Int(bandPoint(minutes: 585).y.rounded()))
        XCTAssertGreaterThan(a.a, 0.15, "the block band is drawn")
        XCTAssertLessThan(abs(a.r - a.b), 0.05, "and it is white, not the task's blue")
        XCTAssertGreaterThan(a.r, 0.9, "white")

        // The sky ring at noon: lit, white.
        let noon = DialGeometry.point(cx: DialSpec.cx, cy: DialSpec.cy, r: DialSpec.skyRadius, minutes: 12 * 60 + 30)
        let sky = Self.pixel(image, x: Int(noon.x.rounded()), y: Int(noon.y.rounded()))
        XCTAssertGreaterThan(sky.a, 0.3, "the noon segment is lit")
        XCTAssertLessThan(abs(sky.r - sky.b), 0.05, "and white, not the sun's gold")

        // The full-colour face is the opposite: opaque everywhere.
        let colour = try render(mono: false)
        XCTAssertEqual(Self.pixel(colour, x: 2, y: 2).a, 1, accuracy: 0.01, "the colour face carries its background")
    }

    @MainActor
    func testTheSeparatorIsCutOutOfTheMonoBand() throws {
        // "a" and "b" touch at 10:30: in full colour the separator is a line
        // of background colour over the band; in mono it is a hole.
        XCTAssertEqual(DialSpec.separatorMinutes(blocks: input.blocks.map { DialRingBlock(id: $0.id, startMin: $0.startMin, endMin: $0.endMin) }), [630])
        let mono = try render(mono: true)
        let cut = alphaRange(mono, around: bandPoint(minutes: 630))
        let solid = alphaRange(mono, around: bandPoint(minutes: 600))
        XCTAssertLessThan(cut.min, 0.08, "the separator is transparent at 10:30 (min alpha \(cut.min))")
        XCTAssertGreaterThan(solid.min, 0.15, "and the band beside it is not (min alpha \(solid.min))")

        // And nothing leaks: the cut does not reach beyond the band.
        let outside = DialGeometry.point(cx: DialSpec.cx, cy: DialSpec.cy, r: DialSpec.blockOuterRadius + 6, minutes: 630)
        XCTAssertLessThan(alphaRange(mono, around: outside, radius: 1).max, 0.2, "no separator outside the band")
    }

    // MARK: the key

    func testTheModeIsPartOfTheCacheKey() {
        let size = CGSize(width: 364, height: 382)
        let colour = DialFaceCache.key(input: input, nowMin: nowMin, size: size, scale: 3)
        let mono = DialFaceCache.key(input: input, nowMin: nowMin, size: size, scale: 3, mono: true)
        XCTAssertNotEqual(colour, mono)
        XCTAssertTrue(mono.hasPrefix("\(DialFaceCache.renderVersion)-mono-"), mono)
        XCTAssertTrue(colour.hasPrefix("\(DialFaceCache.renderVersion)-"), colour)
        XCTAssertFalse(colour.hasPrefix("\(DialFaceCache.renderVersion)-mono-"), colour)
        // A colour prefix never matches a mono file and the reverse, so
        // `retain(prefixes:)` cannot keep one mode's faces on the other's behalf.
        let cp = DialFaceCache.facePrefix(input: input, size: size, scale: 3)
        let mp = DialFaceCache.facePrefix(input: input, size: size, scale: 3, mono: true)
        XCTAssertFalse(mono.hasPrefix(cp))
        XCTAssertFalse(colour.hasPrefix(mp))
    }
}
