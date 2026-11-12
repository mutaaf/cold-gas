// Lattice roads (docs/NATIVE-FREEDRIVE.md §4.2): a road network with no edge and no direction.
//
// The plane is cut into CELL-metre cells, each with one junction jittered inside it by a hash of (seed, cell). Each
// junction joins its east and its north neighbour, unless a hash drops the link, with a Hermite curve whose tangents
// run from the junction's neighbour behind to the one ahead (so a road flows straight through its junctions). The
// web's endless road is generated in order, northward; a link here depends only on its own junctions and their
// neighbours, so any piece of the network is the same whenever and wherever it's asked for.
//
// A link's geometry (plan) is cheap and kept for everything; its profile (height and banking: the low land smoothed
// along it, pinned to its junctions, held to a design grade) is built on demand and kept too.
import Foundation
import ColdGasCore

public enum RoadSpec {
    public static let cell = 1024.0, spacing = 4.0, hw = 3.5, shoulder = 1.2, grade = 0.09
    /// How far a road shapes the land: the relief grows from LOW to full between these distances (m).
    public static let valley0 = 60.0, valley1 = 380.0
    public static let reach = 420.0
}

/// One link's plan: samples every `spacing` metres from its west/south junction to its east/north one.
public final class RoadLink: @unchecked Sendable {
    public let i, j: Int, north: Bool
    public let n: Int
    public let x: [Double], z: [Double]
    /// Unit direction of segment k (k < n − 1), its length, the cumulative distance at sample k.
    public let dx: [Double], dz: [Double], len: [Double], s: [Double]
    public let minX, maxX, minZ, maxZ: Double
    /// Bounding boxes of runs of CHUNK segments (a nearest-road search skips whole runs).
    static let CHUNK = 16
    let cb: [(Double, Double, Double, Double)]
    init(i: Int, j: Int, north: Bool, x: [Double], z: [Double]) {
        self.i = i; self.j = j; self.north = north; self.x = x; self.z = z; n = x.count
        var dx = [Double](repeating: 0, count: n), dz = dx, len = dx, s = dx
        var a = Double.infinity, b = -Double.infinity, c = Double.infinity, d = -Double.infinity
        for k in 0..<n {
            a = jsMin(a, x[k]); b = jsMax(b, x[k]); c = jsMin(c, z[k]); d = jsMax(d, z[k])
            if k < n - 1 {
                let ex = x[k + 1] - x[k], ez = z[k + 1] - z[k], l = jsMax(1e-9, (ex * ex + ez * ez).squareRoot())
                dx[k] = ex / l; dz[k] = ez / l; len[k] = l; s[k + 1] = s[k] + l
            }
        }
        if n > 1 { dx[n - 1] = dx[n - 2]; dz[n - 1] = dz[n - 2] }
        self.dx = dx; self.dz = dz; self.len = len; self.s = s
        minX = a; maxX = b; minZ = c; maxZ = d
        var boxes: [(Double, Double, Double, Double)] = []
        var k = 0
        while k < n - 1 {
            let e = Swift.min(n - 1, k + RoadLink.CHUNK)
            var p = Double.infinity, q = -Double.infinity, r = Double.infinity, t = -Double.infinity
            for m in k...e { p = jsMin(p, x[m]); q = jsMax(q, x[m]); r = jsMin(r, z[m]); t = jsMax(t, z[m]) }
            boxes.append((p, q, r, t))
            k = e
        }
        cb = boxes
    }
    public var length: Double { s[n - 1] }
}

/// A link's profile: the road's centre height and banking (+: the left edge higher) at each sample.
public final class RoadProfile: @unchecked Sendable {
    public let y: [Double], bank: [Double]
    init(y: [Double], bank: [Double]) { self.y = y; self.bank = bank }
}

/// The nearest road to a point.
public struct RoadHit: Sendable {
    public var d = Double.infinity
    /// Lateral offset from the centreline (+ left of the link's direction), the sample and the fraction along segment k.
    public var lat = 0.0, k = 0, u = 0.0
    public var link: RoadLink?
    public var found: Bool { link != nil }
    public init() {}
}

