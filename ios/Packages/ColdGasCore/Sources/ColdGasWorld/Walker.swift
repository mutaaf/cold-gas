// A point travelling the lattice roads (the cruise, the autopilot's line, a reset's "back on the road"): along a link,
// and at its junction on into the link that carries on most nearly straight.
import ColdGasCore

public final class RoadWalker {
    public let world: FreeWorld
    public private(set) var link: RoadLink
    /// +1 along the link's samples, −1 against them; the distance along the link from its first sample.
    public private(set) var dir: Double
    public private(set) var s: Double
    public private(set) var travelled = 0.0

    public init(world: FreeWorld, link: RoadLink, dir: Double, s: Double) {
        self.world = world; self.link = link; self.dir = dir; self.s = s
    }
    /// On the road nearest (x, z), heading the way most nearly along (hx, hz).
    public convenience init?(world: FreeWorld, nearX x: Double, z: Double, headingX hx: Double, z hz: Double, maxD: Double = 3000) {
        let q = world.roads.query(minX: x, minZ: z, maxX: x, maxZ: z, margin: maxD)
        let hit = q.nearest(x, z, maxD: maxD)
        guard let l = hit.link else { return nil }
        let d = l.dx[hit.k] * hx + l.dz[hit.k] * hz >= 0 ? 1.0 : -1.0
        self.init(world: world, link: l, dir: d, s: l.s[hit.k] + l.len[hit.k] * hit.u)
    }

    /// Where it is: position (the road's centre, or `lane` m to the right of travel), height, heading (unit), grade.
    public func pose(lane: Double = 0) -> (x: Double, y: Double, z: Double, hx: Double, hz: Double) {
        let l = link, p = world.roads.profile(l)
        let sc = jsMax(0, jsMin(l.length, s))
        var k = 0
        // Binary search for the segment holding sc.
        var lo = 0, hi = l.n - 1
        while hi - lo > 1 { let m = (lo + hi) / 2; if l.s[m] <= sc { lo = m } else { hi = m } }
        k = lo
        let u = l.len[k] > 0 ? (sc - l.s[k]) / l.len[k] : 0
        let x = l.x[k] + (l.x[k + 1] - l.x[k]) * u, z = l.z[k] + (l.z[k + 1] - l.z[k]) * u
        let hx = l.dx[k] * dir, hz = l.dz[k] * dir
        // Right of travel = −left; left of (hx, hz) is (hz, −hx).
        let rx = -hz, rz = hx
        let y = p.y[k] + (p.y[k + 1] - p.y[k]) * u + (p.bank[k] + (p.bank[k + 1] - p.bank[k]) * u) * (-lane * dir)
        return (x + rx * lane, y, z + rz * lane, hx, hz)
    }

    /// Move `ds` metres on (and through junctions).
    public func advance(_ ds: Double) {
        var left = ds
        travelled += ds
        while left > 0 {
            let room = dir > 0 ? link.length - s : s
            if left <= room { s += dir * left; return }
            left -= room
            turn()
        }
    }
    /// At the end of the link: the junction there, and the link out of it that carries on most nearly straight.
    private func turn() {
        let l = link, end = dir > 0
        let (i, j) = end ? (l.north ? (l.i, l.j + 1) : (l.i + 1, l.j)) : (l.i, l.j)
        let k = end ? l.n - 2 : 0
        let hx = l.dx[k] * dir, hz = l.dz[k] * dir
        var best: (RoadLink, Double)? = nil, bestDot = -2.0
        let R = world.roads
        let options: [(RoadLink?, Double)] = [(R.link(i, j, north: false), 1), (R.link(i - 1, j, north: false), -1), (R.link(i, j, north: true), 1), (R.link(i, j - 1, north: true), -1)]
        for (c, d) in options {
            guard let c, c !== l || d != dir * -1 else { continue }
            if c === l { continue }
            let kk = d > 0 ? 0 : c.n - 2
            let dot = c.dx[kk] * d * hx + c.dz[kk] * d * hz
            if dot > bestDot { bestDot = dot; best = (c, d) }
        }
        if let (c, d) = best { link = c; dir = d; s = d > 0 ? 0 : c.length }
        else { dir = -dir; s = end ? l.length : 0 }   // a dead end: back the way it came
    }
}
