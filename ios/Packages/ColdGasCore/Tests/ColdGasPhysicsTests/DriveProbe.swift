// The drive's dynamics harness (0269): a car on the drive course's slab, driven by a script, with every tick's slip angle,
// yaw rate, lateral acceleration and per-tyre forces logged. DriveDynamicsTests holds the manoeuvres to real numbers;
// `DRIVE_LOG=1 swift test --filter DriveDynamics` prints each manoeuvre's numbers; `DRIVE_LOG=trace` its trace too (every
// 0.05 s: slip, yaw rate, g, speed, steer, each tyre's Fy and Fz, the axles' slip angles, the rears' κ, the throttle).
import Foundation
@testable import ColdGasPhysics
import ColdGasCore

final class DriveProbe {
    let car: Vehicle, dm: DriveModel, inp = Input()
    var t = 0.0
    /// Each tick: time, body slip angle at the CG (rad, + = sliding toward +x), yaw rate (rad/s, about +y), lateral and
    /// longitudinal acceleration in the car's frame (g), speed (m/s), heading (rad), and per tyre: Fy, Fx, Fz (N), α (rad).
    struct Row { var t, beta, r, ay, ax, v, yaw, steer, kr, thr: Double; var fy, fx, fz, alpha: [Double] }
    var rows: [Row] = []
    private var vPrev: (Double, Double) = (0, 0)
    let name: String

    init(_ name: String, tc: DriveModel.TC = .off, esc: Bool = false, vectoring: Bool = false) {
        self.name = name
        car = createVehicle(course: DRIVE_COURSE)
        car.pos.x = -900; car.pos.y = SPEC.comHeight + 0.02; car.pos.z = -1300
        M3.quatFromYaw(car.quat, 0)
        dm = DriveModel(); dm.tc = tc; dm.vectoring = vectoring
        inp.assist = esc ? 1 : 0
        dm.esc = esc ? .on : .off
    }
    deinit { car.world.free() }

