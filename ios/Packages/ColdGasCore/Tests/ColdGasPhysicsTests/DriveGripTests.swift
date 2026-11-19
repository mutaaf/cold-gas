// 0281: the drive's car grips, slides and stops like a car. Stops from 100 km/h with ABS on and off and on each surface,
// the pads fading hot, the balance moving which axle locks first, the handbrake swinging the tail, a thumb holding a drift
// with the assist, wheelspin off the line with traction control off, and a drive that replays to the same bits.
// `DRIVE_LOG=1 swift test --filter DriveGrip` prints each probe's numbers.
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore

private let deg = 180 / Double.pi
private func note(_ s: String) { if ProcessInfo.processInfo.environment["DRIVE_LOG"] != nil { print("GRIP \(s)") } }

@Suite("The drive's car grips, slides and stops", .serialized)
struct DriveGripTests {
    /// A stop from `v` m/s with the pedal flat, straight on: the distance (m) and what the brakes did on the way.
    struct Stop { var d = 0.0, t = 0.0, pulses = 0, lockedTicks = 0, minFzRear = Double.infinity, maxFzFront = 0.0, yaw = 0.0 }
    func stop(from v: Double, abs: Bool = true, surface: Material? = nil, discs: Double? = nil, bias: Double = DriveSpec.brakeBias, steer: Double = 0, pedal: Double = 1) throws -> (Stop, DriveProbe) {
        let p = DriveProbe("stop")
        p.dm.surfaceOverride = surface
        try p.launch(to: v)
        p.dm.abs = abs; p.dm.brakeBias = bias
        if let t = discs { for i in 0..<4 { p.dm.discT[i] = t } }
        var s = Stop()
        let z0 = p.car.pos.z, x0 = p.car.pos.x, p0 = p.dm.absPulses, h0 = p.heading
        var n = 0
        while p.speed > 0.3 && n < 240 * 12 {
            p.inp.throttle = 0; p.inp.brake = pedal; p.inp.steer = steer
            try p.tick(); n += 1
            if p.dm.locked.contains(true) { s.lockedTicks += 1 }
            s.minFzRear = min(s.minFzRear, p.dm.fz[2] + p.dm.fz[3]); s.maxFzFront = max(s.maxFzFront, p.dm.fz[0] + p.dm.fz[1])
            if let d = discs { for i in 0..<4 { p.dm.discT[i] = max(p.dm.discT[i], d) } }   // held hot: a fade test, not a cooling one
        }
        s.d = ((p.car.pos.z - z0) * (p.car.pos.z - z0) + (p.car.pos.x - x0) * (p.car.pos.x - x0)).squareRoot()
        s.t = Double(n) * DT; s.pulses = p.dm.absPulses - p0
        var dy = p.heading - h0; if dy > .pi { dy -= 2 * .pi }; if dy < -.pi { dy += 2 * .pi }; s.yaw = dy
        return (s, p)
    }

    @Test func absStopsShorterThanLockedWheelsFrom100() throws {
        // 100–0 km/h on dry asphalt, the pedal flat. ABS pulses each wheel round its peak slip (many pulses, no wheel
        // locked for long) and stops in 30–40 m; with it off the wheels lock and slide on the tyre's locked tail (≈ 0.75 of
        // its peak), 10–40 % further, and wear a flat spot.
        let (on, _) = try stop(from: 27.78)
        let (off, po) = try stop(from: 27.78, abs: false)
        note(String(format: "100–0 asphalt: ABS on %.1f m in %.2f s (%d pulses, %d ticks a wheel locked), off %.1f m in %.2f s (%d ticks locked), flat spots %.2f %.2f %.2f %.2f",
                    on.d, on.t, on.pulses, on.lockedTicks, off.d, off.t, off.lockedTicks, po.dm.flatSpot[0], po.dm.flatSpot[1], po.dm.flatSpot[2], po.dm.flatSpot[3]))
        #expect(on.d > 28 && on.d < 40)
        #expect(on.pulses > 10)
        #expect(Double(on.lockedTicks) * DT < 0.15)
        #expect(off.d > 1.1 * on.d && off.d < 1.4 * on.d)
        #expect(Double(off.lockedTicks) * DT > 1.0)
        #expect(po.dm.flatSpot.max()! > 0.3)
        // The load moves forward under the brakes: the front axle carries ≥ 20 % more than at rest, the rear less.
        let fz0 = DriveSpec.staticLoad(0) * 2, fr0 = DriveSpec.staticLoad(2) * 2
        note(String(format: "weight transfer under ABS: front %.0f → %.0f N, rear %.0f → %.0f N", fz0, on.maxFzFront, fr0, on.minFzRear))
        #expect(on.maxFzFront > 1.2 * fz0 && on.minFzRear < 0.85 * fr0)
    }

