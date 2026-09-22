import XCTest
@testable import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// The hub (Phase 3): the row constants against handoff §2, the chord rule
// for a row's usable width, and DialHub.resolve — which block is current,
// its true end, and the runway threshold.
// ─────────────────────────────────────────────────────────────────────────────

final class HubTests: XCTestCase {

    private func task(_ id: String, _ s: Double, _ e: Double, title: String? = nil, tag: String? = nil,
                      kind: DialBlockKind = .task, endsNextDay: Bool = false, endMinTrue: Double? = nil) -> DialFaceBlock {
        DialFaceBlock(id: id, kind: kind, startMin: s, endMin: e, endsNextDay: endsNextDay,
                      endMinTrue: endMinTrue, title: title ?? id, tag: tag)
    }

    // MARK: rows

    func testRowBaselinesAreTheSpecs() {
        typealias H = DialSpec.Hub
        XCTAssertEqual(H.eyebrowY, 138); XCTAssertEqual(H.dateY, 172); XCTAssertEqual(H.ruleY, 189)
        XCTAssertEqual(H.titleY, 211); XCTAssertEqual(H.tagY, 229); XCTAssertEqual(H.countdownY, 249); XCTAssertEqual(H.runwayY, 266)
        XCTAssertEqual(H.eyebrowFontSize, 9.5); XCTAssertEqual(H.eyebrowTracking, 3.2); XCTAssertEqual(H.eyebrowOpacity, 0.46)
        XCTAssertEqual(H.dateFontSize, 28); XCTAssertEqual(H.dateOpacity, 0.96); XCTAssertEqual(H.dateFontName, "Lora-Medium")
        XCTAssertEqual(H.ruleHalfWidth, 34); XCTAssertEqual(H.ruleOpacity, 0.16)
        XCTAssertEqual(H.titleFontSize, 15); XCTAssertEqual(H.titleOpacity, 0.95)
        XCTAssertEqual(H.tagFontSize, 11); XCTAssertEqual(H.tagOpacity, 0.44)
        XCTAssertEqual(H.countdownFontSize, 11.5); XCTAssertEqual(H.countdownOpacity, 0.58)
        XCTAssertEqual(H.runwayFontSize, 11); XCTAssertEqual(H.runwayOpacity, 0.72); XCTAssertEqual(H.runwayColorHex, "#4ec9b0")
        XCTAssertEqual(H.runwayMinimumMinutes, 30)
        // The rule is collinear with the 06/18 tick row.
        XCTAssertEqual(H.ruleY, DialSpec.cy)
    }

    // MARK: the chord rule

    func testUsableWidthIsTheChordOfTheSkyRingsInnerEdge() {
        typealias H = DialSpec.Hub
        XCTAssertEqual(H.radius, 116)                       // 119 − 6/2
        // On the centre line the full diameter is usable.
        XCTAssertEqual(H.halfWidth(atY: DialSpec.cy), 116, accuracy: 1e-9)
        // The handoff's number: ~113pt a side at the title row.
        let title = H.halfWidth(atY: H.titleY)
        XCTAssertEqual(title, (116.0 * 116.0 - 22.0 * 22.0).squareRoot(), accuracy: 1e-9)
        XCTAssertEqual(title, 113.9, accuracy: 0.05)
        // Narrower the further from the centre, symmetric above and below.
        XCTAssertLessThan(H.halfWidth(atY: H.runwayY), H.halfWidth(atY: H.countdownY))
        XCTAssertLessThan(H.halfWidth(atY: H.countdownY), H.halfWidth(atY: H.tagY))
        XCTAssertLessThan(H.halfWidth(atY: H.tagY), H.halfWidth(atY: H.titleY))
        XCTAssertEqual(H.halfWidth(atY: DialSpec.cy + 40), H.halfWidth(atY: DialSpec.cy - 40), accuracy: 1e-9)
        XCTAssertEqual(H.halfWidth(atY: H.runwayY), 86.76, accuracy: 0.05)
        // The inset comes straight off, and never below zero.
        XCTAssertEqual(H.halfWidth(atY: H.titleY, inset: 6), title - 6, accuracy: 1e-9)
        XCTAssertEqual(H.width(atY: H.titleY, inset: 6), 2 * (title - 6), accuracy: 1e-9)
        XCTAssertEqual(H.halfWidth(atY: DialSpec.cy + 116), 0)
        XCTAssertEqual(H.halfWidth(atY: DialSpec.cy + 200), 0)
        XCTAssertEqual(H.halfWidth(atY: DialSpec.cy + 115.9, inset: 50), 0)
    }

