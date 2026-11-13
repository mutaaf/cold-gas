// 0225: Free Drive's own chassis (DriveCar.swift). It stands where the scored car stands, rolls and dives on its own
// wheels, its tyres share their grip between braking and cornering, ABS holds the slip, the brakes heat, and the torque
// moves to the outside wheel. The scored car is untouched: RunVectorTests' 52 runs are its proof.
import Testing
@testable import ColdGasPhysics
import ColdGasCore

@Suite("Free Drive's own car", .serialized)
struct DriveCarTests {
    /// A car on the drive course's slab, well clear of the set, facing +z at rest.
    func car() -> (Vehicle, DriveModel) {
        let c = createVehicle(course: DRIVE_COURSE)
        c.pos.x = -900; c.pos.y = SPEC.comHeight + 0.02; c.pos.z = -1300
        M3.quatFromYaw(c.quat, 0)
        return (c, DriveModel())
    }
    func run(_ c: Vehicle, _ dm: DriveModel, _ inp: Input, ticks: Int, each: (() -> Void)? = nil) throws {
        for _ in 0..<ticks { try driveStep(c, inp, dm); each?() }
    }
    func speed(_ c: Vehicle) -> Double { (c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot() }
    /// Up to `v` m/s straight on.
    func launch(_ c: Vehicle, _ dm: DriveModel, to v: Double) throws {
        let inp = Input()
        var n = 0
        while speed(c) < v && n < 240 * 20 { inp.throttle = 0.7; try driveStep(c, inp, dm); n += 1 }
    }

    @Test func itStandsAtTheScoredCarsRideHeightOnItsOwnSprings() throws {
        let (c, dm) = car(); defer { c.world.free() }
        try run(c, dm, Input(), ticks: 720)
        #expect(c.grounded == 4)
        #expect(abs(c.vel.y) < 0.01)
        // Within 2 cm of where the scored car stands (the gas's mass aside), and each spring near its static compression.
        #expect(abs(c.pos.y - SPEC.comHeight) < 0.02)
        for i in 0..<4 { #expect(abs(dm.c2[i] - DriveSpec.staticLoad(i) / DriveSpec.k[i]) < 0.02) }
        // The springs are soft enough to see: ≥ 8 cm of static sag.
        for i in 0..<4 { #expect(DriveSpec.staticLoad(i) / DriveSpec.k[i] > 0.08) }
    }

    @Test func itRollsOntoTheOutsideWheelsInABend() throws {
        let (c, dm) = car(); defer { c.world.free() }
        try launch(c, dm, to: 22)
        let inp = Input()
        inp.throttle = 0.25; inp.steer = 0.6   // + = right
        var roll = 0.0
        try run(c, dm, inp, ticks: 240 * 2) { roll = bodyAttitude(c).roll }
        let latG = abs(c.angVel.y) * speed(c) / G
        let deg = roll * 180 / .pi
        // A real bend (≥ 0.6 g), the body leaning out by a sports car's 1.5–3° per g, the outside springs compressed.
        #expect(latG > 0.6)
        #expect(abs(deg) / latG > 1.2 && abs(deg) / latG < 3.5)
        // Turning right (toward −x), the outside is +x: wheels 1 and 3.
        #expect(dm.c2[1] > dm.c2[0] + 0.02 && dm.c2[3] > dm.c2[2] + 0.02)
        #expect(roll < 0)   // the left (+x) side down
    }

    @Test func itDivesUnderBrakesAndABSHoldsTheSlip() throws {
        let (c, dm) = car(); defer { c.world.free() }
        try launch(c, dm, to: 27.8)   // 100 km/h
        let z0 = c.pos.z, inp = Input()
        inp.brake = 1
        var pitchMin = 0.0, slipMin = 0.0, absSeen = false, n = 0
        while speed(c) > 0.3 && n < 240 * 8 {
            try driveStep(c, inp, dm); n += 1
            pitchMin = min(pitchMin, bodyAttitude(c).pitch)
            if speed(c) > 5 { for w in c.wheels { slipMin = min(slipMin, w.slip) } }
            absSeen = absSeen || dm.absActive
        }
        let d = c.pos.z - z0
        // 100–0 km/h in 30–40 m (≈ 1.0–1.3 g, a performance car on summer tyres), the nose down 0.7–3°, ABS working and
        // no wheel locked past a third slip.
        #expect(d > 28 && d < 40)
        #expect(pitchMin * 180 / .pi < -0.7 && pitchMin * 180 / .pi > -3)
        #expect(absSeen)
        #expect(slipMin > -0.35)
    }

    @Test func theTyresShareTheirGripBetweenBrakingAndCornering() {
        // The combined curve: at the lateral peak, adding longitudinal slip takes lateral force away (the friction circle).
        let C = DriveSpec.shapePaved
        func lat(_ sx: Double, _ sy: Double) -> Double { let s = (sx * sx + sy * sy).squareRoot(); return driveCurve(s, C) * sy / s }
        #expect(abs(driveCurve(1, C) - 1) < 1e-9)
        #expect(lat(0.0001, 1) > 0.99)
        #expect(lat(1, 1) < 0.75)
        #expect(lat(2, 1) < 0.5)
    }

    @Test func hardStopsHeatTheDiscsAndTheAirCoolsThem() throws {
        let (c, dm) = car(); defer { c.world.free() }
        for _ in 0..<3 {
            try launch(c, dm, to: 40)
            let inp = Input(); inp.brake = 1
            var n = 0
            while speed(c) > 0.5 && n < 240 * 8 { try driveStep(c, inp, dm); n += 1 }
        }
        let hot = dm.hottest
        // Three stops from 144 km/h: each front disc takes ≈ 0.4 MJ a stop; the fronts run hotter than the rears.
        #expect(hot.front > 200)
        #expect(hot.front > hot.rear)
        try launch(c, dm, to: 30)
        let inp = Input(); inp.throttle = 0.2
        try run(c, dm, inp, ticks: 240 * 15)
        #expect(dm.hottest.front < hot.front - 30)
    }

    @Test func vectoringTheRearTorqueHoldsTheLineTheSteeringAsksFor() throws {
        // Two identical cars into the same powered bend, one with the motors' torque vectoring and one without: the
        // vectored car's yaw rate stays closer to the one its steering asks for.
        func bend(_ on: Bool) throws -> Double {
            let (c, dm) = car(); defer { c.world.free() }
            try launch(c, dm, to: 18)
            dm.vectoring = on
            let inp = Input(); inp.throttle = 0.12; inp.steer = 0.45
            var err = 0.0, n = 0
            try run(c, dm, inp, ticks: 240 * 2) {
                n += 1
                if n > 120 { err += abs(dm.yawRef - c.angVel.y) }
            }
            return err
        }
        let (c, dm) = car(); defer { c.world.free() }
        try launch(c, dm, to: 18)
        let inp = Input(); inp.throttle = 0.12; inp.steer = 0.45
        var shifted = false
        try run(c, dm, inp, ticks: 240) { shifted = shifted || abs(dm.tvShift) > 50 }
        #expect(shifted)
        let on = try bend(true), off = try bend(false)
        #expect(on < off)
    }

    @Test func theScoredStepIsNotTheDrivesStep() throws {
        // The same input from the same rest on the scored car and the drive's: different chassis, different motion. (The
        // scored car's bits are RunVectorTests'; this proves a drive really runs the drive's model.)
        let (a, dm) = car(); defer { a.world.free() }
        let (b, _) = car(); defer { b.world.free() }
        let inp = Input(); inp.throttle = 0.6
        for _ in 0..<480 { try driveStep(a, inp, dm); try step(b, inp) }
        #expect(abs(a.pos.z - b.pos.z) > 1e-3 || abs(a.pos.y - b.pos.y) > 1e-3)
    }
}
