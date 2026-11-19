// Free Drive's world as a pure function of its seed (docs/NATIVE-FREEDRIVE.md §4): the land, the roads, and the ground
// the car drives on (the land carved to the roads: flat under the shoulders, a 1:4 recoverable apron, then cut and fill
// slopes to the natural ground, as src/sim/roads.js builds a baked road's roadside).
import ColdGasCore
import Foundation

public enum Surface: UInt8, Sendable { case concrete, asphalt, gravel, grass, dirt, rock, sand, snow, water }

public struct GroundPoint: Sendable {
    public var y = 0.0
    public var land = LandPoint()
    /// Distance to the nearest road's centreline (∞ past `RoadSpec.reach`), and what's underfoot by the road.
    public var road = Double.infinity
    public var surface: Surface = .grass
    public var floor = false
    /// The water here (0310, Waters.swift): its surface's level (the sea's `SEA` off the slab, a lake's or a river's where one
    /// is; −∞ on the slab), what it is, and a river's flow direction (unit x, z; 0 elsewhere).
    public var water = -Double.infinity
    public var waterKind: WaterKind = .none
    public var flow = (0.0, 0.0)
    public init() {}
}

public final class FreeWorld: @unchecked Sendable {
    public let seedText: String
    public let seed: UInt32
    public let land: Land
    public let roads: Roads
    /// Lakes and rivers (0310).
    private(set) lazy var waters = Waters(world: self)
    private let watersLock = NSLock()
    public init(seed text: String) {
        seedText = text
        seed = WNoise.seedOf(text)
        land = Land(seed: seed)
        roads = Roads(land: land)
    }
    /// The water bodies, made once (thread-safe: `lazy` alone isn't).
    var w: Waters { watersLock.lock(); defer { watersLock.unlock() }; return waters }

    /// The ground at (x, z). `q` holds the links near the point (Roads.query); `carve` false skips the roadside (the far
    /// tiles, whose vertices are too far apart to see one).
    public func ground(_ x: Double, _ z: Double, _ q: RoadQuery, carve: Bool = true) -> GroundPoint {
        var g = GroundPoint()
        if Site.onFloor(x, z) {
            g.floor = true; g.surface = .concrete
            g.land = land.at(x, z)
            let hit = q.nearest(x, z, maxD: RoadSpec.hw + 0.5)
            if hit.found { g.road = hit.d; g.surface = .asphalt }
            return g
        }
        let lp = land.at(x, z)
        g.land = lp
        let hit = q.nearest(x, z)
        g.road = hit.d
        let s = WNoise.smooth(RoadSpec.valley0, RoadSpec.valley1, hit.d)
        // The natural ground, then the lakes and rivers carved into it (0310).
        let cv = w.carve(x, z, nat: lp.low + (lp.full - lp.low) * s, low: lp.low)
        let nat = cv.y
        g.y = nat
        if cv.water.kind != .none { g.water = cv.water.level; g.waterKind = cv.water.kind; g.flow = cv.water.flow }
        else if !(abs(x) < Site.slab && abs(z) < Site.slab) { g.water = SEA; g.waterKind = .sea }
        guard carve, let l = hit.link else { return g }
        // A river under the road goes through a culvert (0310): its water stays under the road's corridor.
        if g.waterKind == .river && hit.d < RoadSpec.vergeOut + 4 { g.water = SEA; g.waterKind = .sea; g.flow = (0, 0) }
        let p = roads.profile(l)
        let yc = p.y[hit.k] + (p.y[hit.k + 1] - p.y[hit.k]) * hit.u
        let bank = p.bank[hit.k] + (p.bank[hit.k + 1] - p.bank[hit.k]) * hit.u
        let hw = RoadSpec.hw, edge = hw + RoadSpec.shoulder
        if hit.d <= edge {
            g.y = yc + bank * jsMax(-hw, jsMin(hw, hit.lat))
            g.surface = hit.d <= hw ? .asphalt : .gravel
            return g
        }
        let e = hit.d - edge, yEdge = yc + bank * (hit.lat < 0 ? -hw : hw)
        let fill = e < 7 ? e / 4 : 1.75 + (e - 7) / 1.5, cut = e < 7 ? e / 4 : 1.75 + (e - 7)
        g.y = yEdge + jsMax(-fill, jsMin(cut, nat - yEdge))
        return g
    }
    /// One point, with its own query (tests, the camera, a reset).
    public func ground(_ x: Double, _ z: Double) -> GroundPoint {
        ground(x, z, roads.query(minX: x, minZ: z, maxX: x, maxZ: z))
    }

    /// What a tyre meets off the road: by the dominant land and the slope (1 − n.y), as the web's endless world paints it.
    public static func surface(_ g: GroundPoint, slope: Double) -> Surface {
        if g.surface != .grass { return g.surface }
        if g.y < g.water + 0.3 { return g.waterKind == .river ? .gravel : .sand }
        switch g.land.biome {
        case .mountain: return slope > 0.42 ? .rock : g.y > 900 ? .snow : slope > 0.3 ? .gravel : .grass
        case .desert: return slope > 0.26 ? .rock : .sand
        case .forest: return slope > 0.45 ? .dirt : .grass
        case .coast: return slope > 0.41 ? .rock : g.y < SEA + 3 ? .sand : .grass
        }
    }

    /// The nearest road point to (x, z) within `maxD` (a reset, the autopilot): its position, height and heading.
    public func nearestRoad(_ x: Double, _ z: Double, maxD: Double = 1500) -> (x: Double, y: Double, z: Double, dx: Double, dz: Double)? {
        let q = roads.query(minX: x, minZ: z, maxX: x, maxZ: z, margin: maxD)
        let hit = q.nearest(x, z, maxD: maxD)
        guard let l = hit.link else { return nil }
        let p = roads.profile(l), k = hit.k, u = hit.u
        let px = l.x[k] + (l.x[k + 1] - l.x[k]) * u, pz = l.z[k] + (l.z[k + 1] - l.z[k]) * u
        return (px, p.y[k] + (p.y[k + 1] - p.y[k]) * u, pz, l.dx[k], l.dz[k])
    }
}