    // MARK: which block is current

    func testTheRunningBlockIsCurrentAndSleepNeverIs() {
        let day = [
            task("sleep", 0, 385, kind: .sleep),
            task("standup", 480, 540, title: "Standup", tag: "work"),
            task("docs", 600, 750, title: "Write API documentation", tag: "work"),
            task("lunch", 750, 810, title: "Lunch"),
        ]
        let s = DialHub.resolve(blocks: day, nowMin: 680)
        XCTAssertEqual(s.current?.id, "docs")
        XCTAssertEqual(s.current?.title, "Write API documentation")
        XCTAssertEqual(s.current?.tag, "work")
        XCTAssertEqual(s.current?.endMin, 750)
        XCTAssertEqual(s.current?.minutesLeft, 70)
        // At 03:00 only sleep is running: nothing to narrate.
        XCTAssertNil(DialHub.resolve(blocks: day, nowMin: 180).current)
        // Between blocks: nothing, no "next up" fallback in this phase.
        XCTAssertNil(DialHub.resolve(blocks: day, nowMin: 570).current)
        // The end minute itself is not running (start <= now < end).
        XCTAssertNil(DialHub.resolve(blocks: [task("a", 600, 660)], nowMin: 660).current)
        XCTAssertEqual(DialHub.resolve(blocks: [task("a", 600, 660)], nowMin: 600).current?.id, "a")
    }

    func testNestedBlocksTheLatestStartingWins() {
        let day = [task("container", 540, 720, title: "Deep work"), task("inner", 600, 630, title: "Call")]
        XCTAssertEqual(DialHub.resolve(blocks: day, nowMin: 610).current?.id, "inner")
        XCTAssertEqual(DialHub.resolve(blocks: day, nowMin: 650).current?.id, "container")
        // Same start: the first in list order.
        let tie = [task("first", 600, 700), task("second", 600, 660)]
        XCTAssertEqual(DialHub.resolve(blocks: tie, nowMin: 610).current?.id, "first")
    }

    func testEventsAndRoutinesAreNarratedToo() {
        XCTAssertEqual(DialHub.resolve(blocks: [task("ev", 480, 540, kind: .event)], nowMin: 500).current?.id, "ev")
        XCTAssertEqual(DialHub.resolve(blocks: [task("r", 385, 420, kind: .routine)], nowMin: 400).current?.id, "r")
    }

    func testAnEmptyTagIsNoTagAndAMissingTitleIsEmpty() {
        let s = DialHub.resolve(blocks: [DialFaceBlock(id: "x", kind: .task, startMin: 600, endMin: 700, tag: "")], nowMin: 650)
        XCTAssertNil(s.current?.tag)
        XCTAssertEqual(s.current?.title, "")
    }

    // MARK: the true end

    func testCountdownRunsToTheTrueEndAcrossMidnight() {
        // 23:00 for two hours: drawn to 1440, really ends at 01:00.
        let late = task("late", 1380, 1440, endsNextDay: true, endMinTrue: 60)
        XCTAssertEqual(late.trueEndMin, 1500)
        let s = DialHub.resolve(blocks: [late], nowMin: 1400)
        XCTAssertEqual(s.current?.endMin, 1500)
        XCTAssertEqual(s.current?.minutesLeft, 100)
        // And no runway: tomorrow's gap is tomorrow's dial's.
        XCTAssertNil(s.runwayMinutes)
        // Without the flag the drawn end is the end.
        XCTAssertEqual(task("plain", 1380, 1440).trueEndMin, 1440)
    }

    // MARK: the runway

