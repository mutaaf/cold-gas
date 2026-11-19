// 0301: the app keeps going through what a phone does to it, and says nothing went wrong when nothing did. Each test reads
// the `health` probe (`-uitest`: the faults this launch reported, memory warnings left out) and fails on a fault it didn't
// cause on purpose. The faults that can't be made on cue in a simulator come from DEBUG flags (ColdGas/App/Hardening.swift
// `Inject`): corrupt settings, a memory warning, an interruption, a NaN in the drive's input. Nothing here posts to the board.
import XCTest

final class HardeningUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.orientation = .portrait }

    private func launch(_ args: [String]) -> XCUIApplication {
        let a = XCUIApplication()
        a.launchArguments = ["-mute", "-uitest"] + args
        a.launch()
        return a
    }
    private func shot(_ name: String) {
        let s = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }
    /// The faults this launch has reported, from the probe.
    private func faults(_ a: XCUIApplication) -> (n: Int, what: String) {
        let p = a.staticTexts["health"]
        guard p.waitForExistence(timeout: 10) else { return (-1, "no health probe") }
        let n = Int(p.label.split(separator: " ").last ?? "") ?? -1
        return (n, (p.value as? String) ?? "")
    }
    private func expectHealthy(_ a: XCUIApplication, _ line: UInt = #line) {
        sleep(1)   // the probe refreshes each second
        let f = faults(a)
        XCTAssertEqual(f.n, 0, "faults reported: \(f.what)", line: line)
    }
    /// The pause sheet's Resume (its label is drawn in capitals).
    private func resume(_ a: XCUIApplication) -> XCUIElement { a.buttons.matching(NSPredicate(format: "label ==[c] %@", "Resume")).firstMatch }
    /// The results are up (a landing's Next or a wreck's Fly again). A pause sheet on the way is resumed, as a player would.
    private func results(_ a: XCUIApplication, timeout: Double = 240) -> Bool {
        let next = a.buttons["next"], again = a.buttons["again"], r = resume(a)
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if next.exists || again.exists { return true }
            if r.exists && r.isHittable { r.tap() }
            sleep(1)
        }
        return false
    }

    /// Settings this build doesn't know (a look, a course, a tier of the wrong type, a control scheme) are put back to their
    /// defaults before anything reads them, each reported once: the title draws, and the look reads Real.
    func testCorruptSettingsAreRepairedAtLaunch() {
        let a = launch(["-corrupt-prefs"])
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 60), "the title never came up")
        sleep(1)
        let f = faults(a)
        XCTAssertEqual(f.n, 4, f.what)
        XCTAssertTrue(f.what.contains("setting cg.look unknown"), f.what)
        XCTAssertTrue(f.what.contains("setting cg.course unknown"), f.what)
        XCTAssertTrue(f.what.contains("setting cg.tier unreadable"), f.what)
        a.buttons["Settings"].tap()
        let real = a.buttons["Real"]
        XCTAssertTrue(real.waitForExistence(timeout: 10))
        XCTAssertTrue(real.isSelected, "the look isn't back on Real")
        shot("settings-repaired")
        a.terminate()
        // The repair stuck: a second launch has nothing to repair.
        let b = launch([])
        XCTAssertTrue(b.buttons["play"].waitForExistence(timeout: 60))
        expectHealthy(b)
    }

    /// A call's banner mid-run: the run pauses, resumes, and lands as it would have.
    func testAnInterruptionMidRunPausesAndCarriesOn() {
        let a = launch(["-course", "show", "-tier", "assist", "-play", "-autopilot", "-interrupt", "6"])
        XCTAssertTrue(a.buttons["Pause"].waitForExistence(timeout: 60), "the run didn't start")
        XCTAssertTrue(resume(a).waitForExistence(timeout: 30), "the interruption didn't pause the run")
        shot("paused-by-the-call")
        XCTAssertTrue(results(a), "the run never reached its results after the interruption")
        expectHealthy(a)
    }

    /// A memory warning mid-run: the idle stages and flights go, the run doesn't, and nothing is reported but the warning.
    func testAMemoryWarningMidRunIsSurvived() {
        let a = launch(["-course", "wall", "-tier", "assist", "-play", "-autopilot", "-memwarn", "7"])
        XCTAssertTrue(results(a), "the run never reached its results after the memory warning")
        expectHealthy(a)
        // Home rebuilds what was dropped.
        let home = a.buttons["Home"]
        if home.exists { home.tap(); XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 30)) }
        expectHealthy(a)
    }

    /// Turned to landscape and back mid-run: the layout follows, the run carries on.
    func testRotationMidRunIsSurvived() {
        let a = launch(["-course", "lineup", "-tier", "pro", "-play", "-autopilot"])
        XCTAssertTrue(a.buttons["Pause"].waitForExistence(timeout: 60), "the run didn't start")
        sleep(4)
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(3)
        shot("landscape-mid-run")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(results(a), "the run never reached its results after the turns")
        expectHealthy(a)
    }

    /// To the background mid-run and mid-replay: back, the run waits paused; Resume finishes it; the replay carries on.
    func testBackgroundingMidRunAndMidReplay() {
        let a = launch(["-course", "show", "-tier", "assist", "-play", "-autopilot"])
        XCTAssertTrue(a.buttons["Pause"].waitForExistence(timeout: 60), "the run didn't start")
        sleep(5)
        XCUIDevice.shared.press(.home)
        sleep(3)
        a.activate()
        let r = resume(a)
        XCTAssertTrue(r.waitForExistence(timeout: 15), "the run wasn't paused when it came back")
        r.tap()
        XCTAssertTrue(results(a), "the run never reached its results after the background")
        let watch = a.buttons["Watch it"]
        if watch.waitForExistence(timeout: 20) {
            watch.tap()
            sleep(2)
            XCUIDevice.shared.press(.home)
            sleep(3)
            a.activate()
            sleep(3)
            shot("back-mid-replay")
        }
        expectHealthy(a)
    }

    /// A roam with a call's banner and two seconds of NaN in the drive's input: it's let go (said once), and the drive goes on.
    func testARoamSurvivesAnInterruptionAndANaNInput() {
        let a = launch(["-roam", "show", "-interrupt", "8", "-nan-input", "11"])
        let back = a.buttons["Back to the title"]
        XCTAssertTrue(back.waitForExistence(timeout: 60), "the roam never came up")
        sleep(16)
        XCTAssertTrue(back.exists, "the roam went away")
        sleep(1)
        let f = faults(a)
        XCTAssertEqual(f.n, 1, f.what)
        XCTAssertTrue(f.what.contains("drive input not finite"), f.what)
        shot("roam-after-nan")
        back.tap()
        XCTAssertTrue(a.buttons["play"].waitForExistence(timeout: 30), "Home from the roam failed")
    }
}
