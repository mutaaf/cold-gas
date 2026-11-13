// What the app draws and the physics streams, built from the world (docs/NATIVE-FREEDRIVE.md §4.3, §4.4): terrain tiles
// for the CDLOD quadtree, road ribbons, the prop scatter. All pure: the same key gives the same arrays on any thread, in
// any order, on any device. Positions are relative to each piece's own corner (the floating origin's other half: the
// app adds `corner − origin` as a Float).
import ColdGasCore

// MARK: - Terrain tiles

public struct TileKey: Hashable, Sendable, CustomStringConvertible {
    public let level: Int, ix: Int, iz: Int
    public init(_ level: Int, _ ix: Int, _ iz: Int) { self.level = level; self.ix = ix; self.iz = iz }
    public var size: Double { TileSpec.leaf * Double(1 << level) }
    public var x0: Double { Double(ix) * size }
    public var z0: Double { Double(iz) * size }
    public var description: String { "L\(level)(\(ix),\(iz))" }
    public func child(_ k: Int) -> TileKey { TileKey(level - 1, ix * 2 + (k & 1), iz * 2 + (k >> 1)) }
}
public enum TileSpec {
    /// Cells a side (33 × 33 vertices), the finest tile (m), the levels (0 … levels − 1).
    public static let n = 32, leaf = 128.0, levels = 8
    /// Floats a vertex: position (3), the parent level's height here (1), normal (3), colour (RGBA8 as a float's bits).
    public static let stride = 8
    public static var gridVerts: Int { (n + 1) * (n + 1) }
    public static var verts: Int { gridVerts + 4 * (n + 1) }
    /// Levels up to this one carve the roadside into the land (their vertices are ≤ 64 m apart).
    public static let carveLevels = 4
    /// Levels from this one paint the road into the land's colour (the ribbons are drawn within ≈ 2.6 km, which the
    /// levels under it never reach past: a level-2 tile is drawn out to 2.2 × 1,024 m).
    public static let roadPaintLevel = 3
    /// The shared index list: the grid (each quad split from its (0,0) corner to its (1,1) corner, the split the geomorph
    /// assumes) and a skirt down from each edge.
    public static let indices: [UInt16] = {
        var out: [UInt16] = []
        let N = n, W = n + 1
        for j in 0..<N { for i in 0..<N {
            let a = UInt16(j * W + i), b = UInt16(j * W + i + 1), c = UInt16((j + 1) * W + i), d = UInt16((j + 1) * W + i + 1)
            out += [a, d, b, a, c, d]
        } }
        // Skirts: edge e's vertex k is grid vertex g(e, k); its skirt twin is gridVerts + e·W + k.
        func g(_ e: Int, _ k: Int) -> Int { e == 0 ? k : e == 1 ? N * W + k : e == 2 ? k * W : k * W + N }
        for e in 0..<4 { for k in 0..<N {
            let a = UInt16(g(e, k)), b = UInt16(g(e, k + 1)), sa = UInt16(gridVerts + e * W + k), sb = UInt16(gridVerts + e * W + k + 1)
            out += [a, b, sb, a, sb, sa, a, sb, b, a, sa, sb]   // both windings: a skirt is seen from either side
        } }
        return out
    }()
}

public struct TileData: Sendable {
    public let key: TileKey
    public var vertices: [Float]
    public var minY = 0.0, maxY = 0.0
}

@inline(__always) func pack(_ r: Double, _ g: Double, _ b: Double, _ a: UInt32 = 0) -> Float {
    func c(_ v: Double) -> UInt32 { UInt32(jsMax(0, jsMin(255, (v * 255 + 0.5).rounded(.down)))) }
    return Float(bitPattern: c(r) | (c(g) << 8) | (c(b) << 16) | (a << 24))
}
struct RGB { var r, g, b: Double
    init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }
    func mix(_ o: RGB, _ k: Double) -> RGB { RGB(r + (o.r - r) * k, g + (o.g - g) * k, b + (o.b - b) * k) }
    static func * (a: RGB, k: Double) -> RGB { RGB(a.r * k, a.g * k, a.b * k) }
}
/// Matte land under a blue-hour sky (linear albedos).
enum Palette {
    static let alpine = RGB(0.085, 0.095, 0.06), coastGrass = RGB(0.09, 0.11, 0.065), desert = RGB(0.30, 0.19, 0.12), forest = RGB(0.05, 0.07, 0.04)
    static let rock = RGB(0.15, 0.145, 0.14), scree = RGB(0.2, 0.19, 0.175), sand = RGB(0.34, 0.29, 0.21), snow = RGB(0.72, 0.75, 0.8)
    static let concrete = RGB(0.2, 0.205, 0.215), asphalt = RGB(0.035, 0.036, 0.04), gravel = RGB(0.2, 0.19, 0.17), water = RGB(0.012, 0.022, 0.034)
    static let verge = RGB(0.07, 0.068, 0.055)
}

