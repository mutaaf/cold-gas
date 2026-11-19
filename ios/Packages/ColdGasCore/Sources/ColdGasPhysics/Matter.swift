// MATTER (0330, docs/NATIVE-MATTER.md): what the ground is made of, as the drive's car meets it. Free Drive and Roam only:
// a scored run never asks (its ground is the course's own MATERIALS, held to the web's bits by the 52 run vectors).
// Pure: a function of what's underfoot, how wet it is and how cold. Each matter says
//   - what the tyres get from it (a Material for the engine and the chassis: grip, slide, loose, rolling drag);
//   - what the tyres do to it (soft ground takes a rut of so many centimetres a pass, grass lies down, hard ground takes
//     rubber in a slide, snow packs);
//   - what it throws up (dust, clods, spray, snow, grass, stones) and in what colour;
//   - what it leaves on the car (how fast a wheel and the sills cake, up to how much, and how easily water washes it off).
// Every number is an ESTIMATE with its source in the comment beside it. Foundation's maths is fine: nothing is scored.
import Foundation
import ColdGasCore
import ColdGasWorld

/// The drive's ground beyond the courses' MATERIALS (ColdGasCore's are the web's, shared with the scored sim: untouched).
/// Grip is relative to dry asphalt (DriveSpec's μ 1.30 / 1.38 × grip). ESTIMATE, from road-friction tables (PIARC; the
/// usual skid-test ranges): wet asphalt 0.5–0.8 of dry, packed snow 0.2–0.35, mud 0.3–0.45, glare ice 0.05–0.15.
public enum MatterMaterials {
    public static let wetAsphalt = Material(drive: "asphalt-wet", grip: 0.72, slide: 0.45, bounce: 0.1, loose: false, roll: 0)
    public static let mud = Material(drive: "mud", grip: 0.36, slide: 0.45, bounce: 0.02, loose: true, roll: 0.07)
    public static let snow = Material(drive: "snow", grip: 0.30, slide: 0.30, bounce: 0.03, loose: true, roll: 0.03)
    public static let ice = Material(drive: "ice", grip: 0.10, slide: 0.08, bounce: 0.05, loose: false, roll: 0.002)
    /// A ford or a puddle: the tyre on the bed under a few centimetres of water, its wake a drag (0.06 of the load: ESTIMATE,
    /// a car through 10–20 cm of water is slowed like one in sand).
    public static let shallowWater = Material(drive: "water", grip: 0.55, slide: 0.4, bounce: 0.02, loose: true, roll: 0.06)
}

/// What a wheel throws up off the ground.
public enum Roost: UInt8, Sendable { case none, dust, clods, spray, snow, grass, stones }

public enum GroundMatter: UInt8, CaseIterable, Sendable {
    case concrete, asphalt, gravel, dirt, mud, sand, grass, snow, ice, rock, water

    /// What's underfoot from the world's surface, how wet it is (0…1: the rain's or the water's, WATER's hook) and whether
    /// it's freezing (above the snow line, or a cold biome). Dirt and grass soaked through are mud; water frozen is ice;
    /// a soaked road keeps its matter (its grip is `material(wet:)`'s).
    public static func of(_ s: Surface, wet: Double = 0, freezing: Bool = false) -> GroundMatter {
        let w = wet.isFinite ? min(1, max(0, wet)) : 0
        switch s {
        case .concrete: return .concrete
        case .asphalt: return .asphalt
        case .gravel: return .gravel
        case .dirt: return w > 0.4 ? .mud : .dirt
        case .grass: return w > 0.75 ? .mud : .grass
        case .rock: return .rock
        case .sand: return .sand
        case .snow: return .snow
        case .water: return freezing ? .ice : .water
        }
    }
    /// Above the snow line (the land's own: FreeWorld.surface puts snow on mountains over 900 m).
    public static let snowLine = 900.0

