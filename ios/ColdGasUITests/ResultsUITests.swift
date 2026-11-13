// 0258: the results lead with the next jump. Landed: Next (the tall one), then Beat <score> and Share, then Post, then the
// quiet words. Wrecked: Fly again, then Share. Next starts the next event's run. Nothing here posts to the board.
import XCTest

final class ResultsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ args: [String]) -> XCUIApplication {
        let a = XCUIApplication()
        a.launchArguments = ["-uitest"] + args
        a.launch()
        return a
    }
    private func shot(_ name: String) {
        let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    /// The reference run lands: Next, then Beat and Share on one row, then Post; Next flies the Wall.
    func testALandingLeadsWithNext() {
        let a = launch(["-course", "show", "-tier", "assist", "-play", "-autopilot"])
        let next = a.buttons["next"]
        XCTAssertTrue(next.waitForExistence(timeout: 120), "the results never came up")
        shot("landed")
        let beat = a.buttons["beat"], share = a.buttons["share"]
        XCTAssertTrue(beat.exists); XCTAssertTrue(share.exists)
        XCTAssertTrue(beat.label.contains("beat"), beat.label)
        XCTAssertLessThan(next.frame.maxY, beat.frame.minY + 1, "Next sits above Beat")
        XCTAssertLessThan(beat.frame.minX, share.frame.minX, "Beat, then Share")
        XCTAssertEqual(beat.frame.midY, share.frame.midY, accuracy: 2, "Beat and Share share a row")
        let post = a.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Post")).firstMatch
        if post.exists { XCTAssertGreaterThan(post.frame.minY, beat.frame.maxY - 1, "Post sits below Beat and Share") }
        XCTAssertFalse(a.buttons["again"].exists, "no plain Fly again after a landing")
        XCTAssertTrue(next.label.localizedCaseInsensitiveContains("wall"), next.label)
        next.tap()
        XCTAssertTrue(a.buttons["Pause"].waitForExistence(timeout: 20), "Next didn't start a run")
    }

    /// A recorded crash: Fly again first, no Next.
    func testAWreckLeadsWithFlyAgain() {
        let a = launch(["-course", "show", "-tier", "assist", "-play", "-script", "crash-show-carry5"])
        let again = a.buttons["again"]
        XCTAssertTrue(again.waitForExistence(timeout: 120), "the results never came up")
        shot("wrecked")
        XCTAssertFalse(a.buttons["next"].exists, "no Next after a wreck")
        let share = a.buttons["share"]
        if share.exists { XCTAssertGreaterThan(share.frame.minY, again.frame.maxY - 1, "Share after Fly again") }
    }
}
