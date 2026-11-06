// The camera director for a live run: src/render/director.js, ported (0158). Same rigs, same numbers, same order:
//   Lineup  a low chase that swings out to a broadcast three-quarter as the car leaves the deck.
//   Wall    chase on the approach, a side camera up the curl, the wide shot while it hangs inverted, the fall tracking
//           from the side, a low landing cam.
//   Show    the Wall's, then after the release HOLD → CARRY → FOLLOW, each entered by a hard cut (0063, 0113, 0128): a
//           locked-off hold on the drop, a locked-off carry placed to fit the car and the whole row, and a tracking
//           follow down to the pad, which the landed rig eases out of.
// A crash's first big hit cuts to a locked-off camera beside it (crash.js cutTo); shake, and the touchdown's dip and
// punch-in, ride on top of whatever shot is up. The lens is vertical, as three's is; the shots framed side-on to a
// 4.65 m car hold the horizontal lens under LENS_ASPECT (LESSONS 0108). The aspect comes from the scene's rect, so the
// Duo's inner display, its tabletop panel and its outer screen each get the framing the web gives that shape.
//
// Where the web measures the DOM (HUD_SEL, TOUCH_SEL), this reads CameraFraming, worked out from the layout.
// What differs from the web, on purpose:
//   - keepClear's yaw off the left rail: the app has no rail, its HUD reads across the top. What that yaw also did on
//     an upright screen stays, as a plain rule: the car's box stays inside the screen's sides (the follow aims between
//     the car and x = 0, so a car a few metres off the centre line had its tail cut).
//   - The Lineup's broadcast: the web's stands 14 m out, about a metre beyond the lamp poles at x = ±13, so a pole
//     crosses the lens every 24 m as a thick black bar. Here every Lineup rig keeps clear of that line. And upright
//     the shot takes 0108's horizontal lens and aims at the car, where the web's lead (3 m ahead on a 14 m shot) cuts
//     the car at the screen's edge on a phone.
// Not here: the replay theatre (the app has none yet), Free Drive, and the pilot view (a player on the web only sees
// it after choosing it, or in Practice, and the app has neither).
import UIKit
import simd
import ColdGasCore

/// What the screens over the scene leave the camera (0113, 0128): worked out when the layout or the scheme changes.
struct CameraFraming {
    /// The scene's height in points, and how far down the top HUD asks the car's centre to stay (its foot + 24 pt).
    var viewH: Float = 0, clearPx: Float = 0
    /// The touch controls over the scene, in the scene's NDC: (top, left, right) of each.
    var pads: [SIMD3<Float>] = []

    init() {}
    init(rows: Bool, scene: CGRect, controls: CGRect, safeTop: CGFloat, oneThumb: Bool) {
        guard scene.height > 40, scene.width > 40 else { return }
        viewH = Float(scene.height)
        // The HUD (GameUI.HUDView): 12 of padding, the readouts' 50, 8, the gas bar's 35. Upright it stands over the car's
        // line; on a wider screen only its row of corners does, and the car stands between them.
        let upright = scene.width < scene.height
        clearPx = Float(max(0, safeTop - scene.minY) + (upright ? 105 + 24 : 52 + 24))
        if rows { return }   // tabletop: the controller has its own panel
        func add(_ r: CGRect) {
            pads.append(SIMD3(Float(1 - 2 * (r.minY - scene.minY) / scene.height),
                              Float(2 * (r.minX - scene.minX) / scene.width - 1), Float(2 * (r.maxX - scene.minX) / scene.width - 1)))
        }
        if oneThumb {
            let s = ThumbPad.size(controls.width)
            add(CGRect(x: controls.maxX - s - 8, y: controls.maxY - s - 8, width: s, height: s))
        } else {
            let m = ClassicPad.margin, stick = ClassicPad.stickSize, b = ClassicPad.buttonsSize
            add(CGRect(x: controls.minX + m, y: controls.maxY - m - stick, width: stick, height: stick))
            add(CGRect(x: controls.maxX - m - b, y: controls.maxY - m - b, width: b, height: b))
        }
    }
}

