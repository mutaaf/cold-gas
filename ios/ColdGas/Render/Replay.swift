// A run flown by the Swift sim (bit-exact with the web, 0150) and kept per tick for drawing: the car's pose, its ten
// nozzles, each parked body's pose, the phase. Drawn between ticks (src/render/interp.js: the renderer only reads).
import Foundation
import simd
import ColdGasCore
import ColdGasPhysics

final class Replay {
    static let hz = 240.0
    let course: String
    let ticks: Int
    private var carPos: [SIMD3<Float>] = [], carQuat: [simd_quatf] = [], nozzles: [Float] = [], bodies: [Float] = [], phases: [UInt8] = []
    /// Per tick, per wheel: compression (m), spin (rad, accumulated), steer (rad).
    private var wheelState: [Float] = []
    let bodyCount: Int
    let score: Double, verdict: String
    let flownMs: Double

    init?(runVector name: String) {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "runs"),
              let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let course = j["course"] as? String, let log = j["log"] as? [[NSNumber]] else { return nil }
        self.course = course
        let t0 = Date()
        var bc = 0
        var cp: [SIMD3<Float>] = [], cq: [simd_quatf] = [], nz: [Float] = [], bd: [Float] = [], ph: [UInt8] = [], ws: [Float] = []
        func record(_ r: Run) {
            let c = r.car
            cp.append(SIMD3(Float(c.pos.x), Float(c.pos.y), Float(c.pos.z)))
            cq.append(simd_quatf(ix: Float(c.quat.x), iy: Float(c.quat.y), iz: Float(c.quat.z), r: Float(c.quat.w)))
            for v in c.throttles { nz.append(Float(v)) }
            bc = c.world.bodies.count
            for b in c.world.bodies { bd += [Float(b.cx), Float(b.cy), Float(b.cz), Float(b.qx), Float(b.qy), Float(b.qz), Float(b.qw)] }
            ph.append(UInt8(r.phase.rawValue))
            for w in c.wheels { ws += [Float(w.compression), Float(w.spin), Float(w.steer)] }
        }
        guard let run = try? simulate(log.map { $0.map(\.intValue) }, course, onTick: record) else { return nil }
        carPos = cp; carQuat = cq; nozzles = nz; bodies = bd; phases = ph; wheelState = ws; bodyCount = bc
        ticks = cp.count
        let card = scoreRun(run.t)
        score = card.total; verdict = card.verdict
        flownMs = Date().timeIntervalSince(t0) * 1000
    }
    var seconds: Double { Double(ticks) / Replay.hz }

    /// The car at time t (s), between ticks.
    func car(at t: Double) -> (pos: SIMD3<Float>, quat: simd_quatf, tick: Int, frac: Float) {
        let x = max(0, min(Double(ticks - 1), t * Replay.hz)), i = Int(x), j = min(ticks - 1, i + 1), f = Float(x - Double(i))
        return (simd_mix(carPos[i], carPos[j], SIMD3(repeating: f)), simd_slerp(carQuat[i], carQuat[j], f), i, f)
    }
    /// Wheel i at time t: compression and steer interpolated, spin interpolated along its own continuous angle.
    func wheel(_ i: Int, at t: Double) -> (comp: Float, spin: Float, steer: Float) {
        let x = max(0, min(Double(ticks - 1), t * Replay.hz)), a = Int(x), b = min(ticks - 1, a + 1), f = Float(x - Double(a))
        let oa = (a * 4 + i) * 3, ob = (b * 4 + i) * 3
        func mix(_ k: Int) -> Float { wheelState[oa + k] + (wheelState[ob + k] - wheelState[oa + k]) * f }
        return (mix(0), mix(1), mix(2))
    }
    func nozzle(_ k: Int, at tick: Int) -> Float { nozzles[min(ticks - 1, tick) * 10 + k] }
    func phase(at tick: Int) -> UInt8 { phases[min(ticks - 1, tick)] }
    /// Parked body b at time t: position and rotation.
    func body(_ b: Int, at t: Double) -> (pos: SIMD3<Float>, quat: simd_quatf) {
        let x = max(0, min(Double(ticks - 1), t * Replay.hz)), i = Int(x), j = min(ticks - 1, i + 1), f = Float(x - Double(i))
        func at(_ k: Int) -> (SIMD3<Float>, simd_quatf) {
            let o = (k * bodyCount + b) * 7
            return (SIMD3(bodies[o], bodies[o + 1], bodies[o + 2]), simd_quatf(ix: bodies[o + 3], iy: bodies[o + 4], iz: bodies[o + 5], r: bodies[o + 6]))
        }
        let (p0, q0) = at(i), (p1, q1) = at(j)
        return (simd_mix(p0, p1, SIMD3(repeating: f)), simd_slerp(q0, q1, f))
    }
}