extension FreeWorld {
    /// The land's colour at a ground point (normal's y `ny`): its biomes, the slope's scree and rock, the snow line, the
    /// shore, the apron's concrete. Shared by the tiles and the roads' verges (0226), so they meet without a seam.
    func landColor(_ g: GroundPoint, _ x: Double, _ z: Double, ny: Double) -> RGB {
        let w = g.land.w
        var c = Palette.alpine * w.0
        c = RGB(c.r + Palette.coastGrass.r * w.1 + Palette.desert.r * w.2 + Palette.forest.r * w.3,
                c.g + Palette.coastGrass.g * w.1 + Palette.desert.g * w.2 + Palette.forest.g * w.3,
                c.b + Palette.coastGrass.b * w.1 + Palette.desert.b * w.2 + Palette.forest.b * w.3)
        let slope = 1 - ny
        c = c.mix(Palette.scree, WNoise.smooth(0.22, 0.34, slope) * (w.0 + w.2 * 0.6))
        c = c.mix(Palette.rock, WNoise.smooth(0.32, 0.5, slope))
        c = c.mix(Palette.snow, w.0 * WNoise.smooth(820, 1000, g.y) * (1 - WNoise.smooth(0.45, 0.65, slope)))
        c = c.mix(Palette.sand, (1 - WNoise.smooth(SEA + 1, SEA + 4, g.y)) * (1 - w.0))
        c = c * (0.85 + 0.3 * (0.5 + 0.5 * WNoise.fbm(seed ^ 0x70e, x, z, 140, 2)))
        let edge = jsMax(abs(x), abs(z))
        if edge < Site.half + 60 { c = Palette.concrete.mix(c, WNoise.smooth(Site.half - 220, Site.half + 60, edge)) }
        return c
    }
    /// The trodden verge beside a shoulder: the land a shade drier and darker, fading over a few metres.
    func vergeTint(_ c: RGB, road: Double) -> RGB {
        c.mix(Palette.verge, 0.55 * (1 - WNoise.smooth(RoadSpec.hw + RoadSpec.shoulder, RoadSpec.hw + RoadSpec.shoulder + 7, road)))
    }

