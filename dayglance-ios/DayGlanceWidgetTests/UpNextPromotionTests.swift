import XCTest

// Up Next by the clock (ResolvedWidgetDay.promote): the pushed day as well as
// a projected one, so a backgrounded app's widget does not keep showing a
// task that has ended.
final class UpNextPromotionTests: XCTestCase {

    private func next(_ id: String, _ start: String, _ duration: Int, notes: String? = nil) -> NextTaskData {
        NextTaskData(id: id, title: id, colorHex: nil, startTime: start, duration: duration,
                     tags: nil, notes: notes, subtasks: nil, projectName: nil)
    }
    private func row(_ id: String, _ start: String, _ duration: Int) -> UpcomingTaskData {
        UpcomingTaskData(id: id, title: id, colorHex: nil, startTime: start, duration: duration, tags: nil, projectName: nil)
    }
    private let rows = [("b", "10:00", 30), ("c", "11:00", 60), ("d", "14:00", 0)]
    private var upcoming: [UpcomingTaskData] { rows.map { row($0.0, $0.1, $0.2) } }

    func testTheFirstTaskStaysAsPushedUntilItEnds() {
        let first = next("a", "09:00", 60, notes: "agenda")
        let (n, rest) = ResolvedWidgetDay.promote(first, upcoming, nowMin: 9 * 60 + 59)
        XCTAssertEqual(n?.id, "a")
        XCTAssertEqual(n?.notes, "agenda", "notes survive while the pushed task is current")
        XCTAssertEqual(rest.map(\.id), ["b", "c", "d"])
    }

    func testAnEndedTaskGivesWayToTheFirstNotEnded() {
        let (n, rest) = ResolvedWidgetDay.promote(next("a", "09:00", 60), upcoming, nowMin: 10 * 60 + 40)
        XCTAssertEqual(n?.id, "c")
        XCTAssertEqual(rest.map(\.id), ["d"])
    }

    func testAZeroLengthTaskCountsUntilItsStart() {
        XCTAssertEqual(ResolvedWidgetDay.promote(nil, upcoming, nowMin: 13 * 60 + 59).0?.id, "d")
        XCTAssertNil(ResolvedWidgetDay.promote(nil, upcoming, nowMin: 14 * 60 + 1).0)
    }

    func testATaskWithoutATimeIsNeverEnded() {
        let untimed = NextTaskData(id: "x", title: "x", colorHex: nil, startTime: nil, duration: nil,
                                   tags: nil, notes: nil, subtasks: nil, projectName: nil)
        XCTAssertEqual(ResolvedWidgetDay.promote(untimed, upcoming, nowMin: 23 * 60).0?.id, "x")
    }
}
