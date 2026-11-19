// Lakes and rivers (0310, for 0320's water; docs/NATIVE-FREEDRIVE.md §9.2): the land's own water bodies beside the sea, carved
// into the ground and given a surface, all a pure function of the seed. FreeWorld.ground carves them; FreeWorld.water reports
// them; the tiles, the props, the grip and the water's surface all read the same numbers.
//
//   lakes   at most one per 2,048 m cell, by a hash: a basin of radius 90–260 m, its shore wobbled by noise, sited where the
//           roads leave room (its rim ≥ 140 m from any road, so no road is ever flooded) and never on the Show's floor or its
//           rise. Its level is the lowest natural ground round its rim less a metre, so the rim always holds the water; the bed
//           is a bowl 3–9 m deep under that level. Cached per cell (a lake costs ≈ 30 ground samples once).
//   rivers  where a low-frequency noise field crosses zero: meandering channels that run on across cells and loop like a
//           drainage net, 5–12 m wide, tapering out on steep ground (the mountains have streams, not rivers) and in the
//           desert. Their surface follows the land's smooth lower field (`low`, never above the banks) a metre under it, the
//           bed a parabola up to 2.4 m deep, the banks easing back to the land over twice the width. A road over a river
//           keeps its own grade (a culvert: the water goes under).
import ColdGasCore
import Foundation

public enum WaterKind: UInt8, Sendable { case none, sea, lake, river }

public enum WaterSpec0310 {
    public static let lakeCell = 2048.0
    /// Lakes a cell (a hash under this) and their radius range (m).
    public static let lakeChance = 0.45, lakeR0 = 90.0, lakeR1 = 260.0
    /// A lake's rim keeps this far from any road (m).
    public static let lakeRoadClear = 140.0
    /// Rivers: the field's wavelength (m), widths (m), the deepest bed (m).
    public static let riverWL = 2600.0, riverW0 = 5.0, riverW1 = 12.0, riverDepth = 2.4
}

/// One lake: centre, radius, level (m), depth at the centre, the shore's wobble seed.
public struct Lake: Sendable { public let x, z, r, level, depth: Double; public let salt: UInt32 }

/// What a point's water is, before the ground is carved (from the natural ground `nat`).
struct WaterHere { var kind: WaterKind = .none; var level = -Double.infinity; var bed = Double.infinity; var flow = (0.0, 0.0) }

final class Waters: @unchecked Sendable {
    let seed: UInt32
    unowned let world: FreeWorld
    private var lakes: [Int64: Lake?] = [:]
    private let lock = NSLock()
    init(world: FreeWorld) { self.world = world; seed = world.seed ^ 0x1a4e5 }

    // MARK: - Lakes

