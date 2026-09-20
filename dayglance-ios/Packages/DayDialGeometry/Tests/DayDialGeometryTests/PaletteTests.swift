import XCTest
@testable import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// The palette (Phase 2): muteDialColor and dialIntensity against the fixture,
// the variant C band treatment against the numbers in
// docs/day-dial-palette-study.html, DayDial.jsx's state multipliers, the
// projected-day rule on both paths, and the cache bucket.
//
// Tolerances: hex strings and the multipliers are exact. dialIntensity is
// rounded to three decimals on both sides the same way (JSNumber.round3 is
// `Number(n.toFixed(3))` for these inputs), so 1e-12 as for the other
// rounded values. Variant C's products are compared at 1e-12: the formulae
// are evaluated in the study's order on both sides.
// ─────────────────────────────────────────────────────────────────────────────

final class PaletteTests: XCTestCase {

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

    private let palette = WidgetDialPalette()

    // MARK: muteDialColor

    func testMuteMatchesEveryFixtureCase() {
        let list = cases("muteDialColor")
        XCTAssertGreaterThanOrEqual(list.count, 26)
        for c in list {
            let input = (c["input"] as? [String: Any])?["hex"] as? String   // nil for the JSON null
            let want = ((c["expected"] as? [String: Any])?["hex"] as? String) ?? ""
            XCTAssertEqual(palette.mute(hex: input), want, "mute(\(input ?? "null"))")
        }
    }

    /// The study's swatch table, "Drawn (muted)" column: the ten Tailwind
    /// hexes the task palette stores, through the app's own pipeline.
    func testTheTenTailwindHexesMuteToTheStudySwatches() {
        let table: [(String, String, String)] = [
            ("blue-500 (default)", "#3b82f6", "#98b2dd"),
            ("blue-600 (ICS default)", "#2563eb", "#98addd"),
            ("red-500 (Todoist)", "#ef4444", "#dd9898"),
            ("green-500", "#22c55e", "#98ddb1"),
            ("purple-500", "#a855f7", "#bb98dd"),
            ("yellow-500", "#eab308", "#ddcc98"),
            ("pink-500", "#ec4899", "#dd98ba"),
            ("indigo-500", "#6366f1", "#9899dd"),
            ("orange-500", "#f97316", "#ddb498"),
            ("teal-500", "#14b8a6", "#98ddd5"),
        ]
        for (name, stored, drawn) in table {
            XCTAssertEqual(WidgetDialPalette.mute(hex: stored), drawn, name)
        }
        // Routine and sleep are fixed, not muted (the table's last two rows).
        XCTAssertEqual(DialBand.routineColorHex, "#5eead4")
        XCTAssertEqual(DialBand.sleepColorHex, "#c4b5fd")
        XCTAssertEqual(DialBand.colorHex(for: DialFaceBlock(id: "r", kind: .routine, startMin: 0, endMin: 15)), "#5eead4")
        XCTAssertEqual(DialBand.colorHex(for: DialFaceBlock(id: "s", kind: .sleep, startMin: 0, endMin: 385)), "#c4b5fd")
    }

    func testMuteFallsBackRawOnJunk() {
        // dayDial.js returns DIAL_COLORS.effort itself, unmuted.
        XCTAssertEqual(WidgetDialPalette.fallbackHex, "#93c5fd")
        for junk: String? in [nil, "", "#abc", "not-a-color", "3b82f6", "#3B82F", "#3b82f6ff"] {
            XCTAssertEqual(WidgetDialPalette.mute(hex: junk), "#93c5fd", "\(junk ?? "nil")")
        }
        // Upper case is a colour (the JS regex is /i).
        XCTAssertEqual(WidgetDialPalette.mute(hex: "#3B82F6"), "#98b2dd")
        // A task with no colour draws in the fallback, muted-family or not.
        XCTAssertEqual(DialBand.colorHex(for: DialFaceBlock(id: "t", kind: .task, startMin: 0, endMin: 60)), "#93c5fd")
    }

    // MARK: dialIntensity (the web curve)

