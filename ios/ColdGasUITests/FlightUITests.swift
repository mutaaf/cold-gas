// Real touch events through the whole app (XCUITest): the path no scripted run takes, from the glass to the sim. Run on the
// simulators and on a paired iPhone: `make uitest` (DEST=id=<udid> for a device). Nothing here posts to the public board.
import XCTest

final class FlightUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ args: [String] = []) -> XCUIApplication {
        let a = XCUIApplication()
        a.launchArguments = ["-uitest"] + args   // -uitest: no What's new modal over the title (WhatsNewGate)
        a.launch()
        return a
    }
    private func shot(_ name: String) {
        let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    /// The Show on one thumb, by touch: hold to climb, a tap on the ledge, hold to land.
    func testOneThumbFlightByTouch() {
        let a = launch(["-course", "show", "-tier", "assist"])
        let play = a.buttons["play"]
        XCTAssertTrue(play.waitForExistence(timeout: 20))
        play.tap()
        sleep(3)   // the countdown
        let pad = a.staticTexts["Thrust pad"]
        pad.press(forDuration: 13)          // the run-up and the curl, onto the ledge
        shot("on-the-ledge")
        sleep(1)
        pad.press(forDuration: 0.1)         // tap: let go
        sleep(2)
        shot("let-go")
        pad.press(forDuration: 9)           // hold: land
        shot("landing")
        XCTAssertTrue(a.buttons.matching(NSPredicate(format: "identifier IN %@", ["again", "beat"])).firstMatch.waitForExistence(timeout: 30), "the results never came up")
        shot("results")
        let engineer = a.buttons["Engineer"]
        XCTAssertTrue(engineer.exists, "no judge tile")
        engineer.tap()
        shot("results-engineer")
        engineer.tap()
        a.buttons["The numbers"].tap()
        let damage = a.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Damage")).firstMatch
        XCTAssertTrue(damage.waitForExistence(timeout: 3), "the numbers didn't open")
        sleep(1)   // the scroll into view
        shot("results-numbers")
        XCTAssertTrue(damage.isHittable, "the numbers opened out of sight")
        a.buttons["The numbers"].tap()
        XCTAssertTrue(a.buttons["Watch it"].exists)
        a.buttons["Watch it"].tap()
        XCTAssertTrue(a.buttons["Back to the score"].waitForExistence(timeout: 5))
        sleep(4)
        shot("watching")
        a.buttons["Back to the score"].tap()
        XCTAssertTrue(a.buttons.matching(NSPredicate(format: "identifier IN %@", ["again", "beat"])).firstMatch.waitForExistence(timeout: 5))
        a.buttons["Home"].tap()
        let home = a.buttons["play"].waitForExistence(timeout: 10)
        shot("after-home")
        if !home { print("UITREE " + a.debugDescription) }
        XCTAssertTrue(home)
    }

    /// Classic on the Lineup: a pedal answers; pause, resume, restart, home.
    func testClassicControlsAndPause() {
        let a = launch(["-course", "lineup", "-tier", "pro"])
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 20))
        a.buttons["play"].tap()
        sleep(3)
        let go = a.staticTexts["GO"]
        XCTAssertTrue(go.waitForExistence(timeout: 5), "no GO pedal")
        go.press(forDuration: 3)
        shot("driving")
        a.buttons["Pause"].tap()
        XCTAssertTrue(a.buttons["Resume"].waitForExistence(timeout: 3))
        a.buttons["Resume"].tap()
        a.buttons["Pause"].tap()
        a.buttons["Restart"].tap()
        sleep(1)
        a.buttons["Pause"].tap()
        a.buttons["Home"].tap()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 10))
    }

    /// Every sheet opens and closes; the board loads or says it can't.
    func testSheets() {
        let a = launch()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 20))
        for (name, title) in [("Board", "The board"), ("How to play", "How to play"), ("Settings", "Settings")] {
            a.buttons[name].tap()
            XCTAssertTrue(a.staticTexts[title].waitForExistence(timeout: 5), title)
            shot(title)
            a.buttons["Done"].tap()
            XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 5))
        }
    }

    /// What's new, forced (DEBUG -whatsNew wins over -uitest): a callout card takes you to its feature, and the modal
    /// is gone when you come back; Let's fly closes it.
    func testWhatsNewCalloutsGoToTheFeature() {
        for (id, title) in [("whatsnew-go-howTo", "How to play"), ("whatsnew-go-settings", "Settings")] {
            let a = launch(["-whatsNew"])
            XCTAssertTrue(a.buttons["whatsnew-dismiss"].waitForExistence(timeout: 20), "the modal")
            shot("whatsnew")
            let card = a.buttons[id]
            XCTAssertTrue(card.waitForExistence(timeout: 5), id)
            card.tap()
            XCTAssertTrue(a.staticTexts[title].waitForExistence(timeout: 5), title)
            shot("whatsnew-" + id)
            a.buttons["Done"].tap()
            XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 5))
            XCTAssertFalse(a.buttons["whatsnew-dismiss"].exists, "the modal closed")
            a.terminate()
        }
        let a = launch(["-whatsNew"])
        XCTAssertTrue(a.buttons["whatsnew-dismiss"].waitForExistence(timeout: 20))
        a.buttons["whatsnew-dismiss"].tap()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 5))
        XCTAssertFalse(a.buttons["whatsnew-dismiss"].exists)
    }

    /// How to play says the game on its first screen and folds the rest, one open at a time.
    func testHowToFolds() {
        let a = launch()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 20))
        a.buttons["How to play"].tap()
        XCTAssertTrue(a.descendants(matching: .any)["howto-steps"].waitForExistence(timeout: 5))
        shot("howto")
        let judges = a.buttons["The judges"], board = a.buttons["The board"]
        XCTAssertFalse(a.staticTexts["The height and the rotation."].exists, "folded text is showing")
        judges.tap()
        XCTAssertTrue(a.staticTexts["The height and the rotation."].waitForExistence(timeout: 3))
        shot("howto-judges")
        board.tap()
        XCTAssertTrue(a.staticTexts["A scored run, with three letters."].waitForExistence(timeout: 3))
        XCTAssertFalse(a.staticTexts["The height and the rotation."].exists, "two folds open")
        a.buttons["Done"].tap()
    }

    /// A drill from the Practice sheet, by touch: on the ledge, tap to let go, hold to land; its own card, and the coach.
    func testPracticeDrillByTouch() {
        let a = launch(["-course", "show", "-tier", "assist"])
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 20))
        a.buttons["Practice"].tap()
        let ledge = a.buttons.containing(NSPredicate(format: "label CONTAINS[c] %@", "ON THE LEDGE")).firstMatch
        XCTAssertTrue(ledge.waitForExistence(timeout: 5))
        shot("practice")
        ledge.tap()
        sleep(3)
        let pad = a.staticTexts["Thrust pad"]
        pad.press(forDuration: 0.1)
        sleep(2)
        pad.press(forDuration: 9)
        XCTAssertTrue(a.buttons["Again"].waitForExistence(timeout: 30), "the drill's card never came up")
        shot("drill-results")
        a.buttons["Home"].tap()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 10))
    }

    /// Leaving mid-run pauses it, with nothing held.
    func testBackgroundPauses() {
        let a = launch(["-course", "show", "-tier", "assist"])
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 20))
        a.buttons["play"].tap()
        sleep(5)
        XCUIApplication(bundleIdentifier: "com.apple.Preferences").activate()   // an open Duo ignores the Home press
        sleep(2)
        a.activate()
        XCTAssertTrue(a.buttons["Resume"].waitForExistence(timeout: 5), "the run didn't pause")
    }
}