    /// The lake of 2,048 m cell (i, j), if it has one (cached).
    func lake(_ i: Int, _ j: Int) -> Lake? {
        let key = (Int64(Int32(truncatingIfNeeded: i)) << 32) | Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j)))
        lock.lock()
        if let l = lakes[key] { lock.unlock(); return l }
        lock.unlock()
        let l = makeLake(i, j)
        lock.lock(); if lakes.count > 4096 { lakes.removeAll(keepingCapacity: true) }; lakes[key] = l; lock.unlock()   // (bounded: a lake is rebuilt the same)
        return l
    }
    private func makeLake(_ i: Int, _ j: Int) -> Lake? {
        let C = WaterSpec0310.lakeCell, s = seed
        guard WNoise.hash2(s, i, j) < WaterSpec0310.lakeChance else { return nil }
        let r = WaterSpec0310.lakeR0 + (WaterSpec0310.lakeR1 - WaterSpec0310.lakeR0) * WNoise.hash2(s ^ 0x77, i, j)
        // The best of four spots in the cell: the farthest from a road.
        var best: (Double, Double, Double)?
        for k in 0..<4 {
            let x = (Double(i) + 0.2 + 0.6 * WNoise.hash2(s ^ 0x31, i * 4 + k, j)) * C
            let z = (Double(j) + 0.2 + 0.6 * WNoise.hash2(s ^ 0x53, i, j * 4 + k)) * C
            if Site.ramp(x, z) < 0.999 { continue }   // never on the floor or its rise
            let reach = r + WaterSpec0310.lakeRoadClear + 40
            let d = world.roads.query(minX: x - reach, minZ: z - reach, maxX: x + reach, maxZ: z + reach, margin: 0).nearest(x, z, maxD: reach).d
            if best == nil || d > best!.2 { best = (x, z, d) }
        }
        guard let (cx, cz, dRoad) = best else { return nil }
        let rr = jsMin(r, dRoad - WaterSpec0310.lakeRoadClear - r * 0.3)   // (the wobble reaches ≈ 1.3 r)
        guard rr >= WaterSpec0310.lakeR0 * 0.7 else { return nil }
        let w = world.land.weights(cx, cz)
        if w.2 > 0.6 { return nil }   // the desert has no lakes
        // The level: the lowest natural ground round the rim (16 spokes from 1.0 to 2.2 r: the wobbled shore and its beach lie between), less a metre.
        var lo = Double.infinity
        for k in 0..<16 { for f in [1.0, 1.3, 1.6, 2.0, 2.2] {
            let a = Double(k) * Double.pi / 8, x = cx + cos(a) * rr * f, z = cz + sin(a) * rr * f
            lo = jsMin(lo, world.natural(x, z))
        } }
        let level = lo - 1.0
        guard level > SEA + 1 else { return nil }   // (down by the sea it would only be the sea)
        let depth = 3 + 6 * WNoise.hash2(s ^ 0x99, i, j)
        return Lake(x: cx, z: cz, r: rr, level: level, depth: depth, salt: UInt32(truncatingIfNeeded: i &* 73 &+ j &* 179) ^ s)
    }
    /// The lake round (x, z) and the point's distance to its centre over its (wobbled) radius, if within 1.6 radii.
    @inline(__always) func lakeAt(_ x: Double, _ z: Double) -> (Lake, Double)? {
        let C = WaterSpec0310.lakeCell
        let ci = Int((x / C).rounded(.down)), cj = Int((z / C).rounded(.down))
        // A lake lies inside its own cell (its spot is 0.2–0.8 across, its radius ≤ 260 m); check the cell and the nearest neighbours.
        for dj in -1...1 { for di in -1...1 {
            guard let l = lake(ci + di, cj + dj) else { continue }
            let dx = x - l.x, dz = z - l.z, d2 = dx * dx + dz * dz
            if d2 > (l.r * 1.9) * (l.r * 1.9) { continue }
            let a = atan2(dz, dx)
            let wob = 1 + 0.22 * WNoise.vnoise(l.salt, cos(a) * 1.7 + 11, sin(a) * 1.7 + 5) + 0.08 * WNoise.vnoise(l.salt ^ 9, cos(a) * 4 + 3, sin(a) * 4)
            return (l, d2.squareRoot() / (l.r * wob))
        } }
        return nil
    }

    // MARK: - Rivers

    /// The river field and its gradient: a channel where it crosses zero, its distance ≈ |f| / |∇f|.
    @inline(__always) func river(_ x: Double, _ z: Double) -> (d: Double, w: Double, flow: (Double, Double))? {
        let s = seed ^ 0x51ee, L = WaterSpec0310.riverWL
        if Site.ramp(x, z) < 0.6 { return nil }
        let f = WNoise.fbm(s, x, z, L, 2)
        if abs(f) > 0.06 { return nil }   // (well away from any channel: the common case, one fbm)
        let e = 6.0
        let fx = (WNoise.fbm(s, x + e, z, L, 2) - f) / e, fz = (WNoise.fbm(s, x, z + e, L, 2) - f) / e
        let g = (fx * fx + fz * fz).squareRoot()
        guard g > 1e-7 else { return nil }
        let d = abs(f) / g
        // Width: wide in the lowland, tapering to nothing on steep ground and in the desert.
        let lw = world.land.weights(x, z)
        let wv = WaterSpec0310.riverW0 + (WaterSpec0310.riverW1 - WaterSpec0310.riverW0) * (0.5 + 0.5 * WNoise.fbm(s ^ 0x3, x, z, 900, 1))
        let taper = (1 - WNoise.smooth(0.25, 0.6, lw.2)) * (1 - 0.7 * WNoise.smooth(0.4, 0.9, lw.0))
        let w = wv * taper
        guard w > 1.5, d < w * 3 else { return nil }
        // Along the channel (perpendicular to the gradient), pointing downhill on the low land.
        var flow = (-fz / g, fx / g)
        let ahead = world.land.at(x + flow.0 * 30, z + flow.1 * 30).low, behind = world.land.at(x - flow.0 * 30, z - flow.1 * 30).low
        if ahead > behind { flow = (-flow.0, -flow.1) }
        return (d, w, flow)
    }

    // MARK: - The water at a point, from the natural ground

    /// Lakes and rivers carve `nat` (the natural ground before any road); returns the carved ground and the water.
    func carve(_ x: Double, _ z: Double, nat: Double, low: Double) -> (y: Double, water: WaterHere) {
        var y = nat
        var wh = WaterHere()
        if let (l, t) = lakeAt(x, z) {
            if t < 1 {
                // The bowl, under the level; at the shore it meets the level.
                let bed = l.level - l.depth * (1 - t * t)
                y = jsMin(nat, bed)   // the bed (the land above the level cut away)
                wh = WaterHere(kind: .lake, level: l.level, bed: y, flow: (0, 0))
            } else if t < 1.6 {
                // The shore: a beach rising from the level, easing into the land.
                let k = WNoise.smooth(1, 1.6, t)
                let shore = l.level + (t - 1) * l.r * 0.06
                y = jsMin(nat, shore + (nat - shore) * k)
                y = jsMax(y, jsMin(nat, l.level + 0.05))
                wh = WaterHere(kind: .lake, level: l.level, bed: y, flow: (0, 0))
            }
        }
        if let r = river(x, z) {
            let level = jsMax(SEA, jsMin(nat, low) - 1.0)
            let u = r.d / r.w
            var cy = y
            if u < 1 {
                cy = jsMin(y, level - WaterSpec0310.riverDepth * (1 - u * u) * jsMin(1, r.w / 8))
            } else {
                let k = WNoise.smooth(1, 3, u)
                cy = jsMin(y, (level + 0.15) + (y - (level + 0.15)) * k)
            }
            if cy < y || u < 1 {
                y = cy
                if wh.kind == .none || level > wh.level { wh = WaterHere(kind: .river, level: level, bed: y, flow: r.flow) }
            }
        }
        return (y, wh)
    }
}

extension FreeWorld {
    /// The natural ground at (x, z) with no lake, river or road (a lake's level is found from it).
    func natural(_ x: Double, _ z: Double) -> Double {
        let lp = land.at(x, z)
        let q = roads.query(minX: x, minZ: z, maxX: x, maxZ: z)
        let s = WNoise.smooth(RoadSpec.valley0, RoadSpec.valley1, q.nearest(x, z).d)
        return lp.low + (lp.full - lp.low) * s
    }
    /// The lakes of the 2,048 m cells round (x, z) within `r` metres (the app's map, tests).
    public func lakes(nearX x: Double, z: Double, r: Double) -> [Lake] {
        let C = WaterSpec0310.lakeCell
        var out: [Lake] = []
        for j in Int(((z - r) / C).rounded(.down))...Int(((z + r) / C).rounded(.down)) {
            for i in Int(((x - r) / C).rounded(.down))...Int(((x + r) / C).rounded(.down)) { if let l = waters.lake(i, j) { out.append(l) } }
        }
        return out
    }
}
