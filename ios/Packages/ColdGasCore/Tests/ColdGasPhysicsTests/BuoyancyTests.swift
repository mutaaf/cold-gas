// 0320: the water on Free Drive's car (Buoyancy.swift): Archimedes at the body's wet columns, the cabin flooding and the car
// sinking, the water's drag (a wall of water at speed, a wading speed the motors can hold), the tyres' grip in it, the
// drive unit drowning and coming back, the car drying, and loose things floating or sinking by what they're made of. The
// tests flood the apron to a set level (the sea's own level is a FreeWorld's; Water.swift's tests cover where it lies).
// Deterministic (the same ticks give the same bits) and NaN-guarded. The scored car is untouched: RunVectorTests.
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld
import CRapier

@Suite("Free Drive's car in the water", .serialized)
struct BuoyancyTests {
    /// A car on the drive course's slab, clear of the set, facing +z at rest, with the apron flooded to `level` (m).
    func car(level: Double?) -> (Vehicle, DriveModel) {
        let c = createVehicle(course: DRIVE_COURSE)
        c.pos.x = -900; c.pos.y = SPEC.comHeight + 0.02; c.pos.z = -1300
        M3.quatFromYaw(c.quat, 0)
        let dm = DriveModel()
        if let l = level { dm.water.level = { _, _ in l } }
        return (c, dm)
    }
    func speed(_ c: Vehicle) -> Double { (c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot() }
    func run(_ c: Vehicle, _ dm: DriveModel, _ inp: Input, seconds: Double, each: (() -> Void)? = nil) throws {
        for _ in 0..<Int(seconds * 240) { try driveStep(c, inp, dm); each?() }
    }

    @Test func aColumnIsUnderByItsShareAndNaNIsDry() {
        #expect(WaterCar.submerged(0, 1, level: 0.25) == 0.25)
        #expect(WaterCar.submerged(1, 0, level: 0.25) == 0.25)   // either end down
        #expect(WaterCar.submerged(0, 1, level: -1) == 0 && WaterCar.submerged(0, 1, level: 5) == 1)
        #expect(WaterCar.submerged(.nan, 1, level: 0.5) == 0 && WaterCar.submerged(0, 1, level: .nan) == 0)
        #expect(WaterCar.submerged(0.3, 0.3, level: 0.4) == 1)
    }

    @Test func aTyreGripsWetAndAquaplanesInAFilmAtSpeed() {
        let vp = WaterCar.hydroplaneSpeed
        #expect(vp > 26 && vp < 29)   // ≈ 98 km/h at 240 kPa
        #expect(WaterCar.tyreGrip(depth: 0, speed: 40) == 1)
        #expect(WaterCar.tyreGrip(depth: 0.05, speed: 2) == WaterCar.wetGrip)
        // In a 5 cm film the grip falls with speed to its floor at the hydroplaning speed.
        var last = 2.0
        for v in stride(from: 0.0, through: 35, by: 1) { let g = WaterCar.tyreGrip(depth: 0.05, speed: v); #expect(g <= last + 1e-12); last = g }
        #expect(abs(WaterCar.tyreGrip(depth: 0.05, speed: vp) - WaterCar.wetGrip * WaterCar.hydroFloor) < 1e-9)
        // A tyre ploughing through 40 cm doesn't ride up on it.
        #expect(WaterCar.tyreGrip(depth: 0.4, speed: vp) == WaterCar.wetGrip)
        #expect(WaterCar.tyreGrip(depth: .nan, speed: 10) == 1 && WaterCar.tyreGrip(depth: 0.05, speed: .nan) == 1)
    }

    @Test func archimedesLiftsByTheWaterTheBodyDisplaces() {
        // Held upright and still, the water at the box's middle: the lift is half the sealed volume's weight of sea water,
        // through the car's centre line (no pitch, no roll).
        let (c, dm) = car(level: nil)
        defer { c.world.free() }
        let mid = c.pos.y + (WaterCar.y0 + WaterCar.y1) / 2
        dm.water.level = { _, _ in mid }
        M3.set(fTot, 0, 0, 0); M3.set(tTot, 0, 0, 0)
        wade(c, dm, massOf(c), DT)
        let want = WaterCar.rho * G * WaterCar.volume * 0.5
        #expect(abs(fTot.y - want) / want < 1e-9)
        #expect(abs(fTot.x) < 1e-9 && abs(fTot.z) < 1e-9)
        // No roll; the box's middle is ahead of the centre of mass (the nose's overhang), so it lifts the nose.
        let zc = (WaterCar.z0 + WaterCar.z1) / 2
        #expect(abs(tTot.z) < 1e-6)
        #expect(abs(tTot.x + zc * want) / want < 1e-9)
        #expect(abs(dm.water.submerged - 0.5) < 1e-9)
    }

    @Test func aCarInDeepWaterFloatsThenFloodsAndSinks() throws {
        let (c, dm) = car(level: 3.0)
        defer { c.world.free() }
        let inp = Input()
        // Afloat: up to the surface, settled with part of the body above it (≈ 2.4 t on ≈ 3.9 m³).
        try run(c, dm, inp, seconds: 8)
        #expect(dm.water.floating)
        #expect(abs(c.vel.y) < 0.3)
        #expect(c.pos.y > 2.0 && c.pos.y < 3.4)
        // Deep water has drowned the drive unit; the cabin has started to fill.
        #expect(dm.water.stalled && dm.water.motor == 0)
        #expect(dm.water.flood > 0.05)
        #expect(dm.water.wet == 1)
        // Flooded, it goes down to the bottom.
        dm.water.flood = 0.95
        try run(c, dm, inp, seconds: 12)
        #expect(!dm.water.floating)
        #expect(c.pos.y < 1.0)
        #expect(c.grounded >= 2)
        #expect(carFinite(c))
    }

    @Test func drivingInAtSpeedHitsAWallOfWater() throws {
        // At 20 m/s, a second's coast in 40 cm of water against the same on the dry apron.
        func coast(_ level: Double?) throws -> Double {
            let (c, dm) = car(level: nil)
            defer { c.world.free() }
            let inp = Input()
            var n = 0
            while speed(c) < 20 && n < 240 * 20 { inp.throttle = 0.8; try driveStep(c, inp, dm); n += 1 }
            inp.throttle = 0
            if let l = level { dm.water.level = { _, _ in l } }
            let v0 = speed(c)
            try run(c, dm, inp, seconds: 1)
            return v0 - speed(c)
        }
        let dry = try coast(nil), wet = try coast(0.4)
        #expect(dry < 1.5)
        #expect(wet > 6 * dry && wet > 7)   // ≥ 0.7 g of water
    }

    @Test func wadingHasASpeedTheMotorsCanHoldAndDeepWaterDrownsThem() throws {
        let inp = Input(); inp.throttle = 1
        func top(_ level: Double?) throws -> (Double, Bool) {
            let (c, dm) = car(level: level)
            defer { c.world.free() }
            try run(c, dm, inp, seconds: 8)
            return (speed(c), dm.water.stalled)
        }
        let (dry, _) = try top(nil), (shallow, s1) = try top(0.3)
        #expect(shallow < dry * 0.75 && shallow > 3)
        #expect(!s1)   // 30 cm: wading, the drive unit dry
        let (_, s2) = try top(0.75)
        #expect(s2)    // 75 cm: the inverter trips
    }

    @Test func theDriveUnitComesBackAndTheCarDries() throws {
        let (c, dm) = car(level: 0.8)
        defer { c.world.free() }
        let inp = Input()
        try run(c, dm, inp, seconds: 3)
        #expect(dm.water.stalled && dm.water.wet == 1)
        dm.water.level = { _, _ in -5 }   // the water gone
        try run(c, dm, inp, seconds: WaterCar.restartAfter + 0.5)
        #expect(!dm.water.stalled)
        #expect(dm.water.wet < 1 && dm.water.wet > 0.5)
        try run(c, dm, inp, seconds: 90)
        #expect(dm.water.wet == 0 && dm.water.wetLine == 0)
    }

    @Test func aSplashIsCaughtWhereTheCarMeetsTheWater() throws {
        let (c, dm) = car(level: nil)
        defer { c.world.free() }
        let inp = Input()
        var n = 0
        while speed(c) < 15 && n < 240 * 20 { inp.throttle = 0.8; try driveStep(c, inp, dm); n += 1 }
        dm.water.level = { _, _ in 0.35 }
        try driveStep(c, inp, dm)
        let s = dm.water.drainSplash()
        #expect(s.k > 0.3)
        #expect(abs(s.y - 0.35) < 1e-9)
        #expect(abs(s.x - c.pos.x) < 3 && abs(s.z - c.pos.z) < 3)
        #expect(dm.water.drainSplash().k == 0)   // drained
    }

    @Test func theSameTicksGiveTheSameBits() throws {
        func once() throws -> [UInt64] {
            let (c, dm) = car(level: 0.6)
            defer { c.world.free() }
            let inp = Input(); inp.throttle = 0.6; inp.steer = 0.2
            try run(c, dm, inp, seconds: 4)
            return [c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y, c.quat.w, dm.water.flood, dm.water.submerged].map(\.bitPattern)
        }
        #expect(try once() == once())
    }

    @Test func waterThatIsntANumberIsNoWater() throws {
        let (c, dm) = car(level: .nan)
        defer { c.world.free() }
        let inp = Input(); inp.throttle = 0.5
        try run(c, dm, inp, seconds: 2)
        #expect(carFinite(c))
        #expect(dm.water.submerged == 0 && dm.water.grip.allSatisfy { $0 == 1 } && !dm.water.stalled)
        #expect(speed(c) > 5)
    }

    @Test func timberAndDrumsFloatAndSteelSinks() throws {
        let (c, dm) = car(level: nil)
        defer { c.world.free() }
        c.world.streamer = DriveStreamer(world: FreeWorld(seed: "float"))
        let level = 1.6
        let drum = addLoose(c.world, .drum, x: -905, y: 0.5, z: -1290, yaw: 0)
        let fence = addLoose(c.world, .fence, x: -895, y: 0.5, z: -1290, yaw: 0.3)
        let rail = addLoose(c.world, .rail, x: -900, y: 0.5, z: -1285, yaw: 0)
        for b in [drum, fence, rail] { cg_body_set_linvel(c.world.rw, b.rb, 0, -0.1, 0, true) }   // awake, as a thing thrown in is
        let inp = Input()
        for _ in 0..<(240 * 10) {
            floatLoose(c.world, level: { _, _ in level })
            try driveStep(c, inp, dm)
            readLoose(c.world)
        }
        print(String(format: "FLOAT drum %.3f fence %.3f rail %.3f asleep %d %d %d", drum.y, fence.y, rail.y, drum.asleep ? 1 : 0, fence.asleep ? 1 : 0, rail.asleep ? 1 : 0))
        #expect(abs(drum.y - level) < drum.kind.half.1)          // afloat, mostly out
        #expect(abs(fence.y - level) < 0.3)                      // afloat, low in the water
        #expect(rail.y < rail.kind.half.1 + 0.1)                 // on the bottom
        #expect([drum, fence, rail].allSatisfy { $0.x.isFinite && $0.y.isFinite })
    }
}
