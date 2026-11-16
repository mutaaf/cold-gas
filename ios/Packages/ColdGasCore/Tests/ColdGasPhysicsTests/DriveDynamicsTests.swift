// 0269: the drive's car against real vehicle dynamics. Each test drives a manoeuvre through DriveProbe (slip angle, yaw rate,
// lateral g and each tyre's forces, every tick) and holds it to what a real car does, with tolerances: the tyre's curves,
// the yaw's inertia and response, weight transfer, the relaxation lag, the drive's split, then the slides: a handbrake turn,
// power oversteer, lift-off, a Scandinavian flick, a drift held by countersteer and modulated by the throttle, and what
// stability control and the touch countersteer assist do to them. `DRIVE_LOG=1` prints each one's numbers.
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore

@Suite("The drive's car against real dynamics", .serialized)
struct DriveDynamicsTests {
    let deg = 180 / Double.pi
    func note(_ p: DriveProbe, _ s: String) {
        if ProcessInfo.processInfo.environment["DRIVE_LOG"] != nil { print("DYN \(p.name): \(s)") }
        p.dump()
    }

    // MARK: - The tyre

    @Test func theTyrePeaksAtItsSlipAndFallsOffGraduallyPastIt() {
        let lat = DriveSpec.lat, lon = DriveSpec.lon
        // Each curve peaks at its normalised slip of 1, at 1.
        #expect(abs(lat(1) - 1) < 1e-9 && abs(lon(1) - 1) < 1e-9)
        #expect(abs(lat.slope(1)) < 1e-6 && abs(lon.slope(1)) < 1e-6)
        // The peaks sit at a real tyre's slips: 5–10° across (rigs: 5–8° for a performance radial), κ 0.08–0.15 along.
        for a in DriveSpec.alphaPeak { #expect(a * deg > 5 && a * deg < 10) }
        #expect(DriveSpec.kappaPeak > 0.08 && DriveSpec.kappaPeak < 0.15)
        // Past the peak, across: no cliff (never more than 1.5 % of the peak lost per degree), ≥ 0.93 at twice the peak's
        // slip, 0.8–0.95 at 45° (a sliding tyre keeps most of its grip).
        let ap = DriveSpec.alphaPeak[2]
        var prev = 1.0
        for d in stride(from: ap * deg, through: 60, by: 1) {
            let f = lat(d / deg / ap)
            #expect(prev - f < 0.015)
            prev = f
        }
        #expect(lat(2) > 0.93)
        let at45 = lat(45 / deg / ap)
        #expect(at45 > 0.8 && at45 < 0.95)
        // Along: locked or spinning at κ = 1, 0.65–0.85 of the peak (a locked wheel stops in ≈ 1.2–1.5× ABS's distance).
        let locked = lon(1 / DriveSpec.kappaPeak)
        #expect(locked > 0.65 && locked < 0.85)
        // Below the peak it's linear first: the cornering stiffness (slope at 0) is 2–4× the secant to the peak.
        #expect(lat.slope(0) > 1.5 && lat.slope(0) < 4)
    }

    @Test func aTyreGripsLessPerNewtonTheHarderItIsPressed() throws {
        // On the skidpad at the limit (a performance car on summer tyres: 1.0–1.25 g), both fronts sliding: the loaded
        // outside one's friction (|Fy| / Fz) is 5–30 % below the unloaded inside one's (load sensitivity: a tyre's μ falls
        // ≈ 10–20 % per nominal load added).
        let p = DriveProbe("skidpad"); try p.launch(to: 20)
        try p.run(3) { p in p.inp.steer = 1; p.hold(20) }
        let r = try #require(p.rows.last)
        let ay = abs(p.mean(\.ay, 2, 3))
        // Turning right (−x): the outside is +x, wheels 1 and 3.
        let muIn = abs(r.fy[0]) / r.fz[0], muOut = abs(r.fy[1]) / r.fz[1]
        note(p, String(format: "ay %.2f g, front μ inside %.2f outside %.2f", ay, muIn, muOut))
        #expect(ay > 1.0 && ay < 1.25)
        #expect(r.fz[1] > r.fz[0] && r.fz[3] > r.fz[2])
        #expect(muOut < 0.95 * muIn && muOut > 0.7 * muIn)
    }

    @Test func aFreeWheelRollsWithTheRoadAndStaysThere() throws {
        // A car moving at 8 m/s with its wheels still: each wheel spins up to the road's speed within 0.05 s and stays there
        // (|κ| under 0.005 for the next second, and its force steady tick to tick: no buzzing between the curve's peaks).
        let p = DriveProbe("free wheel"); p.car.vel.z = 8
        try p.run(0.05)
        var worst = 0.0, jump = 0.0, last = p.dm.fx
        try p.run(1) { p in
            for i in 0..<4 { worst = max(worst, abs(p.car.wheels[i].slip)); jump = max(jump, abs(p.dm.fx[i] - last[i])) }
            last = p.dm.fx
        }
        note(p, String(format: "worst |κ| %.4f, largest tick-to-tick change of Fx %.0f N", worst, jump))
        #expect(worst < 0.005)
        #expect(jump < 200)
    }

    // MARK: - The chassis

    @Test func theYawInertiaIsARealCarsForItsMassAndWheelbase() {
        // Dynamic index Iz / (m·a·b): 0.8–1.1 for real cars (mid-engined sports cars ≈ 0.8–0.9).
        let m = SPEC.dryMass + SPEC.gasMass, a = SPEC.comFromFront, b = SPEC.wheelbase - SPEC.comFromFront
        let di = DriveSpec.inertiaYaw / (m * a * b)
        #expect(di > 0.75 && di < 1.1)
        // And a yaw radius of gyration 0.26–0.32 of the car's length.
        let k = (DriveSpec.inertiaYaw / m).squareRoot() / SPEC.length
        #expect(k > 0.26 && k < 0.32)
    }

    @Test func aStepSteerBuildsTheYawRateQuicklyWithLittleOvershoot() throws {
        // ISO 7401's step steer at 20 m/s to ≈ 0.4 g: the yaw rate reaches 90 % of its steady value within 0.45 s of the
        // wheels getting half way there (road cars 0.15–0.35 s), overshooting it by under 25 %.
        let p = DriveProbe("step steer"); try p.launch(to: 20)
        try p.run(2.5) { p in p.inp.steer = 0.4; p.hold(20) }
        let rss = p.mean(\.r, 2, 2.5), steer = p.rows.map { abs($0.steer) }, sFinal = steer.last ?? 0
        let tHalf = p.rows[steer.firstIndex { $0 > sFinal / 2 } ?? 0].t
        let t90 = p.rows.first { abs($0.r) > 0.9 * abs(rss) }?.t ?? 9
        let over = p.maxAbs(\.r) / abs(rss) - 1
        note(p, String(format: "ay %.2f g, r %.1f°/s, t90 − t½ %.3f s, overshoot %.0f %%", abs(p.mean(\.ay, 2, 2.5)), rss * deg, t90 - tHalf, over * 100))
        #expect(abs(p.mean(\.ay, 2, 2.5)) > 0.3)
        #expect(t90 - tHalf > 0.05 && t90 - tHalf < 0.45)
        #expect(over < 0.25)
    }

    @Test func weightTransferAcrossTheCarIsItsMassTimesItsLateralGTimesItsCentreOfMassHeight() throws {
        // At a steady 1 g the outside tyres carry m·ay·h / track more than the inside ones (between them, front and rear),
        // within 15 % (the body's roll moves the centre of mass a little).
        let p = DriveProbe("weight transfer"); try p.launch(to: 20)
        try p.run(3) { p in p.inp.steer = 0.8; p.hold(20) }
        let s = p.span(2.5, 3)
        let dF = s.map { ($0.fz[1] - $0.fz[0] + $0.fz[3] - $0.fz[2]) / 2 }.reduce(0, +) / Double(s.count)
        let m = massOf(p.car), ay = abs(p.mean(\.ay, 2.5, 3)) * G, t = (SPEC.trackFront + SPEC.trackRear) / 2
        let want = m * ay * SPEC.comHeight / t
        note(p, String(format: "ΔFz %.0f N, m·ay·h/t %.0f N", dF, want))
        #expect(abs(dF / want - 1) < 0.15)
    }

    @Test func aTyresSlipLagsBehindTheWheelByItsRelaxationLength() {
        // A step in slip angle at 20 m/s: the tyre's own slip reaches 63 % of it after travelling its relaxation length
        // (σ / v = 17.5 ms for the front's 0.35 m), within a tick either way.
        let v = 20.0, sigma = SPEC.tyreRelaxFront
        var a = 0.0, t = 0.0
        while a < 0.632 * 0.1 && t < 1 { a = relaxSlip(a, 0.1, v, sigma, DT); t += DT }
        #expect(abs(t - sigma / v) < DT * 1.5)
    }

    @Test func theMotorsDriveTheRearsOnlyAndTheyShareTheTorque() throws {
        // Rear-wheel drive: the fronts carry no drive torque; straight on, the two rears share it within 5 %.
        let p = DriveProbe("drive split", tc: .on); try p.launch(to: 5)
        try p.run(1) { p in p.inp.throttle = 0.3 }
        #expect(p.dm.driveT[0] == 0 && p.dm.driveT[1] == 0)
        #expect(p.dm.driveT[2] > 100 && abs(p.dm.driveT[2] / p.dm.driveT[3] - 1) < 0.05)
    }

    // MARK: - The slides

    @Test func aHandbrakeTurnRotatesTheCarAndACountersteerCatchesIt() throws {
        // 16 m/s into a bend, a pull on the handbrake (0.25 s): the rear lets go (the body slips 20–75°, the car turns
        // ≥ 60°), then a driver's countersteer and a little throttle bring it straight inside two seconds, still moving.
        let p = DriveProbe("handbrake turn"); try p.launch(to: 16)
        try p.run(0.6) { p in p.inp.throttle = 0; p.inp.steer = 0.6; p.car.handbrake = p.t > 0.15 && p.t < 0.4 ? 1 : 0 }
        try p.run(2.4) { p in p.car.handbrake = 0; p.drift(target: 0, throttle: 0.05, gain: 0.3) }
        let bMax = p.maxAbs(\.beta), turned = abs(p.turned())
        note(p, String(format: "beta max %.1f°, turned %.0f°, end beta %.1f°, v %.1f", bMax * deg, turned * deg, p.beta * deg, p.speed))
        #expect(bMax * deg > 20 && bMax * deg < 75)
        #expect(turned * deg > 60)
        #expect(abs(p.beta) * deg < 8)
        #expect(p.speed > 3)
    }

    @Test func powerOversteerSwingsTheTailOutAndTractionControlStopsIt() throws {
        // A 1 MW rear-drive car at 12 m/s in a bend: 40 % throttle with nothing in the way breaks the rears loose (the body
        // slips past 12° within 1.2 s, the yaw rate past the path's); with traction and stability control on it doesn't
        // (under 6°).
        func run(_ esc: DriveModel.ESC) throws -> DriveProbe {
            let p = DriveProbe("power oversteer \(esc)", esc: esc != .off); p.dm.stability(esc)
            try p.launch(to: 12)
            try p.run(0.8) { p in p.hold(12); p.inp.steer = 0.6 }
            try p.run(1.2) { p in p.inp.throttle = 0.4 }
            note(p, String(format: "beta max %.1f°, r max %.1f°/s", p.maxAbs(\.beta, 0.8) * deg, p.maxAbs(\.r, 0.8) * deg))
            return p
        }
        let off = try run(.off), on = try run(.on), sport = try run(.sport)
        #expect(off.maxAbs(\.beta, 0.8) * deg > 12)
        #expect(on.maxAbs(\.beta, 0.8) * deg < 6)
        // Sport lets it move more than On, less than Off.
        #expect(sport.maxAbs(\.beta, 0.8) >= on.maxAbs(\.beta, 0.8) && sport.maxAbs(\.beta, 0.8) < off.maxAbs(\.beta, 0.8))
    }

    @Test func liftingOffAtTheLimitTucksTheNoseInWithoutSnapping() throws {
        // At 26 m/s on the limit (≥ 1 g), a lift: the load moves forward and the yaw rate rises 3–40 % (the tuck-in a
        // mid- or rear-heavy car is known for); the body's slip grows but stays under 15° with the wheel held still.
        let p = DriveProbe("lift-off"); try p.launch(to: 26)
        try p.run(2.0) { p in p.hold(26); p.inp.steer = 0.75 }
        let r0 = abs(p.mean(\.r, 1.6, 2.0)), ay0 = abs(p.mean(\.ay, 1.6, 2.0))
        try p.run(1.0) { p in p.inp.throttle = 0 }
        let r1 = p.maxAbs(\.r, 2.0, 3.0), fzF0 = p.span(1.6, 2.0).map { $0.fz[0] + $0.fz[1] }.max() ?? 0, fzF1 = p.span(2.0, 2.4).map { $0.fz[0] + $0.fz[1] }.max() ?? 0
        note(p, String(format: "ay %.2f g, r %.1f → %.1f°/s, beta max %.1f°, front load %.0f → %.0f N", ay0, r0 * deg, r1 * deg, p.maxAbs(\.beta, 2, 3) * deg, fzF0, fzF1))
        #expect(ay0 > 1.0)
        #expect(r1 / r0 > 1.03 && r1 / r0 < 1.4)
        #expect(fzF1 > fzF0)
        #expect(p.maxAbs(\.beta, 2, 3) * deg < 15)
    }

    @Test func brakingIntoABendRotatesTheCarAndAScandinavianFlickAddsToIt() throws {
        // At 14 m/s on dry concrete, hard into a bend with a dab of brake, from straight on or after a feint the other way
        // (the flick). The brake's load onto the nose unloads the rears and the car rotates (trail-brake oversteer: the
        // body slips past 5°); the feint's load swinging back across the car adds to it (≥ 5 % more). On dry tarmac a
        // road-tuned car shrugs most of a flick off (it's a loose-surface move): neither spins, both under 30°.
        func run(_ feint: Bool) throws -> (beta: Double, swing: Double) {
            let p = DriveProbe(feint ? "flick" : "turn-in"); try p.launch(to: 14)
            var swing = 0.0
            if feint {
                try p.run(0.5) { p in p.inp.throttle = 0; p.inp.steer = -1 }
                swing = p.rows.last.map { $0.fz[0] + $0.fz[2] - $0.fz[1] - $0.fz[3] } ?? 0
            }
            let t0 = p.t
            try p.run(0.6) { p in p.inp.steer = 1; p.inp.throttle = 0; p.inp.brake = p.t < t0 + 0.3 ? 0.5 : 0 }
            try p.run(1.0) { p in p.inp.brake = 0 }
            let b = p.maxAbs(\.beta, t0)
            note(p, String(format: "beta max %.1f°, load left−right at the reversal %.0f N", b * deg, swing))
            return (b, swing)
        }
        let plain = try run(false), flick = try run(true)
        #expect(abs(flick.swing) > 3000)
        #expect(plain.beta * deg > 5)
        #expect(flick.beta > 1.05 * plain.beta)
        #expect(flick.beta * deg < 30)
    }

    @Test func countersteerHoldsADriftAndTheThrottleSetsItsAngle() throws {
        // Into a bend at 14 m/s, the rears broken loose with the throttle, then held: the wheels pointed along the front's
        // path, the throttle on the angle. The car holds the drift for 3 s (the body's slip inside 5–45°, never spinning,
        // still moving ≥ 7 m/s), its yaw rate the path's (steady: within 35 %), and more throttle holds more angle.
        func hold(_ base: Double) throws -> (mean: Double, lo: Double, hi: Double, v: Double, steady: Double) {
            let p = DriveProbe(String(format: "drift at throttle %.2f", base)); try p.launch(to: 14)
            try p.run(0.6) { p in p.hold(14); p.inp.steer = 0.8 }
            var on = false
            try p.run(5) { p in
                if !on && abs(p.beta) > 0.08 { on = true }
                if on { p.drift(target: 0.3, throttle: base, gain: 0.5) } else { p.inp.throttle = 0.3; p.inp.steer = 0.8 }
            }
            let s = p.span(2.6, 5.6), b = s.map { abs($0.beta) }
            // Steady: the yaw rate against the path's turning rate (ay / v).
            let steady = s.map { abs($0.r - $0.ay * G / max($0.v, 1)) / max(abs($0.r), 0.05) }.reduce(0, +) / Double(s.count)
            let r = (b.reduce(0, +) / Double(b.count), b.min() ?? 0, b.max() ?? 0, s.map { $0.v }.min() ?? 0, steady)
            note(p, String(format: "beta mean %.1f° (%.1f–%.1f), v min %.1f, |r − ay/v| / r %.2f", r.0 * deg, r.1 * deg, r.2 * deg, r.3, r.4))
            return r
        }
        let lo = try hold(0.10), mid = try hold(0.13), hi = try hold(0.16)
        for h in [lo, mid, hi] { #expect(h.hi * deg < 45 && h.v > 7) }
        for h in [mid, hi] { #expect(h.lo * deg > 5) }
        #expect(mid.steady < 0.35)
        #expect(lo.mean < mid.mean && mid.mean < hi.mean)
    }

    @Test func theTouchCountersteerAssistCatchesASlideAThumbLetsGoOf() throws {
        // A power slide out of a bend (stability off, 200 kW), then the thumb lets go of the slider (steer centred, the
        // throttle eased): with the assist the wheels lean into the slide and catch it; without, the car swaps ends.
        func run(_ k: Double) throws -> (Double, Double) {
            let p = DriveProbe(String(format: "counter assist %.2f", k)); p.dm.counterAssist = k
            try p.launch(to: 12)
            try p.run(0.8) { p in p.hold(12); p.inp.steer = 0.6 }
            try p.run(0.6) { p in p.inp.throttle = 0.2 }
            try p.run(2.5) { p in p.inp.steer = 0; p.inp.throttle = 0.04 }
            note(p, String(format: "beta max %.1f°, turned %.0f°, end beta %.1f°", p.maxAbs(\.beta) * deg, abs(p.turned()) * deg, p.beta * deg))
            return (p.maxAbs(\.beta), abs(p.turned()))
        }
        let without = try run(0), with = try run(DriveSpec.counterAssistTouch)
        #expect(without.1 * deg > 150)                       // swapped ends
        #expect(with.1 * deg < 130 && with.0 * deg < 25)     // caught
        #expect(DriveSpec.counterAssistTouch > 0 && DriveSpec.counterAssistTouch <= 0.5)   // light: a hand still steers
    }
}
