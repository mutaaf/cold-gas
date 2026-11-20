// 0330, 0333: matter meets the car. What the ground is (soaked dirt is mud, water above the snow line is ice), what each
// ground gives the tyres (ice and snow slide, mud drags), what the car carries away (mud cakes the wheels and sills and water
// washes it), what each impact does (glass cracks then shatters, lamps go, panels hang then go, arms bend, the drive unit
// smokes and limps), and that a bent arm pulls the drive's car and a wrecked unit slows it. All deterministic; nothing that
// isn't a number changes anything.
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld

@Suite("Matter: the ground, the dirt, the damage", .serialized)
struct MatterTests {
    @Test func theGroundIsWhatItIsWetOrFrozen() {
        #expect(GroundMatter.of(.dirt) == .dirt && GroundMatter.of(.dirt, wet: 0.6) == .mud)
        #expect(GroundMatter.of(.grass, wet: 0.5) == .grass && GroundMatter.of(.grass, wet: 0.9) == .mud)
        #expect(GroundMatter.of(.water) == .water && GroundMatter.of(.water, freezing: true) == .ice)
        #expect(GroundMatter.of(.snow) == .snow && GroundMatter.of(.asphalt, wet: 1) == .asphalt)
        #expect(GroundMatter.of(.dirt, wet: .nan) == .dirt)
        // Grip, loosest last: asphalt > wet asphalt > gravel > dirt > grass > mud > snow > ice.
        let g = [GroundMatter.asphalt.material(), GroundMatter.asphalt.material(wet: 1), GroundMatter.gravel.material(), GroundMatter.dirt.material(),
                 GroundMatter.grass.material(), GroundMatter.mud.material(), GroundMatter.snow.material(), GroundMatter.ice.material()].map(\.grip)
        #expect(zip(g, g.dropFirst()).allSatisfy { $0 > $1 })
        #expect(GroundMatter.ice.material().grip <= 0.15 && !GroundMatter.ice.material().loose)
        // Soft grounds take ruts (mud and snow deepest), hard ones rubber, grass lies down.
        #expect(GroundMatter.mud.rut.pass > GroundMatter.dirt.rut.pass && GroundMatter.snow.rut.max > GroundMatter.sand.rut.max)
        #expect(!GroundMatter.asphalt.soft && GroundMatter.asphalt.rubber && GroundMatter.grass.flattens && !GroundMatter.ice.rubber)
        #expect(GroundMatter.mud.roost == .clods && GroundMatter.snow.roost == .snow && GroundMatter.water.roost == .spray && GroundMatter.ice.roost == .none)
        for m in GroundMatter.allCases { #expect(m.rut.pass <= m.rut.max && m.rut.max <= TraceSpec.depthScale) }
    }

    @Test func theStreamersSnowIsSnowAndHighWaterIsIce() {
        #expect(DriveStreamer.material(.snow, y: 1200).id == "snow")
        #expect(DriveStreamer.material(.water, y: 1200).id == "ice")
        #expect(DriveStreamer.material(.water, y: 0).id == "water")
        #expect(DriveStreamer.material(.grass).id == "grass" && DriveStreamer.material(.asphalt).id == "asphalt")
    }

    @Test func mudCakesTheCarAndWaterWashesItOff() {
        var d = CarDirt()
        // 100 m of mud at a steady roll: the wheels caked, the sills well covered, the tail from the rears' roost.
        for _ in 0..<1000 { for i in 0..<4 { d.roll(wheel: i, on: .mud, dist: 0.1, slip: 0.05, forward: true) } }
        #expect(d.wheel.allSatisfy { $0 > 0.6 } && d.sill > 0.4 && d.tail > 0.3 && d.body > 0.02 && d.nose == 0)
        #expect(d.r < 0.2 && d.g < 0.15)   // mud's own dark brown
        // A dirt road dusts it, much more slowly and to a film.
        var e = CarDirt()
        for _ in 0..<1000 { for i in 0..<4 { e.roll(wheel: i, on: .dirt, dist: 0.1, slip: 0, forward: true) } }
        #expect(e.wheel[0] > 0.05 && e.wheel[0] < d.wheel[0] && e.wheel[0] <= GroundMatter.dirt.dirt.max)
        // Spinning throws more.
        var s = CarDirt(), r = CarDirt()
        for _ in 0..<100 { s.roll(wheel: 2, on: .mud, dist: 0.1, slip: 0.8, forward: true); r.roll(wheel: 2, on: .mud, dist: 0.1, slip: 0, forward: true) }
        #expect(s.wheel[2] > 1.5 * r.wheel[2])
        // A ford (wetness 1) for 10 s takes most of the mud off; the dry air takes almost none.
        var w = d, dry = d
        for _ in 0..<600 { w.weather(dt: 1.0 / 60, wet: 1, speed: 3); dry.weather(dt: 1.0 / 60, wet: 0, speed: 3) }
        #expect(w.wheel[0] < 0.25 * d.wheel[0] && dry.wheel[0] > 0.95 * d.wheel[0])
        // Snow packs on and melts in water.
        var n = CarDirt()
        for _ in 0..<500 { n.roll(wheel: 0, on: .snow, dist: 0.1, slip: 0, forward: true) }
        #expect(n.snow > 0.1 && n.wheel[0] == 0)
        n.weather(dt: 1, wet: 1, speed: 0); #expect(n.snow < 0.3)
        // Nothing that isn't a number changes it.
        var z = d
        z.roll(wheel: 0, on: .mud, dist: .nan, slip: 0, forward: true); z.roll(wheel: 9, on: .mud, dist: 1, slip: 0, forward: true)
        z.roll(wheel: 0, on: .mud, dist: 1, slip: .infinity, forward: true); z.weather(dt: .nan, wet: 1, speed: 0); z.weather(dt: 1, wet: .nan, speed: 0)
        #expect(z == d)
    }

    @Test func impactsCrackThenShatterGlassBreakLampsHangPanelsAndBendArms() {
        var c = CarDamage()
        // A 4.5 m/s nose knock on the right: the right headlamp only; no glass.
        c.apply(kind: ImpactKind.HIT, part: PART.nose, local: (0.5, 0, 2), speed: 4.5)
        #expect(c.lamp == [false, true, false, false] && c.glass == .intact && c.panel == [.on, .on])
        // 6 m/s on the nose: the front panel hangs; a second 6 m/s hit takes it off.
        c.apply(kind: ImpactKind.HIT, part: PART.nose, local: (-0.2, 0, 2), speed: 6)
        #expect(c.panel[0] == .hanging)
        c.apply(kind: ImpactKind.HIT, part: PART.nose, local: (-0.2, 0, 2), speed: 6)
        #expect(c.panel[0] == .off && c.panel[1] == .on)
        // A flank hit at 7 m/s: the canopy cracks; beside the front axle, the left front's arm bends (toe-in, + toward +x).
        c.apply(kind: ImpactKind.HIT, part: PART.side, local: (-0.9, 0.2, AXLE_F), speed: 7)
        #expect(c.glass == .cracked && c.toe[0] > 0 && c.toe[1] == 0)
        // A hard roof hit shatters it.
        c.apply(kind: ImpactKind.HIT, part: PART.roof, local: (0, 0.8, 0), speed: 12)
        #expect(c.glass == .shattered)
        // A kerb strike on the rear right at 12 m/s: that wheel's toe opens, bounded.
        c.apply(kind: ImpactKind.WHEEL, part: PART.wheel, local: (0.9, -0.3, AXLE_R), speed: 12, wheel: 3)
        #expect(c.toe[3] > 0.02 && c.toe[3] <= CarDamage.toeMax && c.camber[3] < 0)
        for _ in 0..<50 { c.apply(kind: ImpactKind.WHEEL, part: PART.wheel, local: (0.9, -0.3, AXLE_R), speed: 30, wheel: 3) }
        #expect(c.toe[3] == CarDamage.toeMax)
        // A scrape bends nothing; a crush dents its zone to its depth.
        let before = c
        c.apply(kind: ImpactKind.SCRAPE, part: PART.side, local: (1, 0, 0), speed: 20)
        #expect(c == before)
        c.apply(kind: ImpactKind.CRUSH, part: PART.tail, local: (0, 0, -2), speed: 0, crush: 0.2)
        #expect(c.dent[CarDamage.Zone.tail.rawValue] == 0.2)
        c.reset(); #expect(c == CarDamage())
    }

    @Test func hardHitsSmokeAndLimpTheDriveUnit() {
        var c = CarDamage()
        c.apply(kind: ImpactKind.HIT, part: PART.nose, local: (0, 0, 2), speed: 3)
        #expect(c.health == 1 && c.smoke == 0 && c.powerK == 1)
        c.apply(kind: ImpactKind.HIT, part: PART.nose, local: (0, 0, 2), speed: 15)
        #expect(c.health < 0.7 && c.health > 0.6 && c.smoke == 0)
        c.apply(kind: ImpactKind.HIT, part: PART.tail, local: (0, 0, -2), speed: 15)
        #expect(c.smoke > 0.3 && c.powerK < 1 && c.powerK > 0.8)
        c.apply(kind: ImpactKind.HIT, part: PART.side, local: (1, 0, 0), speed: 15)
        #expect(c.health < 1e-9 && c.smoke > 0.999 && abs(c.powerK - 0.35) < 1e-9)
        // Non-numbers change nothing; the same impacts give the same car.
        var a = CarDamage(), b = CarDamage()
        a.apply(kind: ImpactKind.HIT, part: PART.nose, local: (0, 0, .nan), speed: 20)
        a.apply(kind: ImpactKind.HIT, part: PART.nose, local: (0, 0, 2), speed: .infinity)
        #expect(a == CarDamage())
        for v in stride(from: 2.0, through: 20, by: 1.5) { a.apply(kind: ImpactKind.HIT, part: PART.side, local: (v > 9 ? 1 : -1, 0, 1.2), speed: v); b.apply(kind: ImpactKind.HIT, part: PART.side, local: (v > 9 ? 1 : -1, 0, 1.2), speed: v) }
        #expect(a == b)
    }

    // MARK: - The drive's car with the damage

    private func cruise(toe: [Double] = [0, 0, 0, 0], powerK: Double = 1, gripK: Double = 1, seconds: Double = 4, throttle: Double? = nil) throws -> (x: Double, z: Double, v: Double, heading: Double) {
        let p = DriveProbe("matter")
        try p.launch(to: 20)
        p.dm.toe = toe; p.dm.powerK = powerK; for i in 0..<4 { p.dm.gripK[i] = gripK }
        let x0 = p.car.pos.x, z0 = p.car.pos.z, h0 = p.heading
        try p.run(seconds) { q in if let t = throttle { q.inp.throttle = t } else { q.hold(20) }; q.inp.steer = 0 }
        var dh = p.heading - h0; if dh > .pi { dh -= 2 * .pi }; if dh < -.pi { dh += 2 * .pi }
        return (p.car.pos.x - x0, p.car.pos.z - z0, p.speed, dh)
    }

    @Test func aBentFrontArmPullsTheCarOffItsLine() throws {
        let straight = try cruise()
        // Both fronts toed 1.5° toward +x (a hit on the left front's arm, a bent rack): hands off, the car turns toward +x.
        let bent = try cruise(toe: [0.026, 0.026, 0, 0])
        #expect(abs(straight.heading) < 0.02 && abs(straight.x) < 0.5)
        #expect(bent.heading > 0.15 && bent.x > 2)
        // Toward −x the other way; a non-number is no toe.
        let other = try cruise(toe: [-0.026, -0.026, 0, 0])
        #expect(other.heading < -0.15)
        let nan = try cruise(toe: [.nan, .nan, .nan, .nan])
        #expect(abs(nan.heading) < 0.02)
    }

    @Test func aWreckedDriveUnitLimpsAndIceGivesNoGrip() throws {
        // A third of the pedal for 3 s from 20 m/s (under the rears' grip): a limping unit (35 %) gains far less speed.
        let full = try cruise(seconds: 3, throttle: 0.3), limp = try cruise(powerK: 0.35, seconds: 3, throttle: 0.3)
        #expect(limp.v < full.v - 4)
        // On ice the same throttle spins the rears: barely any speed gained.
        let p = DriveProbe("ice")
        try p.launch(to: 10)
        p.dm.surfaceOverride = MatterMaterials.ice
        let v0 = p.speed
        try p.run(2) { q in q.inp.throttle = 1; q.inp.steer = 0 }
        let pa = DriveProbe("asphalt")
        try pa.launch(to: 10)
        try pa.run(2) { q in q.inp.throttle = 1; q.inp.steer = 0 }
        #expect(p.speed - v0 < 0.3 * (pa.speed - 10))
        #expect(p.car.pos.x.isFinite && p.car.pos.z.isFinite)
    }
}