// --- The director's numbers (director.js) ----------------------------------------------------------------------------
private let K = Float(WALL.lipY / 19.8)   // the Wall's rigs were framed on a 19.8 m lip
private let HOLD_POS = SIMD3<Float>(30, 12, -6), HOLD_LOOK = SIMD2<Float>(21, -4), HOLD_MAX: Float = 1.6
private let ROW_FRONT = Float(SHOW_BOXES.map(\.maxZ).max() ?? -10) + 1
private let ROW_X = Float(SHOW_BOXES.map(\.maxX).max() ?? 3), ROW_Z0 = Float(SHOW_BOXES.map(\.minZ).min() ?? -24), ROW_Z1 = ROW_FRONT - 1
private let CARRY_MIN: Float = 0.3, CAR_LOW: Float = 1.2, CARRY_AHEAD: Float = 0.5, CARRY_EDGE: Float = 0.9, CAR_HALF: Float = 2.6
private let LENS_ASPECT: Float = 0.9
private let LAND_AHEAD = SIMD2<Float>(6.5, -9), LAND_SIDE = SIMD2<Float>(12, 0), LAND_LIFT: Float = 0.2
private let TOP: Float = 0.5, KNEE: Float = 0.06, SIDE_EDGE: Float = 0.94
private let FIT_CAR: Float = 0.06, FIT_ROW: Float = 0.04, FIT_BACK: Float = 2.5
private let SHOW_PAD_Z = Float(SHOW.pad?.z ?? -30)
private let RECUT: Float = 0.64, RECUT_MAX = 2, RECUT_FLOOR: Float = 4, RECUT_GAP: Float = 0.3   // the carry's re-cuts (0118)
private let FRONT_EDGE: Float = 0.94, NOSE_KEEP: Float = 0.55
private struct FrontBox { let minX, maxX, maxY, minZ, maxZ: Float }
/// The row's front body (nearest the Wall): the one a carry placed ahead along the flight can leave behind (0118).
private let FRONT_BOX: FrontBox = {
    guard let b = SHOW_BOXES.max(by: { $0.maxZ < $1.maxZ }) else { return FrontBox(minX: 0, maxX: 0, maxY: 0, minZ: 0, maxZ: 0) }
    return FrontBox(minX: Float(b.minX), maxX: Float(b.maxX), maxY: Float(b.maxY), minZ: Float(b.minZ), maxZ: Float(b.maxZ))
}()
/// The Lineup's lamp poles (courses.js FIXTURES.poles), and how far either side of their line a lens keeps.
private let POLE_X: Float = 13, POLE_CLEAR: Float = 2.5

private func clamp(_ v: Float, _ a: Float, _ b: Float) -> Float { v < a ? a : v > b ? b : v }

final class Director {
    private enum Shot { case none, hold, carry, follow }

    var framing = CameraFraming()
    var shakeHook: Bool? = nil
    private let reduced = UIAccessibility.isReduceMotionEnabled
    private let log = Launch.args.contains("-cam-log"), closeUp = Launch.value("-cam") == "close"

    // The camera: where it is and how it's turned (columns: its right, up and back, as three's quaternion would give).
    private var pos = SIMD3<Float>(), right = SIMD3<Float>(1, 0, 0), up = SIMD3<Float>(0, 1, 0), back = SIMD3<Float>(0, 0, 1)
    private var aspect: Float = 1

    private var course = ""
    private var shot = Shot.none { didSet { if log && shot != oldValue { print("CAM cut \(oldValue) -> \(shot) at car z \(lastCar.z) y \(lastCar.y), row \(ROW_Z0) to \(ROW_FRONT), under pad \(carryUnderPad(lastCar)), pads \(framing.pads)") } } }
    private var lastCar = SIMD3<Float>()
    #if DEBUG
    private let cutTestTick = Launch.value("-cam-cut-tick").flatMap(Int.init) ?? .max
    #endif
    private var last: Double = -1, lastTick = -1, lastPhase: UInt8 = 0, logT: Float = 0
    private var stT: Float = 0, fov: Float = 52, shakeAmp: Float = 0, dip: Float = 0, punch: Float = 0
    private var inited = false, smooth = SIMD3<Float>(), lookS = SIMD3<Float>(), want = SIMD3<Float>(), lookWant = SIMD3<Float>()
    private var peak: Float = 0, launched = false, launchT: Float = 0
    private var hx: Float = 0, hz: Float = 1   // the chase's heading (unit, xz), follows the car's travel
    private var cutT: Float = 0, cutPos = SIMD3<Float>(), cutFov: Float = 40
    private var holdPos = SIMD3<Float>(), holdLook = SIMD3<Float>()
    private var carryT: Float = 0, placed = false, carryPos = SIMD3<Float>(), carryLook = SIMD3<Float>()
    private var carryY: Float = 0, placeT: Float = 0, recuts = 0   // the car's height and the time at the placement; re-cuts so far (0118)
    private var ux: Float = 0, uz: Float = -1   // the shot's bearing, for elev()

    private func snap() { inited = false }
    /// A new run, a recorded run from the top or its loop: forget the last stunt.
    func restart() {
        peak = 0; launched = false; shot = .none; stT = 0; dip = 0; punch = 0; shakeAmp = 0; hx = 0; hz = 1; cutT = 0; lastPhase = 0
        snap()
    }

