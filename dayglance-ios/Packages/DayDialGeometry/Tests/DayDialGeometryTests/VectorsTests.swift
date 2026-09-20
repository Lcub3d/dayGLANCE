import XCTest
@testable import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// The drift test: every geometry case in dayglance-ios/TestFixtures/
// dayDial.vectors.json, evaluated through this port and compared to what
// src/utils/dayDial.js produced. The fixture is the contract between the two
// implementations; dayDialVectors.test.js keeps it current with the JS, and
// this file keeps the Swift current with the fixture.
//
// TOLERANCES, chosen per quantity rather than one number wide enough to pass:
//
//   radians      1e-12 abs. `(min / 1440) * 2 * π` is evaluated in the same
//                order on both sides, so the results are bit-identical; the
//                allowance is four orders above an ulp at 2π (≈ 9e-16) and
//                exists only so a platform that reassociated the product
//                would still pass while a wrong formula (off by a minute is
//                4e-3 rad) would not.
//   coordinates  1e-9 abs. sin/cos come from two libms (V8's fdlibm port and
//                Apple's), which agree to within a few ulp; at radius 500
//                that is ~1e-13. 1e-9 leaves four orders of margin and is six
//                orders below anything geometric (a one-minute error at
//                r = 385 moves a point 1.7 units).
//   path numbers 5e-4 + 1e-9 abs. The JS rounds path coordinates to three
//                decimals (`fmt`); the port keeps them unrounded and the
//                comparison allows exactly the half-unit that rounding can
//                move a value, plus the trig allowance. Tighter than
//                comparing two rounded values (which needs a full 1e-3 to
//                survive a rounding-boundary flip) and still catches any real
//                difference.
//   lane bands, moon rx  1e-12 abs. Both sides round to three decimals the
//                same way, so equality is expected; the allowance is for the
//                division that follows the rounding.
//   minutes, lanes, flags, sweeps  exact.
//
// The sky section is CONSUMED by the widget, not re-solved (handoff §4); the
// port decodes it and checks the shape it will draw from. `muteDialColor`
// and `dialIntensity` are held to the fixture in PaletteTests.swift; the
// keyboard selection walk is web UI and is only asserted to still be present.
// ─────────────────────────────────────────────────────────────────────────────

final class VectorsTests: XCTestCase {

    // MARK: fixture

    private static var fixture: [String: Any] = {
        // …/dayglance-ios/Packages/DayDialGeometry/Tests/DayDialGeometryTests/VectorsTests.swift
        // → …/dayglance-ios/TestFixtures/dayDial.vectors.json. Five hops: the
        // first drops the file name, the next four the directories up to and
        // including Packages.
        let here = URL(fileURLWithPath: #filePath)
        let url = here
            .deletingLastPathComponent()  // → DayDialGeometryTests/
            .deletingLastPathComponent()  // → Tests/
            .deletingLastPathComponent()  // → DayDialGeometry/
            .deletingLastPathComponent()  // → Packages/
            .deletingLastPathComponent()  // → dayglance-ios/
            .appendingPathComponent("TestFixtures/dayDial.vectors.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            fatalError("Could not load the vector fixture at \(url.path). Run `npm run ios:vectors` from the repo root.")
        }
        return json
    }()

    private static let radiansTolerance = 1e-12
    private static let coordinateTolerance = 1e-9
    private static let pathNumberTolerance = 5e-4 + 1e-9
    private static let roundedTolerance = 1e-12

    private func section(_ name: String) -> [String: Any] {
        Self.fixture[name] as? [String: Any] ?? [:]
    }

    private func cases(_ sectionName: String, _ function: String) -> [[String: Any]] {
        let f = section(sectionName)[function] as? [String: Any]
        let list = f?["cases"] as? [[String: Any]]
        XCTAssertNotNil(list, "\(sectionName).\(function) missing from the fixture")
        return list ?? []
    }

    // JSON helpers: numbers arrive as NSNumber, ids as number OR string.
    private func num(_ v: Any?) -> Double {
        if let n = v as? NSNumber { return n.doubleValue }
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        XCTFail("expected a number, got \(String(describing: v))")
        return .nan
    }
    private func optNum(_ v: Any?) -> Double? {
        if v == nil || v is NSNull { return nil }
        return num(v)
    }
    private func bool(_ v: Any?, default d: Bool = false) -> Bool {
        if let b = v as? Bool { return b }
        if let n = v as? NSNumber { return n.boolValue }
        return d
    }
    /// JS ids are numbers or strings; both compare as their JS string form.
    private func id(_ v: Any?) -> String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber {
            let d = n.doubleValue
            return d == d.rounded() ? String(Int64(d)) : String(d)
        }
        return String(describing: v ?? "nil")
    }
    private func dict(_ v: Any?) -> [String: Any] { v as? [String: Any] ?? [:] }
    private func list(_ v: Any?) -> [Any] { v as? [Any] ?? [] }