    @Test func eachSurfaceStopsInItsOwnDistance() throws {
        // 100–0 km/h with ABS on asphalt, gravel, dirt and grass: each in about v² / (2 μ g) for its μ (the tyre's peak on
        // that ground: SPEC's grip × the tyre's μ, the car a little under it for load sensitivity and the ABS's cycling),
        // the looser the longer.
        var last = 0.0
        for m in [MATERIALS.asphalt, MATERIALS.gravel, MATERIALS.dirt, MATERIALS.grass] {
            let (s, _) = try stop(from: 27.78, surface: m)
            let mu = DriveSpec.muX * m.grip, ideal = 27.78 * 27.78 / (2 * mu * G)
            note(String(format: "100–0 on %@ (μ %.2f): %.1f m (ideal %.1f, ×%.2f), %d ABS pulses", m.id, mu, s.d, ideal, s.d / ideal, s.pulses))
            #expect(s.d > last)
            #expect(s.d > 0.9 * ideal && s.d < 1.3 * ideal)
            last = s.d
        }
    }

    @Test func hotPadsFadeAndTheStopGrowsLonger() throws {
        // The same stop with the discs held at 800 °C: the pads give 40 % of their cold friction, the car stops ≥ 15 %
        // further. 300 °C is still a full-strength brake.
        #expect(DriveSpec.fade(300) == 1 && DriveSpec.fade(800) < 0.45 && DriveSpec.fade(625) < 0.8)
        let (cold, _) = try stop(from: 27.78)
        let (warm, _) = try stop(from: 27.78, discs: 300)
        let (hot, ph) = try stop(from: 27.78, discs: 800)
        note(String(format: "fade: cold %.1f m, 300 °C %.1f m, 800 °C %.1f m (pads at %.2f)", cold.d, warm.d, hot.d, ph.dm.fadeK))
        #expect(abs(warm.d - cold.d) < 1)
        #expect(hot.d > 1.15 * cold.d)
    }

    @Test func theBalanceDecidesWhichAxleLocksFirst() throws {
        // ABS off, the wheel turned, half the pedal from 22 m/s (enough to lock one axle, not both): biased forward the
        // fronts lock first (the car ploughs on straight, under 25° of yaw); biased to the rear the rears lock first and
        // the tail comes round (past 60°).
        let (front, _) = try stop(from: 22, abs: false, bias: 0.7, steer: 0.6, pedal: 0.5)
        let (rear, _) = try stop(from: 22, abs: false, bias: 0.3, steer: 0.6, pedal: 0.5)
        note(String(format: "balance 70/30: yaw %.0f°; 30/70: yaw %.0f°", front.yaw * deg, rear.yaw * deg))
        #expect(abs(front.yaw) * deg < 25)
        #expect(abs(rear.yaw) * deg > 60)
    }

    @Test func theHandbrakeLocksTheRearsAndSwingsTheTail() throws {
        // At 16 m/s, a light steer and a 0.6 s pull on the handbrake: the rears lock, the motors let go, the tail swings out
        // (the yaw rate past 60°/s, the car turned ≥ 50°); the same steer without the lever turns under half as far.
        func run(_ pull: Bool) throws -> (turned: Double, rMax: Double, rearsLocked: Bool, motors: Double) {
            let p = DriveProbe(pull ? "handbrake" : "no handbrake"); try p.launch(to: 16)
            var locked = false, motors = 0.0
            try p.run(1.2) { p in
                p.inp.throttle = 0.05; p.inp.steer = 0.3
                p.car.handbrake = pull && p.t > 0.1 && p.t < 0.7 ? 1 : 0
                if p.t > 0.3 && p.t < 0.6 { locked = locked || (p.dm.locked[2] && p.dm.locked[3]); motors = max(motors, p.dm.driveT[2] + p.dm.driveT[3]) }
            }
            let r = (abs(p.turned()), p.maxAbs(\.r), locked, motors)
            note(String(format: "%@: turned %.0f°, r max %.0f°/s, rears locked %@, motor torque %.0f N·m", p.name, r.0 * deg, r.1 * deg, r.2 ? "yes" : "no", r.3))
            return r
        }
        let pull = try run(true), plain = try run(false)
        #expect(pull.rearsLocked && pull.motors == 0)
        #expect(pull.rMax * deg > 60 && pull.turned * deg > 50)
        #expect(plain.turned < 0.5 * pull.turned)
    }

