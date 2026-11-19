// Free Drive's water (0320), pure: where the sea stands, the waves on it, and the maps the app draws it from. A function
// of the seed, a position and a time, so the car the physics floats and the surface the GPU draws are the same sea.
//
//   level     the sea's still surface: SEA (Land.swift) wherever the ground is under it. The land decides the shore; the
//             water only needs one height (a lake would be a second `WaterBody` with its own level: the land has none yet).
//   waves     two cascades of Gerstner waves, each tiling a square exactly (every wave vector a whole number of cycles
//             across it), so a GPU compute pass can bake one period into a texture and the fragment can repeat it. The
//             swell (256 m) carries the big, slow waves the car bobs on; the chop (32 m) the wind's ripples (ESTIMATE: a
//             moderate breeze's sea, ≈ 0.9 m significant height).
//   maps      the ground's height above the sea round a point, on a grid (the app's depth texture: the water's colour,
//             its foam on the shore, the waves calmed in the shallows), and the land's horizon from a point (the
//             app's reflection of the ranges in the sea at blue hour: one row of elevation angles, no second render).
import ColdGasCore
import Foundation

public enum WaterSpec {
    /// The sea's still level (m).
    public static let level = SEA
    /// The cascades' periods (m) and the waves in each.
    public static let swellL = 256.0, chopL = 32.0, perCascade = 8
    /// Gravity (deep-water dispersion ω² = g·k).
    public static let g = 9.81
    /// Waves calm to nothing over this depth of water (m) toward a shore (they shoal and break: the foam's job).
    public static let calmDepth = 6.0
    /// The way the wind blows (rad from +x toward +z), and each cascade's rms height (m). ESTIMATE: a moderate breeze's sea,
    /// ≈ 0.9 m significant height (4 × rms: sea state 3), with ripples of ≈ 5 cm on it.
    public static let windDir = 0.6, swellRMS = 0.22, chopRMS = 0.045
}

/// One Gerstner wave: wave vector (rad/m), amplitude (m), angular speed (rad/s), phase, and steepness q (the horizontal
/// pinch: q·k·A is the share of a full Gerstner loop, 0 a sine, 1 a cusp).
public struct Wave: Sendable, Equatable {
    public var kx: Double, kz: Double, amp: Double, omega: Double, phase: Double, q: Double
    public var k: Double { (kx * kx + kz * kz).squareRoot() }
}

public enum Waves {
    /// One cascade's waves: whole-cycle wave vectors over `L` (so the field tiles), drawn round the wind from the seed.
    /// Amplitudes shaped as a wind sea's (the longer waves taller, ∝ λ^0.8, the down-wind ones strongest), scaled so the
    /// cascade's variance Σ A²/2 is `rms`²; the steepness shared so the sum never folds over.
    public static func cascade(seed: UInt32, L: Double, rms: Double, count: Int = WaterSpec.perCascade, salt: UInt32) -> [Wave] {
        var out: [Wave] = []
        // Wavelengths spread geometrically from ≈ L/1.4 down to ≈ L/9 (the cascade's band).
        for i in 0..<count {
            let u = Double(i) / Double(Swift.max(1, count - 1))
            let lambda = L / (1.4 * pow(6.5, u))
            let spread = (WNoise.hash2(seed ^ salt, i, 1) - 0.5) * 1.6   // within ±46° of the wind
            let dir = WaterSpec.windDir + spread
            // Snap the wave vector to the lattice of whole cycles over L (the tile repeats exactly).
            let n = L / lambda
            var mx = (n * cos(dir)).rounded(), mz = (n * sin(dir)).rounded()
            if mx == 0 && mz == 0 { mx = 1 }
            let kx = 2 * Double.pi * mx / L, kz = 2 * Double.pi * mz / L
            let k = (kx * kx + kz * kz).squareRoot()
            let c = cos(atan2(kz, kx) - WaterSpec.windDir)
            let shape = pow(2 * Double.pi / k, 0.8) * (0.35 + 0.65 * c * c) * (0.75 + 0.5 * WNoise.hash2(seed ^ salt, i, 3))
            out.append(Wave(kx: kx, kz: kz, amp: shape, omega: (WaterSpec.g * k).squareRoot(),
                            phase: WNoise.hash2(seed ^ salt, i, 2) * 2 * Double.pi, q: 0))
        }
        let v = out.reduce(0) { $0 + $1.amp * $1.amp / 2 }
        let s = v > 0 ? rms / v.squareRoot() : 0
        for i in out.indices { out[i].amp *= s }
        // Steepness: the horizontal pinch shared out so Σ q·k·A ≤ 0.8 (no loops; crests sharpen, troughs widen).
        let sum = out.reduce(0) { $0 + $1.k * $1.amp }
        for i in out.indices { out[i].q = sum > 0 ? jsMin(1, 0.8 / sum) : 0 }
        return out
    }
    public static func swell(seed: UInt32) -> [Wave] { cascade(seed: seed, L: WaterSpec.swellL, rms: WaterSpec.swellRMS, salt: 0x5e11) }
    public static func chop(seed: UInt32) -> [Wave] { cascade(seed: seed, L: WaterSpec.chopL, rms: WaterSpec.chopRMS, salt: 0xc409) }

