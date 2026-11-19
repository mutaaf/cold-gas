// Asking the land (0310, docs/NATIVE-FREEDRIVE.md §9.2): one call for everything a point is, for the tracks that share the
// world. The physics' grip and the effects (MATTER), the water's surface and buoyancy (WATER) and the land's own look
// (LANDSCAPE) all read the same numbers: the carved ground, its normal and slope, what a tyre meets, the biome, the road,
// how wet and how snowy it is, and the water over it. Pure: a function of the seed and (x, z), on any thread.
import ColdGasCore

/// A water body's surface at a point and how deep it is over the ground there.
public struct WaterSample: Sendable {
    /// The surface's height (m): the sea's (`SEA`), a lake's or a river's; −∞ where no water body reaches (the Show's slab).
    public var level: Double
    /// What it is (0310: sea, lake, river), and a river's flow (unit x, z, downstream; 0 on still water).
    public var kind: WaterKind = .none
    public var flow = (0.0, 0.0)
    /// `level − ground` (m): > 0 under water.
    public var depth: Double
    public var wet: Bool { depth > 0 }
    public init(level: Double, depth: Double) { self.level = level; self.depth = depth }
}

/// Everything a point of the land is (§9.2).
public struct LandSample: Sendable {
    /// The carved ground the car drives on (FreeWorld.ground), m.
    public var y = 0.0
    /// The ground's normal, from the ground a metre either side.
    public var normal: (Double, Double, Double) = (0, 1, 0)
    /// 1 − normal.y.
    public var slope = 0.0
    /// What a tyre meets (FreeWorld.surface: the road's paving and gravel, else the land's by biome and slope).
    public var surface: Surface = .grass
    /// The biomes' weights: mountain, coast, desert, forest (sum 1).
    public var biome: (Double, Double, Double, Double) = (0, 0, 0, 1)
    /// To the nearest road's centreline (m; ∞ past RoadSpec.reach).
    public var road = Double.infinity
    /// 0 dry … 1 soaked: the shore's band and the water's edge (LandLook.wetness).
    public var wetness = 0.0
    /// 0 … 1 lying snow: the snow line on the high ground, off the steep rock (LandLook.snow).
    public var snow = 0.0
    /// The water over the ground here.
    public var water = WaterSample(level: -.infinity, depth: -.infinity)
    /// On the Show's concrete floor.
    public var floor = false
    public init() {}
}

/// The land's look as numbers (0310): the same formulae the tiles bake (Build.swift) and the CPU reads (`sample`), so the
/// look, the grip and the spray agree. The shaders add a few metres of noise to the edges on top (World.metal); the
/// physics never sees that.
public enum LandLook {
    /// How far above the water a shore stays damp (m).
    public static let shoreBand = 3.0
    /// Lying snow: the mountains' share of the land over the snow line (820 → 1,000 m), off slopes past ≈ 27°.
    @inline(__always) public static func snow(mountain w0: Double, y: Double, slope: Double) -> Double {
        w0 * WNoise.smooth(820, 1000, y) * (1 - WNoise.smooth(0.45, 0.65, slope))
    }
    /// Damp ground: full at the water's edge, gone `shoreBand` metres above it; 1 under water. The snow's lower edge melts
    /// into a wet band too.
    @inline(__always) public static func wetness(y: Double, waterLevel: Double, snow: Double) -> Double {
        if y < waterLevel { return 1 }
        let shore = waterLevel.isFinite ? 1 - WNoise.smooth(waterLevel, waterLevel + shoreBand, y) : 0
        let melt = snow > 0.02 && snow < 0.5 ? 0.5 * (1 - abs(snow - 0.25) / 0.25) : 0
        return jsMax(shore, melt)
    }
}

extension FreeWorld {
    /// The water body at (x, z) over ground at `groundY` (§9.2): the one place water is defined, so the terrain's shore, the
    /// water's surface and the spray agree. Today: the sea at `SEA` wherever the ground falls under it (off the Show's slab).
    public func water(_ x: Double, _ z: Double, groundY: Double) -> WaterSample {
        water(ground(x, z), groundY: groundY)
    }
    /// The same from a ground point already asked for (its level and kind), over ground at `groundY` (its own `y` if nil).
    public func water(_ g: GroundPoint, groundY: Double? = nil) -> WaterSample {
        guard g.water.isFinite else { return WaterSample(level: -.infinity, depth: -.infinity) }
        var s = WaterSample(level: g.water, depth: g.water - (groundY ?? g.y))
        s.kind = g.waterKind; s.flow = g.flow
        return s
    }

    /// Everything the land is at (x, z) (§9.2). About three ground lookups.
    public func sample(_ x: Double, _ z: Double) -> LandSample {
        var s = LandSample()
        let e = 1.0
        let q = roads.query(minX: x - e, minZ: z - e, maxX: x + e, maxZ: z + e)
        let g = ground(x, z, q)
        s.y = g.y; s.floor = g.floor; s.road = g.road; s.biome = g.land.w
        let gx = (ground(x + e, z, q).y - ground(x - e, z, q).y) / (2 * e)
        let gz = (ground(x, z + e, q).y - ground(x, z - e, q).y) / (2 * e)
        let nl = (gx * gx + 1 + gz * gz).squareRoot()
        s.normal = (-gx / nl, 1 / nl, -gz / nl)
        s.slope = 1 - 1 / nl
        s.surface = FreeWorld.surface(g, slope: s.slope)
        s.water = water(g)
        if !g.floor {
            s.snow = g.surface == .grass ? LandLook.snow(mountain: g.land.w.0, y: g.y, slope: s.slope) : 0
            s.wetness = LandLook.wetness(y: g.y, waterLevel: s.water.level, snow: s.snow)
        }
        return s
    }
}