    private func spanInput(_ t: [String: Any]) -> DialSpanInput {
        DialSpanInput(
            id: id(t["id"]),
            startMinutes: DialSpanInput.minutes(fromClock: t["startTime"] as? String),
            durationMinutes: Int(optNum(t["duration"]) ?? 0),
            isAllDay: bool(t["isAllDay"])
        )
    }

    // MARK: the fixture itself

    func testFixtureIsTheFormatThisPortWasWrittenAgainst() {
        XCTAssertEqual(Self.fixture["format"] as? String, "dayDial.vectors/1")
        XCTAssertEqual(num(Self.fixture["dayMinutes"]), DialGeometry.dayMinutes)
        let counts = dict(Self.fixture["counts"])
        XCTAssertEqual(Int(num(counts["geometry"])), 177)
        XCTAssertEqual(Int(num(counts["sky"])), 16)
        XCTAssertEqual(Int(num(counts["snapshot"])), 2)
    }

    func testEveryGeometryFunctionInTheFixtureIsAccountedFor() {
        let ported: Set<String> = ["dialAngle", "dialPoint", "dialArcPath", "dialSectorPath", "dialTicks",
                                   "padDialSegment", "dialLaneBand", "assignDialLanes", "computeDialModel",
                                   "computeDialRoutines", "moonPhasePath", "findDialFocusBlock",
                                   // Phase 2, PaletteTests.swift.
                                   "muteDialColor", "dialIntensity"]
        // The keyboard selection walk is web accessibility UI with no widget analogue.
        let deferred: Set<String> = ["dialSelection"]
        let present = Set(section("geometry").keys)
        XCTAssertEqual(present, ported.union(deferred),
                       "a geometry function was added to or removed from the fixture; port it or list it here")
    }

    // MARK: dialAngle / dialPoint

    func testDialAngle() {
        for c in cases("geometry", "dialAngle") {
            let min = num(dict(c["input"])["min"])
            XCTAssertEqual(DialGeometry.angle(minutes: min), num(dict(c["expected"])["radians"]),
                           accuracy: Self.radiansTolerance, "min \(min)")
        }
    }

    func testDialPoint() {
        for c in cases("geometry", "dialPoint") {
            let i = dict(c["input"]), e = dict(c["expected"])
            let p = DialGeometry.point(cx: num(i["cx"]), cy: num(i["cy"]), r: num(i["r"]), minutes: num(i["min"]))
            XCTAssertEqual(p.x, num(e["x"]), accuracy: Self.coordinateTolerance, "x for \(i)")
            XCTAssertEqual(p.y, num(e["y"]), accuracy: Self.coordinateTolerance, "y for \(i)")
        }
    }

    // MARK: arcs and sectors

    func testDialArcPath() {
        for c in cases("geometry", "dialArcPath") {
            let i = dict(c["input"]), e = dict(c["expected"])
            let arc = DialGeometry.arc(cx: num(i["cx"]), cy: num(i["cy"]), r: num(i["r"]),
                                       startMin: num(i["startMin"]), endMin: num(i["endMin"]))
            assertNumbers(arc.numbers, list(e["numbers"]).map(num), "arc \(i)")
            XCTAssertEqual(arc.svgPathData, e["d"] as? String, "svg parity for \(i)")
        }
    }

