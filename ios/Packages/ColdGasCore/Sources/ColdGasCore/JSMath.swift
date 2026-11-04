// JavaScript's number semantics, where Swift's differ (docs/NATIVE.md §3, "Porting rules"). The sim is
// ported line for line from src/sim; every Math.* call there maps to one of these, never to Swift's own
// `max`, `min` or `.rounded()`, which disagree with JS on halves, NaN and signed zero.

/// `Math.round`: the nearest integer, a half rounding toward +∞ (`Math.round(-2.5) == -2`), -0 kept for
/// -0.5 ≤ x < 0, NaN and ±∞ unchanged. Swift's `.rounded()` rounds a half away from zero.
@inline(__always)
public func jsRound(_ x: Double) -> Double {
    if !x.isFinite { return x }
    if abs(x) >= 4503599627370496 { return x }          // 2^52: already an integer
    let r = x.rounded(.down)
    let out = (x - r >= 0.5) ? r + 1 : r                // x − r is exact below 2^52
    return out == 0 ? (x.sign == .minus ? -0.0 : 0.0) : out
}

/// `Math.max(a, b)`: NaN if either is NaN; +0 over -0.
@inline(__always)
public func jsMax(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? b : a }       // equal: only the zeros differ (+0 wins)
    return a > b ? a : b
}

/// `Math.min(a, b)`: NaN if either is NaN; -0 over +0.
@inline(__always)
public func jsMin(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? a : b }       // equal: -0 wins
    return a < b ? a : b
}

/// `a % b` on numbers: the remainder truncated toward zero, with the dividend's sign.
@inline(__always)
public func jsRem(_ a: Double, _ b: Double) -> Double { a.truncatingRemainder(dividingBy: b) }

/// `Math.floor`, `Math.ceil`, `Math.abs`, `Math.sqrt`, `Math.sign`: exact everywhere.
@inline(__always) public func jsFloor(_ x: Double) -> Double { x.rounded(.down) }
@inline(__always) public func jsCeil(_ x: Double) -> Double { x.rounded(.up) }
@inline(__always) public func jsSqrt(_ x: Double) -> Double { x.squareRoot() }
@inline(__always) public func jsSign(_ x: Double) -> Double { x.isNaN ? .nan : x > 0 ? 1 : x < 0 ? -1 : x }

/// `Math.imul(a, b)`: 32-bit wrapping multiply of ToInt32(a) and ToInt32(b).
@inline(__always) public func jsImul(_ a: Int32, _ b: Int32) -> Int32 { a &* b }
