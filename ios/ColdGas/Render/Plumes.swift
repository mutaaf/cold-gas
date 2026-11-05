// src/render/plumes.js, ported (0159): cold gas looks nothing like fire. Each firing nozzle gets a shader cone scaled by its
// valve (cg_plume_*: the shock diamonds), and a shared pool sheds condensation mist that blooms, drifts and spreads along the
// ground. The numbers are the web's, with a pool thinned to fit the frame (`thin`); what's left of the overdraw is held by a budget
// (updateBudget). The touchdown's rings
// (main.js touchdown) share it. CPU-side and seeded like the web's; a fixed pool, nothing allocated per frame.
import simd
import ColdGasCore

final class Plumes {
    static let maxMist = 300
    private static let FADED: Float = 0.15
    /// The web's 1800 points at its size are about 23 M fragments a frame here (`-fx-log`), 25 screens of overdraw. So one point in
    /// `thin`, each denser by √thin (plumes.js's rule for a smaller pool, past its cap of 2): soft puffs this big overlap into the same
    /// long trails. Shrinking them instead, to fit, drew strings of beads.
    private static let thin: Float = 5
    private let density = Plumes.thin.squareRoot() * 0.16
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
        spawnAcc += dt * 240 / Plumes.thin
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
            let count = max(3, perPoint / 3)   // (the ring doesn't need thinning as far: it lies flat, and is seen edge on)
            for m in 0..<count {
                let a = (Float(m) / Float(count) + rnd() * 0.15) * .pi * 2, sp = speed * (0.6 + rnd() * 0.6)
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
    /// What the mist costs this frame, in fragments at this size, before `budgetScale` (the `-fx-log` line): Σ (0.6·size·height / depth)²,
    /// the web's rule (plumes.js setScale: a point's side is size · 0.6 · the buffer's height / depth), clamped as cg_mist_vertex does.
    func fragments(viewProj: simd_float4x4, height: Float) -> Float {
        var s: Float = 0
        for j in 0..<Plumes.maxMist where alpha[j] > 0.002 {
            let w = (viewProj * SIMD4(pos[j], 1)).w
            if w < 0.1 { continue }
            let side = min(size[j] * 0.6 / w, Plumes.maxHalf) * height
            s += side * side
        }
        return s
    }
    /// A particle's half side, as a share of the screen's height at most, so one at the lens can't cost the frame.
    static let maxHalf: Float = 0.22
    /// The mist's fragments are held under a budget by shrinking every puff together, eased, so nothing pops; each is drawn a little
    /// denser as it shrinks (plumes.js's rule for a smaller pool). Normally 1: the budget bites only with a lens in the thick of it.
    private(set) var budgetScale: Float = 1
    func updateBudget(viewProj: simd_float4x4, height: Float, budget: Float) {
        let frags = fragments(viewProj: viewProj, height: height)
        let want = frags > budget ? (budget / frags).squareRoot() : 1
        budgetScale += (want - budgetScale) * (want < budgetScale ? 0.25 : 0.04)
    }
}
