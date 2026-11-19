// 0302: the smoke: the app's whole surface in one pass, by its own buttons, with no crash and no fault reported. Launch,
// a scored run on each course (the reference flown live: `-autopilot`) to its results, Home, a roam, Free Drive, then every
// look and every driving option in Settings, and back to the title. The `health` probe (`-uitest`, ColdGas/App/Hardening.swift)
// must read "faults 0" at every stop. Nothing here posts to the board.
import XCTest

final class SmokeUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func shot(_ name: String) {
        let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }
    /// The probe counts every fault since launch, so a stop where a sheet hides it (the results' modal judges) is checked at
    /// the next stop that shows it; the title always does (`required`).
    private func healthy(_ a: XCUIApplication, _ at: String, required: Bool = false, line: UInt = #line) {
        sleep(1)
        let p = a.staticTexts["health"]
        guard p.waitForExistence(timeout: required ? 10 : 3) else {
            if required { XCTFail("no health probe (\(at))", line: line) }
            return
        }
        XCTAssertEqual(p.label, "faults 0", "\(at): \((p.value as? String) ?? "")", line: line)
    }
    /// A tap that a busy simulator can drop: again until `shows` appears (three tries).
    private func tapUntil(_ b: XCUIElement, shows: XCUIElement) -> Bool {
        for _ in 0..<3 { if b.exists { b.tap() }; if shows.waitForExistence(timeout: 12) { return true } }
        return false
    }
    private func results(_ a: XCUIApplication, timeout: Double = 240) -> XCUIElement? {
        let next = a.buttons["next"], again = a.buttons["again"]
        let end = Date().addingTimeInterval(timeout)
        while Date() < end { if next.exists { return next }; if again.exists { return again }; sleep(1) }
        return nil
    }

    func testTheWholeSurfaceWithNoFault() {
        let a = XCUIApplication()
        a.launchArguments = ["-mute", "-uitest", "-autopilot", "-course", "show", "-tier", "assist"]
        a.launch()
        let play = a.buttons["play"]
        XCTAssertTrue(play.waitForExistence(timeout: 90), "the title never came up")
        healthy(a, "title", required: true)

        // Each course in turn: the Show, then Next to the Wall, then Next to the Lineup.
        let pause = a.buttons["Pause"]
        XCTAssertTrue(tapUntil(play, shows: pause), "Fly didn't start a run")
        for course in ["show", "wall", "lineup"] {
            guard let b = results(a) else { XCTFail("\(course): the results never came up"); return }
            shot("results-\(course)")
            healthy(a, "results \(course)")
            if course != "lineup" {
                XCTAssertEqual(b.identifier, "next", "\(course) didn't land: no Next")
                XCTAssertTrue(tapUntil(b, shows: pause), "Next didn't start the next run")
            }
        }
        a.buttons["Home"].firstMatch.tap()
        XCTAssertTrue(play.waitForExistence(timeout: 30), "Home didn't reach the title")
        healthy(a, "title after the runs", required: true)

        // A roam on the set, then Free Drive: in, a few seconds of the world, out.
        for (id, name) in [("roam", "roam"), ("freedrive", "free drive")] {
            a.buttons[id].tap()
            let back = a.buttons["Back to the title"]
            XCTAssertTrue(back.waitForExistence(timeout: 60), "\(name) never came up")
            sleep(8)
            shot(id)
            healthy(a, name)
            XCTAssertTrue(tapUntil(back, shows: play), "back from \(name) failed")
        }

        // Settings: every look, every stability setting, and the drive's aids where this build has them.
        a.buttons["Settings"].tap()
        for look in ["Anime", "8-bit", "Real"] {
            let b = a.buttons[look]
            XCTAssertTrue(b.waitForExistence(timeout: 10), "no \(look) look")
            b.tap()
            XCTAssertTrue(b.isSelected, "\(look) didn't take")
        }
        let stability = a.buttons["stability"]
        if stability.waitForExistence(timeout: 5) {
            for mode in ["Sport", "Off", "On"] {
                stability.tap()
                let m = a.buttons[mode].firstMatch
                if m.waitForExistence(timeout: 5) { m.tap() } else { XCTFail("no stability \(mode)") }
            }
        }
        for name in ["ABS", "Traction control", "Drift assist"] {   // 0281's switches, when the build has them
            let s = a.switches[name].firstMatch
            if s.exists { s.tap(); s.tap() }
        }
        shot("settings")
        a.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(play.waitForExistence(timeout: 20), "Settings didn't close")
        healthy(a, "after settings", required: true)

        // The look chosen last draws on the title, and one more run flies under it.
        XCTAssertTrue(tapUntil(play, shows: pause), "Fly didn't start the last run")
        XCTAssertNotNil(results(a), "a run after the settings never reached its results")
        healthy(a, "the last run")
        let home = a.buttons["Home"].firstMatch
        if home.exists { home.tap(); XCTAssertTrue(play.waitForExistence(timeout: 30)) }
        healthy(a, "the end", required: true)
    }
}