    /// A rattle of the camera (crash.js director.shake).
    func shake(_ a: Float) { shakeAmp = max(shakeAmp, a) }
    /// The touchdown, felt in the camera: main.js touchdown() with render/impact.js landingImpact().
    func touchdown(sink: Double) {
        if reduced { return }
        let r = Float(max(0, sink)) / 5, s = r >= 1 ? 1 : r * r
        shake(s); dip = max(dip, 0.03 + 0.45 * s); punch = max(punch, 0.6 + 5.4 * s)
    }

    // --- The frame -------------------------------------------------------------------------------------------------
    func update(course c: String, car: SIMD3<Float>, vel: SIMD3<Float>, phase: UInt8, tick: Int, time t: Double, aspect a: Float) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>) {
        let dt = Float(last < 0 ? 0 : min(0.1, max(0, t - last))); last = t
        if c != course { course = c; restart() }
        if tick < lastTick { restart() }   // a recorded run looped
        aspect = max(a, 0.2)
        lastCar = car
        #if DEBUG
        if tick >= cutTestTick && lastTick < cutTestTick && lastTick >= 0 { crashCut(at: car, vel: vel) }   // -cam-cut-tick: the crash cut, on demand
        #endif
        lastTick = tick
        stT += dt
        if phase != lastPhase { if phase == 2 && !reduced { shake(0.15) }; lastPhase = phase }

        if closeUp {   // debug: 5 m beside the car at its height (wheels, suspension, contacts)
            want = car + SIMD3(5.5, 0.4, -1.2); lookWant = car + SIMD3(0, -0.1, 0); ease(dt, 2.4, 3.2); fov = 40
        } else if cutT > 0 {
            // A crash cut: a locked-off camera near the impact, watching the car, then a hard cut back.
            cutT -= dt
            pos = cutPos
            lookAt(SIMD3(car.x, car.y + 0.15, car.z))
            fov = lens(cutFov)
            // The Lineup's chase eases its lens back from the cut's, as it did before 0108 (not from the wider one).
            if cutT <= 0 { shot = .none; snap(); if c == "lineup" { fov = cutFov } }
        } else if c == "wall" || c == "show" {
            wallLive(car, vel, phase, dt)
            keepClear(car)
        } else {
            chase(car, vel, phase, dt)
        }

        if shakeAmp > 0 {
            shakeAmp = max(0, shakeAmp - dt * 3)
            let tt = Float(t)
            pos += SIMD3(sin(tt * 91), sin(tt * 77 + 1), 0) * shakeAmp * 0.08
            if shakeAmp > 0.5 { rotateZ(sin(tt * 53) * (shakeAmp - 0.5) * 0.02) }   // a crash rattles the frame too
        }
        // Touchdown: the camera rides the car's suspension down and back, and punches in, over ≈0.4 s.
        let k = exp(-dt * 7)
        if dip > 0.001 { pos.y -= dip; dip *= k } else { dip = 0 }
        if punch > 0.01 { punch *= k } else { punch = 0 }

        if log {
            logT += dt
            if logT >= 0.25 {
                logT = 0
                let v = toCamera(car), tv = tan((fov - punch) * .pi / 360)
                print(String(format: "CAM phase %d car (%.2f %.2f %.2f) eye (%.2f %.2f %.2f) fov %.1f ndc (%.2f %.2f) shot %@", phase, car.x, car.y, car.z, pos.x, pos.y, pos.z, fov - punch, v.x / -v.z / (tv * aspect), v.y / -v.z / tv, "\(shot)"))
            }
        }
        let view = simd_float4x4(columns: (SIMD4(right.x, up.x, back.x, 0), SIMD4(right.y, up.y, back.y, 0), SIMD4(right.z, up.z, back.z, 0),
                                           SIMD4(-simd_dot(right, pos), -simd_dot(up, pos), -simd_dot(back, pos), 1)))
        return (view, perspective(fovy: (fov - punch) * .pi / 180, aspect: aspect, near: 0.1, far: 1500), pos)
    }

    // --- The camera's moves (three's lookAt, rotateX, rotateZ) ---------------------------------------------------------
    private func lookAt(_ target: SIMD3<Float>) {
        var z = pos - target
        if simd_length_squared(z) < 1e-8 { z = SIMD3(0, 0, 1) }
        z = simd_normalize(z)
        var x = simd_cross(SIMD3<Float>(0, 1, 0), z)
        if simd_length_squared(x) < 1e-8 { z.z += 1e-4; z = simd_normalize(z); x = simd_cross(SIMD3<Float>(0, 1, 0), z) }
        x = simd_normalize(x)
        right = x; up = simd_cross(z, x); back = z
    }
    private func rotateX(_ a: Float) { let c = cos(a), s = sin(a), y = up, z = back; up = y * c + z * s; back = z * c - y * s }
    private func rotateWorldY(_ a: Float) {
        if a == 0 { return }
        let c = cos(a), s = sin(a)
        func r(_ v: SIMD3<Float>) -> SIMD3<Float> { SIMD3(v.x * c + v.z * s, v.y, v.z * c - v.x * s) }
        right = r(right); up = r(up); back = r(back)
    }
    private func rotateZ(_ a: Float) { let c = cos(a), s = sin(a), x = right, y = up; right = x * c + y * s; up = y * c - x * s }
    /// A world point in the camera's frame, from `from` (its own place by default); in front of it is −z.
    private func toCamera(_ p: SIMD3<Float>, from: SIMD3<Float>? = nil) -> SIMD3<Float> {
        let d = p - (from ?? pos)
        return SIMD3(simd_dot(d, right), simd_dot(d, up), simd_dot(d, back))
    }

    /// Smoothly fly the camera toward want / lookWant (rate per second).
    private func ease(_ dt: Float, _ rate: Float, _ lookRate: Float = 8) {
        if !inited { smooth = want; lookS = lookWant; inited = true }
        smooth += (want - smooth) * (1 - exp(-dt * rate))
        lookS += (lookWant - lookS) * (1 - exp(-dt * lookRate))
        pos = smooth
        lookAt(lookS)
    }
    private func fovTo(_ f: Float, _ dt: Float, _ rate: Float = 2) { fov += (f - fov) * (1 - exp(-dt * rate)) }
    /// How far under LENS_ASPECT the screen is: 0 at it and wider, 1 from an upright phone's 0.5 down (0119).
    private var upright: Float { clamp((LENS_ASPECT - aspect) / 0.4, 0, 1) }
    /// The horizontal lens a side-on shot holds under LENS_ASPECT (0108).
    private func lens(_ f: Float) -> Float { aspect >= LENS_ASPECT ? f : atan(tan(f * .pi / 360) * LENS_ASPECT / aspect) * 360 / .pi }
    /// The height to add to a ground shot's aim, `d` m from it under lens(f), so the car sits about LAND_LIFT × u of the
    /// half-frame below the middle (0119).
    private func liftFor(_ u: Float, _ d: Float, _ f: Float) -> Float { d * LAND_LIFT * u * tan(lens(f) * .pi / 360) }
    /// Whether a parked body stands across the level line from the car to `dx` m out at +x, the side stand's sight (0119).
    private func rowBlocks(_ c: SIMD3<Float>, _ dx: Float) -> Bool {
        for b in SHOW_BOXES where c.z >= Float(b.minZ) - 0.5 && c.z <= Float(b.maxZ) + 0.5 && Float(b.maxX) >= c.x - 0.5 && Float(b.minX) <= c.x + dx { return true }
        return false
    }

    // --- Keeping the car clear of the HUD (0063, 0107) -----------------------------------------------------------------
    /// The highest the car's centre goes, in NDC.
    private var topLine: Float { min(TOP, framing.viewH > 0 ? 1 - 2 * framing.clearPx / framing.viewH : 1) }
    private func knee(_ e: Float) -> Float { e <= 0 ? 0 : e < KNEE ? e * e / (2 * KNEE) : e - KNEE / 2 }
    /// After a shot has looked where it wants, pitch just enough that the car's centre stays under the top line, and,
    /// upright once launched (the carry excepted, it stands still), turn about the world's up just enough that its box
    /// stays inside the screen's sides.
    private func keepClear(_ car: SIMD3<Float>) {
        var v = toCamera(car)
        if v.z > -0.5 { return }
        let tv = tan(fov * .pi / 360)
        if launched && aspect < 1 && shot != .carry {
            let bearing = atan2(v.x, -v.z), edge = atan(SIDE_EDGE * tv * aspect) - atan(CAR_HALF / -v.z)
            rotateWorldY((bearing < 0 ? 1 : -1) * knee(abs(bearing) - max(0, edge) + KNEE / 2))
            v = toCamera(car)
        }
        rotateX(knee(atan2(v.y, -v.z) - atan(topLine * tv) + KNEE / 2))
    }

    // --- The carry over the row (0113, 0116, 0128) -----------------------------------------------------------------------
    /// The tracking framing for the car where it is, trucked along the flight so the car stands left of centre with the
    /// way it's going in frame (no further than halfway to the pad), then fitted to the band the HUD leaves.
    private func placeCarry(_ car: SIMD3<Float>) {
        want = SIMD3(car.x + 21 + 0.5 * max(0, car.y - 10), clamp(car.y * 0.5 + 1.5, 2.2, 14), car.z + 2)
        lookWant = SIMD3(car.x * 0.5, car.y * 0.55 + 0.8, car.z - 2)
        let d = hypot(want.x - car.x, want.z - car.z), tanH = tan(fov * .pi / 360) * aspect
        let ahead = min(CARRY_AHEAD * d * tanH, max(0, (car.z - SHOW_PAD_Z) / 2))
        want.z -= ahead; lookWant.z -= ahead
        if aspect < 1 { fitRowAcross(car, tanH) }
        fitCarry(car)
        if aspect >= 1 { keepFront(car, tanH) }
        carryPos = want; carryLook = lookWant; placed = true; carryY = car.y; placeT = stT
    }
    /// Each time the car has come down to RECUT of the height it was placed at, the carry cuts to a fresh placement, at most
    /// twice, so the car grows as the span closes. Upright screens keep one placement across the row (0116, 0118).
    private func recut(_ car: SIMD3<Float>) -> Bool {
        aspect >= 1 && recuts < RECUT_MAX && car.y < carryY * RECUT && car.y > RECUT_FLOOR && stT - placeT >= RECUT_GAP
    }
    /// A placement low over the row's back half, trucked ahead along the flight, can lose the row's front body off the frame's
    /// edge behind the car. Truck it back until that body is inside FRONT_EDGE, as far as the car's nose stays inside
    /// NOSE_KEEP. Moves the camera and its aim together, so the fit holds. Two secant steps (0118, director.js keepFront).
    private func keepFront(_ car: SIMD3<Float>, _ tanH: Float) {
        var b = want - lookWant
        if simd_length_squared(b) < 1e-8 { b = SIMD3(0, 0, 1) }
        b = simd_normalize(b)
        var r = simd_cross(SIMD3<Float>(0, 1, 0), b)
        if simd_length_squared(r) < 1e-8 { return }
        r = simd_normalize(r)
        let at = want
        func ndc(_ x: Float, _ y: Float, _ z: Float, _ dz: Float) -> Float {
            let d = SIMD3(x, y, z - dz) - at
            return simd_dot(d, r) / max(0.5, -simd_dot(d, b)) / tanH
        }
        func front(_ dz: Float) -> Float {
            var m = Float.infinity
            for i in 0..<8 {
                m = min(m, ndc(i & 1 != 0 ? FRONT_BOX.maxX : FRONT_BOX.minX, i & 2 != 0 ? FRONT_BOX.maxY : 0, i & 4 != 0 ? FRONT_BOX.maxZ : FRONT_BOX.minZ, dz))
            }
            return m
        }
        func nose(_ dz: Float) -> Float { ndc(car.x, car.y, car.z - CAR_HALF, dz) }
        let f0 = front(0)
        if f0 >= -FRONT_EDGE { return }
        let df = front(1) - f0, dn = nose(1) - nose(0)
        if abs(df) < 1e-4 { return }
        let noseMax = dn > 1e-4 ? max(0, (NOSE_KEEP - nose(0)) / dn) : Float.infinity
        var dz = min((-FRONT_EDGE - f0) / df, noseMax)
        let f1 = front(dz)
        if f1 < -FRONT_EDGE && dz > 0 && f1 - f0 > 1e-4 { dz = min(dz * (-FRONT_EDGE - f0) / (f1 - f0), noseMax) }
        dz = clamp(dz, 0, ROW_Z1 - ROW_Z0)   // never toward the pad, never further back than the row is long
        want.z += dz; lookWant.z += dz
    }
    /// Upright, abeam of the row's middle, back far enough that the stretch from the car's tail at the cut to its nose at
    /// the row's back fits across the frame inside the edge carryOut cuts at (0116).
    private func fitRowAcross(_ car: SIMD3<Float>, _ tanH: Float) {
        let z1 = max(car.z, ROW_FRONT) + CAR_HALF, z0 = ROW_Z0 - CAR_HALF
        let stand = ROW_X + (z1 - z0) / 2 / (CARRY_EDGE * tanH)
        if want.x < stand { want.x = stand }
        want.z = (z1 + z0) / 2; lookWant.z = want.z
    }
    /// Upright with touch controls up (0128): hand over to the follow as the car's box nears a control's top in its column.
    private func carryUnderPad(_ car: SIMD3<Float>) -> Bool {
        if !placed || aspect >= 1 || framing.pads.isEmpty || stT - carryT < CARRY_MIN { return false }
        let v = toCamera(car, from: carryPos)
        if v.z > -0.5 { return false }
        let tv = tan(fov * .pi / 360), th = tv * aspect
        let ny = (v.y - CAR_LOW) / -v.z / tv, nx = v.x / -v.z / th, hw = CAR_HALF / -v.z / th
        for p in framing.pads where ny < p.x && nx + hw > p.y && nx - hw < p.z { return true }
        return false
    }
    /// The car's nose near the far edge of the locked-off frame (or the car behind it).
    private func carryOut(_ car: SIMD3<Float>) -> Bool {
        let v = toCamera(car, from: carryPos)
        return v.z > -0.5 || (v.x + CAR_HALF) / -v.z > CARRY_EDGE * tan(fov * .pi / 360) * aspect
    }
    /// A point's angle above the camera's level line, from `want`, with its depth along the shot's bearing.
    private func elev(_ x: Float, _ y: Float, _ z: Float) -> Float { atan2(y - want.y, max(0.5, (x - want.x) * ux + (z - want.z) * uz)) }
    @discardableResult private func bearing() -> Float {
        let d = hypot(lookWant.x - want.x, lookWant.z - want.z)
        if d >= 0.5 { ux = (lookWant.x - want.x) / d; uz = (lookWant.z - want.z) / d }
        return d
    }
    private func footElev(_ z: Float) -> Float { min(elev(ROW_X, 0, z), elev(ROW_X, 0, ROW_Z0), elev(ROW_X, 0, ROW_Z1)) }
    /// Fit the car and the row between the lines: pitched within the band, and where the span is taller than the band at
    /// this lens, the camera stands back about the middle of the two, just as far as it needs. All from the car's state.
    private func fitCarry(_ car: SIMD3<Float>) {
        let T = tan(fov * .pi / 360), bandB: Float = -1   // nothing of the app's HUD docks across the bottom middle
        let tN = topLine - FIT_CAR, bN = bandB + FIT_ROW
        if tN - bN < 0.2 { return }
        let aC = atan(tN * T), aB = atan(bN * T), span = aC - aB
        let bz = clamp(want.z, ROW_Z0, ROW_Z1)
        var dh = bearing()
        if dh < 0.5 { return }
        let phi0 = atan2(lookWant.y - want.y, dh)
        var eC = elev(car.x, car.y, car.z), eB = footElev(bz)
        if eC - eB > span {
            let s = min(FIT_BACK, tan((eC - eB) / 2) / tan(span / 2))
            let m = SIMD3((car.x + ROW_X) / 2, car.y / 2, (car.z + bz) / 2)
            want = m + (want - m) * s
            dh = bearing()
            eC = elev(car.x, car.y, car.z); eB = footElev(clamp(want.z, ROW_Z0, ROW_Z1))
        }
        let lo = eC - aC, hi = eB - aB
        let phi = lo > hi ? (lo + hi) / 2 : clamp(phi0, lo, hi)
        lookWant.y = want.y + dh * tan(phi)
    }

    // --- Lineup ------------------------------------------------------------------------------------------------------------
    /// A lens stays on the car's side of the lamp poles' line, and POLE_CLEAR off it, so it never moves across it.
    private func clearOfPoles(_ x: Float, _ car: SIMD3<Float>) -> Float {
        let s: Float = x < 0 ? -1 : 1, a = abs(x)
        return abs(car.x) < POLE_X ? s * Swift.min(a, POLE_X - POLE_CLEAR) : s * Swift.max(a, POLE_X + POLE_CLEAR)
    }
    private func chase(_ car: SIMD3<Float>, _ vel: SIMD3<Float>, _ phase: UInt8, _ dt: Float) {
        let speed = hypot(vel.x, vel.z), air = phase == 2, u = upright
        // Follow the direction of travel (smoothed), so a steering input reads as a turn on screen.
        if speed > 1.5 {
            let k = 1 - exp(-dt * 3)
            hx += (vel.x / speed - hx) * k; hz += (vel.z / speed - hz) * k
            let l = hypot(hx, hz); hx /= l > 0 ? l : 1; hz /= l > 0 ? l : 1
        }
        let broadcast = air || (phase == 3 && stT < 1.2)
        var f = 48 + min(16, speed * 0.42) + (air ? 4 : 0)
        if broadcast {
            // Broadcast three-quarter: off to the right, a little ahead, low. Upright, aimed at the car rather than ahead of
            // it (the look's own lag is vel / 8), so it stays in the narrow frame.
            want = SIMD3(car.x + 14, max(3.4, car.y * 0.6 + 2.2), car.z + 2 - min(6, speed * 0.15))
            lookWant = SIMD3(car.x, car.y + 0.2, car.z + 3 * (1 - u) + u * vel.z / 8)
            f = lens(f)
        } else if phase == 3 || phase == 4 {
            want = SIMD3(car.x + 7, 2.4, car.z - 6)
            lookWant = car
            f = lens(f)
        } else {
            // Car sits just below centre, clear of the HUD; the camera trails the heading.
            let back = 7.4 + speed * 0.06
            want = SIMD3(car.x - hx * back, car.y + 2.0 + speed * 0.012, car.z - hz * back)
            lookWant = SIMD3(car.x + hx * 4.5, car.y + 0.35, car.z + hz * 4.5)
        }
        want.x = clearOfPoles(want.x, car)
        ease(dt, air ? 3.2 : 5)
        fovTo(f, dt, 2 + 2 * u)   // the wider lens is there before the car is across the row
    }

    // --- Wall and Show -------------------------------------------------------------------------------------------------------
    /// Where the stunt is, from the car's state alone: climbing, hanging on the ledge, launched.
    private func trackWall(_ car: SIMD3<Float>, _ vel: SIMD3<Float>, _ phase: UInt8) {
        peak = max(peak, car.y)
        if !launched && peak > 6 && (car.z < Float(WALL.lipZ) - 0.8 || (phase == 2 && vel.y < -1)) { launched = true; launchT = stT }
    }
    private func wallLive(_ car: SIMD3<Float>, _ vel: SIMD3<Float>, _ phase: UInt8, _ dt: Float) {
        trackWall(car, vel, phase)
        let speed = simd_length(vel)
        let landed = launched && (phase == 3 || phase == 4 || (car.y < 1 && stT - launchT > 0.6))
        if !launched && car.z < -16 && peak < 1.5 {
            // Approach: chase from behind, the curl growing ahead.
            want = SIMD3(car.x * 0.6, car.y + 2.1 + speed * 0.012, car.z - 7.6 - speed * 0.07)
            lookWant = SIMD3(car.x, car.y + 0.9 + max(0, 30 + car.z) * 0.12, car.z + 6)
            ease(dt, 5)
            fovTo(50 + min(14, speed * 0.36), dt)
        } else if !launched && car.y < 15 * K {
            // Climbing: swing out to the side, keep the car and the whole curl in frame.
            want = SIMD3(24 * K, clamp(car.y * 0.7 + 4, 3.2, 22 * K), min(car.z, 6 * K) - 11 * K)
            lookWant = SIMD3(car.x * 0.5, car.y * 0.75 + 3.5, car.z * 0.6 + 3)
            ease(dt, 2.6, 6)
            fovTo(50, dt)
        } else if !launched {
            // Hanging inverted on the ledge: the dramatic wide shot.
            want = SIMD3(27 * K, 13.5 * K, -13 * K)
            lookWant = SIMD3(car.x * 0.3, car.y * 0.6 + 6, car.z * 0.5 + 2.5)
            ease(dt, 1.8, 4)
            fovTo(46, dt, 1.5)
        } else if !landed && course == "show" {
            // The release is a hard cut to a locked-off camera out to the side and ahead of the ledge (0063).
            if shot == .none {
                shot = .hold; fov = 54; snap()
                holdPos = SIMD3(car.x + HOLD_POS.x, HOLD_POS.y, car.z + HOLD_POS.z)
                holdLook = SIMD3(car.x * 0.5, HOLD_LOOK.x, car.z + HOLD_LOOK.y)
            }
            if shot == .hold && (car.z < ROW_FRONT || stT - launchT > HOLD_MAX) { shot = .carry; snap(); placed = false; carryT = stT; recuts = 0 }
            if shot == .hold {
                pos = holdPos
                lookAt(holdLook)
                return
            }
            // The carry is locked off too (0113): placed at the cut, then still while the car crosses it. If the car nears
            // the far edge it cuts to a fresh placement from there; past the row's back, or nearing a touch control on an
            // upright screen (0128), it cuts to the tracking follow down to the pad.
            if shot == .carry && (car.z < ROW_Z0 || carryUnderPad(car)) { shot = .follow; snap() }
            if shot == .carry {
                if !placed || carryOut(car) { placeCarry(car) }
                else if recut(car) { recuts += 1; placeCarry(car) }
                pos = carryPos
                lookAt(carryLook)
                // A car that comes down on the row: the landing rig eases in from here.
                smooth = carryPos; lookS = carryLook; inited = true
                return
            }
            want = SIMD3(car.x + 21 + 0.5 * max(0, car.y - 10), clamp(car.y * 0.5 + 1.5, 2.2, 14), car.z + 2)
            lookWant = SIMD3(car.x * 0.5, car.y * 0.55 + 0.8, car.z - 2)
            ease(dt, 3.2, 9)
            fovTo(54, dt)
        } else if !landed {
            // The fall and the roll: wide from the side, tracking.
            want = SIMD3(car.x + 19, clamp(car.y * 0.55 + 3.5, 3, 18), car.z + 5)
            lookWant = SIMD3(car.x, car.y, car.z - 1.5)
            ease(dt, 3.2, 9)
            fovTo(48, dt)
        } else {
            // Landed: low, ahead of the car as it rolls back down the approach. On the Show on an upright screen (0119) the
            // rig swings round to the car's open side, broadside, and lifts its aim so the car sits under the middle.
            let u: Float = course == "show" && !rowBlocks(car, LAND_SIDE.x) ? upright : 0
            let o = LAND_AHEAD + (LAND_SIDE - LAND_AHEAD) * u
            want = SIMD3(car.x + o.x, 1.25, car.z + o.y)
            lookWant = SIMD3(car.x, car.y + 0.2 + liftFor(u, simd_length(o), 40), car.z)
            ease(dt, 3, 8)
            fovTo(lens(40), dt)
        }
    }

    // --- A crash cut (crash.js cutTo) -----------------------------------------------------------------------------------------
    /// Hold a locked-off camera beside the impact, looking at the car, with a clear line of sight: the open side first,
    /// low, then higher over the roofs, then the other side. Nothing clear: no cut.
    func crashCut(at p: SIMD3<Float>, vel: SIMD3<Float>) {
        let sp = hypot(vel.x, vel.z)
        let hx = sp > 0.5 ? vel.x / sp : 0, hz = sp > 0.5 ? vel.z / sp : -1
        var sx = hz, sz = -hx        // perpendicular to the travel, in plan
        if sx < 0 { sx = -sx; sz = -sz }   // the stage's open side (+x) first
        let ty = max(0.5, p.y) + 0.4
        for side: Float in [1, -1] {
            for h in [max(0.6, min(5, p.y * 0.45 + 1)), 4.6, 7.5] as [Float] {
                let at = SIMD3(p.x + side * sx * 11 + hx * 3.5, h, p.z + side * sz * 11 + hz * 3.5)
                if sightClear(at, SIMD3(p.x, ty, p.z)) {
                    cutPos = at; cutT = 1.9; cutFov = 42
                    if log { print("CAM crash cut at \(at) for a hit at \(p)") }
                    return
                }
            }
        }
    }
    private func sightClear(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Bool {
        if clearance(a) < 0.8 { return false }
        for k in 1..<8 where clearance(a + (b - a) * Float(k) / 8) < 0.25 { return false }
        return true
    }
    /// courses.js surface(), for a camera's sight: the floor, the curl and the row as parked (the renderer has no world to
    /// ask; a struck car moving a little doesn't change a line of sight 0.25 m wide), and the Lineup's poles.
    private func clearance(_ p: SIMD3<Float>) -> Float {
        var phi = p.y
        if course == "wall" || course == "show" {
            if abs(p.x) <= Float(WALL.width) / 2 { phi = min(phi, curlDistance(p.z, p.y)) }
        } else if abs(abs(p.x) - POLE_X) < 1 { phi = min(phi, abs(abs(p.x) - POLE_X)) }
        for b in (course == "show" ? SHOW_BOXES : course == "lineup" ? LINEUP_BOXES : []) {
            let d = SIMD3(max(Float(b.minX) - p.x, p.x - Float(b.maxX)), max(Float(b.minY) - p.y, p.y - Float(b.maxY)), max(Float(b.minZ) - p.z, p.z - Float(b.maxZ)))
            let out = simd_length(simd_max(d, .zero)), inside = min(0, max(d.x, d.y, d.z))
            phi = min(phi, out + inside)
        }
        return phi
    }
    /// courses.js wallSdf: distance to the curl's slab, in its profile plane.
    private func curlDistance(_ z: Float, _ y: Float) -> Float {
        let r = Float(WALL.r1), aEnd = -Float.pi / 2 + Float(WALL.turn), ledge = Float(WALL.ledge), slab = Float(WALL.slab)
        let pz = r * cos(aEnd), py = r + r * sin(aEnd), tz = -sin(aEnd), ty = cos(aEnd), nz = -cos(aEnd), ny = -sin(aEnd)
        var best = Float.greatestFiniteMagnitude   // (simd's min() can't be trusted with an infinity: it returned one)
        let dy = y - r, d = hypot(z, dy), th = atan2(dy, z)
        if th >= -Float.pi / 2 && th <= aEnd && d > 1e-6 { best = r - d }
        let u = (z - pz) * tz + (y - py) * ty
        if u >= 0 && u <= ledge {
            let sd = (z - pz) * nz + (y - py) * ny
            if abs(sd) < abs(best) { best = sd }
        }
        if best == .greatestFiniteMagnitude { return best }
        if best >= 0 { return best }
        if best > -slab { return min(best, -(slab + best)) }
        return -best - slab
    }
}
