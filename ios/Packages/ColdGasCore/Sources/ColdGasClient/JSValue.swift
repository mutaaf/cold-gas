// A JSON value with JavaScript's semantics where the app has to agree with the web byte for byte (0154): objects keep
// their insertion order (JSON.stringify writes keys in that order), numbers print as JS prints them (Number::toString:
// shortest round trip, "1e+21", "1e-7", -0 as "0"), and non-finite numbers serialise as null, as JSON.stringify does.
// The conversions (`jsNumber`, `jsString`, `truthy`) are ToNumber, ToString and ToBoolean, for code ported from the
// web that reads loosely typed JSON (boardRow, the local lines, the Daily's checks). Foundation only; Linux-safe.
import Foundation

public enum JSValue: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSValue])
    case object([(String, JSValue)])

    public static func == (a: JSValue, b: JSValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case let (.bool(x), .bool(y)): return x == y
        case let (.number(x), .number(y)): return x == y || (x.isNaN && y.isNaN)
        case let (.string(x), .string(y)): return x == y
        case let (.array(x), .array(y)): return x == y
        case let (.object(x), .object(y)):
            // Equal as JSON objects: the same keys and values, in any order.
            guard x.count == y.count else { return false }
            var d: [String: JSValue] = [:]
            for (k, v) in y { d[k] = v }
            return x.allSatisfy { d[$0.0] == $0.1 }
        default: return false
        }
    }

    /// A property, as `o[k]` reads it: nil is `undefined` (no such key, or not an object).
    public subscript(_ key: String) -> JSValue? {
        if case let .object(kv) = self { return kv.first { $0.0 == key }?.1 }
        return nil
    }
    public var isObject: Bool { if case .object = self { return true }; return false }
    public var isArray: Bool { if case .array = self { return true }; return false }
    public var stringValue: String? { if case let .string(s) = self { return s }; return nil }
    public var numberValue: Double? { if case let .number(n) = self { return n }; return nil }
    public var boolValue: Bool? { if case let .bool(b) = self { return b }; return nil }
    public var arrayValue: [JSValue]? { if case let .array(a) = self { return a }; return nil }

    // --- JSON.stringify ---------------------------------------------------------------------------------
    /// `JSON.stringify(value)`: no whitespace, keys in order, numbers as JS prints them, NaN and ±Infinity as null.
    public var json: String { var out = ""; write(&out); return out }
    public func write(_ out: inout String) {
        switch self {
        case .null: out += "null"
        case let .bool(b): out += b ? "true" : "false"
        case let .number(n): out += n.isFinite ? jsNumberString(n) : "null"
        case let .string(s): jsonQuote(s, &out)
        case let .array(a):
            out += "["
            for (i, v) in a.enumerated() { if i > 0 { out += "," }; v.write(&out) }
            out += "]"
        case let .object(kv):
            out += "{"
            for (i, (k, v)) in kv.enumerated() { if i > 0 { out += "," }; jsonQuote(k, &out); out += ":"; v.write(&out) }
            out += "}"
        }
    }
    public var jsonData: Data { Data(json.utf8) }

    /// Parse JSON text (nil when it isn't JSON). Objects keep the text's key order.
    public static func parse(_ text: String) -> JSValue? { parse(Data(text.utf8)) }
    public static func parse(_ data: Data) -> JSValue? {
        var p = JSONParser(Array(data))
        guard let v = p.value() else { return nil }
        p.ws()
        return p.i == p.b.count ? v : nil
    }
}

// Not ExpressibleByNilLiteral: `v == nil` on a JSValue? must mean undefined, never .null.
extension JSValue: ExpressibleByBooleanLiteral, ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(booleanLiteral v: Bool) { self = .bool(v) }
    public init(floatLiteral v: Double) { self = .number(v) }
    public init(integerLiteral v: Int) { self = .number(Double(v)) }
    public init(stringLiteral v: String) { self = .string(v) }
    public init(arrayLiteral v: JSValue...) { self = .array(v) }
    public init(dictionaryLiteral kv: (String, JSValue)...) { self = .object(kv) }
}

