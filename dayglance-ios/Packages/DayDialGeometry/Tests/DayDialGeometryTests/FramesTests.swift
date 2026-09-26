import XCTest
@testable import DayDialGeometry

// Frames on the dial (docs/day-dial-frames-spec.html) against the shared
// vectors: the softened mute, the enclosure radii, the hub's current frame
// and the time still available in it. Hex strings exact; radii at 1e-9.
final class FramesTests: XCTestCase {

    private static var fixture: [String: Any] = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("TestFixtures/dayDial.vectors.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            fatalError("Could not load the vector fixture at \(url.path). Run `npm run ios:vectors` from the repo root.")
        }
        return json
    }()

    private func cases(_ function: String) -> [[String: Any]] {
        let geometry = Self.fixture["geometry"] as? [String: Any]
        let list = (geometry?[function] as? [String: Any])?["cases"] as? [[String: Any]]
        XCTAssertNotNil(list, "geometry.\(function) missing from the fixture")
        return list ?? []
    }

    private func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? .nan }
    private func dict(_ v: Any?) -> [String: Any] { v as? [String: Any] ?? [:] }

    func testTheFrameMuteMatchesEveryCase() {
        let list = cases("muteDialFrameColor")
        XCTAssertGreaterThanOrEqual(list.count, 13)
        for c in list {
            let input = dict(c["input"])["hex"] as? String
            let want = dict(c["expected"])["hex"] as? String ?? ""
            XCTAssertEqual(WidgetDialPalette.muteFrame(hex: input), want, "muteFrame(\(input ?? "null"))")
        }
    }

    func testTheRingIsSofterThanTheTitle() {
        XCTAssertNotEqual(WidgetDialPalette.muteFrame(hex: "#f43f5e"), WidgetDialPalette.mute(hex: "#f43f5e"))
        // The standard mute is the parameterised one at its own constants.
        for hex in ["#3b82f6", "#ef4444", "#22c55e"] {
            XCTAssertEqual(WidgetDialPalette.mute(hex: hex, saturationCap: 0.5, lightness: 0.73), WidgetDialPalette.mute(hex: hex))
        }
    }

    func testRadiiMatchEveryCase() {
        let list = cases("dialFrameRadii")
        XCTAssertEqual(list.count, 6)
        for c in list {
            let i = dict(c["input"]), e = dict(c["expected"])
            let r = DialFrames.radii(bandInner: num(i["rInner"]), bandOuter: num(i["rOuter"]), depth: Int(num(i["depth"])))
            XCTAssertEqual(r.inner, num(e["inner"]), accuracy: 1e-9)
            XCTAssertEqual(r.outer, num(e["outer"]), accuracy: 1e-9)
            XCTAssertEqual(r.width, num(e["width"]), accuracy: 1e-9)
        }
    }

    func testTheWidgetBandIsTheSpec() {
        let top = DialFrames.radii(depth: 0)
        XCTAssertEqual(top.inner, 126, accuracy: 1e-9)
        XCTAssertEqual(top.outer, 153, accuracy: 1e-9)
        XCTAssertEqual(top.width, 1.2, accuracy: 1e-9)
        XCTAssertEqual(DialFrames.radii(depth: 5), DialFrames.radii(depth: 1), "depth is capped")
    }

    func testCurrentFrameMatchesEveryCase() {
        for c in cases("dialCurrentFrame") {
            let i = dict(c["input"])
            let frames = (i["frames"] as? [[String: Any]] ?? []).map {
                DialFrame(name: $0["name"] as? String ?? "", colorHex: nil, startMin: num($0["startMin"]),
                          endMin: num($0["endMin"]), depth: Int(num($0["depth"])))
            }
            let nowMin = num(i["nowMin"])
            let want = dict(c["expected"])["name"] as? String
            XCTAssertEqual(DialFrames.current(frames, nowMin: nowMin)?.name, want, "now \(nowMin)")
        }
    }

    func testAvailableMinutesMatchEveryCase() {
        for c in cases("dialFrameAvailableMinutes") {
            let i = dict(c["input"])
            let slots = (i["slots"] as? [[NSNumber]] ?? []).map {
                DialFrameSlot(startMin: $0[0].doubleValue, endMin: $0[1].doubleValue)
            }
            let frame = DialFrame(name: "", colorHex: nil, startMin: 0, endMin: 1440, slots: slots)
            let nowMin = num(i["nowMin"])
            XCTAssertEqual(DialFrames.availableMinutes(frame, nowMin: nowMin), num(dict(c["expected"])["minutes"]), "now \(nowMin)")
        }
    }

    func testAShortFrameIsNotDrawn() {
        XCTAssertFalse(DialFrames.drawn(DialFrame(name: "", colorHex: nil, startMin: 600, endMin: 609)))
        XCTAssertTrue(DialFrames.drawn(DialFrame(name: "", colorHex: nil, startMin: 600, endMin: 610)))
    }
}