    /// One terrain tile: (n + 1)² grid vertices, then the skirts.
    public func tile(_ key: TileKey) -> TileData {
        let N = TileSpec.n, W = N + 1, S = key.size, step = S / Double(N), x0 = key.x0, z0 = key.z0
        let carve = key.level <= TileSpec.carveLevels, dip = key.level < TileSpec.roadPaintLevel
        let q = roads.query(minX: x0, minZ: z0, maxX: x0 + S, maxZ: z0 + S, margin: RoadSpec.reach, stride: Swift.max(1, Swift.min(16, Int(step / 8))))
        // Heights on a grid one wider all round (for the normals).
        let B = N + 3
        var h = [Double](repeating: 0, count: B * B), rd = [Double](repeating: .infinity, count: B * B)
        var gp = [GroundPoint](repeating: GroundPoint(), count: W * W)
        for j in 0..<B { for i in 0..<B {
            let x = x0 + Double(i - 1) * step, z = z0 + Double(j - 1) * step
            let g = ground(x, z, q, carve: carve)
            h[j * B + i] = g.y; rd[j * B + i] = g.road
            if i >= 1 && i <= W && j >= 1 && j <= W { gp[(j - 1) * W + (i - 1)] = g }
        } }
        @inline(__always) func H(_ i: Int, _ j: Int) -> Double { h[(j + 1) * B + (i + 1)] }
        // What's drawn: the sea flat at its level; under the stage's slab, a little under it (the slab is the ground there).
        @inline(__always) func drawnY(_ i: Int, _ j: Int) -> Double {
            let y = H(i, j)
            let x = x0 + Double(i) * step, z = z0 + Double(j) * step
            if abs(x) < Site.slab && abs(z) < Site.slab { return y - 0.35 }
            // Under a road's ribbon and its verges (the levels the ribbons are drawn over), a few centimetres down: the
            // ribbon, laid on the exact ground every 4 m along the road, is what's seen there, not a 4 m grid's facets.
            if dip { let r = rd[(j + 1) * B + (i + 1)]; if r < RoadSpec.vergeOut { return jsMax(SEA, y - 0.22 * (1 - WNoise.smooth(RoadSpec.vergeOut - 2, RoadSpec.vergeOut, r))) } }
            return jsMax(SEA, y)
        }
        var v = [Float](repeating: 0, count: TileSpec.verts * TileSpec.stride)
        var lo = Double.infinity, hi = -Double.infinity
        for j in 0..<W { for i in 0..<W {
            let y = drawnY(i, j)
            // The parent level's surface here: an odd vertex lies on its parent's edge (or diagonal) between two even ones.
            let oi = i & 1 == 1, oj = j & 1 == 1
            let my: Double
            if oi && oj { my = (drawnY(i - 1, j - 1) + drawnY(i + 1, j + 1)) / 2 }
            else if oi { my = (drawnY(i - 1, j) + drawnY(i + 1, j)) / 2 }
            else if oj { my = (drawnY(i, j - 1) + drawnY(i, j + 1)) / 2 }
            else { my = y }
            let gx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), gz = (H(i, j + 1) - H(i, j - 1)) / (2 * step)
            let nl = (gx * gx + 1 + gz * gz).squareRoot(), nx = -gx / nl, ny = 1 / nl, nz = -gz / nl
            let g = gp[j * W + i]
            let x = x0 + Double(i) * step, z = z0 + Double(j) * step
            // The colour: the land's own, then the road (far off) or the verge (near).
            var c = landColor(g, x, z, ny: ny)
            // A road reads from far away as a dark thread. Close up the ribbons draw it, so the near levels leave it out:
            // painted onto a 4–16 m grid it was a grey sawtooth either side of the ribbon (0226).
            if key.level >= TileSpec.roadPaintLevel {
                c = c.mix(g.road <= RoadSpec.hw ? Palette.asphalt : Palette.gravel, 1 - WNoise.smooth(RoadSpec.hw, RoadSpec.hw + RoadSpec.shoulder + step * 0.6, g.road))
            } else {
                c = vergeTint(c, road: g.road)
            }
            var flag: UInt32 = 0
            if H(i, j) < SEA && !(abs(x) < Site.slab && abs(z) < Site.slab) { c = Palette.water; flag = 1 }
            let o = (j * W + i) * TileSpec.stride
            v[o] = Float(Double(i) * step); v[o + 1] = Float(y); v[o + 2] = Float(Double(j) * step); v[o + 3] = Float(my)
            v[o + 4] = Float(nx); v[o + 5] = Float(ny); v[o + 6] = Float(nz); v[o + 7] = pack(c.r, c.g, c.b, flag)
            lo = jsMin(lo, y); hi = jsMax(hi, y)
        } }
        // Skirts: each edge vertex again, a few steps down.
        let drop = Float(jsMax(2, step * 1.5))
        for e in 0..<4 { for k in 0..<W {
            let gi = e == 0 ? k : e == 1 ? N * W + k : e == 2 ? k * W : k * W + N
            let src = gi * TileSpec.stride, dst = (TileSpec.gridVerts + e * W + k) * TileSpec.stride
            for f in 0..<TileSpec.stride { v[dst + f] = v[src + f] }
            v[dst + 1] -= drop; v[dst + 3] -= drop
        } }
        return TileData(key: key, vertices: v, minY: lo - Double(drop), maxY: hi)
    }
}

// MARK: - Road ribbons

/// A run of a link's ribbon: seven lines along it (the verge's outer edge, the shoulder, the edge, the centre, the edge,
/// the shoulder, the verge). The verges (0226) lie on the exact carved ground, sampled every 4 m along the road, in the
/// land's own colour: the road's cutting is drawn at the road's resolution, not the land grid's.
public struct RoadPiece: Sendable {
    public let ox: Double, oz: Double
    /// Floats a vertex: position (3, relative to (ox, 0, oz)), lateral offset (m, + left), distance along the link (m), normal (3),
    /// colour (RGBA8 as a float's bits: the verge's land colour; unused on the paving).
    public static let stride = 9, across = 7
    public var vertices: [Float]
    public var indices: [UInt32]
    public let minX, maxX, minZ, maxZ: Double
}