    func testDialSectorPath() {
        for c in cases("geometry", "dialSectorPath") {
            let i = dict(c["input"]), e = dict(c["expected"])
            let s = DialGeometry.sector(cx: num(i["cx"]), cy: num(i["cy"]), rInner: num(i["rInner"]), rOuter: num(i["rOuter"]),
                                        startMin: num(i["startMin"]), endMin: num(i["endMin"]))
            assertNumbers(s.numbers, list(e["numbers"]).map(num), "sector \(i)")
            XCTAssertEqual(s.svgPathData, e["d"] as? String, "svg parity for \(i)")
        }
    }

    private func assertNumbers(_ got: [Double], _ want: [Double], _ label: String) {
        XCTAssertEqual(got.count, want.count, "token count, \(label)")
        for (k, (g, w)) in zip(got, want).enumerated() {
            // Coordinates were rounded to 3 dp on the JS side only; radii and
            // flags are exact integers on both sides and pass at any tolerance.
            XCTAssertEqual(g, w, accuracy: Self.pathNumberTolerance, "token \(k), \(label)")
        }
    }

    // MARK: ticks

    func testDialTicksMatchTheWebSchedule() {
        let expected = list(cases("geometry", "dialTicks").first?["expected"]).map(dict)
        let got = DialTicks.schedule()
        XCTAssertEqual(got.count, expected.count)
        for (g, e) in zip(got, expected) {
            XCTAssertEqual(g.minutes, Int(num(e["min"])))
            XCTAssertEqual(g.kind.rawValue, e["kind"] as? String)
        }
    }

    func testSpecTicksAreTheFifteenMinuteSchedule() {
        let t = DialSpec.ticks
        XCTAssertEqual(t.count, 96)
        XCTAssertEqual(t.filter { $0.kind == .hour }.count, 24)
        XCTAssertEqual(t.filter { $0.kind == .quarter }.count, 72)
        XCTAssertTrue(t.allSatisfy { $0.kind != .minor })
        // Minor ticks in the spec sit at 3.75° steps: 15 minutes.
        XCTAssertEqual(t[1].minutes, 15)
    }

    // MARK: padding and lanes

    func testPadDialSegment() {
        for c in cases("geometry", "padDialSegment") {
            let i = dict(c["input"]), e = list(c["expected"]).map(num)
            let r: (start: Double, end: Double)
            if let gap = optNum(i["gapMin"]) {
                r = DialSegments.pad(startMin: num(i["startMin"]), endMin: num(i["endMin"]), gapMin: gap,
                                     padStart: bool(i["padStart"], default: true), padEnd: bool(i["padEnd"], default: true))
            } else {
                r = DialSegments.pad(startMin: num(i["startMin"]), endMin: num(i["endMin"]))
            }
            XCTAssertEqual(r.start, e[0], accuracy: Self.roundedTolerance, "\(i)")
            XCTAssertEqual(r.end, e[1], accuracy: Self.roundedTolerance, "\(i)")
        }
    }

    func testDialLaneBand() {
        XCTAssertEqual(DialSegments.laneGap, 6)
        for c in cases("geometry", "dialLaneBand") {
            let i = dict(c["input"]), e = dict(c["expected"])
            let b = DialSegments.laneBand(rInner: num(i["rInner"]), rOuter: num(i["rOuter"]),
                                          lane: Int(num(i["lane"])), laneCount: Int(num(i["laneCount"])))
            XCTAssertEqual(b.rInner, num(e["rInner"]), accuracy: Self.roundedTolerance, "\(i)")
            XCTAssertEqual(b.rOuter, num(e["rOuter"]), accuracy: Self.roundedTolerance, "\(i)")
        }
    }

    func testAssignDialLanes() {
        for c in cases("geometry", "assignDialLanes") {
            let blocks = list(dict(c["input"])["blocks"]).map(dict)
            let expected = list(c["expected"]).map(dict)
            let got = IntervalLanes.assign(blocks.map { LaneSpan(startMin: num($0["startMin"]), endMin: num($0["endMin"])) })
            XCTAssertEqual(got.count, expected.count)
            for (g, e) in zip(got, expected) {
                XCTAssertEqual(g.lane, Int(num(e["lane"])), "lane of \(id(e["id"]))")
                XCTAssertEqual(g.laneCount, Int(num(e["laneCount"])), "laneCount of \(id(e["id"]))")
            }
        }
    }

    // MARK: block span resolution + day window

