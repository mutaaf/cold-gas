// The player's touch controls (0220): the layouts the HUD editor saves (per tier, per shape), the stick, the buttons and Free
// Drive's look, read by every surface through DeckGeometry. Kept in the save (SaveData.hud) and nowhere else. `revision`
// moves on every change, so the surfaces and the camera's framing lay themselves out again.
//
// The controls-layout API Free Drive's drive controls use: `DeckGeometry.layout(size)` for where things are (tier `.drive`
// on the drive screen), `FlightDeck(..., look: true)` for the surface with swipe-to-look, and `DriveLook.shared.step(dt)` for
// the camera's yaw and pitch from the player's swipe.
import Foundation
import Combine
import ColdGasLayout
import ColdGasClient

final class HudStore: ObservableObject {
    static let shared = HudStore()
    @Published private(set) var revision = 0
    /// The editor is open on this tier (the root draws it over everything; a run under it stays paused).
    @Published var editing: HudTier?
    private(set) var prefs: HudPrefs

    init() {
        prefs = SaveStore.shared.data.hudPrefs
        #if DEBUG
        HudStore.debugLaunch(&prefs)
        #endif
        editing = HudStore.launchEditor
    }

    /// The save's older hand setting: with nothing saved for a shape, a left-handed player starts mirrored.
    var leftHanded: Bool { SaveStore.shared.settings.handedness == .left }
    func custom(_ t: HudTier, _ s: HudShape) -> HudCustom? { prefs.custom(t, s, leftHanded: leftHanded) }

    func update(_ f: (inout HudPrefs) -> Void) {
        var p = prefs
        f(&p)
        guard p != prefs else { return }
        p.v = HudPrefs.version
        prefs = p
        SaveStore.shared.update { $0.hud = p }
        revision += 1
    }
    func save(_ c: HudCustom?, _ t: HudTier, _ s: HudShape) {
        var v = c
        if v?.isFactory == true && v?.preset == nil { v = nil }
        // The factory chosen on a left-handed save is a choice: kept as an explicit Thumbs, or the mirror would come back.
        if v == nil && leftHanded { v = HudCustom(preset: .thumbs) }
        update { $0.set(v, t, s) }
    }

    #if DEBUG
    /// `-hudPreset <name>` applies a preset to every tier on every shape; `-hudReset` clears every layout (shots, UI tests).
    private static func debugLaunch(_ p: inout HudPrefs) {
        if Launch.args.contains("-hudReset") { p = HudPrefs(); SaveStore.shared.update { $0.hud = nil } }
        if let n = Launch.value("-hudPreset"), let preset = HudPreset(rawValue: n) {
            for t in HudTier.allCases { for s in HudShape.allCases { p.set(HudCustom(preset: preset), t, s) } }
        }
        if let m = Launch.value("-hudStick").flatMap(StickMode.init(rawValue:)) { p.stickMode = m }
    }
    /// `-hudEdit <tier>`: the editor open at launch (shots, UI tests).
    static var launchEditor: HudTier? { Launch.value("-hudEdit").flatMap(HudTier.init(rawValue:)) }
    #else
    static var launchEditor: HudTier? { nil }
    #endif
}

/// Free Drive's swipe-to-look (0220): a finger on empty glass turns the chase camera round the car. It drifts back behind the
/// car a moment after the finger lifts. Sensitivity and invert are the player's (Settings → Controls).
final class DriveLook {
    static let shared = DriveLook()
    private(set) var yaw = 0.0, pitch = 0.0
    private var held = false, idle = 0.0

    func drag(dx: Double, dy: Double) {
        let p = HudStore.shared.prefs
        held = true; idle = 0
        yaw += dx * 0.0065 * p.lookSens
        pitch = min(0.6, max(-0.3, pitch + dy * 0.0045 * p.lookSens * (p.lookInvert ? -1 : 1)))
        if yaw > .pi { yaw -= 2 * .pi } else if yaw < -.pi { yaw += 2 * .pi }
    }
    func release() { held = false; idle = 0 }
    func reset() { yaw = 0; pitch = 0; held = false }

    /// Once a frame from the camera: the look now.
    func step(_ dt: Double) -> (yaw: Double, pitch: Double) {
        if !held {
            idle += dt
            if idle > 1.2 { let k = exp(-dt * 2.2); yaw *= k; pitch *= k; if abs(yaw) < 1e-4 && abs(pitch) < 1e-4 { yaw = 0; pitch = 0 } }
        }
        return (yaw, pitch)
    }
}
