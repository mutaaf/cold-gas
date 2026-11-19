// THE CAR'S DAMAGE (0333, docs/NATIVE-MATTER.md §3): what each impact the sim records does to the roadster, kept for the
// drive (or the run) and undone by a reset. Pure and deterministic: the same impacts in the same order give the same car,
// with no randomness (the crash's own seeded sparks and chips are Crash.swift's, untouched).
//   panels     each zone's deformation (m): the nose, the tail, either flank, the roof, the floor
//   glass      the canopy intact → cracked → shattered (a hard hit on the roof or a flank, or the third hard one anywhere)
//   lamps      each headlamp and tail lamp, whole or broken (a hit on its corner)
//   hanging    the front and rear aero panels: on → hanging (a mid hit on that end, it droops and swings) → off (a second
//              or a hard one: the crash's debris takes it)
//   alignment  each wheel's toe (rad): a kerb-strike's slam on a wheel, or a flank hit beside it, bends its arm; the bent
//              fronts pull the steering, a bent rear crabs the car (DriveCar reads `toe` in a drive)
//   drive unit health 1 → 0 from the hits' energy: smoke from 0.6 down, limp power from 0.4 (DriveCar reads `powerK`)
// In a scored run it's drawn only (the renderer's copy, fed from the replay's impacts); the scored step never reads it.
// Thresholds are ESTIMATES (closing speeds in m/s), each beside its rule.
import Foundation
import ColdGasCore

public struct CarDamage: Equatable, Sendable {
    public enum Zone: Int, CaseIterable, Sendable { case nose, tail, left, right, roof, floor }
    public enum Glass: Int, Sendable { case intact, cracked, shattered }
    public enum Panel: Int, Sendable { case on, hanging, off }
    /// Each zone's deformation (m), capped at 0.35 (a crumple zone's travel).
    public var dent = [Double](repeating: 0, count: Zone.allCases.count)
    public var glass: Glass = .intact
    /// Hard hits the canopy has taken (each over 6 m/s); the third shatters a cracked one.
    public var glassHits = 0
    /// Lamps broken: head left, head right, tail left, tail right (+x is the car's right).
    public var lamp = [Bool](repeating: false, count: 4)
    /// The front and rear aero panels.
    public var panel: [Panel] = [.on, .on]
    /// Each wheel's toe (rad, + turns its front toward +x) and camber (rad, drawn).
    public var toe = [Double](repeating: 0, count: 4), camber = [Double](repeating: 0, count: 4)
    /// The drive unit's health (1 new … 0 wrecked).
    public var health = 1.0
    /// Hits counted (the HUD, tests).
    public var hits = 0
    public init() {}
    public mutating func reset() { self = CarDamage() }

    /// ESTIMATE: three 15 m/s hits (≈ 55 km/h, a crash test's speed, each a write-off's) wreck the drive unit; the energy a
    /// hit gives is (v − 3)² for v over 3 m/s (a parking knock is nothing).
    public static let wreckEnergy = 3 * 12.0 * 12.0
    /// The most a wheel's toe is bent (rad): ≈ 4.6°, a bent tie-rod's (1–5° measured after kerb strikes).
    public static let toeMax = 0.08

    /// Smoke from the drive unit (0…1): none above 0.6 health, thick at 0.
    public var smoke: Double { max(0, min(1, (0.6 - health) / 0.6)) }
    /// The motors' torque left (limp mode under 0.4 health, down to 35 % at 0).
    public var powerK: Double { health >= 0.4 ? 1 : 0.35 + 0.65 * max(0, health) / 0.4 }
    /// The steering's pull (rad at the front wheels, + toward +x): the fronts' toe averaged.
    public var pull: Double { (toe[0] + toe[1]) / 2 }
    /// Whether each end has a lamp still lit (the renderer dims an end with none).
    public var headsLit: Int { (lamp[0] ? 0 : 1) + (lamp[1] ? 0 : 1) }
    public var tailsLit: Int { (lamp[2] ? 0 : 1) + (lamp[3] ? 0 : 1) }

