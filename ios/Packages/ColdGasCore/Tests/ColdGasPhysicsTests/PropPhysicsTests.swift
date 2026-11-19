// 0269: Free Drive and Roam's things against real ones. A 4 kg cone tips over its base's edge and rolls; a water-filled
// barrier is shoved, not thrown, and slides to a stop at its friction; a parked car is pushed, not launched; the drive's car
// gives up momentum by the mass ratio; everything comes to rest and stays there (no jitter, stacked or in a row); and the
// knock a player feels is the impulse the thing took. The drive's own car (driveStep) does the hitting.
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld
import CRapier

@Suite("Props against real ones", .serialized)
struct PropPhysicsTests {
    let deg = 180 / Double.pi
    /// Out on the slab, clear of the set (DriveCarTests' spot): everything below is placed relative to it.
    let X0 = -900.0, Z0 = -1300.0
    /// The drive's car on Free Drive's slab at (x, z) off (X0, Z0), heading −z at `v` m/s, and its chassis.
    func car(_ course: Course = DRIVE_COURSE, x: Double = 0, z: Double, v: Double) -> (Vehicle, DriveModel) {
        let c = createVehicle(course: course)
        c.world.streamer = DriveStreamer(world: FreeWorld(seed: "props"))
        c.pos.x = X0 + x; c.pos.y = SPEC.comHeight + 0.02; c.pos.z = Z0 + z
        M3.quatFromYaw(c.quat, DMath.PI)
        go(c, v)
        return (c, DriveModel())
    }
    /// Rolling at `v` m/s along its nose, its wheels turning with the road.
    func go(_ c: Vehicle, _ v: Double) {
        let q = c.quat
        c.vel.x = 2 * (q.x * q.z + q.w * q.y) * v; c.vel.z = (1 - 2 * (q.x * q.x + q.y * q.y)) * v
        for i in 0..<4 { c.wheels[i].omega = v / RW[i] }
    }
    /// The things put down settle (half a second) with the car held where it is, then it rolls at `v`.
    func settle(_ c: Vehicle, _ dm: DriveModel, then v: Double) throws {
        let inp = Input()
        for _ in 0..<120 { go(c, 0); try driveStep(c, inp, dm); readLoose(c.world) }
        go(c, v)
    }
    func speed(_ c: Vehicle) -> Double { (c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot() }
    func up(_ b: LooseBody) -> Double { 1 - 2 * (b.qx * b.qx + b.qz * b.qz) }
    func log(_ s: String) { if ProcessInfo.processInfo.environment["DRIVE_LOG"] != nil { print("PROP \(s)") } }

    // MARK: - The cone

    @Test func aConeTipsOverItsBaseAtItsRealAngleAndANudgeRocksItBack() throws {
        // A 750 mm cone's centre of mass sits ≈ 0.11 m up over a 0.38 m base: it tips past ≈ 60° (atan(0.19 / 0.11)).
        let k = LooseKind.cone, h = k.half.1 - k.comDrop
        let tip = atan(0.19 / h) * deg
        #expect(h > 0.08 && h < 0.14)
        #expect(tip > 50 && tip < 65)
        // Its inertia is its parts', not a solid box's (lower: it tips and spins as a real one does).
        let (ix, iy, _) = k.inertia, m = k.mass, (_, hy, hz) = k.half
        #expect(ix < m / 3 * (hy * hy + hz * hz) && iy < ix)
        // On the slab, a push at its tip: tipping it over its base's edge takes ≈ 4.5 J (its centre of mass raised 0.11 m),
        // which a 3 N·s shove gives it (about the edge, I ≈ 0.36 kg·m²: ≈ 4.4 J... and past it at 4); 0.8 N·s rocks it
        // and it stands back up. Either way it ends still.
        func push(_ J: Double) throws -> (upright: Bool, still: Bool) {
            let (c, dm) = car(z: 300, v: 0)
            defer { c.world.free() }
            let b = addLoose(c.world, .cone, x: X0 + 0, y: 0, z: Z0 + -80, yaw: 0)
            let inp = Input()
            for _ in 0..<120 { try driveStep(c, inp, dm); readLoose(c.world) }
            cg_body_apply_impulse_at_point(c.world.rw, b.rb, 0, 0, Float(J), Float(b.x - c.world.ox), Float(0.74 - c.world.oy), Float(b.z - c.world.oz), true)
            for _ in 0..<(240 * 8) { try driveStep(c, inp, dm); readLoose(c.world) }
            log(String(format: "cone pushed at its tip with %.1f N·s: up %.2f, asleep %@", J, up(b), b.asleep ? "yes" : "no"))
            return (up(b) > 0.98, b.asleep || b.speed < 0.02)
        }
        let nudge = try push(0.8), kick = try push(5)
        #expect(nudge.upright && nudge.still)
        #expect(!kick.upright && kick.still)
    }

    @Test func aCarAtFifteenMetresASecondFlicksAConeAwayAndBarelyNoticesAndTheConeComesToRest() throws {
        let (c, dm) = car(z: -60, v: 15)
        defer { c.world.free() }
        let cone = addLoose(c.world, .cone, x: X0 + 0, y: 0, z: Z0 + -80, yaw: 0)
        try settle(c, dm, then: 15)
        let inp = Input()
        inp.throttle = 0.03
        var peak = 0.0, vCar0 = 0.0, vCar1 = 0.0, hit = -1, t = 0
        for i in 0..<(240 * 10) {
            if hit >= 0 && i == hit + 60 { inp.throttle = 0; inp.brake = 1 }   // stop well past it
            let before = speed(c)
            try driveStep(c, inp, dm); readLoose(c.world)
            if hit < 0 && cone.speed > 1 { hit = i; vCar0 = before }
            if hit >= 0 && i == hit + 12 { vCar1 = speed(c) + 12 * DT * 0.0 }
            peak = max(peak, cone.speed)
            t = i
        }
        _ = t
        let dvCar = vCar0 - vCar1
        log(String(format: "cone peak %.1f m/s, the car lost %.3f m/s in the 50 ms round the hit, cone asleep %@", peak, dvCar, cone.asleep ? "yes" : "no"))
        // A 4.2 kg cone struck by 2.45 t leaves at ≈ (1 + e) × the car's speed (e ≈ 0.25), plus what the nose's slope adds.
        #expect(peak > 14 && peak < 30)
        // The car loses about m_cone·v_cone / m_car (≈ 0.04 m/s): under 0.2 m/s (rolling resistance included).
        #expect(dvCar < 0.2)
        // And the cone comes to rest within the 9 s after: no endless rolling or jitter.
        #expect(cone.asleep || cone.speed < 0.05)
    }

    // MARK: - The barrier

    @Test func aWaterFilledBarrierIsShovedNotThrownAndSlidesToAStopAtItsFriction() throws {
        let k = LooseKind.barrier
        #expect(k.mass > 150 && k.mass < 300)   // 1 m of water-filled polyethylene (ESTIMATE: 185 L + 15 kg)
        let (c, dm) = car(z: -60, v: 8)
        defer { c.world.free() }
        let b = addLoose(c.world, .barrier, x: X0 + 0, y: 0, z: Z0 + -70, yaw: 0)
        try settle(c, dm, then: 8)
        let y0 = b.y
        let inp = Input()
        inp.throttle = 0.02
        var hit = -1, braked = false, peak = 0.0, lift = 0.0, vCar0 = 0.0
        var samples: [(Int, Double)] = []
        for i in 0..<(240 * 6) {
            let before = speed(c)
            try driveStep(c, inp, dm); readLoose(c.world)
            if hit < 0 && b.speed > 1 { hit = i; vCar0 = before }
            // Once it's moving, the car brakes hard (≈ 1 g) and the barrier slides on alone.
            if hit >= 0 && !braked && i > hit + 24 { braked = true; inp.throttle = 0; inp.brake = 1 }
            peak = max(peak, b.speed); lift = max(lift, b.y - y0)
            if braked { samples.append((i, b.speed)) }
        }
        // Momentum: at contact the car (2.45 t) and the barrier (0.2 t) end up together, ≈ m_car·v / (m_car + m_b): the
        // barrier no faster than the car was going, plus its low restitution's ≈ 5 %.
        let together = vCar0 * massOf(c) / (massOf(c) + k.mass)
        log(String(format: "barrier peak %.2f m/s (together %.2f), lift %.3f m", peak, together, lift))
        #expect(peak > 0.8 * together && peak < 1.15 * vCar0)
        #expect(lift < 0.1)   // shoved along the ground, not launched
        // Sliding alone it slows at its friction (HDPE on concrete, μ 0.35: 3.4 m/s²), within 35 %.
        let sliding = samples.filter { $0.1 > 0.5 }
        if let a = sliding.first, let z = sliding.last, z.0 > a.0 + 24 {
            let decel = (a.1 - z.1) / (Double(z.0 - a.0) * DT)
            log(String(format: "barrier slides at %.2f m/s²", decel))
            #expect(abs(decel / (MATERIALS.hdpe.slide * G) - 1) < 0.35)
        } else { Issue.record("the barrier never slid on its own") }
        #expect(b.asleep || b.speed < 0.05)
    }

    @Test func theCarGivesUpMomentumToABarrierByTheMassRatio() throws {
        // Coasting into a barrier at 6 m/s: over the 0.1 s from the hit, what the car lost beyond what it loses coasting on
        // its own (the same run without the barrier: rolling resistance and lift-off regen) matches the barrier's momentum
        // within 25 % (the slab's friction under the barrier and the lift onto the car's nose take a little), and the car
        // slows by about m_b / (m_car + m_b) of its speed.
        func run(_ with: Bool) throws -> (dv: Double, pB: Double, v0: Double) {
            let (c, dm) = car(z: -60, v: 6)
            defer { c.world.free() }
            let b = addLoose(c.world, .barrier, x: X0 + (with ? 0 : 30), y: 0, z: Z0 + -66, yaw: 0)
            try settle(c, dm, then: 6)
            let inp = Input()
            var v0 = 0.0, pB = 0.0, dv = 0.0
            // The hit comes when the car's nose reaches the barrier's face; the control run is measured over the same ticks.
            let reach = Int((((66 - 60) - b.kind.half.2 - (AXLE_F + SPEC.overhangFront)) / 6) / DT) - 6
            for i in 0..<(240 * 2) {
                try driveStep(c, inp, dm); readLoose(c.world)
                if i == reach { v0 = speed(c) }
                if i == reach + 30 { dv = v0 - speed(c); pB = b.speed * LooseKind.barrier.mass }
            }
            return (dv, pB, v0)
        }
        let hit = try run(true), alone = try run(false)
        let m = massOf(createVehicle(course: DRIVE_COURSE))
        let pCar = (hit.dv - alone.dv) * m
        log(String(format: "car Δp %.0f N·s beyond coasting (%.0f), barrier p %.0f N·s, car Δv %.2f m/s", pCar, alone.dv * m, hit.pB, hit.dv - alone.dv))
        #expect(hit.pB > 300)
        #expect(abs(pCar / hit.pB - 1) < 0.25)
        let ratio = LooseKind.barrier.mass / (m + LooseKind.barrier.mass)
        #expect((hit.dv - alone.dv) / hit.v0 > 0.5 * ratio && (hit.dv - alone.dv) / hit.v0 < 2 * ratio)
    }

    // MARK: - At rest

    @Test func barriersInARowAndStackedComeToRestAndStayThere() throws {
        let (c, dm) = car(z: 300, v: 0)
        defer { c.world.free() }
        var row: [LooseBody] = []
        for k in 0..<6 { row.append(addLoose(c.world, .barrier, x: X0 + -3 + Double(k) * 1.1, y: 0, z: Z0 + -40, yaw: 0)) }
        // One stacked on another, and a cone on its own.
        let base = addLoose(c.world, .barrier, x: X0 + 10, y: 0, z: Z0 + -40, yaw: 0)
        let top = addLoose(c.world, .barrier, x: X0 + 10, y: 2 * LooseKind.barrier.half.1, z: Z0 + -40, yaw: 0)
        let cone = addLoose(c.world, .cone, x: X0 + 14, y: 0, z: Z0 + -40, yaw: 0)
        let all = row + [base, top, cone]
        // Wake them all (a nudge of nothing) so the engine has to settle them, then 8 s.
        for b in all { cg_body_set_linvel(c.world.rw, b.rb, 0, 0, 0, true) }
        let inp = Input()
        for _ in 0..<(240 * 4) { try driveStep(c, inp, dm); readLoose(c.world) }
        let at = all.map { ($0.x, $0.y, $0.z) }
        for _ in 0..<(240 * 4) { try driveStep(c, inp, dm); readLoose(c.world) }
        var drift = 0.0
        for (b, p) in zip(all, at) { drift = max(drift, abs(b.x - p.0) + abs(b.y - p.1) + abs(b.z - p.2)) }
        log(String(format: "after 8 s: the most anything moved in the last 4 s %.4f m; asleep %d of %d; top over base by %.3f m", drift, all.filter { $0.asleep }.count, all.count, top.y - base.y))
        // Nothing creeps (under 2 mm in the last 4 s), the stack stands (the top one still on the bottom, upright).
        #expect(drift < 0.002)
        #expect(abs(top.x - base.x) < 0.05 && abs(top.z - base.z) < 0.05 && abs(top.y - base.y - 2 * LooseKind.barrier.half.1) < 0.05)
        for b in all { #expect(up(b) > 0.99) }
    }

    // MARK: - The parked cars (the Lineup's, shared with the scored runs: audited, unchanged)

    @Test func aParkedCarIsShovedNotLaunched() throws {
        // Into the Lineup's row at 10 m/s, coasting: the first parked car (1.4–1.8 t) moves off no faster than the two
        // cars would together after a hit with a crumple's restitution (≤ 0.3), never leaves the ground (under 1.5 m/s up),
        // and doesn't roll or pitch past 15°; the drive's car slows by about the mass ratio.
        let (c, dm) = car(DRIVE_LINEUP, x: -X0, z: LINEUP.lineupZ0 - 14 - Z0, v: 10)
        defer { c.world.free() }
        M3.quatFromYaw(c.quat, 0)
        try settle(c, dm, then: 10)
        let first = try #require(c.world.bodies.min { $0.cz < $1.cz })
        let inp = Input()
        var peak = 0.0, up = 0.0, tilt = 0.0, hit = -1, vCar0 = 0.0, vCar1 = 0.0
        for i in 0..<(240 * 3) {
            let before = speed(c)
            try driveStep(c, inp, dm)
            let v = (first.vx * first.vx + first.vz * first.vz).squareRoot()
            if hit < 0 && v > 0.3 { hit = i; vCar0 = before }
            if hit >= 0 && i == hit + 36 { vCar1 = speed(c) }
            peak = max(peak, v); up = max(up, first.vy)
            tilt = max(tilt, acos(min(1, 1 - 2 * (first.qx * first.qx + first.qz * first.qz))))
        }
        let m1 = massOf(c), m2 = first.mass, bound = (1 + 0.3) * m1 * vCar0 / (m1 + m2)
        log(String(format: "parked %.0f kg: peak %.2f m/s (bound %.2f), up %.2f m/s, tilt %.1f°, car Δv %.2f of %.2f", m2, peak, bound, up, tilt * deg, vCar0 - vCar1, vCar0))
        #expect(hit >= 0)
        #expect(peak > 0.5 && peak < bound)
        #expect(up < 1.5)
        #expect(tilt * deg < 15)
        #expect((vCar0 - vCar1) / vCar0 > 0.3 * m2 / (m1 + m2))
    }

    // MARK: - What a hit feels like

    @Test func theKnockAPlayerFeelsIsTheImpulseTheThingTook() {
        // A cone flicked away at 15 m/s (≈ 63 N·s) is a light tick; a barrier shoved to 5 m/s (≈ 1,000 N·s) a thud; a guard
        // rail section thrown at 15 m/s (≈ 1,650 N·s) harder still; a rocked cone nothing.
        let cone = LooseKind.knock(.cone, dv: 15) ?? 0, barrier = LooseKind.knock(.barrier, dv: 5) ?? 0, rail = LooseKind.knock(.rail, dv: 15) ?? 0
        #expect(cone > 0.05 && cone < 0.3)
        #expect(barrier > 0.5 && barrier < 0.8)
        #expect(rail > barrier && rail <= 1)
        #expect(LooseKind.knock(.cone, dv: 0.3) == nil && LooseKind.knock(.cone, dv: 1) == nil)
        // Monotonic in the impulse, whatever the thing.
        var prev = 0.0
        for dv in stride(from: 0.5, through: 20, by: 0.5) { let k = LooseKind.knock(.barrier, dv: dv) ?? 0; #expect(k >= prev); prev = k }
    }
}