    func testWebIntensityMatchesEveryFixtureCase() {
        let list = cases("dialIntensity")
        XCTAssertEqual(list.count, 12)
        for c in list {
            let d = ((c["input"] as? [String: Any])?["durationMin"] as? NSNumber)?.doubleValue ?? -1
            let e = c["expected"] as? [String: Any] ?? [:]
            let got = palette.intensity(durationMinutes: d)
            XCTAssertEqual(got.fillOpacity, (e["fillOpacity"] as? NSNumber)?.doubleValue ?? -1, accuracy: 1e-12, "fill @\(d)")
            XCTAssertEqual(got.edgeOpacity, (e["edgeOpacity"] as? NSNumber)?.doubleValue ?? -1, accuracy: 1e-12, "edge @\(d)")
            XCTAssertEqual(got.edgeWidth, (e["edgeWidth"] as? NSNumber)?.doubleValue ?? -1, accuracy: 1e-12, "width @\(d)")
        }
    }

    /// The fixture's 45-minute case caught this: 0.05 + 0.25 × 0.11 is the
    /// double 0.07749999…, which toFixed(3) prints as 0.077 while rounding
    /// the product 77.5 gives 0.078. `fmt` is toFixed, so the port is too.
    func testToFixedRoundsTheExactBinaryValueNotTheProduct() {
        XCTAssertEqual(JSNumber.toFixed3(0.0775), 0.077)
        XCTAssertEqual(JSNumber.round3(0.0775), 0.078)
        XCTAssertEqual(JSNumber.toFixed3(0.05 + 0.25 * 0.11), 0.077)
        // An exact binary tie (an odd sixteenth) goes away from zero, as JS.
        XCTAssertEqual(JSNumber.toFixed3(0.0625), 0.063)
        XCTAssertEqual(JSNumber.toFixed3(2.0625), 2.063)
        XCTAssertEqual(JSNumber.toFixed3(-2.0625), -2.063)
        XCTAssertEqual(JSNumber.toFixed3(1.0005), 1.0)   // 1.0005 is below the tie in binary
        XCTAssertEqual(JSNumber.toFixed3(0.5), 0.5)
        XCTAssertEqual(JSNumber.toFixed3(1), 1)
    }

    // MARK: variant C

    func testVariantCNumbersAreTheStudys() {
        // "Fill 0.18–0.56 (× 3.5) · rim 1.5–2.5pt"; rim opacity 0.45–1.0.
        XCTAssertEqual(DialBandTreatment.fillOpacity(t: 0, stateFill: 1), 0.175, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.fillOpacity(t: 1, stateFill: 1), 0.56, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.fillOpacity(t: 0.5, stateFill: 1), 0.3675, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.rimWidth(t: 0), 1.5, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.rimWidth(t: 1), 2.5, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.rimWidth(t: 0.6), 2.1, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.rimOpacity(t: 0, stateEdge: 1), 0.45, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.rimOpacity(t: 1, stateEdge: 1), 1, accuracy: 1e-12)
        XCTAssertEqual(DialBandTreatment.rimOpacity(t: 1, stateEdge: 0.25), 0.25, accuracy: 1e-12)
        // Both opacities clamp at 1; the fill never reaches it under these multipliers.
        XCTAssertEqual(DialBandTreatment.fillOpacity(t: 1, stateFill: 3), 1)
        XCTAssertEqual(DialBandTreatment.rimOpacity(t: 1, stateEdge: 2), 1)
        // t saturates at 180 minutes and floors at 0.
        XCTAssertEqual(WidgetDialPalette.t(durationMinutes: 600), 1)
        XCTAssertEqual(WidgetDialPalette.t(durationMinutes: 90), 0.5)
        XCTAssertEqual(WidgetDialPalette.t(durationMinutes: -5), 0)
    }

    func testAStyledBlockCarriesTheStudysGeometryAndWeights() {
        // The study's 10:00–12:30 focus block (150 min, t = 5/6), future.
        let b = DialFaceBlock(id: "5", kind: .task, startMin: 600, endMin: 750, colorHex: "#3b82f6")
        let s = DialBand.style(b, nowMin: 680, projectedDay: false)
        let t = 150.0 / 180.0
        XCTAssertEqual(s.colorHex, "#98b2dd")
        XCTAssertEqual(s.rInner, 129); XCTAssertEqual(s.rOuter, 151)
        XCTAssertEqual(s.fillOpacity, (0.05 + 0.11 * t) * 3.5, accuracy: 1e-12)
        XCTAssertEqual(s.rimWidth, 1.5 + t, accuracy: 1e-12)
        // Rim on the OUTER edge, drawn inside the band.
        XCTAssertEqual(s.rimRadius, 151 - s.rimWidth / 2, accuracy: 1e-12)
        XCTAssertEqual(s.rimOpacity, 0.45 + 0.55 * t, accuracy: 1e-12)
        XCTAssertFalse(s.isPast)
        XCTAssertEqual(s.tone, DialTone(fill: 1, edge: 1))
    }

