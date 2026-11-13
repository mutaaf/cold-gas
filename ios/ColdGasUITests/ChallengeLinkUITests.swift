// 0253: a challenge link opens the app on its card; Take the challenge flies it on the sender's course and tier with their
// score to beat; the results say where you stand and offer Send it back. An older version's link says so. `-open <url>`
// (DEBUG) hands the app the link as the scene would. Payloads from Vectors/challenge.json (pro-fuzz-1, old-sim).
import XCTest

final class ChallengeLinkUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func shot(_ name: String) {
        let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }
    private func launch(_ url: String, _ more: [String] = []) -> XCUIApplication {
        let a = XCUIApplication()
        a.launchArguments = ["-uitest", "-open", url] + more
        a.launch()
        return a
    }

    func testALinkOpensTheChallengeAndTheResultsSayWhereYouStand() {
        let a = launch("https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=rASAAoAEBTUFaBgAAxgGKyAHUAoDFAY4BhsgBPAO2AQRnhYYBc4bHAcoGA7UBBGiFhQE",
                       ["-autopilot"])
        let take = a.buttons["take-challenge"]
        XCTAssertTrue(take.waitForExistence(timeout: 30), "no challenge card")
        XCTAssertTrue(a.staticTexts["MAZ"].exists, "the sender's initials")
        shot("challenge-card")
        take.tap()
        XCTAssertTrue(a.buttons["Pause"].waitForExistence(timeout: 15), "Take the challenge didn't fly")
        let standing = a.staticTexts["standing"]
        XCTAssertTrue(standing.waitForExistence(timeout: 150), "no standing on the results")
        XCTAssertTrue(standing.label.contains("MAZ"), standing.label)
        XCTAssertTrue(a.buttons["share"].exists)
        shot("challenge-results")
    }

    func testAnOlderVersionsLinkSaysSo() {
        let a = launch("coldgas://play?play=jump&course=wall#vs=rAQMB9QMAAAAAAwCAyAEHgkWlAgDHAYJG")
        XCTAssertTrue(a.staticTexts["challenge-stale"].waitForExistence(timeout: 30), "no older-version card")
        XCTAssertTrue(a.buttons["fly-incoming"].exists)
        shot("challenge-stale")
        a.buttons["Not now"].tap()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 5))
    }
}