extension FreeWorld {
    /// A link's ribbon in pieces of `run` segments, clipped where it crosses the stage's slab.
    public func ribbon(_ l: RoadLink, run: Int = 32) -> [RoadPiece] {
        let p = roads.profile(l)
        let hw = RoadSpec.hw, sh = RoadSpec.shoulder
        let vo = RoadSpec.vergeOut
        let lats = [vo, hw + sh, hw, 0, -hw, -(hw + sh), -vo]
        var out: [RoadPiece] = []
        var k0 = 0
        while k0 < l.n - 1 {
            let k1 = Swift.min(l.n - 1, k0 + run)
            // The samples off the slab (a ribbon ends at the slab's edge).
            var ks: [Int] = []
            for k in k0...k1 where !(abs(l.x[k]) < Site.slab - 2 && abs(l.z[k]) < Site.slab - 2) { ks.append(k) }
            if ks.count >= 2 {
                let ox = l.x[ks[0]], oz = l.z[ks[0]]
                var bx0 = Double.infinity, bx1 = -Double.infinity, bz0 = Double.infinity, bz1 = -Double.infinity
                for k in ks { bx0 = jsMin(bx0, l.x[k]); bx1 = jsMax(bx1, l.x[k]); bz0 = jsMin(bz0, l.z[k]); bz1 = jsMax(bz1, l.z[k]) }
                let q = roads.query(minX: bx0 - vo - 4, minZ: bz0 - vo - 4, maxX: bx1 + vo + 4, maxZ: bz1 + vo + 4)
                var v: [Float] = [], idx: [UInt32] = []
                var a = Double.infinity, b = -Double.infinity, c0 = Double.infinity, d = -Double.infinity
                var row = 0
                var prev = -2
                for k in ks {
                    let lx = l.dz[k], lz = -l.dx[k]   // left of the direction
                    if prev == k - 1 && row > 0 {
                        for m in 0..<(RoadPiece.across - 1) {
                            let A = UInt32((row - 1) * RoadPiece.across + m), Bv = A + 1, C = UInt32(row * RoadPiece.across + m), D = C + 1
                            idx += [A, C, Bv, Bv, C, D]
                        }
                    }
                    for lat in lats {
                        let x = l.x[k] + lx * lat, z = l.z[k] + lz * lat
                        if abs(lat) > hw + sh + 0.01 {
                            // A verge vertex: the carved ground here, its normal from the ground round it, the land's colour.
                            let g = ground(x, z, q), e = 1.0
                            let gx = (ground(x + e, z, q).y - ground(x - e, z, q).y) / (2 * e), gz = (ground(x, z + e, q).y - ground(x, z - e, q).y) / (2 * e)
                            let nl = (gx * gx + 1 + gz * gz).squareRoot()
                            let c = vergeTint(landColor(g, x, z, ny: 1 / nl), road: g.road)
                            v += [Float(x - ox), Float(jsMax(SEA, g.y) + 0.01), Float(z - oz), Float(lat), Float(l.s[k]), Float(-gx / nl), Float(1 / nl), Float(-gz / nl), pack(c.r, c.g, c.b)]
                            a = jsMin(a, x); b = jsMax(b, x); c0 = jsMin(c0, z); d = jsMax(d, z)
                            continue
                        }
                        let inside = abs(lat) <= hw ? lat : (lat > 0 ? hw : -hw)
                        var y = p.y[k] + p.bank[k] * inside + 0.025
                        if abs(lat) > hw { y -= 0.04 }
                        v += [Float(x - ox), Float(y), Float(z - oz), Float(lat), Float(l.s[k]), Float(-p.bank[k] * lx), 1, Float(-p.bank[k] * lz), pack(0, 0, 0)]
                        a = jsMin(a, x); b = jsMax(b, x); c0 = jsMin(c0, z); d = jsMax(d, z)
                    }
                    row += 1; prev = k
                }
                if !idx.isEmpty { out.append(RoadPiece(ox: ox, oz: oz, vertices: v, indices: idx, minX: a, maxX: b, minZ: c0, maxZ: d)) }
            }
            k0 = k1
        }
        return out
    }
}

// MARK: - Props