    func testOverlappingBlocksTakeLaneBandsAsTheAppDoes() {
        let a = DialFaceBlock(id: "a", kind: .task, startMin: 600, endMin: 720, lane: 0, laneCount: 2)
        let b = DialFaceBlock(id: "b", kind: .task, startMin: 630, endMin: 690, lane: 1, laneCount: 2)
        let sa = DialBand.style(a, nowMin: 0, projectedDay: false)
        let sb = DialBand.style(b, nowMin: 0, projectedDay: false)
        let band0 = DialSegments.laneBand(rInner: 129, rOuter: 151, lane: 0, laneCount: 2)
        let band1 = DialSegments.laneBand(rInner: 129, rOuter: 151, lane: 1, laneCount: 2)
        XCTAssertEqual(sa.rInner, band0.rInner); XCTAssertEqual(sa.rOuter, band0.rOuter)
        XCTAssertEqual(sb.rInner, band1.rInner); XCTAssertEqual(sb.rOuter, band1.rOuter)
        XCTAssertLessThan(sa.rOuter, sb.rInner, "lanes do not overlap")
        XCTAssertEqual(sb.rimRadius, band1.rOuter - sb.rimWidth / 2, accuracy: 1e-12)
    }

    // MARK: state multipliers (DayDial.jsx)

    private func tone(_ kind: DialBlockKind, completed: Bool = false, past: Bool, prev: Bool = false, projected: Bool = false) -> DialTone {
        WidgetDialPalette.tone(DialToneInput(kind: kind, completed: completed, past: past, startedPrevDay: prev, projectedDay: projected))
    }

    func testStateMultipliersOnThePushedDay() {
        // future / current 1.0 / 1.0
        XCTAssertEqual(tone(.task, past: false), DialTone(fill: 1, edge: 1))
        XCTAssertEqual(tone(.event, past: false), DialTone(fill: 1, edge: 1))
        // completed 0.6 / 0.25 — read before past, so a block ticked off early is done now
        XCTAssertEqual(tone(.task, completed: true, past: true), DialTone(fill: 0.6, edge: 0.25))
        XCTAssertEqual(tone(.task, completed: true, past: false), DialTone(fill: 0.6, edge: 0.25))
        // past undone 0.35 / 1.0 — the rim stays at full strength over a hollowed fill
        XCTAssertEqual(tone(.task, past: true), DialTone(fill: 0.35, edge: 1))
        // past event 0.6 / 0.6
        XCTAssertEqual(tone(.event, past: true), DialTone(fill: 0.6, edge: 0.6))
        // yesterday's overrun is history the moment it ends, never owed
        XCTAssertEqual(tone(.task, past: true, prev: true), DialTone(fill: 0.6, edge: 0.6))
        XCTAssertEqual(tone(.task, past: false, prev: true), DialTone(fill: 1, edge: 1))
    }

    func testSleepIsContextNotSchedule() {
        XCTAssertEqual(tone(.sleep, past: false), DialTone(fill: 0.6, edge: 0.6))
        let past = tone(.sleep, past: true)
        XCTAssertEqual(past.fill, 0.36, accuracy: 1e-12); XCTAssertEqual(past.edge, 0.36, accuracy: 1e-12)
        // Same on a projected day: sleep carries no completion to misread.
        XCTAssertEqual(tone(.sleep, past: true, projected: true), past)
        XCTAssertEqual(tone(.sleep, past: false, projected: true), DialTone(fill: 0.6, edge: 0.6))
    }