    var speed: Double { (car.vel.x * car.vel.x + car.vel.z * car.vel.z).squareRoot() }
    /// The car's body-frame velocity (x right… as the sim's +x, z forward).
    var body: (x: Double, z: Double) {
        let q = car.quat
        let fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y)
        let rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y)
        return (car.vel.x * rx + car.vel.z * rz, car.vel.x * fx + car.vel.z * fz)
    }
    var heading: Double { let q = car.quat; return atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) }
    var beta: Double { let b = body; return b.z > 0.5 ? atan2(b.x, b.z) : 0 }

    func tick() throws {
        try driveStep(car, inp, dm)
        t += DT
        let b = body
        let ay = (b.x - vPrev.0) / DT + car.angVel.y * b.z   // v̇y + r·vx (the sign: + = toward +x)
        let ax = (b.z - vPrev.1) / DT - car.angVel.y * b.x
        vPrev = b
        rows.append(Row(t: t, beta: beta, r: car.angVel.y, ay: ay / G, ax: ax / G, v: speed, yaw: heading, steer: car.steer, kr: (car.wheels[2].slip + car.wheels[3].slip) / 2, thr: inp.throttle,
                        fy: dm.fy, fx: dm.fx, fz: dm.fz, alpha: car.wheels.map { $0.slipAngle }))
    }
    func run(_ seconds: Double, _ each: ((DriveProbe) -> Void)? = nil) throws {
        let n = Int((seconds / DT).rounded())
        for _ in 0..<n { each?(self); try tick() }
    }
    /// Straight up to `v` m/s (throttle, a hand on the wheel keeping it straight), then a second to settle.
    func launch(to v: Double) throws {
        var n = 0
        let tc0 = dm.tc; dm.tc = .on
        while speed < v && n < 240 * 25 { inp.throttle = 0.8; inp.steer = 0; try tick(); n += 1 }
        dm.tc = tc0
        try run(0.5) { p in p.hold(v) }
        rows.removeAll(); t = 0
        vPrev = body
    }
    /// A light foot holding `v` m/s (the motors are 1 MW: a road speed takes a few per cent of the pedal).
    func hold(_ v: Double) { inp.throttle = max(0, min(1, 0.012 + 0.04 * (v - speed))) }
    /// The wheel angle the rack can reach now (rad): its speed-sensitive lock, plus the room it gives a countersteer.
    var reach: Double {
        let v2 = max(1, car.vel.x * car.vel.x + car.vel.z * car.vel.z)
        return rackLock(v2, DriveSpec.muY * G)
    }
    /// The front axle's slip direction: the angle of its velocity off the car's nose (rad, + toward +x).
    var betaFront: Double { let b = body; return b.z > 0.5 ? atan2(b.x + car.angVel.y * AXLE_F, b.z) : 0 }
    /// A skilled driver holding a drift at `target` rad of body slip: the front wheels pointed along the front axle's path,
    /// a few degrees into the turn and damped by the yaw rate (countersteer), the throttle on the angle (more to open it).
    func drift(target: Double, throttle base: Double, gain: Double = 1.6) {
        let b = beta, side: Double = b >= 0 ? 1 : -1
        let delta = betaFront - side * 0.06   // wheels along the front axle's path, a little in
        let lim = min(SPEC.steerLock, reach + abs(b))
        inp.steer = max(-1, min(1, -delta / lim))
        inp.throttle = max(0, min(1, base + gain * (target - abs(b))))
    }
    /// The rows between two times.
    func span(_ a: Double, _ b: Double) -> ArraySlice<Row> {
        let i = rows.firstIndex { $0.t >= a } ?? rows.count, j = rows.lastIndex { $0.t <= b } ?? -1
        return i <= j ? rows[i...j] : []
    }
    func maxAbs(_ k: KeyPath<Row, Double>, _ a: Double = 0, _ b: Double = .infinity) -> Double { span(a, b).map { abs($0[keyPath: k]) }.max() ?? 0 }
    func mean(_ k: KeyPath<Row, Double>, _ a: Double, _ b: Double) -> Double { let s = span(a, b); return s.isEmpty ? 0 : s.map { $0[keyPath: k] }.reduce(0, +) / Double(s.count) }
    /// How far the car has turned from its heading at t = a (rad, unwrapped).
    func turned(_ a: Double = 0) -> Double {
        let s = span(a, .infinity); guard var p = s.first?.yaw else { return 0 }
        var tot = 0.0
        for r in s { var d = r.yaw - p; if d > .pi { d -= 2 * .pi }; if d < -.pi { d += 2 * .pi }; tot += d; p = r.yaw }
        return tot
    }

    func dump() {
        guard ProcessInfo.processInfo.environment["DRIVE_LOG"] == "trace" else { return }
        print("== \(name)")
        print("    t   beta°   r°/s  ay g  ax g   v m/s steer°  | FyFL  FyFR  FyRL  FyRR (N) | FzFL  FzFR  FzRL  FzRR | αF°  αR°  κR  thr")
        var next = 0.0
        for r in rows where r.t >= next {
            next += 0.05
            let d = 180 / Double.pi
            print(String(format: "%5.2f %6.1f %6.1f %5.2f %5.2f %6.1f %6.1f | %5.0f %5.0f %5.0f %5.0f | %5.0f %5.0f %5.0f %5.0f | %5.1f %5.1f %5.2f %4.2f",
                         r.t, r.beta * d, r.r * d, r.ay, r.ax, r.v, r.steer * d, r.fy[0], r.fy[1], r.fy[2], r.fy[3], r.fz[0], r.fz[1], r.fz[2], r.fz[3],
                         (r.alpha[0] + r.alpha[1]) / 2 * d, (r.alpha[2] + r.alpha[3]) / 2 * d, r.kr, r.thr))
        }
    }
}