public final class Roads: @unchecked Sendable {
    public let seed: UInt32
    public let land: Land
    private let lock = NSLock()
    private var links: [Int64: RoadLink] = [:]
    private var absent = Set<Int64>()
    private var profiles: [ObjectIdentifier: RoadProfile] = [:]
    public init(land: Land) { self.land = land; seed = land.seed }

    // --- Junctions ------------------------------------------------------------------------------------------
    @inline(__always) public func junction(_ i: Int, _ j: Int) -> (x: Double, z: Double) {
        let C = RoadSpec.cell
        return ((Double(i) + 0.25 + 0.5 * WNoise.hash2(seed ^ 0x7a11, i, j)) * C, (Double(j) + 0.25 + 0.5 * WNoise.hash2(seed ^ 0x7a12, i, j)) * C)
    }
    /// The road's height at a junction: the low land there, averaged over 200 m round it (the same for every link that meets it).
    public func junctionY(_ i: Int, _ j: Int) -> Double {
        let p = junction(i, j)
        if Site.onFloor(p.x, p.z) { return 0 }
        var s = land.low(p.x, p.z)
        for (ox, oz) in [(80.0, 0.0), (-80.0, 0.0), (0.0, 80.0), (0.0, -80.0), (200.0, 0.0), (-200.0, 0.0), (0.0, 200.0), (0.0, -200.0)] { s += land.low(p.x + ox, p.z + oz) }
        return jsMax(SEA + 3, s / 9)
    }
    /// Whether junction (i, j) has its east (or north) link.
    @inline(__always) public func hasLink(_ i: Int, _ j: Int, north: Bool) -> Bool {
        north ? WNoise.hash2(seed ^ 0x41, i, j) >= 0.18 : WNoise.hash2(seed ^ 0xe1, i, j) >= 0.12
    }
    @inline(__always) static func key(_ i: Int, _ j: Int, _ north: Bool) -> Int64 {
        (Int64(Int32(truncatingIfNeeded: i)) << 33) ^ (Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j))) << 1) ^ (north ? 1 : 0)
    }

    // --- Links -----------------------------------------------------------------------------------------------
    /// Junction (i, j)'s east or north link, or nil where the network drops it.
    public func link(_ i: Int, _ j: Int, north: Bool) -> RoadLink? {
        let k = Roads.key(i, j, north)
        lock.lock()
        if let l = links[k] { lock.unlock(); return l }
        if absent.contains(k) { lock.unlock(); return nil }
        lock.unlock()
        guard hasLink(i, j, north: north) else { lock.lock(); absent.insert(k); lock.unlock(); return nil }
        let l = buildLink(i, j, north: north)
        lock.lock()
        if let had = links[k] { lock.unlock(); return had }
        links[k] = l
        lock.unlock()
        return l
    }
    private func buildLink(_ i: Int, _ j: Int, north: Bool) -> RoadLink {
        let (bi, bj) = north ? (i, j + 1) : (i + 1, j)
        let A = junction(i, j), B = junction(bi, bj)
        let P = north ? junction(i, j - 1) : junction(i - 1, j), Q = north ? junction(i, j + 2) : junction(i + 2, j)
        func unit(_ a: (x: Double, z: Double), _ b: (x: Double, z: Double)) -> (Double, Double) {
            let ex = b.x - a.x, ez = b.z - a.z, l = jsMax(1e-9, (ex * ex + ez * ez).squareRoot()); return (ex / l, ez / l)
        }
        let L = ((B.x - A.x) * (B.x - A.x) + (B.z - A.z) * (B.z - A.z)).squareRoot() * 0.9
        let ta = unit(P, B), tb = unit(A, Q)
        // Dense Hermite samples, then resampled every `spacing` metres along the arc.
        let M = 256
        var hx = [Double](repeating: 0, count: M + 1), hz = hx, hs = hx
        for m in 0...M {
            let t = Double(m) / Double(M), t2 = t * t, t3 = t2 * t
            let h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2
            hx[m] = h00 * A.x + h10 * L * ta.0 + h01 * B.x + h11 * L * tb.0
            hz[m] = h00 * A.z + h10 * L * ta.1 + h01 * B.z + h11 * L * tb.1
            if m > 0 { let ex = hx[m] - hx[m - 1], ez = hz[m] - hz[m - 1]; hs[m] = hs[m - 1] + (ex * ex + ez * ez).squareRoot() }
        }
        let total = hs[M]
        let n = Swift.max(2, Int((total / RoadSpec.spacing).rounded(.up)) + 1)
        var xs = [Double](repeating: 0, count: n), zs = xs
        var m = 0
        for k in 0..<n {
            let want = total * Double(k) / Double(n - 1)
            while m < M - 1 && hs[m + 1] < want { m += 1 }
            let seg = jsMax(1e-9, hs[m + 1] - hs[m]), f = jsMin(1, jsMax(0, (want - hs[m]) / seg))
            xs[k] = hx[m] + (hx[m + 1] - hx[m]) * f; zs[k] = hz[m] + (hz[m + 1] - hz[m]) * f
        }
        xs[0] = A.x; zs[0] = A.z; xs[n - 1] = B.x; zs[n - 1] = B.z
        return RoadLink(i: i, j: j, north: north, x: xs, z: zs)
    }

    /// A link's height and banking (built once, kept).
    public func profile(_ l: RoadLink) -> RoadProfile {
        let id = ObjectIdentifier(l)
        lock.lock()
        if let p = profiles[id] { lock.unlock(); return p }
        lock.unlock()
        let p = buildProfile(l)
        lock.lock()
        if let had = profiles[id] { lock.unlock(); return had }
        profiles[id] = p
        lock.unlock()
        return p
    }
    private func buildProfile(_ l: RoadLink) -> RoadProfile {
        let n = l.n, ds = l.length / Double(n - 1)
        var raw = [Double](repeating: 0, count: n)
        for k in 0..<n { raw[k] = Site.onFloor(l.x[k], l.z[k]) ? 0 : land.low(l.x[k], l.z[k]) }
        func average(_ a: [Double], _ r: Int) -> [Double] {
            var out = a, acc = 0.0, cnt = 0
            // A running window, clamped at the ends.
            var lo = 0, hi = -1
            for k in 0..<n {
                let want0 = Swift.max(0, k - r), want1 = Swift.min(n - 1, k + r)
                while hi < want1 { hi += 1; acc += a[hi]; cnt += 1 }
                while lo < want0 { acc -= a[lo]; lo += 1; cnt -= 1 }
                out[k] = acc / Double(cnt)
            }
            return out
        }
        var y = average(raw, 20)
        let ya = junctionY(l.i, l.j), yb = l.north ? junctionY(l.i, l.j + 1) : junctionY(l.i + 1, l.j)
        let c0 = ya - y[0], c1 = yb - y[n - 1]
        for k in 0..<n {
            let u = Double(k) / Double(n - 1)
            y[k] += c0 * (1 - u) + c1 * u
            if !Site.onFloor(l.x[k], l.z[k]) { y[k] = jsMax(SEA + 3, y[k]) }
        }
        // The design grade, both ways, the ends held; steeper only where the junctions ask for more (a pass).
        let g = jsMax(RoadSpec.grade, abs(yb - ya) / l.length + 0.01) * ds
        y[0] = ya
        for k in 1..<n { y[k] = jsMin(y[k - 1] + g, jsMax(y[k - 1] - g, y[k])) }
        y[n - 1] = yb
        var k = n - 2
        while k >= 0 { y[k] = jsMin(y[k + 1] + g, jsMax(y[k + 1] - g, y[k])); k -= 1 }
        // Vertical curves: a short average (keeps the grade), the ends pinned again.
        y = average(y, 6)
        let e0 = ya - y[0], e1 = yb - y[n - 1]
        for k in 0..<n { let u = Double(k) / Double(n - 1); y[k] += e0 * (1 - u) + e1 * u }
        for k in 0..<n where Site.onFloor(l.x[k], l.z[k]) { y[k] = 0 }
        // Banking into the curves (src/sim/endless.js: −k·9, at most 6 %), eased.
        var bank = [Double](repeating: 0, count: n)
        for k in 1..<(n - 1) {
            let a0 = DMath.datan2(l.dx[k - 1], l.dz[k - 1]), a1 = DMath.datan2(l.dx[k], l.dz[k])
            var da = a1 - a0
            if da > DMath.PI { da -= 2 * DMath.PI } else if da < -DMath.PI { da += 2 * DMath.PI }
            bank[k] = jsMax(-0.06, jsMin(0.06, -(da / ds) * 9))
        }
        bank = average(bank, 4)
        return RoadProfile(y: y, bank: bank)
    }

    // --- Queries ---------------------------------------------------------------------------------------------
    /// Every link whose plan comes within `margin` of the box.
    public func links(minX: Double, minZ: Double, maxX: Double, maxZ: Double, margin: Double) -> [RoadLink] {
        let C = RoadSpec.cell
        let i0 = Int(((minX - margin) / C).rounded(.down)) - 2, i1 = Int(((maxX + margin) / C).rounded(.down)) + 1
        let j0 = Int(((minZ - margin) / C).rounded(.down)) - 2, j1 = Int(((maxZ + margin) / C).rounded(.down)) + 1
        var out: [RoadLink] = []
        for j in j0...j1 { for i in i0...i1 { for north in [false, true] {
            guard let l = link(i, j, north: north) else { continue }
            if l.maxX < minX - margin || l.minX > maxX + margin || l.maxZ < minZ - margin || l.minZ > maxZ + margin { continue }
            out.append(l)
        } } }
        return out
    }
    /// A region's links, for many nearest-road questions in it.
    public func query(minX: Double, minZ: Double, maxX: Double, maxZ: Double, margin: Double = RoadSpec.reach, stride: Int = 1) -> RoadQuery {
        RoadQuery(links(minX: minX, minZ: minZ, maxX: maxX, maxZ: maxZ, margin: margin), stride: stride)
    }
}

