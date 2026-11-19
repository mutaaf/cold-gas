// A scored set's water and mud in motion (0340; the web's src/render/surfaces.js createSurfaceFx): the splash-down's crown,
// the wake as the car moves in the tank, and the mud thrown off the rear tyres. Read from the track's own pose (never the
// sim: a replay splashes as the run did), into the crash's puff pool (Crash.kick), so it costs no pipeline, no draw call and
// no allocation of its own, and every look (Real, Anime, 8-bit) draws it as it draws the dust. The tanks, the water and the
// mud themselves are the stage's static meshes (scripts/native-stage.mjs bakes them from the web's builders).
//
// NOTE for the Free Drive WATER (0320) and MATTER (0330) tracks: this is the scored sets' own simple spray. When your
// renderers land (splash and wake; mud spray and dirt on the car), swap them in here.
import simd
import ColdGasCore

final class SetWater {
    private var wasWet = false, lastT = -1.0
    private var acc: Float = 0, mudAcc: Float = 0
    private var seed: Double = 11
    private func rnd() -> Float { seed = (seed * 16807).truncatingRemainder(dividingBy: 2147483647); return Float(seed / 2147483647) }
    private let anchors = wheelAnchors()
    private static let water = SIMD3<Float>(0.78, 0.86, 0.9), foam = SIMD3<Float>(0.95, 0.97, 1), mud = SIMD3<Float>(0.16, 0.11, 0.07)

    func reset() { wasWet = false; lastT = -1; acc = 0; mudAcc = 0 }

    /// Once a frame, as TyreSmoke: `t` the track's time (s), `dt` the presentation clock's step.
    func update(_ r: Replay, t: Double, dt: Float, carPos p: SIMD3<Float>, carQuat q: simd_quatf, vel v: SIMD3<Float>, into crash: Crash) {
        if t < lastT - 1e-6 { reset() }   // the track went back (a replay, the encore)
        let step = lastT < 0 ? 0 : t - lastT
        lastT = t
        guard let surf = COURSES[r.course]?.surfaces, step > 0, step < 0.25 else { return }
        seed = Double((r.tickBase + Int(t * Replay.hz)) * 7 + 3)
        let level = waterLevel(surf, Double(p.x), Double(p.z))
        let along = simd_length(SIMD2(v.x, v.z))
        let wet = level != NO_WATER && Double(p.y) - 0.3 < level
        let lv = Float(level)
        if wet && !wasWet {
            // The splash-down: a crown of water thrown up and out, more the harder it hit.
            let k = min(1, max(0.15, (max(0, -v.y) + 0.4 * along) / 14))
            for _ in 0..<Int(18 + 50 * k) {
                let a = rnd() * 2 * .pi, rr = 1.2 + rnd() * 1.4, up = 2.5 + rnd() * 7 * k, out = 1.2 + rnd() * 4 * k
                crash.kick(SIMD3(p.x + cos(a) * rr, lv + 0.05, p.z + sin(a) * rr), SIMD3(cos(a) * out + v.x * 0.3, up, sin(a) * out + v.z * 0.3),
                           size: 0.35 + 0.3 * rnd(), grow: 1.5 + 2 * k, life: 0.9 + rnd() * 0.9, alpha: 0.35 + 0.3 * k, color: rnd() < 0.4 ? SetWater.foam : SetWater.water)
            }
        } else if wet && along > 1.2 {
            // The wake: spray off the sides as long as it moves through the water.
            acc += dt * min(40, along * 5)
            while acc >= 1 {
                acc -= 1
                let s: Float = rnd() < 0.5 ? -1 : 1, nx = v.z / along * s, nz = -v.x / along * s
                crash.kick(SIMD3(p.x + nx * 1.1, lv + 0.03, p.z + nz * 1.1), SIMD3(v.x * 0.4 + nx * 1.4, 0.6 + rnd() * 1.2, v.z * 0.4 + nz * 1.4),
                           size: 0.3, grow: 1.6, life: 0.6 + rnd() * 0.4, alpha: 0.25, color: SetWater.foam)
            }
        }
        wasWet = wet
        // Mud off the rear tyres while they're in it and turning.
        guard !wet, p.y < 0.7, along > 1.5 else { mudAcc = 0; return }
        for i in 2..<4 {
            let a = anchors[i], w = q.act(SIMD3(Float(a.0), -0.35, Float(a.2))) + p
            guard mudSink(surf, Double(w.x), Double(w.z)) >= 0 else { continue }
            mudAcc += dt * min(24, along * 2.5)
            while mudAcc >= 1 {
                mudAcc -= 1
                crash.kick(SIMD3(w.x + (rnd() - 0.5) * 0.3, 0.15, w.z), SIMD3(-v.x * 0.35 + (rnd() - 0.5) * 2, 1 + rnd() * 2.2, -v.z * 0.35 + (rnd() - 0.5) * 2),
                           size: 0.18, grow: 0.6, life: 0.5 + rnd() * 0.4, alpha: 0.7, color: SetWater.mud)
            }
        }
    }
}
