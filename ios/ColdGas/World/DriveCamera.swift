// Free Drive's cameras, src/drive/camera.js's chase and bumper ported (docs/NATIVE-FREEDRIVE.md §5):
//   chase   behind and above, trailing the car's heading (leaning toward where it's going in a slide), longer with
//           speed, kept clear of the ground; upright, wider, further back and higher (the web's H_MIN rule).
//   bumper  on the nose, the horizon locked to the car.
//   cinema  (0225) a trackside lens: a spot picked ahead of the car and off to one side at head height, held while the car
//           drives past it on a long lens, then the next spot further on, the other side (a broadcast replay's look).
// Worked in world metres (Double): the renderer gets it relative to the floating origin.
import simd
import UIKit

final class DriveCamera {
    enum Mode: String, CaseIterable { case chase, cinema, bumper }
    var mode: Mode = .chase
    private var inited = false
    private var hx = 0.0, hz = 1.0
    private var pos = SIMD3<Double>(), look = SIMD3<Double>()
    private(set) var fov: Double = 58
    private(set) var eye = SIMD3<Double>(), target = SIMD3<Double>(), up = SIMD3<Double>(0, 1, 0)
    func snap() { inited = false }
    /// An impact felt in the lens (0223): the amplitude the crash asks for, decaying at 3 a second, as the Director's.
    private var shakeAmp: Float = 0, shakeT = 0.0, roadT = 0.0
    let reduced = UIAccessibility.isReduceMotionEnabled
    func shake(_ a: Float) { if !reduced { shakeAmp = max(shakeAmp, a) } }
    func cycle() { mode = mode == .chase ? .cinema : mode == .cinema ? .bumper : .chase; inited = false; spot = nil }
    // The cinema's spot (world metres), which side the last one was on, and its eased aim.
    private var spot: SIMD3<Double>?, spotSide = 1.0, aim = SIMD3<Double>()

    /// A phone held upright sees a sliver of the world: widen to at least 46° across (up to 80° tall).
    static func fovFor(_ base: Double, _ aspect: Double) -> Double {
        if !(aspect < 1) { return base }
        let need = 2 * atan(tan(23 * .pi / 180) / aspect) * 180 / .pi
        return min(80, max(base, need))
    }

    /// `ground(x, z)`: the ground's height there (the camera stays clear of it).
    func update(dt: Double, carPos p: SIMD3<Double>, carQuat q: simd_quatd, vel v: SIMD3<Double>, aspect: Double, ground: (Double, Double) -> Double) {
        let speed = simd_length(v)
        if mode == .bumper {
            let f = q.act(SIMD3(0, 0, 1)), u = q.act(SIMD3(0, 1, 0))
            eye = p + f * 0.55 + u * 0.62
            target = eye + f * 30 - u * 0.6
            up = u
            fov = DriveCamera.fovFor(66, aspect) + min(10, speed * 0.06) * (aspect < 1 ? 0.4 : 1)
            inited = false
            return
        }
        if mode == .cinema { cinema(dt: dt, p: p, q: q, v: v, speed: speed, aspect: aspect, ground: ground); return }
        let f = q.act(SIMD3(0, 0, 1))
        var fx = f.x, fz = f.z
        let fl = max(1e-9, (fx * fx + fz * fz).squareRoot()); fx /= fl; fz /= fl
        let vl = (v.x * v.x + v.z * v.z).squareRoot()
        if vl > 4 && (v.x * fx + v.z * fz) / vl > 0.2 { let k = min(1, (vl - 4) / 10) * 0.55; fx = fx * (1 - k) + v.x / vl * k; fz = fz * (1 - k) + v.z / vl * k }
        let l = max(1e-9, (fx * fx + fz * fz).squareRoot()); fx /= l; fz /= l
        if !inited { hx = fx; hz = fz }
        let k = 1 - exp(-dt * (3.2 + speed * 0.04))
        hx += (fx - hx) * k; hz += (fz - hz) * k
        let hl = max(1e-9, (hx * hx + hz * hz).squareRoot()); hx /= hl; hz /= hl
        let tall = aspect < 1
        let back = min(9.5, 6.3 + speed * 0.04) * (tall ? 1.3 : 1), upH = (1.85 + min(1.2, speed * 0.008)) * (tall ? 1.45 : 1)
        // The player's look (a swipe on empty glass): the heading turned round the car, the eye raised or lowered.
        let lk = DriveLook.shared.step(dt), lc = cos(lk.yaw), ls = sin(lk.yaw)
        let rx = hx * lc - hz * ls, rz = hx * ls + hz * lc
        var want = SIMD3(p.x - rx * back, p.y + upH + back * lk.pitch, p.z - rz * back)
        want.y = max(want.y, ground(want.x, want.z) + 1.1)
        let ahead = tall ? 9.0 : 4.0
        let lookW = SIMD3(p.x + rx * ahead, p.y + 0.85, p.z + rz * ahead)
        if !inited { pos = want; look = lookW; inited = true }
        let kp = 1 - exp(-dt * 12), ky = 1 - exp(-dt * 7)
        pos.x += (want.x - pos.x) * kp; pos.z += (want.z - pos.z) * kp; pos.y += (want.y - pos.y) * ky
        pos.y = max(pos.y, ground(pos.x, pos.z) + 0.6)
        look += (lookW - look) * (1 - exp(-dt * 14))
        eye = pos; target = look; up = SIMD3(0, 1, 0)
        if shakeAmp > 0 {
            shakeAmp = max(0, shakeAmp - Float(dt) * 3); shakeT += dt
            let a = Double(shakeAmp) * 0.08
            eye += SIMD3(sin(shakeT * 91) * a, sin(shakeT * 77 + 1) * a, sin(shakeT * 63 + 2) * a * 0.5)
        }
        // The road through the lens (0228): a faint, fast tremor that grows with speed (a camera car's mount), never under
        // Reduce Motion.
        if !reduced && speed > 3 {
            roadT += dt
            let a = min(1, (speed - 3) / 45) * 0.012
            eye += SIMD3(0, (sin(roadT * 37) * 0.6 + sin(roadT * 59 + 1.3) * 0.4) * a, 0)
            target += SIMD3(sin(roadT * 23 + 0.7) * a * 0.5, sin(roadT * 41) * a * 0.4, 0)
        }
        let fw = DriveCamera.fovFor(56, aspect) + min(20, speed * 0.13) * (aspect < 1 ? 0.4 : 1)
        fov += (fw - fov) * (1 - exp(-dt * 2.5))
    }