/// Nearest-road questions over a fixed set of links.
public struct RoadQuery: Sendable {
    public let links: [RoadLink]
    /// Look at every `stride`-th segment (a coarse tile's vertices are tens of metres apart).
    public let stride: Int
    public init(_ links: [RoadLink], stride: Int = 1) { self.links = links; self.stride = Swift.max(1, stride) }

    public func nearest(_ x: Double, _ z: Double, maxD: Double = RoadSpec.reach) -> RoadHit {
        var hit = RoadHit()
        var best = maxD * maxD
        for l in links {
            let bx = jsMax(0, jsMax(l.minX - x, x - l.maxX)), bz = jsMax(0, jsMax(l.minZ - z, z - l.maxZ))
            if bx * bx + bz * bz > best { continue }
            var c = 0, k0 = 0
            while c < l.cb.count {
                let b = l.cb[c]
                let k1 = Swift.min(l.n - 1, k0 + RoadLink.CHUNK)
                let ex = jsMax(0, jsMax(b.0 - x, x - b.1)), ez = jsMax(0, jsMax(b.2 - z, z - b.3))
                if ex * ex + ez * ez <= best {
                    var k = k0
                    while k < k1 {
                        let k2 = Swift.min(k1, k + stride)
                        // Segment k → k2 (one segment unless strided).
                        let sx = l.x[k], sz = l.z[k], vx = l.x[k2] - sx, vz = l.z[k2] - sz
                        let vv = vx * vx + vz * vz
                        let u = vv > 0 ? jsMax(0, jsMin(1, ((x - sx) * vx + (z - sz) * vz) / vv)) : 0
                        let px = sx + vx * u - x, pz = sz + vz * u - z, d2 = px * px + pz * pz
                        if d2 < best {
                            best = d2
                            let L = vv.squareRoot()
                            let tx = L > 0 ? vx / L : l.dx[k], tz = L > 0 ? vz / L : l.dz[k]
                            hit.d = d2.squareRoot(); hit.link = l
                            hit.lat = (x - sx) * tz - (z - sz) * tx   // + left of (tx, tz)
                            // As a position on the 4 m samples: sample k + u × (k2 − k).
                            let f = u * Double(k2 - k)
                            let kk = Swift.min(l.n - 2, k + Int(f.rounded(.down)))
                            hit.k = kk; hit.u = jsMin(1, f - Double(kk - k))
                        }
                        k = k2
                    }
                }
                k0 = k1; c += 1
            }
        }
        return hit
    }
}
