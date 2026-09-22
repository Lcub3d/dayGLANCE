import XCTest
import UIKit
import DayDialGeometry

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 states as the hub words them, and the zone-change rule. The test
// bundle has no string catalog, so the copy comes back as the English keys
// with their arguments filled: exactly what the English widget shows.
// ─────────────────────────────────────────────────────────────────────────────

final class HubStatesTests: XCTestCase {

    private let noon: Date = {
        var c = DateComponents(); c.year = 2026; c.month = 9; c.day = 21; c.hour = 12
        return Calendar.current.date(from: c)!
    }()

    private func block(_ id: String, _ s: Double, _ e: Double, kind: DialBlockKind = .task, title: String? = nil) -> DialFaceBlock {
        DialFaceBlock(id: id, kind: kind, startMin: s, endMin: e, title: title ?? id)
    }

    private var sparse: [DialFaceBlock] {
        [block("sleep", 0, 420, kind: .sleep), block("docs", 600, 750, title: "Write API documentation"),
         block("gym", 1020, 1140, title: "Gym"), block("night", 1380, 1440, kind: .sleep)]
    }

    private func hub(at minute: Double, blocks: [DialFaceBlock]? = nil) -> DialHubView {
        DialHubView(date: noon, state: DialHub.resolve(blocks: blocks ?? sparse, nowMin: minute), use24Hour: true)
    }

    // MARK: open time

    func testOpenTimeNamesWhatEndsIt() {
        let h = hub(at: 780)
        let o = try! XCTUnwrap(h.state.open)
        XCTAssertEqual(h.openText(o), "4h open")
        XCTAssertEqual(h.openDetail(o), "until Gym at 17:00")
    }

    func testOpenTimeCanEndAtSleepOrAtNothing() {
        let evening = hub(at: 1170)
        XCTAssertEqual(evening.openDetail(try! XCTUnwrap(evening.state.open)), "until sleep at 23:00")
        let quiet = hub(at: 800, blocks: [block("a", 600, 700)])
        XCTAssertEqual(quiet.openDetail(try! XCTUnwrap(quiet.state.open)), "Nothing else today")
    }

    func testALongNextTitleIsCutSoTheTimeSurvives() {
        let long = String(repeating: "Quarterly planning ", count: 6)
        let h = hub(at: 780, blocks: [block("x", 1020, 1140, title: long)])
        let text = h.openDetail(try! XCTUnwrap(h.state.open))
        XCTAssertTrue(text.hasSuffix("at 17:00"), text)
        XCTAssertTrue(text.contains("…"), text)
        let font = UIFont.systemFont(ofSize: DialSpec.Hub.countdownFontSize)
        XCTAssertLessThanOrEqual(DialHubTypography.width(of: text, font: font),
                                 DialSpec.Hub.width(atY: DialSpec.Hub.rowBaseline(0), inset: DialHubTypography.chordInset) + 0.5)
    }

    // MARK: the current block: three rows, stacked

    func testTheCountdownIsThreeRowsUnderTheTitle() {
        let h = hub(at: 680)   // inside "Write API documentation", 10:00–12:30
        let c = try! XCTUnwrap(h.state.current)
        XCTAssertEqual(h.untilText(c), "until 12:30")
        XCTAssertEqual(h.leftText(c), "1h 10m left")
        XCTAssertFalse(h.leftRow(c).live, "no end instant: the static form")
        let rows = h.rows()
        XCTAssertNotNil(rows.title)
        XCTAssertEqual(rows.stack.count, 3, "until, left, runway (the fixture block has no tag)")

        // With a tag and the projected note the stack is five rows, the last
        // still inside the ring.
        let tagged = [block("sleep", 0, 420, kind: .sleep),
                      DialFaceBlock(id: "docs", kind: .task, startMin: 600, endMin: 750, title: "Write API documentation", tag: "work"),
                      block("gym", 1020, 1140, title: "Gym")]
        let full = DialHubView(date: noon, state: DialHub.resolve(blocks: tagged, nowMin: 680), use24Hour: true,
                               plannedAsOf: "Planned as of Mon 8:42 PM")
        XCTAssertEqual(full.rows().stack.count, 5)
        XCTAssertLessThan(DialSpec.Hub.rowBaseline(4), DialSpec.cy + DialSpec.Hub.radius)
    }

    // MARK: the clock preference

