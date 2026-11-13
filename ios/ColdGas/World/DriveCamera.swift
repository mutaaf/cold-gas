// Free Drive's cameras, src/drive/camera.js's chase and bumper ported (docs/NATIVE-FREEDRIVE.md §5):
//   chase   behind and above, trailing the car's heading (leaning toward where it's going in a slide), longer with
//           speed, kept clear of the ground; upright, wider, further back and higher (the web's H_MIN rule).
//   bumper  on the nose, the horizon locked to the car.
// Worked in world metres (Double): the renderer gets it relative to the floating origin.
import simd

final class DriveCamera {
    enum Mode: String, CaseIterable { case chase, bumper }
    var mode: Mode = .chase
    private var inited = false
    private var hx = 0.0, hz = 1.0
    private var pos = SIMD3<Double>(), look = SIMD3<Double>()
    private(set) var fov: Double = 58
    private(set) var eye = SIMD3<Double>(), target = SIMD3<Double>(), up = SIMD3<Double>(0, 1, 0)
    func snap() { inited = false }
    func cycle() { mode = mode == .chase ? .bumper : .chase; inited = false }

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
        let fw = DriveCamera.fovFor(56, aspect) + min(20, speed * 0.13) * (aspect < 1 ? 0.4 : 1)
        fov += (fw - fov) * (1 - exp(-dt * 2.5))
    }

    /// The view (render space: relative to `origin`) and the lens. The far plane reaches the horizon; the near plane is as
    /// far out as the bumper camera allows, for the depth buffer's sake.
    func matrices(origin: SIMD3<Double>, aspect: Float) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>) {
        let e = SIMD3<Float>(eye - origin), t = SIMD3<Float>(target - origin), u = SIMD3<Float>(up)
        return (lookAt(eye: e, target: t, up: u), perspective(fovy: Float(fov) * .pi / 180, aspect: aspect, near: 0.5, far: 45_000), e)
    }
}