    func testRoutinesAreRimOnly() {
        XCTAssertEqual(tone(.routine, past: false), DialTone(fill: 0, edge: 0.5))
        XCTAssertEqual(tone(.routine, past: true), DialTone(fill: 0, edge: 0.5))       // the app does not dim a routine by time
        XCTAssertEqual(tone(.routine, completed: true, past: false), DialTone(fill: 0, edge: 0.18))
        XCTAssertEqual(tone(.routine, completed: true, past: true), DialTone(fill: 0, edge: 0.18))
        // The style applies a routine's opacity ABSOLUTELY, not through the duration curve.
        let s = DialBand.style(DialFaceBlock(id: "r", kind: .routine, startMin: 385, endMin: 420, completed: true), nowMin: 0, projectedDay: false)
        XCTAssertEqual(s.fillOpacity, 0)
        XCTAssertEqual(s.rimOpacity, 0.18)
        XCTAssertEqual(s.colorHex, "#5eead4")
        XCTAssertEqual(s.rimWidth, 1.5 + 35.0 / 180.0, accuracy: 1e-12)
    }

    // MARK: the projected-day rule

    func testProjectedDayNeverMarksPastWorkAsUndone() {
        // Same block, flags false (as a projected payload always carries them).
        let pushed = tone(.task, completed: false, past: true, projected: false)
        let projected = tone(.task, completed: false, past: true, projected: true)
        XCTAssertEqual(pushed, DialTone(fill: 0.35, edge: 1), "the pushed day reads completion: this one is owed")
        XCTAssertEqual(projected, DialTone(fill: 0.6, edge: 0.6), "the projected day cannot know: it happened")
        // Events and overruns land on the same tone either way.
        XCTAssertEqual(tone(.event, past: true, projected: true), DialTone(fill: 0.6, edge: 0.6))
        XCTAssertEqual(tone(.task, past: true, prev: true, projected: true), DialTone(fill: 0.6, edge: 0.6))
        // Future blocks are untouched by the rule.
        XCTAssertEqual(tone(.task, past: false, projected: true), DialTone(fill: 1, edge: 1))
        // Only the pushed day uses completion: a stray true on a projected day is not read.
        XCTAssertEqual(tone(.task, completed: true, past: true, projected: true), DialTone(fill: 0.6, edge: 0.6))
        XCTAssertEqual(tone(.task, completed: true, past: false, projected: true), DialTone(fill: 1, edge: 1))
    }

    func testProjectedDayRoutinesThatHavePassedTakeTheDoneOpacity() {
        XCTAssertEqual(tone(.routine, past: true, projected: true), DialTone(fill: 0, edge: 0.18))
        XCTAssertEqual(tone(.routine, past: false, projected: true), DialTone(fill: 0, edge: 0.5))
        XCTAssertEqual(tone(.routine, completed: true, past: false, projected: true), DialTone(fill: 0, edge: 0.5), "completion is not read")
    }

    func testProjectedRuleReachesTheStyledBlocks() {
        let day = [
            DialFaceBlock(id: "done-at-9", kind: .task, startMin: 540, endMin: 600, completed: false, colorHex: "#ef4444"),
            DialFaceBlock(id: "running", kind: .task, startMin: 600, endMin: 750, completed: false, colorHex: "#3b82f6"),
            DialFaceBlock(id: "later", kind: .task, startMin: 900, endMin: 960, completed: false, colorHex: "#22c55e"),
        ]
        let pushed = DialBand.styles(day, nowMin: 680, projectedDay: false)
        let projected = DialBand.styles(day, nowMin: 680, projectedDay: true)
        XCTAssertEqual(pushed[0].tone, DialTone(fill: 0.35, edge: 1))
        XCTAssertEqual(projected[0].tone, DialTone(fill: 0.6, edge: 0.6))
        XCTAssertEqual(pushed[0].rimOpacity, 0.45 + 0.55 / 3, accuracy: 1e-12)
        XCTAssertEqual(projected[0].rimOpacity, (0.45 + 0.55 / 3) * 0.6, accuracy: 1e-12)
        // The running and later blocks are identical on both tiers.
        XCTAssertEqual(pushed[1], projected[1]); XCTAssertEqual(pushed[2], projected[2])
        XCTAssertTrue(pushed[0].isPast); XCTAssertFalse(pushed[1].isPast); XCTAssertFalse(pushed[2].isPast)
    }

    // MARK: past and the cache bucket