    /// The tyres' ground. Wet roads lose grip in proportion to how wet they are (to wetAsphalt's at soaked).
    public func material(wet: Double = 0) -> Material {
        let w = wet.isFinite ? min(1, max(0, wet)) : 0
        switch self {
        case .concrete: return w > 0.3 ? MatterMaterials.wetAsphalt : MATERIALS.concrete
        case .asphalt: return w > 0.3 ? MatterMaterials.wetAsphalt : MATERIALS.asphalt
        case .gravel: return MATERIALS.gravel
        case .dirt: return MATERIALS.dirt
        case .mud: return MatterMaterials.mud
        case .sand: return MATERIALS.sand
        case .grass: return MATERIALS.grass
        case .snow: return MatterMaterials.snow
        case .ice: return MatterMaterials.ice
        case .rock: return MATERIALS.rock
        case .water: return MatterMaterials.shallowWater
        }
    }

    /// A rut's depth (m) laid by one pass of a loaded wheel, and the deepest it gets (repeated passes deepen it toward this).
    /// ESTIMATE, from terramechanics' sinkage for a 2.4 t car's 0.6 t corners on 245 mm tyres: firm dirt 1–2 cm, sand 3–5 cm,
    /// soft mud 6–12 cm, fresh snow 8–15 cm (compacting), turf 0.5–1 cm (the blades lie down before the soil gives).
    public var rut: (pass: Double, max: Double) {
        switch self {
        case .dirt: return (0.012, 0.05)
        case .mud: return (0.06, 0.14)
        case .sand: return (0.035, 0.08)
        case .snow: return (0.08, 0.16)
        case .grass: return (0.006, 0.025)
        case .gravel: return (0.008, 0.03)
        case .concrete, .asphalt, .ice, .rock, .water: return (0, 0)
        }
    }
    /// The ground takes a trace (a rut, a pressed track) under a wheel.
    public var soft: Bool { rut.pass > 0 }
    /// Grass lies down where a tyre crosses it (and stays down: it's a drive's afternoon, not a season).
    public var flattens: Bool { self == .grass }
    /// Hard ground takes rubber from a sliding or spinning tyre (the soft ones are ploughed, not marked).
    public var rubber: Bool { self == .concrete || self == .asphalt }
    /// What a wheel throws up from it.
    public var roost: Roost {
        switch self {
        case .dirt, .sand: return .dust
        case .mud: return .clods
        case .gravel, .rock: return .stones
        case .grass: return .grass
        case .snow: return .snow
        case .water: return .spray
        case .ice, .concrete, .asphalt: return .none
        }
    }
    /// Its colour as thrown (linear RGB, the stage's blue-hour exposure): the soil under grass, not its green; snow off-white.
    public var color: (Double, Double, Double) {
        switch self {
        case .concrete: return (0.36, 0.35, 0.33)
        case .asphalt: return (0.06, 0.06, 0.065)
        case .gravel: return (0.32, 0.30, 0.26)
        case .dirt: return (0.30, 0.23, 0.16)
        case .mud: return (0.12, 0.085, 0.055)
        case .sand: return (0.42, 0.36, 0.25)
        case .grass: return (0.26, 0.24, 0.18)
        case .snow: return (0.62, 0.65, 0.70)
        case .ice: return (0.50, 0.58, 0.66)
        case .rock: return (0.25, 0.24, 0.23)
        case .water: return (0.60, 0.63, 0.68)
        }
    }
    /// What it leaves on the car: coverage gained per metre a wheel rolls (at no slip; a spinning or sliding tyre throws 1 +
    /// 2·slip times as much), the most it can cake (dust tops out as a film), and how fast water takes it off (per second at
    /// full wetness). ESTIMATE: a car driven 100 m of mud is caked to the sills; a dirt road dusts it over a kilometre.
    public var dirt: (perM: Double, max: Double, wash: Double) {
        switch self {
        case .mud: return (0.012, 1.0, 0.18)
        case .dirt: return (0.0015, 0.55, 0.6)
        case .sand: return (0.002, 0.45, 0.8)
        case .gravel: return (0.0008, 0.35, 0.6)
        case .grass: return (0.0006, 0.3, 0.6)
        case .snow: return (0.006, 0.8, 1.5)   // it packs on, and melts off in water
        case .water: return (0, 0, 0)
        case .concrete, .asphalt, .ice, .rock: return (0, 0, 0)
        }
    }
    /// A texel's material tag in the trace (TraceAtlas.channel A): which colour the rut takes.
    public var tag: UInt8 { rawValue }
}