    /// The surface's height above the still level at (x, z) and time t (m), and its slope, from `waves`, calmed by `calm`
    /// (1 open water … 0 at the shore). A Gerstner surface moves its points sideways too; the height here is the one at
    /// (x, z) itself, which is what a floating body samples (the sideways shift is under 10 % of a wavelength). NaN in → 0.
    public static func height(_ waves: [Wave], _ x: Double, _ z: Double, _ t: Double, calm: Double = 1) -> (y: Double, dx: Double, dz: Double) {
        guard x.isFinite, z.isFinite, t.isFinite, calm.isFinite else { return (0, 0, 0) }
        var y = 0.0, sx = 0.0, sz = 0.0
        for w in waves {
            let th = w.kx * x + w.kz * z - w.omega * t + w.phase
            let a = w.amp * calm
            y += a * cos(th)
            let s = -a * sin(th)
            sx += s * w.kx; sz += s * w.kz
        }
        return (y, sx, sz)
    }
    /// The drawn surface's height above the still level at (x, z): a Gerstner surface moves each point sideways as well as
    /// up, so the point that ends up over (x, z) started elsewhere. Two fixed-point steps find it (the shift is a fraction
    /// of a wavelength, Σ q·k·A < 1, so they converge), then its height. What the car floats on matches what's drawn.
    public static func surface(_ waves: [Wave], _ x: Double, _ z: Double, _ t: Double, calm: Double = 1) -> Double {
        guard x.isFinite, z.isFinite, t.isFinite, calm.isFinite, calm > 0 else { return 0 }
        var px = x, pz = z
        for _ in 0..<2 {
            var dx = 0.0, dz = 0.0
            for w in waves {
                let s = sin(w.kx * px + w.kz * pz - w.omega * t + w.phase), k = jsMax(1e-9, w.k)
                dx -= w.q * w.amp * calm * w.kx / k * s; dz -= w.q * w.amp * calm * w.kz / k * s
            }
            px = x - dx; pz = z - dz
        }
        return height(waves, px, pz, t, calm: calm).y
    }
    /// The calm factor for a water depth (m): 0 on the shore, 1 in open water.
    @inline(__always) public static func calm(depth d: Double) -> Double {
        guard d.isFinite else { return 0 }
        return WNoise.smooth(0.2, WaterSpec.calmDepth, d)
    }
}

/// The ground's height above the sea on an n × n grid of `cell`-metre cells centred on (cx, cz): positive is land, negative
/// the water's depth. `exact` asks the carved ground (roads, causeways); otherwise the natural land (the far map).
public struct WaterMap: Sendable {
    public let cx: Double, cz: Double, cell: Double, n: Int
    public var h: [Float]
    public var x0: Double { cx - cell * Double(n) / 2 }
    public var z0: Double { cz - cell * Double(n) / 2 }
    public var span: Double { cell * Double(n) }
    /// Any water on it at all (nothing to draw or bake when false).
    public var wet: Bool { h.contains { $0 < 0 } }

    public static func build(_ w: FreeWorld, cx: Double, cz: Double, cell: Double, n: Int, exact: Bool) -> WaterMap {
        var h = [Float](repeating: 0, count: n * n)
        let half = cell * Double(n) / 2
        let x0 = cx - half, z0 = cz - half
        if exact {
            // In 16 × 16 blocks, each with its own road query (as a terrain tile builds).
            let B = 16
            var bj = 0
            while bj < n {
                var bi = 0
                while bi < n {
                    let ax = x0 + Double(bi) * cell, az = z0 + Double(bj) * cell
                    let q = w.roads.query(minX: ax, minZ: az, maxX: ax + Double(B) * cell, maxZ: az + Double(B) * cell, stride: Swift.max(1, Swift.min(16, Int(cell / 8))))
                    for j in bj..<Swift.min(n, bj + B) { for i in bi..<Swift.min(n, bi + B) {
                        let x = x0 + (Double(i) + 0.5) * cell, z = z0 + (Double(j) + 0.5) * cell
                        let g = w.ground(x, z, q)
                        h[j * n + i] = Float((g.floor ? 0 : g.y) - WaterSpec.level)
                    } }
                    bi += B
                }
                bj += B
            }
        } else {
            for j in 0..<n { for i in 0..<n {
                let x = x0 + (Double(i) + 0.5) * cell, z = z0 + (Double(j) + 0.5) * cell
                let lp = w.land.at(x, z)
                // The natural land, as it stands away from a road (the far map doesn't know the roads).
                h[j * n + i] = Float((Site.onFloor(x, z) ? 0 : lp.full) - WaterSpec.level)
            } }
        }
        return WaterMap(cx: cx, cz: cz, cell: cell, n: n, h: h)
    }

