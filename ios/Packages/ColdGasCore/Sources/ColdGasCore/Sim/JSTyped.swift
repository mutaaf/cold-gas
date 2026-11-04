// What a typed-array store does to a JS number (the sim keeps state in Float32/Int8/Uint8/Int32 arrays).
/// `a || b` for numbers: b when a is 0, -0 or NaN.
@inline(__always) public func jsOr(_ a: Double, _ b: Double) -> Double { (a == 0 || a.isNaN) ? b : a }
/// Float32Array store = Math.fround (round to nearest, ties to even): Swift's Float(Double) does the same.
@inline(__always) public func f32(_ x: Double) -> Float { Float(x) }
/// ToInt32 / ToUint32 / ToInt8 / ToUint8: truncate toward zero, wrap modulo 2^n, NaN and ±∞ → 0.
@inline(__always) func jsToIntBits(_ x: Double) -> UInt64 {
    guard x.isFinite else { return 0 }
    let t = x.rounded(.towardZero)
    let m = t.truncatingRemainder(dividingBy: 18446744073709551616.0)   // mod 2^64 keeps the low bits
    return m < 0 ? UInt64(-m).twosComplement : UInt64(m)
}
extension UInt64 { @inline(__always) var twosComplement: UInt64 { (~self) &+ 1 } }
@inline(__always) public func jsInt32(_ x: Double) -> Int32 { Int32(truncatingIfNeeded: jsToIntBits(x)) }
@inline(__always) public func jsUint32(_ x: Double) -> UInt32 { UInt32(truncatingIfNeeded: jsToIntBits(x)) }
@inline(__always) public func jsInt8(_ x: Double) -> Int8 { Int8(truncatingIfNeeded: jsToIntBits(x)) }
@inline(__always) public func jsUint8(_ x: Double) -> UInt8 { UInt8(truncatingIfNeeded: jsToIntBits(x)) }
@inline(__always) public func jsInt16(_ x: Double) -> Int16 { Int16(truncatingIfNeeded: jsToIntBits(x)) }