    func testTheClockFollowsTheSnapshotsPreferenceNotTheLocalesCycle() {
        // en_US is a 12-hour locale; the snapshot's use24Hour must still give
        // 17:00, and false must give the 12-hour form whatever the device.
        XCTAssertEqual(DialHubClock.text(minutesOfDay: 1020, use24Hour: true, reference: noon), "17:00")
        XCTAssertEqual(DialHubClock.text(minutesOfDay: 425, use24Hour: true, reference: noon), "07:05")
        let twelve = DialHubClock.text(minutesOfDay: 1020, use24Hour: false, reference: noon)
        XCTAssertTrue(twelve.hasPrefix("5:00"), twelve)
        XCTAssertTrue(twelve.localizedCaseInsensitiveContains("PM"), twelve)

        // The freshness labels share the rule (the "as of" clock).
        var c = DateComponents(); c.year = 2026; c.month = 9; c.day = 17; c.hour = 20; c.minute = 42
        let captured = Calendar.current.date(from: c)!
        let fresh = WidgetFreshness(isStale: true, daysOld: 4, snapshotDay: captured, capturedAt: captured)
        XCTAssertTrue(fresh.plannedAsOfLabel(use24Hour: true).hasSuffix("20:42"), fresh.plannedAsOfLabel(use24Hour: true))
        XCTAssertTrue(fresh.plannedAsOfLabel(use24Hour: false).hasSuffix("PM"), fresh.plannedAsOfLabel(use24Hour: false))
        XCTAssertTrue(fresh.detailLabel(use24Hour: true)?.contains("20:42") == true, fresh.detailLabel(use24Hour: true) ?? "nil")
    }

    // MARK: sleep and runway

    func testSleepRowAndRunwayToSleep() {
        let asleep = hub(at: 300)
        XCTAssertEqual(asleep.sleepText(try! XCTUnwrap(asleep.state.sleep)), "until 07:00")
        let late = hub(at: 1100, blocks: [block("a", 1080, 1140, title: "Dinner"), block("night", 1380, 1440, kind: .sleep)])
        XCTAssertEqual(late.state.runwayMinutes, 240)
        XCTAssertEqual(late.runwayText(240, toSleep: late.state.runwayEndsAtSleep), "then 4h until sleep")
    }

    // MARK: VoiceOver

    func testTheSpokenSummaryReadsTheHubInOneBreath() {
        let current = DialHub.resolve(blocks: sparse, nowMin: 680)
        let s = DialHubView.summary(date: noon, state: current, use24Hour: true, status: .live, plannedAsOf: nil)
        XCTAssertTrue(s.hasPrefix("Monday, September 21. "), s)
        XCTAssertTrue(s.contains("Now: Write API documentation, 1 hour, 10 minutes left"), s)
        XCTAssertTrue(s.contains("then 4 hours, 30 minutes open"), s)

        let open = DialHub.resolve(blocks: sparse, nowMin: 780)
        let o = DialHubView.summary(date: noon, state: open, use24Hour: true, status: .live, plannedAsOf: "Planned as of Mon 8:42 PM")
        XCTAssertTrue(o.contains("4 hours open, until Gym at 17:00"), o)
        XCTAssertTrue(o.hasSuffix("Planned as of Mon 8:42 PM."), o)

        let stale = DialHubView.summary(date: noon, state: current, use24Hour: true,
                                        status: .outdated(detail: "as of Thu, Sep 17, 8:42 PM"), plannedAsOf: nil)
        XCTAssertEqual(stale, "Monday, September 21. Outdated, as of Thu, Sep 17, 8:42 PM.")
    }

    // MARK: time zone

    func testZoneChangedComparesOffsetsNotNames() {
        let chicago = TimeZone(identifier: "America/Chicago")!
        XCTAssertFalse(WidgetFreshness.zoneChanged(snapshotZone: "US/Central", at: noon, current: chicago), "an alias is the same clock")
        XCTAssertFalse(WidgetFreshness.zoneChanged(snapshotZone: nil, at: noon, current: chicago), "older payloads never flag")
        XCTAssertFalse(WidgetFreshness.zoneChanged(snapshotZone: "Not/AZone", at: noon, current: chicago))
        XCTAssertTrue(WidgetFreshness.zoneChanged(snapshotZone: "America/New_York", at: noon, current: chicago))
        XCTAssertTrue(WidgetFreshness.zoneChanged(snapshotZone: "Asia/Tokyo", at: noon, current: chicago))
    }
}
