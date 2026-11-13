// 0221: the HUD layout editor by touch, through the whole app: drag a control, size it, pinch another, save, relaunch and
// find it kept; a preset, the mirror, undo; then a whole Pro and Advanced run on the Wall with a custom layout, past the
// ledge (0210's RELEASE hang) to the results. `make uitest` or xcodebuild test -only-testing:ColdGasUITests/HudEditorUITests.
import XCTest

final class HudEditorUITests: XCTestCase {
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
    private func control(_ a: XCUIApplication, _ id: String) -> XCUIElement {
        a.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    /// The element's value: "NN% across, NN% down, size NN%, opacity NN%".
    private func numbers(_ e: XCUIElement) -> [Int] {
        (e.value as? String ?? "").split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
    }

    func testArrangeSaveRelaunchPresetsAndFly() {
        var a = launch(["-hudReset", "-course", "wall", "-tier", "pro", "-hudEdit", "pro"])
        let save = a.buttons["hud-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 40), "the editor never opened")
        let stick = control(a, "hud-stick")
        XCTAssertTrue(stick.waitForExistence(timeout: 5), "no stick in the editor")
        let before = numbers(stick)
        XCTAssertEqual(before.count, 4)
        shot("editor-factory")

        // Drag: the stick up and in.
        let from = stick.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.3, thenDragTo: from.withOffset(CGVector(dx: 70, dy: -160)))
        let moved = numbers(control(a, "hud-stick"))
        XCTAssertGreaterThan(moved[0], before[0], "the stick didn't move right")
        XCTAssertLessThan(moved[1], before[1], "the stick didn't move up")

        // Size and opacity: the selected stick's sliders.
        let size = a.sliders["hud-size"]
        XCTAssertTrue(size.waitForExistence(timeout: 3), "no inspector for the selected control")
        size.adjust(toNormalizedSliderPosition: 0.75)
        a.sliders["hud-opacity"].adjust(toNormalizedSliderPosition: 0.5)
        let sized = numbers(control(a, "hud-stick"))
        XCTAssertGreaterThan(sized[2], 130, "the size slider didn't grow the stick")
        XCTAssertLessThan(sized[3], 80, "the opacity slider didn't fade it")

        // Pinch: the main button, selected by a tap, two fingers apart.
        let main = control(a, "hud-slotA")
        main.tap()
        main.pinch(withScale: 1.6, velocity: 1)
        XCTAssertGreaterThan(numbers(control(a, "hud-slotA"))[2], 105, "the pinch didn't grow the main button")
        shot("editor-custom")
        save.tap()
        XCTAssertFalse(save.waitForExistence(timeout: 2) && save.isHittable, "Save didn't close the editor")

        // Relaunch: it's kept.
        a.terminate()
        a = launch(["-course", "wall", "-tier", "pro", "-hudEdit", "pro"])
        XCTAssertTrue(a.buttons["hud-save"].waitForExistence(timeout: 40))
        let kept = numbers(control(a, "hud-stick"))
        XCTAssertEqual(Array(kept.prefix(4)), Array(sized.prefix(4)), "the stick's place didn't survive a relaunch")

        // Presets, the mirror, undo.
        a.buttons["hud-presets"].tap()
        let left = a.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Left-handed")).firstMatch
        XCTAssertTrue(left.waitForExistence(timeout: 3), "no Left-handed preset")
        left.tap()
        XCTAssertGreaterThan(numbers(control(a, "hud-stick"))[0], 50, "left-handed: the stick goes right")
        XCTAssertLessThan(numbers(control(a, "hud-slotA"))[0], 50, "left-handed: the main button goes left")
        shot("editor-left-handed")
        a.buttons["hud-mirror"].tap()
        XCTAssertLessThan(numbers(control(a, "hud-stick"))[0], 50, "the mirror didn't flip it back")
        a.buttons["hud-undo"].tap()
        XCTAssertGreaterThan(numbers(control(a, "hud-stick"))[0], 50, "undo didn't step back")
        a.buttons["hud-save"].tap()
        a.terminate()

        // A whole Pro run on the Wall with the left-handed layout: past the ledge, to the card.
        a = launch(["-course", "wall", "-tier", "pro", "-play", "-autopilot"])
        XCTAssertTrue(a.buttons["Fly again"].waitForExistence(timeout: 150), "the Pro run never reached the results")
        shot("pro-results")
        a.terminate()

        // And Advanced, with the Claw preset over every shape.
        a = launch(["-course", "wall", "-tier", "advanced", "-play", "-autopilot", "-hudPreset", "claw"])
        XCTAssertTrue(a.buttons["Fly again"].waitForExistence(timeout: 150), "the Advanced run never reached the results")
        shot("advanced-results")
    }
}
