import XCTest
@testable import DayDialGeometry

// The iPad extra-large dial's cards: the same rules as the Android widget's
// DialCardsTest.kt.
final class CardsTests: XCTestCase {

    private func routine(_ id: String, done: Bool) -> DialFaceBlock {
        DialFaceBlock(id: id, kind: .routine, startMin: 420, endMin: 435, completed: done)
    }

    func testTheLegendIsInTheAppsOrder() {
        let items = DialLegend.items(hasTotals: true, effortMinutes: 200, restoreMinutes: 170,
                                     sleepMinutes: 480, unblockedMinutes: 590, blocks: [])
        XCTAssertEqual(items.map(\.key), [.effort, .restore, .sleep, .unblocked])
        XCTAssertEqual(items[0].minutes, 200)
        XCTAssertEqual(items[3].minutes, 590)
    }

    func testNoWindowMeansNoSleepAndNoUnblocked() {
        let items = DialLegend.items(hasTotals: true, effortMinutes: 60, restoreMinutes: nil,
                                     sleepMinutes: nil, unblockedMinutes: nil, blocks: [])
        XCTAssertEqual(items.map(\.key), [.effort, .restore])
        XCTAssertEqual(items[1].minutes, 0)
    }

    func testRoutinesAreCountedOffTheRing() {
        let items = DialLegend.items(hasTotals: true, effortMinutes: 0, restoreMinutes: 0, sleepMinutes: nil,
                                     unblockedMinutes: nil, blocks: [routine("a", done: true), routine("b", done: false)])
        XCTAssertEqual(items.last, DialLegendItem(key: .routines, done: 1, total: 2))
    }

    func testAPayloadWithoutTotalsDrawsNoLegend() {
        XCTAssertEqual(DialLegend.items(hasTotals: false, effortMinutes: 60, restoreMinutes: 0, sleepMinutes: nil,
                                        unblockedMinutes: nil, blocks: [routine("a", done: true)]), [])
    }

    func testTheDialTakesTheFullHeightAndTheCardsTheRest() {
        // iPad mini's extra-large (634 × 306) and the 12.9"'s (715 × 337).
        for size in [CGSize(width: 634, height: 306), CGSize(width: 715, height: 337)] {
            let dial = DialExtraLarge.dialSize(in: size)
            XCTAssertEqual(Double(dial.height), Double(size.height), accuracy: 0.001)
            XCTAssertEqual(Double(dial.width / dial.height), DialSpec.canvasWidth / DialSpec.canvasHeight, accuracy: 1e-9)
            XCTAssertGreaterThan(Double(size.width - dial.width), 300, "the cards keep a real column")
        }
        // A box too narrow for both: the dial capped at 55 % of the width, aspect kept.
        let capped = DialExtraLarge.dialSize(in: CGSize(width: 400, height: 400))
        XCTAssertEqual(Double(capped.width), 220, accuracy: 0.001)
        XCTAssertLessThan(Double(capped.height), 400)
    }

    func testAllDayRowsFitUnderTheLegend() {
        XCTAssertEqual(DialExtraLarge.legendHeight(0), 0)
        XCTAssertEqual(DialExtraLarge.legendHeight(5), 24 + 40 * 3)
        // 306pt tall, five totals: 306 − 28 − 144 − 8 − 44 = 82 → 3 rows.
        XCTAssertEqual(DialExtraLarge.allDayRows(height: 306, legendItems: 5), 3)
        // No legend: the whole column, capped.
        XCTAssertEqual(DialExtraLarge.allDayRows(height: 306, legendItems: 0), 8)
        XCTAssertEqual(DialExtraLarge.allDayRows(height: 100, legendItems: 5), 0)
    }
}
