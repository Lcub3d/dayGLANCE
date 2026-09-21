import XCTest
import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// The live path, end to end, on a payload shaped like a real push.
//
// dayglance-ios/TestFixtures/widgetSnapshot.live.json is written by
// `npm run ios:vectors` from the same JS producers the app's snapshot effect
// uses (src/utils/widgetSnapshotFixture.js), and its own vitest fails when it
// drifts. Here it goes through the widget's OWN decoder (decodeSnapshot, what
// loadSnapshot calls), day resolution (ResolvedWidgetDay), the face mapping
// (DialFaceInput) and a real ImageRenderer pass over DialFaceView, and the
// rendered ring is sampled. The DIAL_PREVIEW widget draws from a hand-made
// fixture and shipped once with the live path drawing no sky at all; this is
// the test that would have failed.
// ─────────────────────────────────────────────────────────────────────────────

final class LiveSnapshotSkyTests: XCTestCase {

    /// The fixture's zone (LIVE_SNAPSHOT_TIMEZONE), so "noon on the pushed
    /// day" is the same instant the producers meant.
    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Denver")!
        return c
    }()

    private func loadFixture() throws -> WidgetSnapshot {
        let url = try XCTUnwrap(Bundle(for: LiveSnapshotSkyTests.self).url(forResource: "widgetSnapshot.live", withExtension: "json"),
                                "widgetSnapshot.live.json is a resource of the test bundle (project.yml)")
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(decodeSnapshot(data), "the widget's decoder must accept a live-shaped push whole")
    }

    /// Noon, `offset` days after the pushed day.
    private func noon(_ offset: Int, of snapshot: WidgetSnapshot) throws -> Date {
        let pushed = try XCTUnwrap(WidgetFreshness.parseDay(snapshot.date, calendar: calendar))
        let day = try XCTUnwrap(calendar.date(byAdding: .day, value: offset, to: pushed))
        return try XCTUnwrap(calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day))
    }

    // MARK: the mapping

    func testThePushedDayCarriesItsSkyIntoTheFaceInput() throws {
        let snapshot = try loadFixture()
        XCTAssertNotNil(snapshot.sky, "the live push carries `sky` for the pushed day")
        let day = ResolvedWidgetDay.resolve(snapshot, at: try noon(0, of: snapshot), calendar: calendar)
        XCTAssertEqual(day.tier, .pushed)
        let input = DialFaceInput(day: day)
        XCTAssertEqual(input.sky.count, 24)
        XCTAssertNotNil(input.sunriseMin)
        XCTAssertNotNil(input.sunsetMin)
        XCTAssertNotNil(input.moon, "the fixture night has a moon glyph (glyphMin is set)")
        XCTAssertTrue(input.sky.contains { $0.body == .sun && $0.strength > 0.5 }, "a September noon in Denver is lit")
        XCTAssertTrue(input.sky.contains { $0.body == .moon && $0.strength > 0 }, "a 77 % moon shows in the night hours")
    }

    func testEveryProjectedDayCarriesItsOwnSky() throws {
        let snapshot = try loadFixture()
        XCTAssertEqual(snapshot.days?.count, 3)
        for offset in 1...3 {
            let day = ResolvedWidgetDay.resolve(snapshot, at: try noon(offset, of: snapshot), calendar: calendar)
            XCTAssertEqual(day.tier, .projected, "day +\(offset)")
            let input = DialFaceInput(day: day)
            XCTAssertEqual(input.sky.count, 24, "day +\(offset)")
            XCTAssertNotNil(input.sunriseMin, "day +\(offset)")
            XCTAssertNotNil(input.sunsetMin, "day +\(offset)")
            XCTAssertTrue(input.projectedDay)
        }
    }

    func testTheDialBlocksSurviveTheSameDecode() throws {
        // The sky is the subject; the blocks ride the same strict decoder, so
        // a payload that lost them would be caught here rather than on a phone.
        let snapshot = try loadFixture()
        let input = DialFaceInput(day: ResolvedWidgetDay.resolve(snapshot, at: try noon(0, of: snapshot), calendar: calendar))
        XCTAssertGreaterThan(input.blocks.count, 5)
        XCTAssertTrue(input.blocks.contains { $0.kind == .sleep })
        XCTAssertTrue(input.blocks.contains { $0.completed })
    }

    // MARK: the pixels

    /// The face at 1×, spec size, over the widget's background: what the
    /// cache renders (DialFaceCache.renderFace) minus the pixel scale.
    @MainActor
    private func render(_ input: DialFaceInput, nowMin: Double) throws -> CGImage {
        let renderer = ImageRenderer(content: DialFaceView(input: input, nowMin: nowMin)
            .background(Color(hex: DialSpec.backgroundHex)))
        renderer.scale = 1
        return try XCTUnwrap(renderer.cgImage, "ImageRenderer produced no image")
    }

    private struct RGB { let r: Double; let g: Double; let b: Double }

    /// One pixel, top-left origin, un-premultiplied enough for a comparison.
    private func pixel(_ image: CGImage, x: Int, y: Int) -> RGB {
        var px = [UInt8](repeating: 0, count: 4)
        px.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            // Core Graphics draws bottom-up: shift the image so the wanted
            // pixel lands on the context's single pixel.
            ctx.draw(image, in: CGRect(x: -CGFloat(x), y: -CGFloat(image.height - 1 - y),
                                       width: CGFloat(image.width), height: CGFloat(image.height)))
        }
        return RGB(r: Double(px[0]) / 255, g: Double(px[1]) / 255, b: Double(px[2]) / 255)
    }

    /// The pixel on the sky ring at `minutes` (the ring's centre radius).
    private func skyPixel(_ image: CGImage, minutes: Double) -> RGB {
        let p = DialGeometry.point(cx: DialSpec.cx, cy: DialSpec.cy, r: DialSpec.skyRadius, minutes: minutes)
        return pixel(image, x: Int(p.x.rounded()), y: Int(p.y.rounded()))
    }

    @MainActor
    func testTheSkyRingIsDrawnOnTheRenderedLiveFace() throws {
        let snapshot = try loadFixture()
        let input = DialFaceInput(day: ResolvedWidgetDay.resolve(snapshot, at: try noon(0, of: snapshot), calendar: calendar))
        let image = try render(input, nowMin: 12 * 60)
        XCTAssertEqual(image.width, Int(DialSpec.canvasWidth))
        XCTAssertEqual(image.height, Int(DialSpec.canvasHeight))

        let background = pixel(image, x: Int(DialSpec.cx), y: Int(DialSpec.cy))   // the hub is empty on the face
        let noon = skyPixel(image, minutes: 12 * 60 + 30)                          // hour 12's segment, sampled at its midpoint
        // The sun segment is #d9b33c at 0.10 + 0.66 × strength over the
        // background: unmistakably warm and far from the background.
        XCTAssertGreaterThan(noon.r - background.r, 0.25, "the noon segment is lit")
        XCTAssertGreaterThan(noon.r - noon.b, 0.2, "and it is the sun's colour")

        // Two hours after midnight the moon segment (#c3c3e8) is cool.
        let night = skyPixel(image, minutes: 2 * 60 + 30)
        let seg = try XCTUnwrap(input.sky.first { $0.hour == 2 })
        if seg.body == .moon && seg.strength > 0.05 {
            XCTAssertGreaterThan(night.b - background.b, 0.05, "the night segment is lit by the moon")
            XCTAssertGreaterThanOrEqual(night.b, night.r, "and it is the moon's colour")
        }
    }

    /// The strongest sun tint (r − b) and the brightest neutral pixel in a
    /// window around a point: glyphs are a few points across, so one pixel
    /// is too easy to miss.
    private func window(_ image: CGImage, around p: DialPoint, radius: Int = 7) -> (warmth: Double, bright: Double) {
        var warmth = -1.0, bright = 0.0
        for dx in -radius...radius {
            for dy in -radius...radius {
                let x = Int(p.x.rounded()) + dx, y = Int(p.y.rounded()) + dy
                guard x >= 0, y >= 0, x < image.width, y < image.height else { continue }
                let c = pixel(image, x: x, y: y)
                warmth = max(warmth, c.r - c.b)
                bright = max(bright, (c.r + c.g + c.b) / 3)
            }
        }
        return (warmth, bright)
    }

    @MainActor
    func testTheSunAndMoonGlyphsAreDrawnOnTheRenderedLiveFace() throws {
        // Glyphs are the other half of the sky (handoff §4): a live face with
        // a ring but no rise, set or moon glyph is the bug this pins.
        let snapshot = try loadFixture()
        let input = DialFaceInput(day: ResolvedWidgetDay.resolve(snapshot, at: try noon(0, of: snapshot), calendar: calendar))
        let rise = try XCTUnwrap(input.sunriseMin), set = try XCTUnwrap(input.sunsetMin), moon = try XCTUnwrap(input.moon)
        let image = try render(input, nowMin: 12 * 60)
        let background = pixel(image, x: Int(DialSpec.cx), y: Int(DialSpec.cy))

        // The sunrise glyph (#f5c542) and sunset glyph (#f59942) sit at the
        // glyph radius: warm against a near-black background.
        let sunrise = window(image, around: DialSpec.glyphPoint(minutes: rise))
        let sunset = window(image, around: DialSpec.glyphPoint(minutes: set))
        XCTAssertGreaterThan(sunrise.warmth, 0.3, "the sunrise glyph is drawn at \(rise) min")
        XCTAssertGreaterThan(sunset.warmth, 0.3, "the sunset glyph is drawn at \(set) min")

        // The moon (#d8d8f0 at 0.85) is the brightest thing near its point.
        let moonPx = window(image, around: DialSpec.glyphPoint(minutes: moon.minutes))
        XCTAssertGreaterThan(moonPx.bright - (background.r + background.g + background.b) / 3, 0.3,
                             "the moon glyph is drawn at \(moon.minutes) min")

        // Control: a point on the glyph radius with no glyph is background.
        let quiet = window(image, around: DialSpec.glyphPoint(minutes: 15 * 60 + 30), radius: 3)
        XCTAssertLessThan(quiet.warmth, 0.1)
    }

    @MainActor
    func testWithoutSkyDataTheRingIsUnlitNotMissing() throws {
        let snapshot = try loadFixture()
        var skyless = snapshot
        skyless.sky = nil
        let input = DialFaceInput(day: ResolvedWidgetDay.resolve(skyless, at: try noon(0, of: snapshot), calendar: calendar))
        XCTAssertTrue(input.sky.isEmpty)
        XCTAssertNil(input.sunriseMin)
        XCTAssertNil(input.moon)

        let image = try render(input, nowMin: 12 * 60)
        let background = pixel(image, x: Int(DialSpec.cx), y: Int(DialSpec.cy))
        let samples: [Double] = [30, 6 * 60 + 30, 12 * 60 + 30, 18 * 60 + 30]
        for minutes in samples {
            let p = skyPixel(image, minutes: minutes)
            // White at 4.5 % over the background: a few levels brighter,
            // and neutral (no warm or cool cast).
            XCTAssertGreaterThan(p.r - background.r, 0.012, "the ring is drawn at \(minutes)")
            XCTAssertLessThan(abs(p.r - p.b), 0.02, "and it is neutral at \(minutes)")
        }
        // And the two faces are not the same picture: the digest differs, so
        // the cache cannot hand a lit face to a skyless day or the reverse.
        let lit = DialFaceInput(day: ResolvedWidgetDay.resolve(snapshot, at: try noon(0, of: snapshot), calendar: calendar))
        XCTAssertNotEqual(lit.digest, input.digest)
    }
}
