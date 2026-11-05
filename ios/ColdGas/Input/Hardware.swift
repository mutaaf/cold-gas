// A game controller and a hardware keyboard (src/input.js's other two devices), read once a frame through GameController,
// and the tilt (src/touch-settings.js) through CoreMotion. A key or a pad in use takes the run off the one-thumb pad and hides
// the touch controls, as on the web; a finger on the glass brings them back. Everything goes in through InputSampler.
import GameController
import CoreMotion
import UIKit
import ColdGasPhysics

@MainActor
final class Hardware {
    static let shared = Hardware()
    /// A controller or a keyboard was the last thing used.
    private(set) var inUse = false
    private let motion = CMMotionManager()
    private var tiltZero: Double?
    private var startWas = false

    func note(touch: Bool) { if touch { inUse = false } }

    /// Once a display frame. `onPause`: a controller's Menu button, on the press.
    func poll(_ l: LiveRun, onPause: () -> Void) {
        var pads: [PadState] = []
        var used = false, start = false
        for c in GCController.controllers() {
            guard let g = c.extendedGamepad else { continue }
            var p = PadState()
            // Web standard mapping: axes 0 LX, 1 LY (+ down), 2 RX, 3 RY; 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 14/15 dpad L/R.
            p.axes = [Double(g.leftThumbstick.xAxis.value), Double(-g.leftThumbstick.yAxis.value), Double(g.rightThumbstick.xAxis.value), Double(-g.rightThumbstick.yAxis.value)]
            let b: [(Int, GCControllerButtonInput)] = [(0, g.buttonA), (1, g.buttonB), (2, g.buttonX), (3, g.buttonY), (4, g.leftShoulder), (5, g.rightShoulder), (6, g.leftTrigger), (7, g.rightTrigger), (14, g.dpad.left), (15, g.dpad.right)]
            for (i, x) in b { p.pressed[i] = x.isPressed; p.value[i] = Double(x.value) }
            if b.contains(where: { $0.1.isPressed }) || p.axes.contains(where: { abs($0) > 0.5 }) { used = true }
            if g.buttonMenu.isPressed { start = true }
            pads.append(p)
        }
        l.sampler.pads = pads
        if start && !startWas { onPause() }
        startWas = start
        var k = KeyState()
        if let kb = GCKeyboard.coalesced?.keyboardInput {
            func on(_ c: GCKeyCode...) -> Bool { c.contains { kb.button(forKeyCode: $0)?.isPressed ?? false } }
            k.left = on(.leftArrow, .keyA); k.right = on(.rightArrow, .keyD); k.up = on(.upArrow, .keyW); k.down = on(.downArrow, .keyS)
            k.yawLeft = on(.keyQ); k.yawRight = on(.keyE); k.lift = on(.spacebar); k.land = on(.leftShift, .rightShift); k.boost = on(.keyF)
            if k.left || k.right || k.up || k.down || k.yawLeft || k.yawRight || k.lift || k.land || k.boost { used = true }
        }
        l.sampler.keys = k
        if used { inUse = true }
        if inUse { l.oneThumb = false }
        l.sampler.tilt = tilt()
    }

    // --- The tilt ------------------------------------------------------------------------------------
    func startRun() {
        tiltZero = nil
        if SaveStore.shared.settings.tiltOn, motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive {
            motion.deviceMotionUpdateInterval = 1.0 / 60
            motion.startDeviceMotionUpdates()
        } else if !SaveStore.shared.settings.tiltOn { motion.stopDeviceMotionUpdates() }
    }
    private func tilt() -> Double {
        guard SaveStore.shared.settings.tiltOn, let a = motion.deviceMotion?.attitude else { return 0 }
        // Degrees to the side, as the screen is held (the web reads gamma upright, beta on its side).
        let landscape = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.effectiveGeometry.interfaceOrientation }.first?.isLandscape ?? false
        let roll = (landscape ? a.pitch : a.roll) * 180 / .pi
        if tiltZero == nil { tiltZero = roll }
        return TouchControls.tiltSteer(roll: roll, zero: tiltZero ?? roll)
    }
}
