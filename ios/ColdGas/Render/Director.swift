// The camera (a first cut of src/render/director.js, 0153). The Show plays out in the Wall's side profile (z–y), so the
// rig is a side-on tracking shot that frames the climb, the hang, the release, the arc over the row and the landing,
// on critically damped springs (no jolts at a phase change). The lens holds the HORIZONTAL field of view across
// aspects (LESSONS 0108), so the Duo's near-square inner screen and its upright outer one frame the car the same.
import simd

final class Director {
    private var eye = SIMD3<Float>(18, 3, -8), look = SIMD3<Float>(0, 1, -6), ev = SIMD3<Float>(), lv = SIMD3<Float>()
    private var last: Double = -1
    var hfov: Float = 1.05   // ≈ 60° across
    var shakeHook: Bool? = nil
    private var shakeAmp: Float = 0
    /// A rattle of the camera (crash.js director.shake): decays over ≈0.4 s.
    func shake(_ a: Float) { shakeAmp = max(shakeAmp, a) }

    func update(car: SIMD3<Float>, quat: simd_quatf, phase: UInt8, time t: Double, aspect: Float) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>) {
        let dt = Float(last < 0 ? 1.0 / 60 : min(0.1, max(0.0, t - last))); last = t
        // Wider and higher while airborne (the arc over the row), closer on the ground.
        let air: Float = phase == 2 ? 1 : 0
        let side: Float = 15 + 7 * air + 0.35 * max(0, car.y - 2)
        var wantEye = SIMD3<Float>(side, 2.2 + car.y * 0.55 + 2 * air, car.z - 3)
        var wantLook = SIMD3<Float>(0, max(0.8, car.y * 0.85), car.z - 1.5)
        if Launch.value("-cam") == "close" {   // debug: 5 m beside the car at its height (wheels, suspension, contacts)
            wantEye = car + SIMD3(5.5, 0.4, -1.2); wantLook = car + SIMD3(0, -0.1, 0)
        }
        if last == t && ev == .zero && lv == .zero && eye.x == 18 { eye = wantEye; look = wantLook }
        spring(&eye, &ev, wantEye, 2.4, dt)
        spring(&look, &lv, wantLook, 3.2, dt)
        var shook = eye
        if shakeAmp > 0.01 {
            let tt = Float(t)
            shook += SIMD3(sin(tt * 61) * sin(tt * 17), sin(tt * 53 + 1) * sin(tt * 23), sin(tt * 47 + 2) * sin(tt * 19)) * shakeAmp * 0.06
            shakeAmp *= exp(-dt * 6)
        }
        let vfov = 2 * atan(tan(hfov / 2) / max(aspect, 0.2))
        return (lookAt(eye: shook, target: look, up: [0, 1, 0]), perspective(fovy: min(vfov, 2.2), aspect: aspect, near: 0.1, far: 1500), shook)
    }
    // Critically damped spring toward `to` at angular frequency w (exact for a constant target over the step).
    private func spring(_ x: inout SIMD3<Float>, _ v: inout SIMD3<Float>, _ to: SIMD3<Float>, _ w: Float, _ dt: Float) {
        let d = x - to, e = exp(-w * dt)
        let tmp = (v + w * d) * dt
        v = (v - w * tmp) * e
        x = to + (d + tmp) * e
    }
}
