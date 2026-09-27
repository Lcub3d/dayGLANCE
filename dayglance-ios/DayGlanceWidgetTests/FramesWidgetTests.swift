import XCTest
import SwiftUI
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Frames on the widget (docs/day-dial-frames-spec.html): the payload into the
// face input, the cache seed, the hub's frame rows, and the enclosure in the
// rendered face, full colour AND mono (the tinted/clear Home Screen, where
// the outline is the faintest thing on the face and the likeliest to vanish).
// ─────────────────────────────────────────────────────────────────────────────

final class FramesWidgetTests: XCTestCase {

    private let noon: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 9; c.day = 26; c.hour = 12
        return Calendar.current.date(from: c)!
    }()

    private func frame(_ name: String, _ hex: String, _ s: Int, _ e: Int, depth: Int = 0, slots: [[Int]] = []) -> DialFrameWire {
        DialFrameWire(name: name, colorHex: hex, startMin: s, endMin: e, depth: depth, slots: slots)
    }

    private func input(frames: [DialFrameWire], blocks: [DialBlock] = []) -> DialFaceInput {
        DialFaceInput(dial: DialSnapshot(date: "2026-09-26", blocks: blocks, frames: frames), sky: nil, projectedDay: false)
    }

    private let admin: [DialFrameWire] = [
        DialFrameWire(name: "Admin", colorHex: "#f59e0b", startMin: 840, endMin: 1065, depth: 0, slots: [[840, 865], [1010, 1065]]),
    ]

    // MARK: the input and the key

    func testThePayloadBecomesTheFacesFrames() {
        let i = input(frames: admin + [frame("Bad", "#000000", 900, 900), frame("Focus", "#22c55e", 870, 930, depth: 1)])
        XCTAssertEqual(i.frames.map(\.name), ["Admin", "Focus"], "a frame that does not end after it starts is dropped")
        XCTAssertEqual(i.frames[0].slots, [DialFrameSlot(startMin: 840, endMin: 865), DialFrameSlot(startMin: 1010, endMin: 1065)])
        XCTAssertEqual(i.frames[1].depth, 1)
    }

    func testFramesNameANewFaceButNotANewBucket() {
        let without = input(frames: [])
        let with = input(frames: admin)
        XCTAssertNotEqual(without.digest, with.digest, "an edited frame must not reuse a cached face")
        XCTAssertEqual(DialFaceInput(blocks: []).digest, without.digest, "a day without frames keeps its old key")
        // Names and slots are the hub's: renaming a frame reuses the face.
        var renamed = admin
        renamed[0].name = "Paperwork"
        renamed[0].slots = [[840, 900]]
        XCTAssertEqual(input(frames: renamed).digest, with.digest)
    }

    // MARK: the hub

    func testTheHubFrameIsTheInnermostWithItsFreeTimeFromNow() throws {
        let frames = input(frames: admin + [frame("Calls", "#14b8a6", 1030, 1050, depth: 1, slots: [[1030, 1050]])]).frames
        let inner = try XCTUnwrap(DialHubFrame(frames: frames, nowMin: 1038))
        XCTAssertEqual(inner.name, "Calls")
        XCTAssertEqual(inner.availableMinutes, 12)
        let outer = try XCTUnwrap(DialHubFrame(frames: frames, nowMin: 1055))
        XCTAssertEqual(outer.name, "Admin")
        XCTAssertEqual(outer.availableMinutes, 10)
        XCTAssertNil(DialHubFrame(frames: frames, nowMin: 1100))
    }

    func testFrameRowsReplaceTheOpenTimeRows() throws {
        let frames = input(frames: admin).frames
        let state = DialHub.resolve(blocks: [], nowMin: 1038)
        let h = DialHubView(date: noon, state: state, use24Hour: true, frame: DialHubFrame(frames: frames, nowMin: 1038))
        let rows = h.rows()
        XCTAssertEqual(rows.title?.text, "Admin")
        XCTAssertNotNil(rows.title?.live, "the title carries the Frames mark")
        XCTAssertEqual(rows.stack.map(\.text), ["14:00–17:45", "27m available"])
        let spoken = DialHubView.summary(date: noon, state: state, use24Hour: true, status: .live, plannedAsOf: nil,
                                         frame: DialHubFrame(frames: frames, nowMin: 1038))
        XCTAssertTrue(spoken.contains("Admin, 14:00–17:45, 27 minutes available"), spoken)
    }

    func testNoFreeTimeLeftDropsTheAvailableRow() {
        let full = DialHubFrame(name: "Admin", colorHex: "#f59e0b", startMin: 840, endMin: 1065, availableMinutes: 0)
        let h = DialHubView(date: noon, state: DialHub.resolve(blocks: [], nowMin: 1000), use24Hour: true, frame: full)
        XCTAssertEqual(h.rows().stack.map(\.text), ["14:00–17:45"])
    }

    // MARK: the rendered face

    @MainActor
    private func render(_ input: DialFaceInput, mono: Bool) throws -> CGImage {
        let face = DialFaceView(input: input, nowMin: 1038, mono: mono)
        let renderer = ImageRenderer(content: mono ? AnyView(face) : AnyView(face.background(Color(hex: DialSpec.backgroundHex))))
        renderer.scale = 2
        return try XCTUnwrap(renderer.cgImage)
    }

    /// RGBA at a spec point (2× image), straight alpha.
    private func rgba(_ image: CGImage, at p: DialPoint) -> (r: Double, g: Double, b: Double, a: Double) {
        var px = [UInt8](repeating: 0, count: 4)
        px.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            let x = Int((p.x * 2).rounded()), y = Int((p.y * 2).rounded())
            ctx.draw(image, in: CGRect(x: -CGFloat(x), y: -CGFloat(image.height - 1 - y),
                                       width: CGFloat(image.width), height: CGFloat(image.height)))
        }
        return (Double(px[0]) / 255, Double(px[1]) / 255, Double(px[2]) / 255, Double(px[3]) / 255)
    }

    @MainActor
    func testTheEnclosureIsDrawnInFullColourAndSurvivesMono() throws {
        let top = DialFrames.radii(depth: 0)
        // Mid-span on the outer outline, where nothing else on the face is drawn.
        let onOutline = DialGeometry.point(cx: DialSpec.cx, cy: DialSpec.cy, r: top.outer, minutes: 950)
        let offSpan = DialGeometry.point(cx: DialSpec.cx, cy: DialSpec.cy, r: top.outer, minutes: 700)

        let color = try render(input(frames: admin), mono: false)
        let lit = rgba(color, at: onOutline), dark = rgba(color, at: offSpan)
        XCTAssertGreaterThan(lit.r + lit.g + lit.b, dark.r + dark.g + dark.b + 0.3, "the outline is visible over the background")

        let mono = try render(input(frames: admin), mono: true)
        XCTAssertGreaterThan(rgba(mono, at: onOutline).a, 0.3, "the mono outline keeps its alpha on a tinted Home Screen")
        XCTAssertLessThan(rgba(mono, at: offSpan).a, 0.05)
    }
}
