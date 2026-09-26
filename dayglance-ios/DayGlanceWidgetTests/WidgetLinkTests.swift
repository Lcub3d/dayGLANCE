import XCTest

// The widgets' tap links (WidgetLink in WidgetModels.swift). The web side
// reads the id with URLSearchParams, so what matters is that it decodes back
// to the exact id: '+' must not become a space, '&' and '=' must not split it.
final class WidgetLinkTests: XCTestCase {

    /// What the web side does: URLSearchParams semantics ('+' is a space).
    private func webDecodedId(_ url: URL) -> String? {
        guard let query = url.query else { return nil }
        for pair in query.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.first == "id" else { continue }
            let raw = (parts.count > 1 ? parts[1] : "").replacingOccurrences(of: "+", with: " ")
            return raw.removingPercentEncoding
        }
        return nil
    }

    func testGoalAndProjectLinks() {
        XCTAssertEqual(WidgetLink.goal("g1").absoluteString, "dayglance://goal?id=g1")
        XCTAssertEqual(WidgetLink.project("p-2").absoluteString, "dayglance://project?id=p-2")
        XCTAssertEqual(WidgetLink.today.absoluteString, "dayglance://today")
    }

    func testNoIdOpensTheSpace() {
        XCTAssertEqual(WidgetLink.goal(nil).absoluteString, "dayglance://goal")
        XCTAssertEqual(WidgetLink.project("").absoluteString, "dayglance://project")
    }

    func testIdsSurviveTheWebSidesDecoding() {
        for id in ["a+b@example.com", "x&y=z", "space here", "ümlaut/slash?#", "plain-id_1.2~"] {
            XCTAssertEqual(webDecodedId(WidgetLink.completeTask(id)), id, id)
            XCTAssertEqual(webDecodedId(WidgetLink.project(id)), id, id)
        }
    }

    func testFocusCarriesTheTask() {
        XCTAssertEqual(WidgetLink.startFocus("t 1").absoluteString, "dayglance://startFocus?id=t%201")
        XCTAssertEqual(WidgetLink.startFocus(nil).absoluteString, "dayglance://startFocus")
    }

    func testTheHostIsTheAction() {
        XCTAssertEqual(WidgetLink.completeTask("t").host, "completeTask")
        XCTAssertEqual(WidgetLink.goal("g").host, "goal")
    }
}