public enum PropKind: Int, CaseIterable, Sendable {
    case spruce, broadleaf, shrub, rock, post, fence, signpost, guardrail
    /// The kind's name in a prop source (the forge's assets are looked up by it).
    public var id: String { ["tree.spruce", "tree.broadleaf", "shrub", "rock", "post", "fence", "signpost", "guardrail"][rawValue] }
}
public struct PropInstance: Sendable {
    public var kind: PropKind
    /// Relative to the cell's corner (x, 0, z).
    public var x: Float, y: Float, z: Float
    public var yaw: Float, scale: Float, tint: Float
    /// A roadside item that can break (0227): its index among the cell's solids, else −1.
    public var item: Int32 = -1
}
/// What the physics makes solid of a prop: a trunk (a vertical cylinder), a boulder (a ball), or a roadside item that can
/// break (0227: a fence bay, a sign, a guard rail section: a box `half` × 2 turned by `yaw`, standing on y), world
/// coordinates.
public struct PropSolid: Sendable {
    public enum Kind: Sendable { case trunk, boulder, fence, sign, rail }
    public let kind: Kind
    public let x, y, z, r, h: Double
    public var yaw = 0.0, half = (0.0, 0.0, 0.0)
    public init(kind: Kind, x: Double, y: Double, z: Double, r: Double, h: Double) { self.kind = kind; self.x = x; self.y = y; self.z = z; self.r = r; self.h = h }
    public init(kind: Kind, x: Double, y: Double, z: Double, yaw: Double, half: (Double, Double, Double)) {
        self.kind = kind; self.x = x; self.y = y; self.z = z; r = 0; h = half.1 * 2; self.yaw = yaw; self.half = half
    }
    public var breakable: Bool { kind == .fence || kind == .sign || kind == .rail }
}
/// The roadside's sizes (m, the forge's boxes, tools/forge/lib/slots.mjs): half extents across, up, along.
public enum Roadside {
    public static let fence = (0.07, 0.575, 2.0), sign = (0.06, 1.15, 0.45), rail = (0.18, 0.4, 2.0)
    /// How far out from the centreline each stands (m).
    public static let railLat = RoadSpec.hw + RoadSpec.shoulder + 0.35, signLat = RoadSpec.hw + RoadSpec.shoulder + 1.1
    public static let fenceLat = RoadSpec.hw + RoadSpec.shoulder + 5.6
}
public struct PropCell: Sendable {
    public let cx: Int, cz: Int
    public var instances: [PropInstance] = []
    public var solids: [PropSolid] = []
}
public enum PropSpec { public static let cell = 128.0 }

