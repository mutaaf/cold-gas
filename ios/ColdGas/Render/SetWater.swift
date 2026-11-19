// A scored set's water and mud in motion (0340; the web's src/render/surfaces.js createSurfaceFx): the splash-down's crown,
// the wake as the car moves in the tank, and the mud thrown off the rear tyres. Read from the track's own pose (never the
// sim: a replay splashes as the run did), into the crash's puff pool (Crash.kick), so it costs no pipeline, no draw call and
// no allocation of its own, and every look (Real, Anime, 8-bit) draws it as it draws the dust. The tanks, the water and the
// mud themselves are the stage's static meshes (scripts/native-stage.mjs bakes them from the web's builders).
//
// With MATTER (0330) landed beside it: the car carries the set away as a drive's does. Its coat is MATTER's own model
// (ColdGasPhysics CarDirt: each rear tyre's metres in the mud cake the wheels and the sills, the water rinses it) and is drawn
// by MATTER's car shading (CarMatter.h, through `look` → MatterLook.frame), and the mud comes off the tyres as MATTER's clods
// (Crash.fling: tumbling bits that land and lie) over the puffs. All of it pixels: nothing here reaches the sim or a score.
// WATER's (0320) splash, wake and surface stay Free Drive's: they draw as a world layer, and a scored set has no world, so
// the tanks keep this crown and their stage-baked water.
import simd
import ColdGasCore
import ColdGasPhysics

final class SetWater {
    private var wasWet = false, lastT = -1.0
    private var acc: Float = 0, mudAcc: Float = 0
    private var seed: Double = 11
    private func rnd() -> Float { seed = (seed * 16807).truncatingRemainder(dividingBy: 2147483647); return Float(seed / 2147483647) }
    private let anchors = wheelAnchors()
    private static let water = SIMD3<Float>(0.78, 0.86, 0.9), foam = SIMD3<Float>(0.95, 0.97, 1), mud = SIMD3<Float>(0.16, 0.11, 0.07)

    /// What the set left on the car (MATTER's CarDirt) and how wet it is (0…1, drying), for the car's shading.
    private var dirt = CarDirt(), wetK = 0.0
    func reset() { wasWet = false; lastT = -1; acc = 0; mudAcc = 0; dirt.reset(); wetK = 0 }
    /// The car's coat as MATTER's shading reads it (nil: nothing on it).
    var look: DriveCarLook? {
        var l = DriveCarLook()
        l.dirt = SIMD4(Float(dirt.sill), Float(dirt.nose), Float(dirt.tail), Float(dirt.wheel.reduce(0, +) / 4))
        l.coat = SIMD4(Float(dirt.r), Float(dirt.g), Float(dirt.b), Float(dirt.body))
        l.wet = Float(wetK); l.wetLine = Float(wetK)
        return l.coated ? l : nil
    }

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
        // The coat: the water soaks the car and rinses the mud; out of it, it dries (MATTER's weather).
        if wet { wetK = 1 }
        dirt.weather(dt: step, wet: wetK, speed: Double(along))
        wetK = max(0, wetK - step * 0.0125 * (1 + Double(along) * 0.22))   // ≈ 80 s still, ≈ 20 s at 15 m/s (0320's drying)
        // Mud off the rear tyres while they're in it and turning, and onto the car.
        guard !wet, p.y < 0.7, along > 1.5 else { mudAcc = 0; return }
        for i in 2..<4 {
            let a = anchors[i], w = q.act(SIMD3(Float(a.0), -0.35, Float(a.2))) + p
            guard mudSink(surf, Double(w.x), Double(w.z)) >= 0 else { continue }
            dirt.roll(wheel: i, on: .mud, dist: Double(along) * step, slip: 0, forward: true)
            mudAcc += dt * min(24, along * 2.5)
            while mudAcc >= 1 {
                mudAcc -= 1
                crash.kick(SIMD3(w.x + (rnd() - 0.5) * 0.3, 0.15, w.z), SIMD3(-v.x * 0.35 + (rnd() - 0.5) * 2, 1 + rnd() * 2.2, -v.z * 0.35 + (rnd() - 0.5) * 2),
                           size: 0.18, grow: 0.6, life: 0.5 + rnd() * 0.4, alpha: 0.7, color: SetWater.mud)
                // MATTER's clods: every other one a tumbling bit of mud that lands and lies (6 s).
                if rnd() < 0.5 {
                    crash.fling(SIMD3(w.x, 0.15, w.z), SIMD3(-v.x * 0.3 + (rnd() - 0.5) * 2.4, 1.8 + rnd() * 3, -v.z * 0.3 + (rnd() - 0.5) * 2.4),
                                size: 0.03 + rnd() * 0.04, color: 0x3b2a1b, life: 6)
                }
            }
        }
    }
}