/// The dirt on the car (0330): how much each part is caked (0…1) and the colour it's caked in. The wheels take it first,
/// the sills behind them from the front wheels' roost, the tail from the rears', the nose a little in reverse; the body
/// above the sills only from heavy mud. Water washes it (the WATER track's wetness, 0…1; a ford is 1), and dust dries
/// and falls off slowly. Deterministic and allocation-free; non-numbers are ignored.
public struct CarDirt: Equatable, Sendable {
    public var wheel: [Double] = [0, 0, 0, 0]
    public var sill = 0.0, nose = 0.0, tail = 0.0, body = 0.0
    /// The caked colour (linear RGB), the running blend of what was laid down.
    public var r = 0.30, g = 0.23, b = 0.16
    /// Packed snow (0…1), a separate white on the same parts: it melts.
    public var snow = 0.0
    public init() {}
    public mutating func reset() { self = CarDirt() }
    /// The most caked part (the renderer's quick "anything to draw" test).
    public var most: Double { max(wheel.max() ?? 0, sill, nose, tail, body, snow) }

    /// One wheel's contribution, per tick or per frame: it rolled `dist` metres on `m` with longitudinal slip `slip`
    /// (|κ|), `forward` true when the car goes forward. The rear wheels (index 2, 3) throw onto the tail, the fronts onto
    /// the sills; any wheel cakes itself.
    public mutating func roll(wheel i: Int, on m: GroundMatter, dist: Double, slip: Double, forward: Bool) {
        guard i >= 0, i < 4, dist.isFinite, dist > 0, slip.isFinite else { return }
        let d = m.dirt
        if d.perM <= 0 { return }
        let k = d.perM * min(dist, 5) * (1 + 2 * min(1, abs(slip)))
        func add(_ v: inout Double, _ s: Double) { v = min(d.max, v + k * s * (1 - v / max(d.max, 1e-6))) }
        if m == .snow {
            snow = min(d.max, snow + k * (i >= 2 ? 0.6 : 0.4))
        } else {
            let before = wheel[i]
            add(&wheel[i], 1)
            add(&sill, i < 2 ? 0.45 : 0.2)
            if forward { if i >= 2 { add(&tail, 0.35) } } else { if i < 2 { add(&nose, 0.3) } }
            if m == .mud { add(&body, 0.06) }
            // The colour: blended toward what's laid, by how much of the wheel's coat is new.
            let gain = max(0, wheel[i] - before), w = min(1, gain / max(1e-6, wheel[i]))
            let c = m.color
            r += (c.0 - r) * w; g += (c.1 - g) * w; b += (c.2 - b) * w
        }
    }
    /// Time passing: water washes (wetness 0…1, how much the car is being rinsed: rain, a ford, spray), and dry dust sheds.
    public mutating func weather(dt: Double, wet: Double, speed: Double) {
        guard dt.isFinite, dt > 0, wet.isFinite, speed.isFinite else { return }
        let w = min(1, max(0, wet)), t = min(dt, 1)
        // A soaked car loses its coat at the material's own rate (mud clings: slow; dust: fast), the wheels first.
        let wash = w * t
        let dust = r + g + b > 0.4   // a pale coat is dust; a dark one is mud
        let rate = dust ? 0.6 : 0.18
        for i in 0..<4 { wheel[i] *= exp(-wash * rate * 1.5) }
        sill *= exp(-wash * rate); nose *= exp(-wash * rate); tail *= exp(-wash * rate); body *= exp(-wash * rate * 0.8)
        // Snow melts in water fast and in the air slowly; dry dust shakes off at speed.
        snow *= exp(-t * (0.01 + 1.5 * w))
        if dust && w == 0 && speed > 15 { let s = exp(-t * 0.004 * (speed - 15)); body *= s; nose *= s }
    }
}