    /// Bilinear height at (x, z); nil off the map.
    public func at(_ x: Double, _ z: Double) -> Double? {
        let u = (x - x0) / cell - 0.5, v = (z - z0) / cell - 0.5
        guard u.isFinite, v.isFinite, u >= 0, v >= 0, u <= Double(n - 1), v <= Double(n - 1) else { return nil }
        let i = Swift.min(n - 2, Int(u)), j = Swift.min(n - 2, Int(v)), fu = u - Double(i), fv = v - Double(j)
        let a = Double(h[j * n + i]), b = Double(h[j * n + i + 1]), c = Double(h[(j + 1) * n + i]), d = Double(h[(j + 1) * n + i + 1])
        return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv
    }
}

/// The land's skyline from a point over the sea: for each of `n` bearings (from +x toward +z), the steepest elevation
/// angle's tangent the land rises to (−∞ … none) and how far off that is (m). The sea reflects the sky above it and the
/// land below it, so the ranges stand mirrored in the water without drawing the world twice.
public struct Horizon: Sendable {
    public let n: Int
    public var tan: [Float], dist: [Float]
    public static let none: Float = -1

    /// From the eye (x, eyeY, z) over the maps `near` then `far` (the first that holds a point answers), out to `reach` m.
    public static func build(eyeX: Double, eyeY: Double, eyeZ: Double, maps: [WaterMap], n: Int = 512, reach: Double = 16_000, steps: Int = 96) -> Horizon {
        var t = [Float](repeating: none, count: n), d = [Float](repeating: 0, count: n)
        guard eyeX.isFinite, eyeY.isFinite, eyeZ.isFinite else { return Horizon(n: n, tan: t, dist: d) }
        let eyeH = eyeY - WaterSpec.level
        // Steps grow geometrically from 4 m to the reach.
        let r0 = 4.0, ratio = pow(reach / r0, 1 / Double(steps - 1))
        for a in 0..<n {
            let ang = Double(a) / Double(n) * 2 * Double.pi, ca = cos(ang), sa = sin(ang)
            var best = -Double.infinity, bd = 0.0, r = r0
            for _ in 0..<steps {
                let x = eyeX + ca * r, z = eyeZ + sa * r
                var hh: Double? = nil
                for m in maps { if let v = m.at(x, z) { hh = v; break } }
                if let hv = hh, hv > 0 {
                    let tn = (hv - eyeH) / r
                    if tn > best { best = tn; bd = r }
                }
                r *= ratio
            }
            if best > -Double.infinity { t[a] = Float(jsMax(-0.99, jsMin(4, best))); d[a] = Float(bd) }
        }
        return Horizon(n: n, tan: t, dist: d)
    }
}

extension FreeWorld {
    /// The sea's still level at (x, z): the water stands wherever the ground is below it.
    @inline(__always) public var seaLevel: Double { WaterSpec.level }
    /// Is (x, z) under the sea (the natural land, no roads: a quick look for the drive's water)?
    public func underSea(_ x: Double, _ z: Double) -> Bool { !Site.onFloor(x, z) && ground(x, z).y < WaterSpec.level }
    /// The nearest sea to (x, z) on a ring search out to `maxR` m (shots, tests): a point just off a shore, or nil.
    public func nearestSea(_ x: Double, _ z: Double, maxR: Double = 40_000, step: Double = 250) -> (x: Double, z: Double)? {
        var r = step
        while r <= maxR {
            let n = Swift.max(8, Int(2 * Double.pi * r / step))
            for i in 0..<n {
                let a = Double(i) / Double(n) * 2 * Double.pi
                let px = x + cos(a) * r, pz = z + sin(a) * r
                if !Site.onFloor(px, pz) && land.at(px, pz).full < WaterSpec.level - 1 && ground(px, pz).y < WaterSpec.level - 1 { return (px, pz) }
            }
            r += step
        }
        return nil
    }
}