    @Test func aThumbHoldsADriftWithTheAssist() throws {
        // A thumb on glass, not a driver's hands: stability off, a slide started with the handbrake into a bend at 15 m/s,
        // then the slider held still a little into the turn and the throttle held at 22 %. With the drift assist the car
        // holds its angle for 3.5 s (the body's slip inside 8–40°, settling near the assist's 24°, still moving); without it the same
        // thumb spins the car (past 90°) or loses the slide.
        func run(_ assist: Bool) throws -> (lo: Double, hi: Double, mean: Double, v: Double, spun: Bool) {
            let p = DriveProbe(assist ? "drift assist on" : "drift assist off")
            p.dm.driftAssist = assist
            try p.launch(to: 15)
            try p.run(0.5) { p in p.hold(15); p.inp.steer = 0.5; p.car.handbrake = p.t > 0.15 && p.t < 0.4 ? 1 : 0 }
            var slip: [Double] = [], worst = 0.0
            try p.run(4.5) { p in
                p.car.handbrake = 0; p.inp.steer = 0.25; p.inp.throttle = 0.22
                // The body's slip the whole way round (the probe's beta stops at 90°): a spin shows as past 90°.
                let b = p.body, a = abs(atan2(b.x, b.z))
                worst = max(worst, a)
                if p.t >= 1.5 { slip.append(a) }
            }
            let s = p.span(1.5, 5.0)
            let r = (slip.min() ?? 0, slip.max() ?? 0, slip.reduce(0, +) / Double(max(1, slip.count)), s.map(\.v).min() ?? 0, worst > 1.57)
            note(String(format: "%@: beta %.1f–%.1f° (mean %.1f°), v min %.1f, %@", p.name, r.0 * deg, r.1 * deg, r.2 * deg, r.3, r.4 ? "spun" : "held"))
            p.dump()
            return r
        }
        let on = try run(true), off = try run(false)
        #expect(!on.spun && on.lo * deg > 8 && on.hi * deg < 40 && on.v > 5)
        #expect(off.spun || off.lo * deg < 8 || off.hi * deg > 40)
    }

    @Test func theRearsSpinUpOffTheLineWithTractionControlOff() throws {
        // Flat out from rest: with traction control off the 1 MW motors spin the rears past 30 % slip at once (the tyres'
        // peak is ≈ 11 %); with it on the slip is held near its target and the car pulls harder for it.
        func run(_ tc: DriveModel.TC) throws -> (kMax: Double, v1: Double) {
            let p = DriveProbe("launch \(tc)", tc: tc)
            try p.run(0.4)   // settle on the springs
            p.rows.removeAll(); p.t = 0
            try p.run(1.0) { p in p.inp.throttle = 1 }
            // (the first tenth of a second aside: a controller reacts to a slip, it can't see it coming)
            let r = (p.maxAbs(\.kr, 0.1), p.speed)
            note(String(format: "launch, traction control %@: rear slip max after 0.1 s %.2f, %.1f m/s after 1 s", "\(tc)", r.0, r.1))
            return r
        }
        let off = try run(.off), on = try run(.on)
        #expect(off.kMax > 0.3)
        #expect(on.kMax < 0.25)
        #expect(on.v1 > off.v1)
    }

    @Test func aDriveReplaysToTheSameBits() throws {
        // The drive's car is unscored, but the same inputs from the same start give the same car, bit for bit (no clock, no
        // randomness in the chassis): a slide, a stop and a handbrake turn, twice.
        func run() throws -> [UInt64] {
            let p = DriveProbe("replay"); p.dm.driftAssist = true; p.dm.abs = false
            try p.launch(to: 18)
            try p.run(3) { p in
                p.inp.steer = sin(p.t * 2) * 0.6; p.inp.throttle = p.t < 1.5 ? 0.25 : 0; p.inp.brake = p.t > 2 ? 1 : 0
                p.car.handbrake = p.t > 1.2 && p.t < 1.6 ? 1 : 0
            }
            let c = p.car
            return [c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.vel.x, c.vel.z, c.angVel.y].map(\.bitPattern) + p.dm.discT.map(\.bitPattern)
        }
        #expect(try run() == run())
    }
}