extension JSValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSValue].self) { self = .array(a); return }
        let d = try c.decode([String: JSValue].self)
        self = .object(d.sorted { $0.key < $1.key }.map { ($0.key, $0.value) })   // JSONDecoder doesn't keep order
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .number(n): if n.isFinite { try c.encode(n) } else { try c.encodeNil() }
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(kv): try c.encode(Dictionary(kv, uniquingKeysWith: { _, b in b }))
        }
    }
    /// Decode a Codable type from this value (through its JSON).
    public func decode<T: Decodable>(_ type: T.Type) -> T? { try? JSONDecoder().decode(T.self, from: jsonData) }
    /// Any Encodable as a JSValue (keys sorted: Codable has no order).
    public static func from<T: Encodable>(_ v: T) -> JSValue? {
        let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]
        return (try? e.encode(v)).flatMap { parse($0) }
    }
}

// --- flattened paths ---------------------------------------------------------------------------------
extension JSValue {
    /// The inverse of scripts/vectors-lib.mjs `flat`: ("facts.damageZones.nose", 3), ("judges[0].id", "engineer") → a tree.
    public static func unflatten(_ kv: [(String, JSValue)]) -> JSValue {
        enum Seg { case key(String), index(Int) }
        func segs(_ path: String) -> [Seg] {
            var out: [Seg] = [], cur = ""
            var it = Array(path), i = 0
            while i < it.count {
                let ch = it[i]
                if ch == "." { if !cur.isEmpty { out.append(.key(cur)) }; cur = ""; i += 1 }
                else if ch == "[" {
                    if !cur.isEmpty { out.append(.key(cur)) }; cur = ""
                    var j = i + 1, n = ""
                    while j < it.count && it[j] != "]" { n.append(it[j]); j += 1 }
                    out.append(.index(Int(n) ?? 0)); i = j + 1
                } else { cur.append(ch); i += 1 }
            }
            if !cur.isEmpty { out.append(.key(cur)) }
            it = []
            return out
        }
        func put(_ node: inout JSValue, _ s: ArraySlice<Seg>, _ v: JSValue) {
            guard let first = s.first else { node = v; return }
            switch first {
            case let .key(k):
                var kv: [(String, JSValue)] = { if case let .object(o) = node { return o }; return [] }()
                if let i = kv.firstIndex(where: { $0.0 == k }) { put(&kv[i].1, s.dropFirst(), v) }
                else { var child = JSValue.null; put(&child, s.dropFirst(), v); kv.append((k, child)) }
                node = .object(kv)
            case let .index(i):
                var a: [JSValue] = { if case let .array(x) = node { return x }; return [] }()
                while a.count <= i { a.append(.null) }
                put(&a[i], s.dropFirst(), v)
                node = .array(a)
            }
        }
        var root = JSValue.object([])
        for (p, v) in kv { put(&root, segs(p)[...], v) }
        return root
    }
}

// --- ToNumber, ToString, ToBoolean ---------------------------------------------------------------------
/// `Number(v)` (ToNumber): undefined (nil) → NaN, null → 0, booleans → 0/1, strings as JS reads a numeric literal
/// (trimmed; "" → 0; "0x1A", "1e2", "Infinity"; anything else NaN), an array through its string, an object NaN.
public func jsNumber(_ v: JSValue?) -> Double {
    guard let v else { return .nan }
    switch v {
    case .null: return 0
    case let .bool(b): return b ? 1 : 0
    case let .number(n): return n
    case let .string(s): return jsStringToNumber(s)
    case .array: return jsStringToNumber(jsString(v))
    case .object: return .nan
    }
}
/// `String(v)` (ToString): undefined → "undefined", null → "null", numbers as JS prints them, an array's items joined
/// by "," (null and undefined as ""), an object "[object Object]".
public func jsString(_ v: JSValue?) -> String {
    guard let v else { return "undefined" }
    switch v {
    case .null: return "null"
    case let .bool(b): return b ? "true" : "false"
    case let .number(n): return jsNumberString(n)
    case let .string(s): return s
    case let .array(a): return a.map { if case .null = $0 { return "" }; return jsString($0) }.joined(separator: ",")
    case .object: return "[object Object]"
    }
}
/// `!!v` (ToBoolean).
public func truthy(_ v: JSValue?) -> Bool {
    guard let v else { return false }
    switch v {
    case .null: return false
    case let .bool(b): return b
    case let .number(n): return n != 0 && !n.isNaN
    case let .string(s): return !s.isEmpty
    case .array, .object: return true
    }
}