    func testComputeDialModelGeometry() {
        for c in cases("geometry", "computeDialModel") {
            let name = c["name"] as? String ?? "?"
            let i = dict(c["input"]), e = dict(c["expected"])
            var window: DialDayWindow? = nil
            if let w = i["dayWindow"] as? [String: Any] {
                window = DialDayWindow(startMinutes: DialSpanInput.minutes(fromClock: w["start"] as? String),
                                       stopMinutes: DialSpanInput.minutes(fromClock: w["stop"] as? String))
            }
            let model = DialModel.resolve(
                dayTasks: list(i["dayTasks"]).map(dict).map(spanInput),
                prevDayTasks: list(i["prevDayTasks"]).map(dict).map(spanInput),
                window: window
            )
            assertBlocks(model.blocks, list(e["blocks"]).map(dict), name)

            let sleep = list(e["sleep"]).map(dict)
            XCTAssertEqual(model.sleep.count, sleep.count, "sleep segments, \(name)")
            for (g, w) in zip(model.sleep, sleep) {
                XCTAssertEqual(g.startMin, num(w["startMin"]), "sleep start, \(name)")
                XCTAssertEqual(g.endMin, num(w["endMin"]), "sleep end, \(name)")
            }
            XCTAssertEqual(model.sleepMinutes.map { Double($0) }, optNum(e["sleepMinutes"]), "sleepMinutes, \(name)")
        }
    }

    func testComputeDialRoutines() {
        for c in cases("geometry", "computeDialRoutines") {
            let i = dict(c["input"])
            let bars = DialModel.routineBars(list(i["routines"]).map(dict).map(spanInput))
            assertBlocks(bars, list(c["expected"]).map(dict), "routines")
        }
    }

    /// The geometric fields of a ring block. The JS objects also carry kind,
    /// title, colour, completion and completability — data the snapshot
    /// ships, not geometry the port derives — and those are not compared.
    private func assertBlocks(_ got: [DialRingBlock], _ want: [[String: Any]], _ label: String) {
        XCTAssertEqual(got.count, want.count, "block count, \(label)")
        for (g, w) in zip(got, want) {
            let who = "\(label) / \(id(w["id"]))"
            XCTAssertEqual(g.id, id(w["id"]), "id order, \(label)")
            XCTAssertEqual(g.startMin, num(w["startMin"]), "startMin, \(who)")
            XCTAssertEqual(g.endMin, num(w["endMin"]), "endMin, \(who)")
            XCTAssertEqual(g.endsNextDay, bool(w["endsNextDay"]), "endsNextDay, \(who)")
            XCTAssertEqual(g.endMinTrue, optNum(w["endMinTrue"]), "endMinTrue, \(who)")
            XCTAssertEqual(g.startedPrevDay, bool(w["startedPrevDay"]), "startedPrevDay, \(who)")
            XCTAssertEqual(g.startMinTrue, optNum(w["startMinTrue"]), "startMinTrue, \(who)")
            XCTAssertEqual(g.lane, Int(num(w["lane"])), "lane, \(who)")
            XCTAssertEqual(g.laneCount, Int(num(w["laneCount"])), "laneCount, \(who)")
        }
    }

    // MARK: focus block

    func testFindDialFocusBlock() {
        for c in cases("geometry", "findDialFocusBlock") {
            let i = dict(c["input"])
            let blocks = list(i["blocks"]).map(dict).map { b in
                DialRingBlock(id: id(b["id"]), startMin: num(b["startMin"]), endMin: num(b["endMin"]),
                              endsNextDay: bool(b["endsNextDay"]), endMinTrue: optNum(b["endMinTrue"]),
                              startedPrevDay: bool(b["startedPrevDay"]), startMinTrue: optNum(b["startMinTrue"]),
                              lane: Int(num(b["lane"])), laneCount: Int(num(b["laneCount"])))
            }
            let nowMin = num(i["nowMin"])
            let got = DialModel.focusBlock(in: blocks, nowMin: nowMin)
            if c["expected"] == nil || c["expected"] is NSNull {
                XCTAssertNil(got, "nowMin \(nowMin) should have no focus block")
            } else {
                let e = dict(c["expected"])
                XCTAssertNotNil(got, "nowMin \(nowMin)")
                XCTAssertEqual(got.map { blocks[$0.index].id }, id(dict(e["block"])["id"]), "nowMin \(nowMin)")
                XCTAssertEqual(got?.current, bool(e["current"]), "current at \(nowMin)")
            }
        }
    }

