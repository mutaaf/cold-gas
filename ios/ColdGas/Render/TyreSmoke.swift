// Tyre smoke (0271): read from the track's own wheels, never the sim. A tyre that meets the ground turning slower than the
// ground goes by under it (a touchdown's spin-up, the brakes locking on the pad, a wreck sliding on its wheels) smokes, in
// proportion to the slip; a touchdown after real air throws a burst from each tyre as it lands. The puffs go into the crash's
// pool (Crash.kick), so they cost no pipeline, no draw call and no allocation of their own: a few dozen soft quads at most.
// Seeded per tick and wheel, so a replay smokes as the run did.
import simd
import ColdGasCore

final class TyreSmoke {
    private var loaded = [Bool](repeating: true, count: 4), airT = [Float](repeating: 0, count: 4), acc = [Float](repeating: 0, count: 4)
    private var lastT = -1.0
    private var seed: Double = 7
    private func rnd() -> Float { seed = (seed * 16807).truncatingRemainder(dividingBy: 2147483647); return Float(seed / 2147483647) }
    private let anchors = wheelAnchors()
    private let radius = Float(SPEC.wheelRadius)
    /// The smoke's tone: a tyre's pale grey, a little warm, so it reads apart from the jets' cold white mist.
    private static let tone = SIMD3<Float>(0.74, 0.72, 0.70)

    func reset() { for i in 0..<4 { loaded[i] = true; airT[i] = 0; acc[i] = 0 }; lastT = -1 }

    /// Once a frame: `t` the track's time (s), `dt` the presentation clock's step (slowed with the crash or the encore),
    /// `lateral` each tyre's sideways slip speed (m/s, RunSkids: 0281, a slide smokes as a spin does).
    func update(_ r: Replay, t: Double, dt: Float, carPos: SIMD3<Float>, carQuat q: simd_quatf, vel: SIMD3<Float>, lateral: SIMD4<Float> = .zero, into crash: Crash) {
        if t < lastT - 1e-6 { reset() }   // the track went back (a replay, the encore)
        let step = lastT < 0 ? 0 : t - lastT
        lastT = t
        guard r.ticks > 2, step > 0, step < 0.25 else { return }
        let fwd = q.act(SIMD3<Float>(0, 0, 1)), vLong = abs(simd_dot(vel, fwd))
        let vh = SIMD2(vel.x, vel.z), speed = simd_length(vh)
        for i in 0..<4 {
            let w = r.wheel(i, at: t), w0 = r.wheel(i, at: max(0, t - 1 / Replay.hz))
            let on = w.comp > 0.002
            if !on { airT[i] += Float(step); loaded[i] = false; continue }
            let rim = abs(w.spin - w0.spin) * Float(Replay.hz) * radius   // the tread's speed
            let slip = (abs(vLong - rim) * abs(vLong - rim) + lateral[i] * lateral[i]).squareRoot()
            let a = anchors[i], wp = q.act(SIMD3(Float(a.0), Float(a.1), Float(a.2))) + carPos
            let at = SIMD3(wp.x, max(0.05, wp.y - 0.24 - radius) + 0.12, wp.z)
            seed = Double((r.tickBase + Int(t * Replay.hz)) * 4 + i + 1)
            for _ in 0..<2 { _ = rnd() }
            // A touchdown after real air: a burst, sized by how fast the ground went by.
            if !loaded[i] && airT[i] > 0.25 {
                let k = min(1, max(0, (max(slip, speed * 0.6) - 1.5) / 9))
                let n = Int(3 + 9 * k)
                for _ in 0..<n {
                    let ang = rnd() * .pi * 2, sp = 0.6 + rnd() * 2.2 * (0.4 + k)
                    crash.kick(at, SIMD3(cos(ang) * sp - vel.x * 0.15, 0.25 + rnd() * 0.7, sin(ang) * sp - vel.z * 0.15),
                               size: 0.45, grow: 3 + 3 * k, life: 1.8 + rnd() * 1.2, alpha: 0.12 + 0.2 * k, color: TyreSmoke.tone)
                }
            }
            loaded[i] = true; airT[i] = 0
            // Sliding: a steady trail while the slip lasts (≈ 30 puffs a second a wheel at its worst).
            let k = min(1, max(0, (slip - 2.5) / 8))
            if k <= 0 { acc[i] = 0; continue }
            acc[i] += dt * 30 * k
            while acc[i] >= 1 {
                acc[i] -= 1
                crash.kick(at, SIMD3(-vel.x * 0.25 + (rnd() - 0.5) * 1.2, 0.3 + rnd() * 0.5, -vel.z * 0.25 + (rnd() - 0.5) * 1.2),
                           size: 0.35, grow: 2.6 + 2 * k, life: 1.6 + rnd(), alpha: 0.08 + 0.14 * k, color: TyreSmoke.tone)
            }
        }
    }
}
