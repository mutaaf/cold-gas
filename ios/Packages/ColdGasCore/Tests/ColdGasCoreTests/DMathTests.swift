// 0147: DMath.swift against Tests/Vectors/dmath.json (written by `npm run vectors` from src/sim/dmath.js).
// Bit for bit: compared as IEEE 754 bit patterns, never with a tolerance. (Any NaN equals any NaN: a
// NaN's payload is not part of JS's semantics, and DataView may write either sign.)
import Foundation
import Testing
@testable import ColdGasCore

func vectorURL(_ name: String) -> URL {
    Bundle.module.url(forResource: "Vectors/\(name)", withExtension: nil)!
}
func bits(_ hex: String) -> Double { Double(bitPattern: UInt64(hex, radix: 16)!) }
func hex(_ x: Double) -> String { let s = String(x.bitPattern, radix: 16); return String(repeating: "0", count: 16 - s.count) + s }
func same(_ a: Double, _ b: Double) -> Bool { (a.isNaN && b.isNaN) || a.bitPattern == b.bitPattern }

struct DMathVectors {
    let functions: [(name: String, args: Int, cases: [[String]])]
    static let shared: DMathVectors = {
        let data = try! Data(contentsOf: vectorURL("dmath.json"))
        let json = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        let fs = (json["functions"] as! [[String: Any]]).map { f in
            (name: f["name"] as! String, args: f["args"] as! Int, cases: f["cases"] as! [[String]])
        }
        return DMathVectors(functions: fs)
    }()
}

@Suite("DMath matches src/sim/dmath.js bit for bit")
struct DMathTests {
    static let impl: [String: ([Double]) -> Double] = [
        "dsin": { DMath.dsin($0[0]) }, "dcos": { DMath.dcos($0[0]) },
        "dsin_wide": { DMath.dsin($0[0]) }, "dcos_wide": { DMath.dcos($0[0]) },
        "datan": { DMath.datan($0[0]) }, "datan2": { DMath.datan2($0[0], $0[1]) },
        "dacos": { DMath.dacos($0[0]) }, "dhypot2": { DMath.dhypot($0[0], $0[1]) },
        "dhypot3": { DMath.dhypot($0[0], $0[1], $0[2]) },
        "dexp": { DMath.dexp($0[0]) }, "dlog": { DMath.dlog($0[0]) },
    ]

    @Test("every function and every case", arguments: DMathVectors.shared.functions.map(\.name))
    func function(_ name: String) throws {
        let f = try #require(DMathVectors.shared.functions.first { $0.name == name })
        let fn = try #require(Self.impl[name], "no Swift port for \(name)")
        var misses: [String] = []
        for c in f.cases {
            let args = c.prefix(f.args).map(bits), want = bits(c[f.args])
            let got = fn(args)
            if !same(got, want) && misses.count < 5 { misses.append("\(name)(\(c.prefix(f.args).joined(separator: ", "))) = \(hex(got)), JS \(c[f.args])") }
        }
        #expect(misses.isEmpty, "\(misses.joined(separator: "\n"))")
        #expect(f.cases.count >= 5000)
    }

    @Test func jsRoundMatchesMathRound() {
        #expect(jsRound(-2.5) == -2)
        #expect(jsRound(2.5) == 3)
        #expect(jsRound(0.49999999999999994) == 0)
        #expect(jsRound(-0.4).sign == .minus && jsRound(-0.4) == 0)
        #expect(jsRound(-0.5).sign == .minus && jsRound(-0.5) == 0)
        #expect(jsRound(4503599627370497) == 4503599627370497)
    }
    @Test func jsMaxMinFollowJS() {
        #expect(jsMax(0, .nan).isNaN)
        #expect(jsMax(-0.0, 0).sign == .plus)
        #expect(jsMin(-0.0, 0).sign == .minus)
        #expect(jsRem(-7, 4) == -3)
    }
    @Test func xorshiftMatchesTheGenerator() {
        // scripts/vectors-lib.mjs xorshift(42)'s first value (pinned in tests/unit/vectors.test.js too).
        var s: UInt32 = 42
        s ^= s << 13; s ^= s >> 17; s ^= s << 5
        #expect(s == 11355432)
    }
}