    // MARK: moon phase

    func testMoonPhasePath() {
        for c in cases("geometry", "moonPhasePath") {
            let i = dict(c["input"]), e = dict(c["expected"])
            let m = MoonPhase.geometry(r: num(i["r"]), fraction: num(i["fraction"]), waxing: bool(i["waxing"]), mirror: bool(i["mirror"]))
            XCTAssertEqual(m.limbSweep, Int(num(e["limbSweep"])), "\(i)")
            XCTAssertEqual(m.terminatorSweep, Int(num(e["terminatorSweep"])), "\(i)")
            XCTAssertEqual(m.terminatorRx, num(e["terminatorRx"]), accuracy: Self.roundedTolerance, "\(i)")
            XCTAssertEqual(m.svgPathData, e["d"] as? String, "svg parity for \(i)")
        }
    }

    // MARK: the sky section — consumed, not re-solved

    func testSkySnapshotShapeIsWhatTheRingDrawsFrom() {
        let skyCases = cases("sky", "computeSkySnapshot")
        XCTAssertEqual(skyCases.count, 6)
        for c in skyCases {
            let e = c["expected"]
            let site = dict(c["input"])["site"] as? String ?? "?"
            if e == nil || e is NSNull {
                XCTAssertEqual(site, "nowhere", "only the coordinate-less case ships no sky")
                continue
            }
            let sky = dict(e)
            let hours = list(sky["hours"]).map(dict)
            XCTAssertEqual(hours.count, 24, site)
            let segments = DialSpec.skySegments(hours: hours.map { (sun: optNum($0["sun"]), moon: optNum($0["moon"])) })
            XCTAssertEqual(segments.count, 24, site)
            for s in segments {
                XCTAssertEqual(s.startMin, Double(s.hour * 60))
                XCTAssertEqual(s.endMin, Double(s.hour * 60 + 60))
                XCTAssertTrue((0...1).contains(s.strength), "\(site) hour \(s.hour) strength \(s.strength)")
                // The spec's ranges: sun 0.10–0.76, moon 0.09–0.61.
                switch s.body {
                case .sun: XCTAssertTrue((0.10...0.76).contains(s.opacity), "\(site) hour \(s.hour)")
                case .moon: XCTAssertTrue((0.09...0.61).contains(s.opacity), "\(site) hour \(s.hour)")
                }
            }
            // A polar day/night carries a flag and no rise/set minute; an
            // ordinary day has both inside the revolution and rise before set.
            if let polar = sky["polar"] as? String {
                XCTAssertTrue(polar == "day" || polar == "night", site)
                XCTAssertNil(optNum(sky["sunriseMin"]), site)
            } else {
                let rise = num(sky["sunriseMin"]), set = num(sky["sunsetMin"])
                XCTAssertTrue(rise >= 0 && set <= 1440 && rise < set, "\(site): \(rise)–\(set)")
                // The glyph angles are just the angle map.
                XCTAssertEqual(DialGeometry.angle(minutes: rise), (rise / 1440) * 2 * Double.pi, accuracy: Self.radiansTolerance)
            }
            let moon = dict(sky["moon"])
            XCTAssertTrue((0...1).contains(num(moon["fraction"])), site)
        }
    }

    func testSkyOpacityFormulaeAreTheSpecs() {
        XCTAssertEqual(DialSpec.skyOpacity(body: .sun, strength: 0), 0.10, accuracy: 1e-12)
        XCTAssertEqual(DialSpec.skyOpacity(body: .sun, strength: 1), 0.76, accuracy: 1e-12)
        XCTAssertEqual(DialSpec.skyOpacity(body: .moon, strength: 0), 0.09, accuracy: 1e-12)
        XCTAssertEqual(DialSpec.skyOpacity(body: .moon, strength: 1), 0.61, accuracy: 1e-12)
        // Sun wins a tie, per the spec's `sv >= mv`.
        XCTAssertEqual(DialSpec.skySegments(hours: [(sun: 0.3, moon: 0.3)]).first?.body, DialSpec.SkySegment.Body.sun)
        XCTAssertEqual(DialSpec.skySegments(hours: [(sun: 0.2, moon: 0.3)]).first?.body, DialSpec.SkySegment.Body.moon)
        XCTAssertEqual(DialSpec.skySegments(hours: [(sun: nil, moon: nil)]).first?.opacity, 0.10)
    }