    private func cinema(dt: Double, p: SIMD3<Double>, q: simd_quatd, v: SIMD3<Double>, speed: Double, aspect: Double, ground: (Double, Double) -> Double) {
        let f = q.act(SIMD3(0, 0, 1))
        var d = speed > 3 ? SIMD3(v.x, 0, v.z) : SIMD3(f.x, 0, f.z)
        d /= max(1e-6, simd_length(d))
        let side = SIMD3(d.z, 0, -d.x)
        // A new spot when there's none, the car's well past this one, or it's got too far away (a turn off the line).
        if let s = spot {
            let rel = s - p, along = simd_dot(SIMD3(rel.x, 0, rel.z), d), dist = simd_length(rel)
            if along < -max(12, speed * 0.7) || dist > 70 { spot = nil }
        }
        if spot == nil {
            spotSide = -spotSide
            let ahead = 14 + speed * 0.9, off = 4 + min(4, speed * 0.1)
            var s = p + d * ahead + side * (off * spotSide)
            s.y = max(ground(s.x, s.z), p.y - 1.5) + 1.15 + min(1.2, speed * 0.02)
            spot = s; aim = p
        }
        guard let s = spot else { return }
        // The aim leads the car a little and eases (a camera operator's pan); the lens tightens with distance so ≈ 7 m of road
        // spans the screen's narrower side (on an upright phone, its width).
        let lead = p + SIMD3(v.x, 0, v.z) * 0.12 + SIMD3(0, 0.35, 0)
        aim += (lead - aim) * (inited ? 1 - exp(-dt * 9) : 1)
        inited = true
        eye = s; target = aim; up = SIMD3(0, 1, 0)
        let dist = max(3, simd_length(aim - s))
        let want = 2 * atan(3.6 / (dist * min(1, aspect))) * 180 / .pi
        fov = min(70, max(8, want))
        if shakeAmp > 0 { shakeAmp = max(0, shakeAmp - Float(dt) * 3) }
    }

    /// The view (render space: relative to `origin`) and the lens. The far plane reaches the horizon; the near plane is as
    /// far out as the bumper camera allows, for the depth buffer's sake.
    func matrices(origin: SIMD3<Double>, aspect: Float) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>) {
        let e = SIMD3<Float>(eye - origin), t = SIMD3<Float>(target - origin), u = SIMD3<Float>(up)
        return (lookAt(eye: e, target: t, up: u), perspective(fovy: Float(fov) * .pi / 180, aspect: aspect, near: 0.5, far: 45_000), e)
    }
}
