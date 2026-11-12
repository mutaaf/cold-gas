// src/sim/noise.js in Swift (docs/NATIVE-FREEDRIVE.md §4.1): integer hashing with wrapping 32-bit multiplies, then
// + − × ÷ on doubles, so a seed builds the same hills on every device. Value noise with a quintic fade; fbm and ridged
// fractals. Only the values are kept (the tiles take their normals from the samples around each vertex).
import ColdGasCore

public enum WNoise {
    /// A 32-bit seed from any text (FNV-1a, as noise.js seedOf).
    public static func seedOf(_ s: String) -> UInt32 {
        var h: UInt32 = 0x811c9dc5
        for u in s.utf16 { h ^= UInt32(u); h = h &* 0x01000193 }
        return h
    }
    /// JS `x | 0` for the floors this module takes (|x| < 2³¹).
    @inline(__always) static func i32(_ x: Double) -> UInt32 { UInt32(truncatingIfNeeded: Int64(x)) }

    /// noise.js hash2: a seed and two integers → [0, 1).
    @inline(__always) public static func hash2(_ seed: UInt32, _ i: Int, _ j: Int) -> Double {
        var h = seed ^ (UInt32(truncatingIfNeeded: i) &* 0x27d4eb2d) ^ (UInt32(truncatingIfNeeded: j) &* 0x165667b1)
        h = (h ^ (h >> 15)) &* 0x85ebca6b
        h = (h ^ (h >> 13)) &* 0xc2b2ae35
        h ^= h >> 16
        return Double(h) / 4294967296
    }
    @inline(__always) public static func hash1(_ seed: UInt32, _ i: Int) -> Double { hash2(seed, i, 0x5bd1e995) }

    /// noise.js vnoise: 2D value noise in [−1, 1].
    @inline(__always) public static func vnoise(_ seed: UInt32, _ x: Double, _ z: Double) -> Double {
        let fi = x.rounded(.down), fj = z.rounded(.down), fx = x - fi, fz = z - fj
        let i = Int(Int32(truncatingIfNeeded: Int64(fi))), j = Int(Int32(truncatingIfNeeded: Int64(fj)))
        let a = hash2(seed, i, j), b = hash2(seed, i + 1, j), c = hash2(seed, i, j + 1), d = hash2(seed, i + 1, j + 1)
        let ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
        let k1 = b - a, k2 = c - a, k3 = a - b - c + d
        return 2 * (a + k1 * ux + k2 * uz + k3 * ux * uz) - 1
    }
    /// noise.js vnoise1: 1D value noise in [−1, 1].
    @inline(__always) public static func vnoise1(_ seed: UInt32, _ t: Double) -> Double {
        let fi = t.rounded(.down), f = t - fi, i = Int(Int32(truncatingIfNeeded: Int64(fi)))
        let a = hash1(seed, i), b = hash1(seed, i + 1)
        let u = f * f * f * (f * (f * 6 - 15) + 10)
        return 2 * (a + (b - a) * u) - 1
    }
    /// noise.js fbm: `oct` octaves at wavelength `wl` (m), each half the wavelength and `gain` of the amplitude, ≈ [−1, 1].
    public static func fbm(_ seed: UInt32, _ x: Double, _ z: Double, _ wl: Double, _ oct: Int, _ gain: Double = 0.5) -> Double {
        var f = 1 / wl, amp = 1.0, sum = 0.0, norm = 0.0
        for o in 0..<oct {
            let od = Double(o)
            sum += amp * vnoise(seed &+ UInt32(o) &* 1013, x * f + od * 17.31, z * f - od * 9.73)
            norm += amp; amp *= gain; f *= 2.03
        }
        return sum / norm
    }
    /// noise.js ridged: sharp crests where the noise crosses zero (mountain ranges), in [0, 1].
    public static func ridged(_ seed: UInt32, _ x: Double, _ z: Double, _ wl: Double, _ oct: Int, _ gain: Double = 0.5) -> Double {
        var f = 1 / wl, amp = 1.0, sum = 0.0, norm = 0.0, weight = 1.0
        for o in 0..<oct {
            let od = Double(o)
            let n = vnoise(seed &+ UInt32(o) &* 7919, x * f + od * 31.7, z * f + od * 11.3)
            let r = 1 - (n < 0 ? -n : n)
            let v = r * r * weight
            sum += amp * v; norm += amp
            weight = v < 1 ? v : 1
            amp *= gain; f *= 2.07
        }
        return sum / norm
    }
    /// Smoothstep from e0 to e1.
    @inline(__always) public static func smooth(_ e0: Double, _ e1: Double, _ v: Double) -> Double {
        let t = (v - e0) / (e1 - e0)
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }
        return t * t * (3 - 2 * t)
    }
}
