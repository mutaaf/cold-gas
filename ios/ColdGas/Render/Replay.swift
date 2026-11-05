// A run flown by the Swift sim (bit-exact with the web, 0150) and kept per tick for drawing: the car's pose, its ten
// nozzles, each parked body's pose, the phase. Drawn between ticks (src/render/interp.js: the renderer only reads).
import Foundation
import simd
import ColdGasCore
import ColdGasPhysics

final class Replay {
    static let hz = 240.0
    let course: String
    private(set) var ticks: Int
    /// A live run (0154): ticks are appended as the sim flies them; the renderer draws the newest, never loops.
    let live: Bool
    private var carPos: [SIMD3<Float>] = [], carQuat: [simd_quatf] = [], nozzles: [Float] = [], bodies: [Float] = [], phases: [UInt8] = []
    /// Per tick, per wheel: compression (m), spin (rad, accumulated), steer (rad).
    private var wheelState: [Float] = []
    private var carVel: [SIMD3<Float>] = []
    /// The run's impact events (src/sim/impacts.js), as the sim recorded them: what crash.js draws.
    struct Impact { let tick: Int; let kind, part, probe: UInt8; let body: Int8; let pos, normal: SIMD3<Float>; let speed, crush: Float }
    private(set) var impacts: [Impact] = []
    private(set) var bodyCount: Int
    private(set) var score: Double, verdict: String
    let flownMs: Double

    /// An empty track for a live run, filled tick by tick with `append` (room reserved for a long run up front, so a
    /// run allocates nothing while it flies).
    init(live course: String) {
        self.course = course; live = true; ticks = 0; bodyCount = 0; score = 0; verdict = ""; flownMs = 0
        let n = 240 * 90
        carPos.reserveCapacity(n); carQuat.reserveCapacity(n); carVel.reserveCapacity(n); phases.reserveCapacity(n)
        nozzles.reserveCapacity(n * 10); wheelState.reserveCapacity(n * 12); bodies.reserveCapacity(n * 7 * 6)
    }
    /// One tick of a live run, after the sim stepped (the world may be freed once the run is done: then nothing is read).
    func append(_ r: Run, phase: UInt8? = nil) {
        let c = r.car
        carPos.append(SIMD3(Float(c.pos.x), Float(c.pos.y), Float(c.pos.z)))
        carQuat.append(simd_quatf(ix: Float(c.quat.x), iy: Float(c.quat.y), iz: Float(c.quat.z), r: Float(c.quat.w)))
        carVel.append(SIMD3(Float(c.vel.x), Float(c.vel.y), Float(c.vel.z)))
        for v in c.throttles { nozzles.append(Float(v)) }
        bodyCount = c.world.bodies.count
        for b in c.world.bodies { bodies += [Float(b.cx), Float(b.cy), Float(b.cz), Float(b.qx), Float(b.qy), Float(b.qz), Float(b.qw)] }
        phases.append(phase ?? UInt8(r.phase.rawValue))
        for w in c.wheels { wheelState += [Float(w.compression), Float(w.spin), Float(w.steer)] }
        let im = c.impacts
        while impacts.count < im.count {
            let i = impacts.count
            impacts.append(Impact(tick: Int(im.tick[i]), kind: im.kind[i], part: im.part[i], probe: im.probe[i], body: im.body[i],
                pos: SIMD3(im.x[i], im.y[i], im.z[i]), normal: SIMD3(im.nx[i], im.ny[i], im.nz[i]), speed: im.speed[i], crush: im.crush[i]))
        }
        ticks += 1
    }
    func setScore(_ total: Double, _ v: String) { score = total; verdict = v }

    init?(runVector name: String) {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "runs"),
              let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let course = j["course"] as? String, let log = j["log"] as? [[NSNumber]] else { return nil }
        self.course = course
        live = false
        let t0 = Date()
        var bc = 0
        var cp: [SIMD3<Float>] = [], cq: [simd_quatf] = [], nz: [Float] = [], bd: [Float] = [], ph: [UInt8] = [], ws: [Float] = [], cv: [SIMD3<Float>] = []
        func record(_ r: Run) {
            let c = r.car
            cp.append(SIMD3(Float(c.pos.x), Float(c.pos.y), Float(c.pos.z)))
            cq.append(simd_quatf(ix: Float(c.quat.x), iy: Float(c.quat.y), iz: Float(c.quat.z), r: Float(c.quat.w)))
            cv.append(SIMD3(Float(c.vel.x), Float(c.vel.y), Float(c.vel.z)))
            for v in c.throttles { nz.append(Float(v)) }
            bc = c.world.bodies.count
            for b in c.world.bodies { bd += [Float(b.cx), Float(b.cy), Float(b.cz), Float(b.qx), Float(b.qy), Float(b.qz), Float(b.qw)] }
            ph.append(UInt8(r.phase.rawValue))
            for w in c.wheels { ws += [Float(w.compression), Float(w.spin), Float(w.steer)] }
        }
        guard let run = try? simulate(log.map { $0.map(\.intValue) }, course, onTick: record) else { return nil }
        carPos = cp; carQuat = cq; nozzles = nz; bodies = bd; phases = ph; wheelState = ws; carVel = cv; bodyCount = bc
        let im = run.car.impacts
        impacts = (0..<im.count).map { i in Impact(tick: Int(im.tick[i]), kind: im.kind[i], part: im.part[i], probe: im.probe[i], body: im.body[i],
            pos: SIMD3(im.x[i], im.y[i], im.z[i]), normal: SIMD3(im.nx[i], im.ny[i], im.nz[i]), speed: im.speed[i], crush: im.crush[i]) }
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
    func velocity(at tick: Int) -> SIMD3<Float> { carVel[max(0, min(ticks - 1, tick))] }
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
