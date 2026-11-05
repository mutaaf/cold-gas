// src/render/plumes.js, ported (0159): cold gas looks nothing like fire. Each firing nozzle gets a shader cone scaled by its
// valve (cg_plume_*: the shock diamonds), and a shared pool sheds condensation mist that blooms, drifts and spreads along the
// ground. The numbers are the web's, with its low tier's pool: 500 particles, each drawn denser, as plumes.js keeps a smaller
// pool looking the same (the high tier's 1800 would be about 3.6× the overdraw at 120 Hz on a phone). The touchdown's rings
// (main.js touchdown) share it. CPU-side and seeded like the web's; a fixed pool, nothing allocated per frame.
import simd
import ColdGasCore

final class Plumes {
    static let maxMist = 500
    private static let FADED: Float = 0.15
    private let density = min(2, (1800 / Float(Plumes.maxMist)).squareRoot()) * 0.16
    private var seed: Double = 11
    private func rnd() -> Float { seed = (seed * 16807).truncatingRemainder(dividingBy: 2147483647); return Float(seed / 2147483647) }
    private var pos = [SIMD3<Float>](repeating: .zero, count: maxMist), vel = [SIMD3<Float>](repeating: .zero, count: maxMist)
    private var life = [Float](repeating: 0, count: maxMist), size = [Float](repeating: 0, count: maxMist), alpha = [Float](repeating: 0, count: maxMist)
    private var head = 0, spawnAcc: Float = 0
    private(set) var live = 0
    private let local: [(pos: SIMD3<Float>, jet: SIMD3<Float>)] = NOZZLE_SPEC.map { n in
        (SIMD3(Float(n.pos.0), Float(n.pos.1), Float(n.pos.2)), -SIMD3(Float(n.dir.0), Float(n.dir.1), Float(n.dir.2)))
    }

    /// `thr`: the ten valves now. `dt`: the game's clock (slowed with a crash).
    func update(dt: Float, thr: [Float], carPos: SIMD3<Float>, carQuat q: simd_quatf, carVel: SIMD3<Float>, groundY: Float = 0) {
        spawnAcc += dt * 240
        let n = Int(spawnAcc); spawnAcc -= Float(n)
        if n > 0 {
            for _ in 0..<n {
                for i in 0..<local.count {
                    let p = thr[i]
                    if p < 0.05 || rnd() > p * 0.9 { continue }
                    if life[head] > Plumes.FADED { continue }   // the pool is full of visible mist
                    let wp = q.act(local[i].pos) + carPos, wd = q.act(local[i].jet)
                    let j = head; head = (head + 1) % Plumes.maxMist
                    let sp = 7 + rnd() * 9
                    pos[j] = wp + wd * 0.3
                    vel[j] = carVel * 0.6 + wd * sp + SIMD3((rnd() - 0.5) * 2, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2)
                    life[j] = 1; size[j] = 0.25
                }
            }
        }
        var n0 = 0
        let drag = exp(-dt * 4.5)
        for j in 0..<Plumes.maxMist {
            if life[j] <= 0 { alpha[j] = 0; continue }
            n0 += 1
            life[j] -= dt * 0.55
            vel[j].x *= drag; vel[j].y = vel[j].y * drag + dt * 0.6; vel[j].z *= drag
            pos[j] += vel[j] * dt
            // Spread along the ground when the jet hits it.
            if pos[j].y < groundY + 0.15 {
                pos[j].y = groundY + 0.15
                let v = vel[j].y
                if v < 0 { vel[j].x += (rnd() - 0.5) * -v * 1.6; vel[j].z += (rnd() - 0.5) * -v * 1.6; vel[j].y = 0 }
            }
            let age = 1 - life[j]
            size[j] = 0.35 + age * 4.2
            // Fade in over the first moments (no hard-edged pop), then dissolve.
            alpha[j] = min(1, age * 7) * pow(max(0, life[j]), 1.6) * density
        }
        live = n0
    }
    /// Touchdown: a flat ring of mist from each tyre contact, pushed outward at `speed` m/s (one call per landing).
    func burst(_ pts: (SIMD3<Float>, SIMD3<Float>, SIMD3<Float>, SIMD3<Float>), perPoint: Int, speed: Float) {
        for k in 0..<4 {
            let pt = k == 0 ? pts.0 : k == 1 ? pts.1 : k == 2 ? pts.2 : pts.3
            for m in 0..<perPoint {
                let a = (Float(m) / Float(perPoint) + rnd() * 0.15) * .pi * 2, sp = speed * (0.6 + rnd() * 0.6)
                if life[head] > Plumes.FADED { return }
                let j = head; head = (head + 1) % Plumes.maxMist
                pos[j] = pt
                vel[j] = SIMD3(cos(a) * sp, rnd() * speed * 0.15, sin(a) * sp)
                life[j] = 1; size[j] = 0.3
            }
        }
    }
    func clear() { for j in 0..<Plumes.maxMist { life[j] = 0; alpha[j] = 0 }; live = 0; head = 0 }
    /// The live mist into the GPU's instance buffer; returns how many.
    func write(_ out: UnsafeMutablePointer<PuffGPU>) -> Int {
        var n = 0
        for j in 0..<Plumes.maxMist where alpha[j] > 0.002 {
            out[n] = PuffGPU(pos: SIMD4(pos[j], size[j]), color: SIMD4(0.86, 0.9, 0.95, alpha[j])); n += 1
        }
        return n
    }
    /// What the mist costs this frame, in fragments at this size (the `-fx-log` line): Σ (size · 0.5·width / depth)², as the
    /// vertex shader draws them, clamped likewise.
    func fragments(viewProj: simd_float4x4, width: Float) -> Float {
        var s: Float = 0
        for j in 0..<Plumes.maxMist where alpha[j] > 0.002 {
            let w = (viewProj * SIMD4(pos[j], 1)).w
            if w < 0.1 { continue }
            let side = min(size[j] * 0.5 / w, 0.35) * width
            s += side * side
        }
        return s
    }
}