    // MARK: the snapshot section — the wire shape the widget receives

    func testProjectedSnapshotBlocksResolveOnTheRing() {
        // The `dial` field is already projected; the ring only has to place
        // its spans. Here the dense day's blocks are re-laned from their
        // spans and must agree with the lanes the JS assigned.
        for c in cases("snapshot", "projectDialSnapshot") {
            let blocks = list(dict(c["expected"])["blocks"]).map(dict)
            let nonSleep = blocks.filter { ($0["type"] as? String) != "sleep" && ($0["type"] as? String) != "routine" }
            let spans = nonSleep.map { LaneSpan(startMin: num($0["startMin"]), endMin: num($0["startMin"]) + num($0["durationMin"])) }
            let lanes = IntervalLanes.assign(spans)
            for (b, l) in zip(nonSleep, lanes) {
                XCTAssertEqual(l.lane, Int(num(b["lane"])), "lane of \(id(b["id"]))")
                XCTAssertEqual(l.laneCount, Int(num(b["laneCount"])), "laneCount of \(id(b["id"]))")
            }
        }
    }

    // MARK: spec constants

    func testSpecConstantsMatchTheHandoff() {
        XCTAssertEqual(DialSpec.cx, 182); XCTAssertEqual(DialSpec.cy, 189)
        XCTAssertEqual(DialSpec.skyRadius, 119); XCTAssertEqual(DialSpec.skyWidth, 6)
        XCTAssertEqual(DialSpec.blockRadius, 140); XCTAssertEqual(DialSpec.blockWidth, 22)
        XCTAssertEqual(DialSpec.blockInnerRadius, 129); XCTAssertEqual(DialSpec.blockOuterRadius, 151)
        XCTAssertEqual(DialSpec.tickInnerRadius, 155); XCTAssertEqual(DialSpec.tickOuterRadius, 166); XCTAssertEqual(DialSpec.tickMinorRadius, 161)
        XCTAssertEqual(DialSpec.labelCardinalRadius, 172); XCTAssertEqual(DialSpec.labelDiagonalRadius, 181)
        XCTAssertEqual(DialSpec.glyphRadius, 104)
        XCTAssertEqual(DialSpec.needleInnerRadius, 126); XCTAssertEqual(DialSpec.needleOuterRadius, 159)
        XCTAssertEqual(DialSpec.separatorLineWidth, 1.6)
        XCTAssertEqual(DialSpec.hubRuleY, 189)
        XCTAssertEqual(DialSpec.hourLabels.map(\.text), ["00", "03", "09", "12", "15", "21"])
        // The needle's inner end clears the sky ring's outer edge by 4pt.
        XCTAssertEqual(DialSpec.needleInnerRadius - (DialSpec.skyRadius + DialSpec.skyWidth / 2), 4)
        // Label 00 sits straight up from the centre at its radius.
        let top = DialSpec.labelPoint(DialSpec.hourLabels[0])
        XCTAssertEqual(top.x, 182, accuracy: 1e-9); XCTAssertEqual(top.y, 189 - 172, accuracy: 1e-9)
    }

    func testSeparatorsOnlyWhereBlocksTouch() {
        let mk = { (id: String, s: Double, e: Double) in
            DialRingBlock(id: id, startMin: s, endMin: e, endsNextDay: false, endMinTrue: nil,
                          startedPrevDay: false, startMinTrue: nil, lane: 0, laneCount: 1)
        }
        // The spec's dense day: 385–420 touches 420? no (435 next); 480–540–600 touch.
        let blocks = [mk("a", 385, 420), mk("b", 435, 480), mk("c", 480, 540), mk("d", 540, 600), mk("e", 601, 660)]
        XCTAssertEqual(DialSpec.separatorMinutes(blocks: blocks), [480, 540])
    }
}
