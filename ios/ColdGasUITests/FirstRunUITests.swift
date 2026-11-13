// 0249: a first launch flies. `-firstrun` (DEBUG) gives the app a fresh install's counters: the title holds the car on the
// mark with one Fly, a tap anywhere starts a one-beat countdown, the hints come one at a time and can be skipped, the first
// landing gets its own moment with Next and Beat and nothing over it, and after it the title is the normal one.
import XCTest

final class FirstRunUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ args: [String]) -> XCUIApplication {
        let a = XCUIApplication()
        a.launchArguments = ["-uitest", "-firstrun"] + args
        a.launch()
        return a
    }
    private func shot(_ name: String) {
        let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    func testAFreshInstallFliesWithATapAndIsGuided() {
        let a = launch([])
        XCTAssertTrue(a.staticTexts["first-run"].waitForExistence(timeout: 30), "no first-run title")
        XCTAssertTrue(a.buttons["play"].exists, "one Fly")
        XCTAssertFalse(a.buttons["Pro"].exists, "the tiers wait until after the first landing")
        shot("first-title")
        a.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()   // anywhere on the title
        XCTAssertTrue(a.buttons["Pause"].waitForExistence(timeout: 10), "a tap didn't start the run")
        let guide = a.staticTexts["guide"]
        XCTAssertTrue(guide.waitForExistence(timeout: 10), "no hint")
        XCTAssertTrue(guide.label.contains("Hold the pad"), guide.label)
        shot("first-hint")
        a.buttons["skip-hints"].tap()
        XCTAssertFalse(guide.waitForExistence(timeout: 2), "the hint stayed after I've got it")
    }

    func testTheFirstLandingIsCelebratedThenTheTitleIsNormal() {
        let a = launch(["-play", "-autopilot"])
        let moment = a.staticTexts["first-landing"]
        XCTAssertTrue(moment.waitForExistence(timeout: 150), "no first-landing moment")
        XCTAssertTrue(a.buttons["next"].waitForExistence(timeout: 5)); XCTAssertTrue(a.buttons["beat"].exists)
        XCTAssertFalse(a.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Post")).firstMatch.exists, "no post form on the moment")
        XCTAssertEqual(a.sheets.count + a.alerts.count, 0, "nothing over the moment")
        shot("first-landing")
        a.buttons["first-more"].tap()
        XCTAssertTrue(a.buttons["Home"].waitForExistence(timeout: 5))
        a.buttons["Home"].tap()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 15))
        XCTAssertFalse(a.staticTexts["first-run"].exists, "still the first-run title after a landing")
        XCTAssertTrue(a.buttons["Pro"].exists, "the normal title has the tiers")
    }

    func testAFirstWreckSaysWhatToDo() {
        let a = launch(["-play", "-script", "crash-show-carry5"])
        XCTAssertTrue(a.staticTexts["first-wreck"].waitForExistence(timeout: 150), "no first-wreck line")
        XCTAssertTrue(a.buttons["again"].exists)
        XCTAssertFalse(a.buttons["next"].exists)
        shot("first-wreck")
    }
}
