// src/challenge.js: the `#vs=` payload, the same bytes as the web's (pinned by Tests/Vectors/challenge.json). A finished
// run (its input log, course, SIM_VERSION, score, tier and the sender's initials) packed small and base64url-encoded,
// 'z' + deflate-raw where the platform has it (Apple's Compression), else 'r' + the bytes as they are. Everything decoded
// is bounded and checked; a payload that breaks a bound is nil, never a crash. Pure; the replay lives with the sim.
import Foundation
import ColdGasCore
#if canImport(Compression)
import Compression
#endif

public enum Challenge {
    public static let FORMAT = 1
    public static let COURSE_IDS = ["show", "wall", "lineup"]
    public static let TIER_IDS = ["assist", "pro", "advanced"]
    public static let CHANNELS = 23                 // src/sim/run.js INPUT_KEYS
    public static let MAX_TICKS = 240 * 90          // src/sim/run.js MAX_TICKS
    public static let VS_MAX_CHARS = 12000
    public static let VS_TARGET_CHARS = 1900
    public static let MAX_RAW = 256 * 1024
    static let NONE: UInt8 = 0xFF, LAST: UInt8 = 0x80

    /// A decoded challenge. `stale`: packed by another SIM_VERSION (decoded so the app can say so).
    public struct Run: Equatable {
        public var simVersion: Int, course: String, score: Double, tier: String, initials: String
        public var log: [[Int]]
        public var stale = false
    }
    struct Bad: Error { let why: String }

    // --- varints ---------------------------------------------------------------------------------
    static func putVar(_ out: inout [UInt8], _ v: Int) {
        var n = v
        while n >= 0x80 { out.append(UInt8((n & 0x7F) | 0x80)); n = n / 128 }
        out.append(UInt8(truncatingIfNeeded: n))
    }
    struct Reader { let b: [UInt8]; var i = 0 }
    static func getVar(_ r: inout Reader) throws -> Int {
        var n = 0, mul = 1
        for _ in 0..<5 {
            guard r.i < r.b.count else { throw Bad(why: "eof") }
            let x = Int(r.b[r.i]); r.i += 1
            n += (x & 0x7F) * mul
            if x & 0x80 == 0 { return n }
            mul *= 128
        }
        throw Bad(why: "varint")
    }
    static func getByte(_ r: inout Reader) throws -> UInt8 {
        guard r.i < r.b.count else { throw Bad(why: "eof") }
        defer { r.i += 1 }
        return r.b[r.i]
    }

    // --- the log, as bytes ---------------------------------------------------------------------------
    /// packBytes: an older client's 12-channel entries are packed as 23 (the missing channels zero). Throws for an
    /// unknown course only.
    public static func packBytes(log: [[Int]], course: String, score: Double, tier: String = "assist", initials: String = "", simVersion: Int) throws -> [UInt8] {
        guard let ci = COURSE_IDS.firstIndex(of: course) else { throw Bad(why: "course") }
        var out: [UInt8] = [UInt8(FORMAT)]
        putVar(&out, simVersion)
        out.append(UInt8(ci))
        let s10 = score.isNaN ? 0 : jsRoundD(score * 10)
        putVar(&out, Int(Swift.max(0, Swift.min(1000, s10))))
        out.append(UInt8(Swift.max(0, TIER_IDS.firstIndex(of: tier) ?? -1)))
        let ini = initials.utf8.count == 3 && initials.utf8.allSatisfy({ $0 >= 65 && $0 <= 90 }) ? Array(initials.utf8) : [0, 0, 0]
        out.append(contentsOf: ini)
        putVar(&out, log.count)
        var prev = [Int](repeating: 0, count: CHANNELS)
        var lastTick = 0
        for (k, e) in log.enumerated() {
            let tick = e.first ?? 0
            putVar(&out, k == 0 ? tick : tick - lastTick)
            lastTick = tick
            var changed: [Int] = []
            for c in 0..<CHANNELS { let v = c + 1 < e.count ? e[c + 1] : 0; if v != prev[c] { changed.append(c) } }
            if changed.isEmpty { out.append(NONE) }
            for (j, c) in changed.enumerated() {
                let v = Swift.max(-100, Swift.min(100, c + 1 < e.count ? e[c + 1] : 0)), d = v - prev[c]
                out.append(UInt8(c) | (j == changed.count - 1 ? LAST : 0))
                putVar(&out, d >= 0 ? 2 * d : -2 * d - 1)
                prev[c] = v
            }
        }
        return out
    }

