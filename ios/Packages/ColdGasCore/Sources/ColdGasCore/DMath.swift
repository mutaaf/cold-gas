// src/sim/dmath.js, line for line: fdlibm kernels using only +, −, ×, ÷ and √ (IEEE 754 rounds those
// exactly everywhere), so iPhone, Node, every browser and the Worker compute the same bits. Ported from
// fdlibm (Sun, 1993: "Developed at SunPro, a Sun Microsystems business. Permission to use, copy, modify,
// and distribute this software is freely granted, provided that this notice is preserved.").
// Keep every expression's order and parentheses as in the JS (no reassociation, no fused multiply-add).
// tests: ColdGasCoreTests/DMathTests.swift against Tests/Vectors/dmath.json.

public enum DMath {
    static let PIO2_1 = 1.57079632673412561417e+00   // first 33 bits of π/2
    static let PIO2_1T = 6.07710050650619224932e-11  // π/2 − PIO2_1
    static let INV_PIO2 = 6.36619772367581382433e-01 // 2/π
    public static let PI = 3.141592653589793

    static let S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
               S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10
    static let C1 = 4.16666666666666019037e-02, C2 = -1.38888888887411369855e-03, C3 = 2.48015872894767294178e-05,
               C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11

    @inline(__always) static func kSin(_ x: Double) -> Double {
        let z = x * x, v = z * x
        return x + v * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))))
    }
    @inline(__always) static func kCos(_ x: Double) -> Double {
        let z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
        let hz = 0.5 * z, w = 1 - hz
        return w + (((1 - w) - hz) + z * r)
    }
    // Range-reduce to [−π/4, π/4]: r and the quadrant (0…3, as a double, like the JS).
    @inline(__always) static func reduce(_ x: Double) -> (rr: Double, rq: Double) {
        let n = jsRound(x * INV_PIO2)
        let rr = (x - n * PIO2_1) - n * PIO2_1T
        let rq = jsRem(jsRem(n, 4) + 4, 4)
        return (rr, rq)
    }
    public static func dsin(_ x: Double) -> Double {
        if x > -0.7853981633974483 && x < 0.7853981633974483 { return kSin(x) }
        let (rr, rq) = reduce(x)
        return rq == 0 ? kSin(rr) : rq == 1 ? kCos(rr) : rq == 2 ? -kSin(rr) : -kCos(rr)
    }
    public static func dcos(_ x: Double) -> Double {
        if x > -0.7853981633974483 && x < 0.7853981633974483 { return kCos(x) }
        let (rr, rq) = reduce(x)
        return rq == 0 ? kCos(rr) : rq == 1 ? -kSin(rr) : rq == 2 ? -kCos(rr) : kSin(rr)
    }

    static let ATANHI: [Double] = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00]
    static let ATANLO: [Double] = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
    static let AT0 = 3.33333333333329318027e-01, AT1 = -1.99999999998764832476e-01, AT2 = 1.42857142725034663711e-01,
               AT3 = -1.11111104054623557880e-01, AT4 = 9.09088713343650656196e-02, AT5 = -7.69187620504482999495e-02,
               AT6 = 6.66107313738753120669e-02, AT7 = -5.83357013379057348645e-02, AT8 = 4.97687799461593236017e-02,
               AT9 = -3.65315727442169155270e-02, AT10 = 1.62858201153657823623e-02

    public static func datan(_ x: Double) -> Double {
        if x.isNaN { return x }
        let neg = x < 0
        var a = neg ? -x : x
        let id: Int
        if a >= 4.4e15 { return neg ? -1.5707963267948966 : 1.5707963267948966 }
        if a < 0.4375 { id = -1 }
        else if a < 0.6875 { id = 0; a = (2 * a - 1) / (2 + a) }
        else if a < 1.1875 { id = 1; a = (a - 1) / (a + 1) }
        else if a < 2.4375 { id = 2; a = (a - 1.5) / (1 + 1.5 * a) }
        else { id = 3; a = -1 / a }
        let z = a * a, w = z * z
        let s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))))
        let s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))))
        let r: Double
        if id < 0 { r = a - a * (s1 + s2) }
        else { r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a) }
        return neg ? -r : r
    }

    public static func datan2(_ y: Double, _ x: Double) -> Double {
        if x.isNaN || y.isNaN { return .nan }
        if x > 0 { return datan(y / x) }
        if x < 0 { return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI }
        return y > 0 ? 1.5707963267948966 : y < 0 ? -1.5707963267948966 : 0
    }

    @inline(__always) public static func dacos(_ x: Double) -> Double { datan2(jsSqrt(jsMax(0, 1 - x * x)), x) }
    @inline(__always) public static func dhypot(_ a: Double, _ b: Double, _ c: Double = 0) -> Double { jsSqrt(a * a + b * b + c * c) }

    static let LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00
    static let P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
               P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08

    // 2^k for an integer k in [−1022, 1023], from its exponent bits (the JS builds the high word the same way).
    @inline(__always) static func pow2(_ k: Double) -> Double {
        let hi = UInt32(truncatingIfNeeded: Int32(k + 1023) << 20)
        return Double(bitPattern: UInt64(hi) << 32)
    }
    public static func dexp(_ x: Double) -> Double {
        if x.isNaN { return x }
        if x > 709.782712893384 { return .infinity }
        if x < -745.1332191019411 { return 0 }
        if x > -3.725290298461914e-9 && x < 3.725290298461914e-9 { return 1 + x }
        let k = jsFloor(x * INV_LN2 + 0.5)
        let hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo
        let t = r * r, c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
        let y = 1 - ((lo - (r * c) / (2 - c)) - hi)
        if k > 1023 { return y * pow2(1023) * pow2(k - 1023) }
        if k < -1022 { return y * pow2(k + 1000) * pow2(-1000) }
        return y * pow2(k)
    }

    static let LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
               LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01
    public static func dlog(_ x0: Double) -> Double {
        var x = x0
        if x.isNaN || x < 0 { return .nan }
        if x == 0 { return -.infinity }
        if x == .infinity { return x }
        var k: Double = 0
        if x < 2.2250738585072014e-308 { x *= 18014398509481984; k = -54 }   // subnormal: × 2^54
        let bits = x.bitPattern
        var hx = UInt32(truncatingIfNeeded: bits >> 32)
        let lo = UInt32(truncatingIfNeeded: bits)
        k += Double(hx >> 20) - 1023
        hx &= 0x000fffff
        // Normalise the mantissa into [√2/2, √2).
        let i = (hx &+ 0x95f64) & 0x100000
        let f = Double(bitPattern: (UInt64(hx | (i ^ 0x3ff00000)) << 32) | UInt64(lo)) - 1
        k += Double(i >> 20)
        let s = f / (2 + f), z = s * s, w = z * z
        let t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
        let R = t2 + t1, hfsq = 0.5 * f * f
        return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f)
    }
}