/// JS's whitespace and line terminators (String.prototype.trim, StringToNumber).
public func isJSSpace(_ u: Unicode.Scalar) -> Bool {
    switch u.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
    default: return false
    }
}
public func jsTrim(_ s: String) -> String {
    let u = Array(s.unicodeScalars)
    var a = 0, b = u.count
    while a < b && isJSSpace(u[a]) { a += 1 }
    while b > a && isJSSpace(u[b - 1]) { b -= 1 }
    var out = String.UnicodeScalarView(); out.append(contentsOf: u[a..<b])
    return String(out)
}
/// StringToNumber.
public func jsStringToNumber(_ raw: String) -> Double {
    let s = jsTrim(raw)
    if s.isEmpty { return 0 }
    let lower = s.lowercased()
    for (p, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(p) {
        let digits = s.dropFirst(2)
        guard !digits.isEmpty else { return .nan }
        var v = 0.0
        for ch in digits { guard let d = ch.hexDigitValue, d < radix else { return .nan }; v = v * Double(radix) + Double(d) }
        return v
    }
    switch s { case "Infinity", "+Infinity": return .infinity; case "-Infinity": return -.infinity; default: break }
    // StrDecimalLiteral: [+-] (digits [. digits] | . digits) [e [+-] digits]
    let b = Array(s.utf8)
    var i = 0
    func digits() -> Int { var n = 0; while i < b.count && b[i] >= 48 && b[i] <= 57 { i += 1; n += 1 }; return n }
    if i < b.count && (b[i] == 43 || b[i] == 45) { i += 1 }
    var mant = digits()
    if i < b.count && b[i] == 46 { i += 1; mant += digits() }
    guard mant > 0 else { return .nan }
    if i < b.count && (b[i] == 101 || b[i] == 69) {
        i += 1
        if i < b.count && (b[i] == 43 || b[i] == 45) { i += 1 }
        guard digits() > 0 else { return .nan }
    }
    guard i == b.count else { return .nan }
    return Double(s) ?? .nan
}

// --- Number::toString and toFixed --------------------------------------------------------------------------
/// The shortest decimal digits that round-trip `x` (x finite, > 0) and the decimal point's position: x = 0.d₁d₂… × 10ⁿ.
func shortestDigits(_ x: Double) -> (digits: [UInt8], n: Int) {
    // Swift's description is the shortest round-trip, closest to x (as ECMAScript asks); only its layout differs.
    let d = x.description
    var mant = Substring(d), exp = 0
    if let e = d.firstIndex(where: { $0 == "e" || $0 == "E" }) { mant = d[..<e]; exp = Int(d[d.index(after: e)...]) ?? 0 }
    var digits: [UInt8] = [], point = 0, seenPoint = false
    for ch in mant.utf8 {
        if ch == 46 { seenPoint = true; continue }
        digits.append(ch - 48)
        if !seenPoint { point += 1 }
    }
    point += exp
    while digits.first == 0 && digits.count > 1 { digits.removeFirst(); point -= 1 }
    while digits.last == 0 && digits.count > 1 { digits.removeLast() }
    return (digits, point)
}
/// `String(x)` for a number (Number::toString): "0" for ±0, "1e+21", "1.5e-7", "123", "0.001".
public func jsNumberString(_ x: Double) -> String {
    if x.isNaN { return "NaN" }
    if x == 0 { return "0" }
    if x.isInfinite { return x < 0 ? "-Infinity" : "Infinity" }
    let (dg, n) = shortestDigits(abs(x))
    let k = dg.count
    let s = String(decoding: dg.map { $0 + 48 }, as: UTF8.self)
    var out = x < 0 ? "-" : ""
    if k <= n && n <= 21 { out += s + String(repeating: "0", count: n - k) }
    else if 0 < n && n <= 21 { let i = s.index(s.startIndex, offsetBy: n); out += s[..<i] + "." + s[i...] }
    else if -6 < n && n <= 0 { out += "0." + String(repeating: "0", count: -n) + s }
    else {
        let e = n - 1
        out += k == 1 ? s : String(s.first!) + "." + s.dropFirst()
        out += "e" + (e < 0 ? "-" : "+") + String(abs(e))
    }
    return out
}
/// `x.toFixed(f)` (0 ≤ f ≤ 100): the exact binary value rounded to f decimals, a tie rounding up in magnitude
/// ((2.5).toFixed(0) is "3", where printf rounds to even), "-" kept for a negative x that rounds to zero ("-0"),
/// and |x| ≥ 1e21 printed as String(x).
public func jsToFixed(_ x: Double, _ f: Int) -> String {
    if x.isNaN { return "NaN" }
    if !(abs(x) < 1e21) { return jsNumberString(x) }
    if x < 0 { return "-" + jsToFixed(-x, f) }
    // The exact expansion, 40 places past the cut (a double's distance from a decimal tie is far larger than 1e-40 here).
    let exact = String(format: "%.\(f + 40)f", abs(x))   // abs: -0 prints "-0" but is not < 0
    var intPart = Array(exact.utf8.prefix { $0 != 46 }.map { $0 - 48 })
    let fracAll = Array(exact.utf8.drop { $0 != 46 }.dropFirst().map { $0 - 48 })
    var frac = Array(fracAll.prefix(f))
    if fracAll.count > f && fracAll[f] >= 5 {
        // Round up: carry through the fraction, then the integer.
        var i = frac.count - 1, carry = true
        while carry && i >= 0 { if frac[i] == 9 { frac[i] = 0; i -= 1 } else { frac[i] += 1; carry = false } }
        i = intPart.count - 1
        while carry && i >= 0 { if intPart[i] == 9 { intPart[i] = 0; i -= 1 } else { intPart[i] += 1; carry = false } }
        if carry { intPart.insert(1, at: 0) }
    }
    let ip = String(decoding: intPart.map { $0 + 48 }, as: UTF8.self)
    return f == 0 ? ip : ip + "." + String(decoding: frac.map { $0 + 48 }, as: UTF8.self)
}
/// `Math.round(x).toLocaleString('en-US')` for an integer-valued x: digits grouped by threes with commas.
public func jsGrouped(_ x: Double) -> String {
    let neg = x < 0 || (x == 0 && x.sign == .minus)
    let digits = abs(x) < 1e21 ? jsNumberString(abs(x)) : String(format: "%.0f", abs(x))
    var out = "", n = 0
    for ch in digits.reversed() { if n > 0 && n % 3 == 0 { out.append(",") }; out.append(ch); n += 1 }
    return (neg ? "-" : "") + String(out.reversed())
}

/// JSON string quoting as JSON.stringify does it: \" \\ \b \f \n \r \t, other controls as \u00xx, lone surrogates as \udxxx.
func jsonQuote(_ s: String, _ out: inout String) {
    out += "\""
    var units = Array(s.utf16), i = 0
    func hex4(_ u: UInt16) -> String { let h = String(u, radix: 16); return "\\u" + String(repeating: "0", count: 4 - h.count) + h }
    while i < units.count {
        let u = units[i]
        switch u {
        case 0x22: out += "\\\""
        case 0x5C: out += "\\\\"
        case 0x08: out += "\\b"
        case 0x0C: out += "\\f"
        case 0x0A: out += "\\n"
        case 0x0D: out += "\\r"
        case 0x09: out += "\\t"
        case 0..<0x20: out += hex4(u)
        case 0xD800...0xDBFF:
            if i + 1 < units.count, (0xDC00...0xDFFF).contains(units[i + 1]) {
                out += String(decoding: [u, units[i + 1]], as: UTF16.self); i += 1
            } else { out += hex4(u) }
        case 0xDC00...0xDFFF: out += hex4(u)
        default: out += String(decoding: [u], as: UTF16.self)
        }
        i += 1
    }
    units = []
    out += "\""
}

/// A small JSON reader that keeps object key order (JSONSerialization and JSONDecoder don't).
struct JSONParser {
    let b: [UInt8]
    var i = 0
    init(_ b: [UInt8]) { self.b = b }
    mutating func ws() { while i < b.count && (b[i] == 32 || b[i] == 9 || b[i] == 10 || b[i] == 13) { i += 1 } }
    mutating func value() -> JSValue? {
        ws()
        guard i < b.count else { return nil }
        switch b[i] {
        case 123: // {
            i += 1; var kv: [(String, JSValue)] = []
            ws(); if i < b.count && b[i] == 125 { i += 1; return .object(kv) }
            while true {
                ws(); guard let k = string() else { return nil }
                ws(); guard i < b.count && b[i] == 58 else { return nil }; i += 1
                guard let v = value() else { return nil }
                kv.append((k, v)); ws()
                guard i < b.count else { return nil }
                if b[i] == 44 { i += 1; continue }
                if b[i] == 125 { i += 1; return .object(kv) }
                return nil
            }
        case 91: // [
            i += 1; var a: [JSValue] = []
            ws(); if i < b.count && b[i] == 93 { i += 1; return .array(a) }
            while true {
                guard let v = value() else { return nil }
                a.append(v); ws()
                guard i < b.count else { return nil }
                if b[i] == 44 { i += 1; continue }
                if b[i] == 93 { i += 1; return .array(a) }
                return nil
            }
        case 34: return string().map { .string($0) }
        case 116: return lit("true", .bool(true))
        case 102: return lit("false", .bool(false))
        case 110: return lit("null", .null)
        default: return number()
        }
    }
    mutating func lit(_ w: String, _ v: JSValue) -> JSValue? {
        let u = Array(w.utf8)
        guard i + u.count <= b.count, Array(b[i..<i + u.count]) == u else { return nil }
        i += u.count; return v
    }
    mutating func number() -> JSValue? {
        let s = i
        while i < b.count, let c = Optional(b[i]), (c >= 48 && c <= 57) || c == 45 || c == 43 || c == 46 || c == 101 || c == 69 { i += 1 }
        guard i > s, let d = Double(String(decoding: b[s..<i], as: UTF8.self)) else { return nil }
        return .number(d)
    }
    mutating func string() -> String? {
        guard i < b.count && b[i] == 34 else { return nil }
        i += 1
        var units: [UInt16] = []
        var run: [UInt8] = []
        func flush() { if !run.isEmpty { units.append(contentsOf: String(decoding: run, as: UTF8.self).utf16); run.removeAll() } }
        while i < b.count {
            let c = b[i]
            if c == 34 { i += 1; flush(); return String(decoding: units, as: UTF16.self) }
            if c == 92 {
                flush(); i += 1
                guard i < b.count else { return nil }
                let e = b[i]; i += 1
                switch e {
                case 34: units.append(0x22); case 92: units.append(0x5C); case 47: units.append(0x2F)
                case 98: units.append(0x08); case 102: units.append(0x0C); case 110: units.append(0x0A)
                case 114: units.append(0x0D); case 116: units.append(0x09)
                case 117:
                    guard i + 4 <= b.count, let u = UInt16(String(decoding: b[i..<i + 4], as: UTF8.self), radix: 16) else { return nil }
                    units.append(u); i += 4
                default: return nil
                }
            } else { run.append(c); i += 1 }
        }
        return nil
    }
}