    func testPastIsAtOrAfterTheEndAndNeverAcrossMidnight() {
        let b = DialFaceBlock(id: "b", kind: .task, startMin: 540, endMin: 600)
        XCTAssertFalse(DialBand.isPast(b, nowMin: 599))
        XCTAssertTrue(DialBand.isPast(b, nowMin: 600), "a block ending at the entry's minute is past (endMin <= nowMin)")
        XCTAssertTrue(DialBand.isPast(b, nowMin: 601))
        let overnight = DialFaceBlock(id: "o", kind: .task, startMin: 1380, endMin: 1440, endsNextDay: true)
        XCTAssertFalse(DialBand.isPast(overnight, nowMin: 1440), "it ends tomorrow, so it is not past today")
        let carried = DialFaceBlock(id: "c", kind: .task, startMin: 0, endMin: 30, startedPrevDay: true)
        XCTAssertTrue(DialBand.isPast(carried, nowMin: 30))
    }

    func testPastBucketStepsOnceAtEachEndAndNamesTheEndedSet() {
        let day = [
            DialFaceBlock(id: "sleep", kind: .sleep, startMin: 0, endMin: 385),
            DialFaceBlock(id: "r", kind: .routine, startMin: 385, endMin: 420),
            DialFaceBlock(id: "a", kind: .task, startMin: 435, endMin: 480),
            DialFaceBlock(id: "b", kind: .event, startMin: 480, endMin: 540),
            DialFaceBlock(id: "c", kind: .task, startMin: 540, endMin: 600),
            DialFaceBlock(id: "d", kind: .task, startMin: 600, endMin: 750),
            DialFaceBlock(id: "night", kind: .sleep, startMin: 1350, endMin: 1440),
        ]
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 0), 0)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 384), 0)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 385), 1)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 419), 1)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 420), 2)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 680), 5)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 1439), 6)
        XCTAssertEqual(DialBand.pastBucket(day, nowMin: 1440), 7)
        // Monotone across a whole day of 15-minute entries, and the styles
        // agree whenever the bucket does: the bucket is a complete key.
        var last = -1
        var seen: [Int: [DialBlockStyle]] = [:]
        for step in 0...96 {
            let now = Double(step * 15)
            let bucket = DialBand.pastBucket(day, nowMin: now)
            XCTAssertGreaterThanOrEqual(bucket, last)
            last = bucket
            let styles = DialBand.styles(day, nowMin: now, projectedDay: false)
            if let prior = seen[bucket] { XCTAssertEqual(prior, styles, "bucket \(bucket) at \(now)") } else { seen[bucket] = styles }
        }
    }

    // MARK: canvas angle

    func testCanvasAngleIsTheDialAngleFromThePlusXAxis() {
        XCTAssertEqual(DialGeometry.canvasAngle(minutes: 0), -Double.pi / 2, accuracy: 1e-12)
        XCTAssertEqual(DialGeometry.canvasAngle(minutes: 360), 0, accuracy: 1e-12)
        XCTAssertEqual(DialGeometry.canvasAngle(minutes: 720), Double.pi / 2, accuracy: 1e-12)
        // Consistent with point(): cos/sin of the canvas angle reproduce the
        // point's offsets, so a Path arc and a Path line meet.
        let p = DialGeometry.point(cx: 182, cy: 189, r: 140, minutes: 250)
        let a = DialGeometry.canvasAngle(minutes: 250)
        XCTAssertEqual(p.x, 182 + 140 * cos(a), accuracy: 1e-9)
        XCTAssertEqual(p.y, 189 + 140 * sin(a), accuracy: 1e-9)
    }

    func testSeparatorsReadOffTheStyledList() {
        let day = [
            DialFaceBlock(id: "a", kind: .task, startMin: 435, endMin: 480),
            DialFaceBlock(id: "b", kind: .event, startMin: 480, endMin: 540),
            DialFaceBlock(id: "c", kind: .task, startMin: 540, endMin: 600),
            DialFaceBlock(id: "d", kind: .task, startMin: 601, endMin: 660),
        ]
        let styles = DialBand.styles(day, nowMin: 0, projectedDay: false)
        XCTAssertEqual(DialSpec.separatorMinutes(styles: styles), [480, 540])
    }
}