extension FreeWorld {
    /// Everything that stands in prop cell (cx, cz): trees, shrubs and rocks on jittered grids, by biome and slope; posts
    /// along the roads. Nothing on the floor, on a road or its shoulder, or in the sea.
    public func props(_ cx: Int, _ cz: Int) -> PropCell {
        var cell = PropCell(cx: cx, cz: cz)
        let C = PropSpec.cell, x0 = Double(cx) * C, z0 = Double(cz) * C
        if abs(x0 + C / 2) < Site.half - C && abs(z0 + C / 2) < Site.half - C { return cell }   // wholly on the floor
        let q = roads.query(minX: x0, minZ: z0, maxX: x0 + C, maxZ: z0 + C)
        struct Grid { let kind: PropKind; let spacing: Double; let salt: UInt32; let dens: (Double, Double, Double, Double); let clear: Double }
        let grids = [
            Grid(kind: .spruce, spacing: 9, salt: 0x7ee, dens: (0.3, 0.12, 0.012, 0.55), clear: Roadside.fenceLat + 2),
            Grid(kind: .shrub, spacing: 6.5, salt: 0x5b, dens: (0.07, 0.16, 0.1, 0.2), clear: RoadSpec.hw + 3),
            Grid(kind: .rock, spacing: 22, salt: 0x70c, dens: (0.35, 0.12, 0.22, 0.05), clear: Roadside.fenceLat + 1.5),
        ]
        for G in grids {
            let i0 = Int((x0 / G.spacing).rounded(.down)), i1 = Int(((x0 + C) / G.spacing).rounded(.up))
            let j0 = Int((z0 / G.spacing).rounded(.down)), j1 = Int(((z0 + C) / G.spacing).rounded(.up))
            for j in j0...j1 { for i in i0...i1 {
                let s = seed ^ G.salt
                let x = (Double(i) + 0.1 + 0.8 * WNoise.hash2(s, i, j)) * G.spacing, z = (Double(j) + 0.1 + 0.8 * WNoise.hash2(s ^ 0x9e37, i, j)) * G.spacing
                if x < x0 || x >= x0 + C || z < z0 || z >= z0 + C { continue }
                if Site.onFloor(x, z, margin: 30) { continue }
                let w = land.weights(x, z)
                var p = w.0 * G.dens.0 + w.1 * G.dens.1 + w.2 * G.dens.2 + w.3 * G.dens.3
                // Clumps: more where a slow field says so (groves, scree fields).
                p *= 0.35 + 1.3 * WNoise.smooth(-0.3, 0.4, WNoise.fbm(s ^ 0x6a0, x, z, 260, 2))
                let roll = WNoise.hash2(s ^ 0x1e1, i, j)
                if roll >= p { continue }
                let g = ground(x, z, q)
                if g.road < G.clear || g.y < SEA + 0.5 { continue }
                let gx = ground(x + 1.5, z, q).y, gz = ground(x, z + 1.5, q).y
                let sx = (gx - g.y) / 1.5, sz = (gz - g.y) / 1.5, slope = 1 - 1 / (sx * sx + 1 + sz * sz).squareRoot()
                var kind = G.kind
                if kind == .spruce {
                    if slope > 0.4 { continue }
                    if g.y > 1150 { continue }
                    // Spruce in the mountains and the forest's high ground, broadleaf on the coast and the low forest.
                    let spruceK = w.0 + w.3 * WNoise.smooth(40, 140, g.y)
                    if WNoise.hash2(s ^ 0xb1, i, j) > spruceK + 0.15 { kind = .broadleaf }
                } else if kind == .shrub && slope > 0.5 { continue }
                let yaw = Float(WNoise.hash2(s ^ 0xa7, i, j) * 2 * DMath.PI)
                let sc: Double
                switch kind {
                case .spruce: sc = 0.7 + 0.7 * WNoise.hash2(s ^ 0x5c, i, j)
                case .broadleaf: sc = 0.7 + 0.6 * WNoise.hash2(s ^ 0x5c, i, j)
                case .shrub: sc = 0.6 + 0.8 * WNoise.hash2(s ^ 0x5c, i, j)
                case .rock: sc = 0.5 + 1.8 * WNoise.hash2(s ^ 0x5c, i, j) * WNoise.hash2(s ^ 0x5d, i, j) + 0.4 * slope
                case .post, .fence, .signpost, .guardrail: sc = 1
                }
                let tint = Float(0.8 + 0.4 * WNoise.hash2(s ^ 0x71, i, j))
                cell.instances.append(PropInstance(kind: kind, x: Float(x - x0), y: Float(g.y - 0.05), z: Float(z - z0), yaw: yaw, scale: Float(sc), tint: tint))
                switch kind {
                case .spruce, .broadleaf: cell.solids.append(PropSolid(kind: .trunk, x: x, y: g.y, z: z, r: 0.22 * sc, h: 5 * sc))
                case .rock where sc > 0.8: cell.solids.append(PropSolid(kind: .boulder, x: x, y: g.y + 0.35 * sc, z: z, r: 0.95 * sc, h: 0))
                default: break
                }
            } }
        }
        // Delineator posts: every 48 m along each road, both sides, staggered.
        for l in q.links {
            var k = 0
            while k < l.n {
                for side in [1.0, -1.0] {
                    let kk = side > 0 ? k : Swift.min(l.n - 1, k + 6)
                    let lat = side * (RoadSpec.hw + RoadSpec.shoulder + 0.3)
                    let x = l.x[kk] + l.dz[kk] * lat, z = l.z[kk] - l.dx[kk] * lat
                    if x < x0 || x >= x0 + C || z < z0 || z >= z0 + C { continue }
                    if abs(x) < Site.slab && abs(z) < Site.slab { continue }
                    let g = ground(x, z, q)
                    cell.instances.append(PropInstance(kind: .post, x: Float(x - x0), y: Float(g.y), z: Float(z - z0),
                                                       yaw: Float(DMath.datan2(l.dx[kk], l.dz[kk]) + (side > 0 ? 0 : DMath.PI)), scale: 1, tint: 1))
                }
                k += 12
            }
        }
        roadside(&cell, q, x0, z0, C)
        return cell
    }