    /// unpackBytes: bytes → a run, or throws on any broken bound.
    public static func unpackBytes(_ b: [UInt8]) throws -> Run {
        var r = Reader(b: b)
        guard try getByte(&r) == FORMAT else { throw Bad(why: "format") }
        let simVersion = try getVar(&r)
        let cb = Int(try getByte(&r))
        guard cb < COURSE_IDS.count else { throw Bad(why: "course") }
        let score10 = try getVar(&r)
        guard score10 <= 1000 else { throw Bad(why: "score") }
        let tb = Int(try getByte(&r))
        guard tb < TIER_IDS.count else { throw Bad(why: "tier") }
        let ic = [try getByte(&r), try getByte(&r), try getByte(&r)]
        var initials = ""
        if ic.allSatisfy({ $0 >= 65 && $0 <= 90 }) { initials = String(decoding: ic, as: UTF8.self) }
        else if !ic.allSatisfy({ $0 == 0 }) { throw Bad(why: "initials") }
        let n = try getVar(&r)
        guard n >= 1 && n <= MAX_TICKS else { throw Bad(why: "entries") }
        var cur = [Int](repeating: 0, count: CHANNELS)
        var log: [[Int]] = []
        log.reserveCapacity(n)
        var tick = 0
        for k in 0..<n {
            let d = try getVar(&r)
            tick = k == 0 ? d : tick + d
            if (k > 0 && d == 0) || tick >= MAX_TICKS { throw Bad(why: "tick") }
            var x = try getByte(&r)
            if x != NONE {
                var seen = 0
                while true {
                    let c = Int(x & 0x7F)
                    if c >= CHANNELS || seen & (1 << c) != 0 { throw Bad(why: "channel") }
                    seen |= 1 << c
                    let z = try getVar(&r)
                    if z > 400 { throw Bad(why: "value") }
                    let v = cur[c] + (z & 1 == 1 ? -(z + 1) / 2 : z / 2)
                    if v < -100 || v > 100 || v == cur[c] { throw Bad(why: "value") }
                    cur[c] = v
                    if x & LAST != 0 { break }
                    x = try getByte(&r)
                }
            }
            log.append([tick] + cur)
        }
        guard r.i == b.count else { throw Bad(why: "trailing") }
        return Run(simVersion: simVersion, course: COURSE_IDS[cb], score: Double(score10) / 10, tier: TIER_IDS[tb], initials: initials, log: log)
    }