    func testRunwayIsTheGapToTheNextBlockWhenAtLeastThirtyMinutes() {
        // The study's sparse day at 11:20: docs until 12:30, next at 17:00.
        let sparse = [
            task("sleep", 0, 420, kind: .sleep),
            task("r", 420, 455, kind: .routine),
            task("docs", 600, 750, title: "Write API documentation", tag: "work"),
            task("later", 1020, 1140),
            task("night", 1380, 1440, kind: .sleep),
        ]
        XCTAssertEqual(DialHub.resolve(blocks: sparse, nowMin: 680).runwayMinutes, 270)
        // The dense day: lunch starts the minute docs ends.
        let dense = [task("docs", 600, 750), task("lunch", 750, 810), task("review", 810, 870)]
        XCTAssertNil(DialHub.resolve(blocks: dense, nowMin: 680).runwayMinutes)
        // The threshold is inclusive at 30.
        XCTAssertEqual(DialHub.resolve(blocks: [task("a", 600, 700), task("b", 730, 800)], nowMin: 650).runwayMinutes, 30)
        XCTAssertNil(DialHub.resolve(blocks: [task("a", 600, 700), task("b", 729, 800)], nowMin: 650).runwayMinutes)
        // Nothing follows: no runway line rather than "open until midnight".
        XCTAssertNil(DialHub.resolve(blocks: [task("a", 600, 700)], nowMin: 650).runwayMinutes)
        // Phase 5: the runway CAN end at sleep, and says so.
        let evening = DialHub.resolve(blocks: [task("a", 1200, 1260), task("night", 1350, 1440, kind: .sleep)], nowMin: 1230)
        XCTAssertEqual(evening.runwayMinutes, 90)
        XCTAssertTrue(evening.runwayEndsAtSleep)
        XCTAssertFalse(DialHub.resolve(blocks: sparse, nowMin: 680).runwayEndsAtSleep)
        // A block that overlaps the current one (starts before it ends) is not "after" it.
        XCTAssertEqual(DialHub.resolve(blocks: [task("a", 600, 700), task("b", 650, 690), task("c", 760, 800)], nowMin: 620).runwayMinutes, 60)
    }

    // MARK: Phase 5 — open time and sleep

    private var sparse: [DialFaceBlock] {
        [task("sleep", 0, 420, kind: .sleep), task("r", 420, 455, kind: .routine),
         task("docs", 600, 750, title: "Write API documentation", tag: "work"),
         task("gym", 1020, 1140, title: "Gym"), task("night", 1380, 1440, kind: .sleep)]
    }

    func testOpenTimeRunsToTheNextBlockAndNamesIt() {
        let s = DialHub.resolve(blocks: sparse, nowMin: 780)
        XCTAssertNil(s.current); XCTAssertNil(s.sleep)
        XCTAssertEqual(s.open, DialHubOpen(minutesUntil: 240, endMin: 1020, nextTitle: "Gym", nextIsSleep: false))
    }

    func testOpenTimeCanEndAtSleep() {
        let s = DialHub.resolve(blocks: sparse, nowMin: 1170)
        XCTAssertEqual(s.open, DialHubOpen(minutesUntil: 210, endMin: 1380, nextTitle: nil, nextIsSleep: true))
    }

    func testOpenTimeWithNothingElseTodayRunsToMidnight() {
        let s = DialHub.resolve(blocks: [task("a", 600, 700)], nowMin: 800)
        XCTAssertEqual(s.open, DialHubOpen(minutesUntil: 640, endMin: nil, nextTitle: nil, nextIsSleep: false))
    }

    func testInsideSleepTheHubSaysSleepAndWhenItEnds() {
        let morning = DialHub.resolve(blocks: sparse, nowMin: 300)
        XCTAssertNil(morning.current); XCTAssertNil(morning.open)
        XCTAssertEqual(morning.sleep, DialHubSleep(endMin: 420, minutesLeft: 120))
        // An evening sleep that runs into tomorrow counts down to its true end.
        let night = [task("a", 600, 700), task("night", 1380, 1440, kind: .sleep, endsNextDay: true, endMinTrue: 385)]
        XCTAssertEqual(DialHub.resolve(blocks: night, nowMin: 1400).sleep, DialHubSleep(endMin: 1825, minutesLeft: 425))
    }

    func testANarratedBlockWinsOverSleepItOverlaps() {
        // A late task inside the sleep window is still what the hub narrates.
        let day = [task("night", 1380, 1440, kind: .sleep), task("call", 1390, 1420, title: "Call")]
        let s = DialHub.resolve(blocks: day, nowMin: 1400)
        XCTAssertEqual(s.current?.id, "call"); XCTAssertNil(s.sleep)
    }

    func testTheRunwayCountsFromTheNarratedBlocksEnd() {
        // Nested: the inner block is current; its own end starts the gap.
        let day = [task("container", 540, 720), task("inner", 600, 630), task("next", 700, 760)]
        let s = DialHub.resolve(blocks: day, nowMin: 610)
        XCTAssertEqual(s.current?.id, "inner")
        XCTAssertEqual(s.runwayMinutes, 70)
    }
}