    /// The roadside (0227), along each road in the cell, one per 4 m sample where it applies:
    ///   guard rails  where the road runs on a fill (the ground 3 m past the shoulder ≥ 0.8 m below the road), and along
    ///                the outside of a bend (≥ 0.045 rad over ±24 m: the world's lattice roads are gentle, that's their sharpest few per cent);
    ///   bend signs   on the outside of the sharpest (≥ 0.06 rad), every 24 m (behind the rail);
    ///   fences       runs of post-and-rail on a third of the 128 m stretches, both sides, anywhere but the desert.
    /// Each is an instance to draw and a solid that breaks (its `item` is its index in `cell.solids`).
    func roadside(_ cell: inout PropCell, _ q: RoadQuery, _ x0: Double, _ z0: Double, _ C: Double) {
        for l in q.links {
            let p = roads.profile(l)
            let salt = seed ^ UInt32(truncatingIfNeeded: (l.i &* 73856093) ^ (l.j &* 19349663) ^ (l.north ? 0x9e37 : 0x51f1))
            let reach = Roadside.fenceLat + 2
            for k in 0..<l.n {
                // Only the samples whose roadside can fall in this cell.
                if l.x[k] < x0 - reach || l.x[k] >= x0 + C + reach || l.z[k] < z0 - reach || l.z[k] >= z0 + C + reach { continue }
                let hx = l.dx[k], hz = l.dz[k], yaw = DMath.datan2(hx, hz)
                func put(_ kind: PropKind, _ sk: PropSolid.Kind, _ side: Double, _ lat: Double, _ half: (Double, Double, Double), _ y: Double? = nil, turn: Double = 0) {
                    let x = l.x[k] + hz * side * lat, z = l.z[k] - hx * side * lat
                    if x < x0 || x >= x0 + C || z < z0 || z >= z0 + C { return }
                    if Site.onFloor(x, z, margin: 10) { return }
                    let g = ground(x, z, q)
                    // Not on a road (another one, at a junction), and not in the sea.
                    if g.road < RoadSpec.hw + RoadSpec.shoulder + 0.2 { return }
                    let gy = y ?? g.y
                    if gy < SEA + 0.3 { return }
                    let item = Int32(cell.solids.count)
                    cell.solids.append(PropSolid(kind: sk, x: x, y: gy, z: z, yaw: yaw + turn, half: half))
                    cell.instances.append(PropInstance(kind: kind, x: Float(x - x0), y: Float(gy), z: Float(z - z0), yaw: Float(yaw + turn), scale: 1, tint: 1, item: item))
                }
                let roadY = p.y[k]
                var railed = [false, false]
                // How the road turns over ±24 m (+ = to the left): its outside is the other side.
                var turn = 0.0
                if k >= 6 && k < l.n - 6 {
                    turn = DMath.datan2(l.dx[k + 6], l.dz[k + 6]) - DMath.datan2(l.dx[k - 6], l.dz[k - 6])
                    while turn > DMath.PI { turn -= 2 * DMath.PI }
                    while turn < -DMath.PI { turn += 2 * DMath.PI }
                }
                let outside = turn > 0 ? -1.0 : 1.0
                for (si, side) in [1.0, -1.0].enumerated() {
                    let ox = l.x[k] + hz * side * (Roadside.railLat + 3), oz = l.z[k] - hx * side * (Roadside.railLat + 3)
                    if roadY - ground(ox, oz, q).y >= 0.8 || (abs(turn) >= 0.045 && side == outside) {
                        // the rail's top 0.8 m over the road's edge (its foot on the shoulder's level)
                        // the forged rail's beam is on its local +x (the forge's −x, turned into the game's frame): toward the road
                        put(.guardrail, .rail, side, Roadside.railLat, Roadside.rail, roadY - 0.02, turn: side > 0 ? DMath.PI : 0)
                        railed[si] = true
                    }
                }
                if k % 6 == 0 && abs(turn) >= 0.06 {   // behind the rail if there is one
                    put(.signpost, .sign, outside, Roadside.signLat, Roadside.sign, turn: outside > 0 ? 0 : DMath.PI)
                }
                // Fences: a third of the 128 m stretches in grass and forest country, on gentle ground.
                let run = k / 32
                if WNoise.hash2(salt, run, 7) < 0.34 {
                    let land = self.land.weights(l.x[k], l.z[k])
                    if land.2 < 0.5 {
                        for (si, side) in [1.0, -1.0].enumerated() where !railed[si] { put(.fence, .fence, side, Roadside.fenceLat, Roadside.fence) }
                    }
                }
            }
        }
    }
}