    // --- base64url ---------------------------------------------------------------------------------
    static let B64 = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)
    static let B64I: [Int] = { var t = [Int](repeating: -1, count: 128); for (i, c) in B64.enumerated() { t[Int(c)] = i }; return t }()
    public static func toB64url(_ bytes: [UInt8]) -> String {
        var s: [UInt8] = []
        s.reserveCapacity(bytes.count * 4 / 3 + 3)
        var i = 0
        while i < bytes.count {
            let a = Int(bytes[i]), b = i + 1 < bytes.count ? Int(bytes[i + 1]) : nil, c = i + 2 < bytes.count ? Int(bytes[i + 2]) : nil
            s.append(B64[a >> 2]); s.append(B64[((a & 3) << 4) | ((b ?? 0) >> 4)])
            if let b { s.append(B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) }
            if let c { s.append(B64[c & 63]) }
            i += 3
        }
        return String(decoding: s, as: UTF8.self)
    }
    public static func fromB64url(_ s: String) -> [UInt8]? {
        let u = Array(s.utf16)
        if u.count % 4 == 1 { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(u.count * 3 / 4)
        var bits = 0, acc = 0
        for code in u {
            let v = code < 128 ? B64I[Int(code)] : -1
            if v < 0 { return nil }
            acc = ((acc << 6) | v) & 0xFFFFFF; bits += 6
            if bits >= 8 { bits -= 8; out.append(UInt8((acc >> bits) & 0xFF)) }
        }
        return out
    }

    // --- compression -------------------------------------------------------------------------------
    public static var canCompress: Bool {
        #if canImport(Compression)
        return true
        #else
        return false
        #endif
    }
    /// deflate-raw (RFC 1951), as CompressionStream('deflate-raw') reads and writes it.
    public static func deflateRaw(_ src: [UInt8]) -> [UInt8]? {
        #if canImport(Compression)
        guard !src.isEmpty else { return nil }
        var dst = [UInt8](repeating: 0, count: src.count + 1024)
        let n = dst.withUnsafeMutableBufferPointer { d in
            src.withUnsafeBufferPointer { s in compression_encode_buffer(d.baseAddress!, d.count, s.baseAddress!, s.count, nil, COMPRESSION_ZLIB) }
        }
        return n > 0 ? Array(dst.prefix(n)) : nil
        #else
        return nil
        #endif
    }
    /// inflate-raw, refusing anything past `cap` bytes.
    public static func inflateRaw(_ src: [UInt8], cap: Int = MAX_RAW) -> [UInt8]? {
        #if canImport(Compression)
        guard !src.isEmpty else { return nil }
        var dst = [UInt8](repeating: 0, count: cap + 1)
        let n = dst.withUnsafeMutableBufferPointer { d in
            src.withUnsafeBufferPointer { s in compression_decode_buffer(d.baseAddress!, d.count, s.baseAddress!, s.count, nil, COMPRESSION_ZLIB) }
        }
        return n > 0 && n <= cap ? Array(dst.prefix(n)) : nil
        #else
        return nil
        #endif
    }

    // --- payloads ----------------------------------------------------------------------------------
    /// encodeChallenge: 'z' + base64url(deflate-raw(bytes)) where it can, else 'r' + base64url(bytes).
    public static func encode(log: [[Int]], course: String, score: Double, tier: String = "assist", initials: String = "", simVersion: Int, compress: Bool = canCompress) throws -> String {
        let bytes = try packBytes(log: log, course: course, score: score, tier: tier, initials: initials, simVersion: simVersion)
        if compress, let z = deflateRaw(bytes) { return "z" + toB64url(z) }
        return "r" + toB64url(bytes)
    }
    /// decodeChallenge: a payload → its run (stale when its SIM_VERSION isn't `simVersion`), or nil for anything else.
    public static func decode(_ payload: String, simVersion: Int) -> Run? {
        let n = payload.utf16.count
        guard n >= 2 && n <= VS_MAX_CHARS else { return nil }
        let kind = payload.utf16.first!
        guard var bytes = fromB64url(String(payload.dropFirst())), !bytes.isEmpty else { return nil }
        if kind == 0x7A {   // z
            guard let raw = inflateRaw(bytes) else { return nil }
            bytes = raw
        } else if kind != 0x72 { return nil }   // r
        guard bytes.count <= MAX_RAW, var run = try? unpackBytes(bytes) else { return nil }
        run.stale = run.simVersion != simVersion
        return run
    }

    /// vsFromHash: the fragment's payload when it's a challenge (`#vs=…`, maybe among other `&` keys).
    public static func vsFromHash(_ hash: String) -> String? {
        guard hash.utf16.count <= VS_MAX_CHARS + 16 else { return nil }
        let ns = hash as NSString
        guard let m = vsRegex.firstMatch(in: hash, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return ns.substring(with: m.range(at: 1))
    }
    static let vsRegex = try! NSRegularExpression(pattern: "(?:^#|&)vs=([A-Za-z0-9_-]+)")

    /// challengeUrl: the deep link (`?play=jump`) with the course, the run in the fragment.
    public static func url(base: String, course: String, payload: String) -> String {
        "\(base)?play=jump&course=\(encodeURIComponent(course))#vs=\(payload)"
    }

    /// compare: how a finished run stands against the challenger's (to one decimal, as the panel gives them).
    public struct Standing: Equatable { public let won: Bool, tie: Bool, diff: Double, text: String }
    public static func compare(mine: Double, theirs: Double, initials: String = "") -> Standing {
        let who = initials.isEmpty ? "Your challenger" : initials, them = initials.isEmpty ? "your challenger" : initials
        let d = jsRound((mine - theirs) * 10) / 10
        if d > 0 { return Standing(won: true, tie: false, diff: d, text: "You beat \(them) by \(jsToFixed(d, 1))") }
        if d == 0 { return Standing(won: false, tie: true, diff: 0, text: "Dead level with \(them)") }
        return Standing(won: false, tie: false, diff: -d, text: "\(who) still leads by \(jsToFixed(-d, 1))")
    }

    /// coarsen: every channel rounded to `step` hundredths, entries that then change nothing dropped (a shorter link).
    public static let COARSE_STEPS = [5, 10, 25]
    public static func coarsen(_ log: [[Int]], step: Int) -> [[Int]] {
        var out: [[Int]] = [], prev: [Int]? = nil
        for e in log {
            var q = [e.first ?? 0]
            for c in e.indices.dropFirst() { q.append(Int(jsRound(Double(e[c]) / Double(step)) * Double(step))) }
            if let p = prev, p.count == q.count, q.indices.allSatisfy({ $0 == 0 || q[$0] == p[$0] }) { continue }
            out.append(q); prev = q
        }
        return out
    }
}

/// `Math.round` to an Int-able Double (jsRound, but for a value we then clamp and convert).
@inline(__always) func jsRoundD(_ x: Double) -> Double { x.isFinite ? jsRound(x) : 0 }

/// encodeURIComponent: UTF-8, every byte but A–Z a–z 0–9 - _ . ! ~ * ' ( ) percent-encoded in upper-case hex.
public func encodeURIComponent(_ s: String) -> String {
    var out = ""
    for b in s.utf8 {
        switch b {
        case 0x41...0x5A, 0x61...0x7A, 0x30...0x39, 0x2D, 0x5F, 0x2E, 0x21, 0x7E, 0x2A, 0x27, 0x28, 0x29: out.append(Character(Unicode.Scalar(b)))
        default: out += String(format: "%%%02X", b)
        }
    }
    return out
}