    /// One impact. `kind`/`part`: ImpactKind and PART; `local`: where, in the car's frame (x right, y up from the CoM, z
    /// forward); `nLocal`: the contact's normal in the car's frame (pointing out of what was hit, into the car); `speed`:
    /// the closing speed (m/s); `crush`: a CRUSH event's depth (m); `wheel`: a WHEEL event's wheel (its probe).
    public mutating func apply(kind: UInt8, part: UInt8, local: (Double, Double, Double), nLocal: (Double, Double, Double) = (0, 0, 0),
                               speed v: Double, crush: Double = 0, wheel: Int = -1) {
        guard v.isFinite, crush.isFinite, local.0.isFinite, local.1.isFinite, local.2.isFinite,
              nLocal.0.isFinite, nLocal.1.isFinite, nLocal.2.isFinite else { return }
        let (x, _, z) = local
        if kind == ImpactKind.WHEEL {
            // A slam on a wheel past 7 m/s (a kerb, a ditch's lip at speed; ESTIMATE: road cars' arms take ≈ 25 km/h into a
            // kerb) bends its arm: the toe opens by the excess, outward (its front away from the car's middle).
            guard wheel >= 0, wheel < 4, v > 7 else { return }
            let side: Double = wheel % 2 == 0 ? -1 : 1   // WHEELS[0], [2] are the −x (left) side
            bend(wheel, side * 0.006 * (v - 7))
            return
        }
        if kind == ImpactKind.SCRAPE { return }   // a scrape marks the paint (the renderer's sparks), it doesn't bend metal
        if kind == ImpactKind.CRUSH {
            let zn = zone(part, x)
            dent[zn.rawValue] = min(0.35, max(dent[zn.rawValue], crush))
            return
        }
        // HIT
        guard v > 1.6 else { return }
        hits += 1
        let zn = zone(part, x)
        dent[zn.rawValue] = min(0.35, dent[zn.rawValue] + 0.004 * pow(max(0, v - 2), 1.2))
        let e = max(0, v - 3) * max(0, v - 3)
        health = max(0, health - e / CarDamage.wreckEnergy)
        // Glass: a roof or flank hit over 5 m/s cracks it, over 11 shatters it; any part over 9 cracks it; a cracked canopy
        // shatters on its third hard hit (ESTIMATE: laminated glazing crazes before it lets go).
        let glassy = part == PART.roof || part == PART.side
        if v > 6 { glassHits += 1 }
        if glassy && v > 11 { glass = .shattered }
        else if (glassy && v > 5) || v > 9 { if glass == .intact { glass = .cracked } else if glassHits >= 3 { glass = .shattered } }
        // Lamps: the end struck over 4 m/s loses the lamp on that corner; over 8 both (ESTIMATE: a lamp's housing breaks at a
        // parking-bump-plus).
        if part == PART.nose || part == PART.tail {
            let base = part == PART.nose ? 0 : 2
            if v > 8 { lamp[base] = true; lamp[base + 1] = true }
            else if v > 4 { lamp[base + (x > 0 ? 1 : 0)] = true }
            // The aero panel on that end: hangs at 5 m/s, goes at 9 (or a second hit over 5 while hanging).
            let p = part == PART.nose ? 0 : 1
            if v > 9 || (v > 5 && panel[p] == .hanging) { panel[p] = .off }
            else if v > 5 && panel[p] == .on { panel[p] = .hanging }
        }
        // A flank hit beside a wheel (within 0.7 m of its axle along the car) over 4 m/s pushes that wheel's arm in.
        if part == PART.side && v > 4 {
            let front = z > 0, i = (front ? 0 : 2) + (x > 0 ? 1 : 0)
            let axle = front ? AXLE_F : AXLE_R
            if abs(z - axle) < 0.7 { bend(i, (x > 0 ? -1.0 : 1.0) * 0.004 * (v - 4)) }
        }
    }
    private mutating func bend(_ i: Int, _ d: Double) {
        toe[i] = max(-CarDamage.toeMax, min(CarDamage.toeMax, toe[i] + d))
        camber[i] = max(-0.12, min(0.12, camber[i] - abs(d) * 1.5))
    }
    private func zone(_ part: UInt8, _ x: Double) -> Zone {
        switch part {
        case PART.nose: return .nose
        case PART.tail: return .tail
        case PART.roof: return .roof
        case PART.floor, PART.wheel: return .floor
        default: return x > 0 ? .right : .left
        }
    }
}
