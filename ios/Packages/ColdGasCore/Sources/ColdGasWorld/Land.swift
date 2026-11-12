// The land of Free Drive (docs/NATIVE-FREEDRIVE.md §4.1): four biomes blended by low-frequency fields that run the same
// way in every direction (the web's endless world lays its land along a north-going valley; this one has no direction),
// the Show's floor flat in the middle, and the relief growing from it over a mile.
//
// Each biome is a base and a relief. The roads (Roads.swift) ride the *low* land, base + LOW_RELIEF × relief, smoothed;
// the land itself is the low land near a road and the full land a few hundred metres from one, so a road runs along
// a valley floor of its own making and the ranges stand either side of it (the web's valley idea, made local).
import ColdGasCore

public enum Biome: Int, CaseIterable, Sendable { case mountain, coast, desert, forest
    public var name: String { ["Mountains", "Coast", "Desert", "Forest"][rawValue] }
}

/// The site: the Show's physics floor (src/sim/world.js: a 1,500 m half-extent concrete cuboid) and the drawn slab (±700 m).
public enum Site {
    public static let half = 1500.0, slab = 700.0, rise = 1600.0
    /// 0 on the floor, rising C¹ to 1 at `rise` metres past its edge (a rounded square).
    @inline(__always) public static func ramp(_ x: Double, _ z: Double) -> Double {
        let dx = jsMax(0, abs(x) - half), dz = jsMax(0, abs(z) - half)
        if dx == 0 && dz == 0 { return 0 }
        let t = jsMin(1, (dx * dx + dz * dz).squareRoot() / rise)
        return t * t * (3 - 2 * t)
    }
    @inline(__always) public static func onFloor(_ x: Double, _ z: Double, margin: Double = 0) -> Bool { abs(x) < half + margin && abs(z) < half + margin }
}

public let SEA = -2.0
let LOW_RELIEF = 0.22

/// The natural land at a point: the low and full heights and the biome weights (mountain, coast, desert, forest).
public struct LandPoint: Sendable {
    public var low = 0.0, full = 0.0
    public var w: (Double, Double, Double, Double) = (0, 0, 0, 1)
    public var ramp = 0.0
    public init() {}
    public var biome: Biome {
        var b = 0, m = w.0
        if w.1 > m { b = 1; m = w.1 }
        if w.2 > m { b = 2; m = w.2 }
        if w.3 > m { b = 3 }
        return Biome(rawValue: b) ?? .forest
    }
}

public final class Land: @unchecked Sendable {
    public let seed: UInt32
    public init(seed: UInt32) { self.seed = seed }

    /// The biome weights at (x, z); they sum to 1.
    @inline(__always) public func weights(_ x: Double, _ z: Double) -> (Double, Double, Double, Double) {
        let s = seed
        let c = WNoise.smooth(0.22, 0.42, WNoise.fbm(s ^ 0xc0a57, x, z, 14000, 2))
        let m = WNoise.smooth(-0.08, 0.22, WNoise.fbm(s ^ 0x3011, x, z, 8000, 2))
        let d = WNoise.smooth(0.04, 0.28, WNoise.fbm(s ^ 0xd35e, x, z, 9000, 2))
        let nc = 1 - c, nm = 1 - m
        return (nc * m, c, nc * nm * d, nc * nm * (1 - d))
    }

    /// One biome's base and relief at (x, z).
    @inline(__always) func biome(_ b: Int, _ x: Double, _ z: Double) -> (base: Double, relief: Double) {
        let s = seed
        switch b {
        case 0:   // mountain ranges (ridged), rolling ground between them
            // Ranges, not needles: the ridged field over a longer wavelength and four octaves (its crest r² at 2.6 km and 980 m
            // stood 5:1 in places, a pillar from 5 km off).
            return (120 + 40 * WNoise.fbm(s ^ 0x1002, x, z, 700, 3), 760 * WNoise.ridged(s ^ 0x1001, x, z, 3400, 4))
        case 1:   // the coast: land near the water, headlands and coves; the sea where the full relief falls under it
            return (6 + 8 * WNoise.fbm(s ^ 0x1003, x, z, 500, 2), 85 * WNoise.fbm(s ^ 0x1008, x, z, 1600, 3) + 30 * (WNoise.ridged(s ^ 0x1010, x, z, 900, 3) - 0.4))
        case 2:   // a high plain with mesas and dunes
            let mesa = WNoise.smooth(0.16, 0.3, WNoise.fbm(s ^ 0x1005, x, z, 1500, 3))
            return (70 + 7 * WNoise.fbm(s ^ 0x1006, x, z, 220, 2), 70 * WNoise.fbm(s ^ 0x1004, x, z, 3000, 3) + 110 * mesa)
        default:  // rolling forest hills
            return (35 + 18 * WNoise.fbm(s ^ 0x1009, x, z, 500, 2), 180 * WNoise.fbm(s ^ 0x1007, x, z, 1800, 4))
        }
    }

    /// The natural land at (x, z), before any road.
    public func at(_ x: Double, _ z: Double) -> LandPoint {
        var p = LandPoint()
        let r = Site.ramp(x, z)
        p.ramp = r
        let w = weights(x, z)
        p.w = w
        if r == 0 { return p }
        var lo = 0.0, hi = 0.0
        for b in 0..<4 {
            let wb = b == 0 ? w.0 : b == 1 ? w.1 : b == 2 ? w.2 : w.3
            if wb <= 1e-4 { continue }
            let h = biome(b, x, z)
            lo += wb * (h.base + LOW_RELIEF * h.relief)
            hi += wb * (h.base + h.relief)
        }
        p.low = r * lo; p.full = r * hi
        return p
    }
    /// The low land only (what the roads ride).
    @inline(__always) public func low(_ x: Double, _ z: Double) -> Double { at(x, z).low }
}
