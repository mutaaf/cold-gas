// 0152: the Swift sim replays every run vector (Tests/Vectors/runs/*.json, `npm run vectors` from src/sim) to the same
// bits: every 24-tick state hash, every full state, the final hash and the telemetry. On a miss it names the tick, the
// field and both bit patterns.
#if canImport(CRapier)
import Foundation
import Testing
@testable import ColdGasPhysics
@testable import ColdGasCore

let vectorsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Vectors")
func runNames() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: vectorsDir.appendingPathComponent("runs").path)) ?? []).filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
}
struct RunVector {
    let name, course: String, simVersion: Int, ticks: Int
    let log: [[Int]]
    let checks: [(Int, String)], full: [(Int, [String])], final: String
    let fields: [String]
    let telemetry: [(String, String, Any?)], card: [(String, String, Any?)]
    init(_ name: String) {
        let d = try! Data(contentsOf: vectorsDir.appendingPathComponent("runs/\(name).json"))
        let j = try! JSONSerialization.jsonObject(with: d) as! [String: Any]
        self.name = name
        course = j["course"] as! String; simVersion = j["simVersion"] as! Int; ticks = j["ticks"] as! Int
        log = (j["log"] as! [[NSNumber]]).map { $0.map(\.intValue) }
        checks = (j["checks"] as! [[Any]]).map { ($0[0] as! Int, $0[1] as! String) }
        full = (j["full"] as! [[Any]]).map { ($0[0] as! Int, $0[1] as! [String]) }
        final = j["final"] as! String
        fields = j["fields"] as! [String]
        telemetry = (j["telemetry"] as! [[Any]]).map { ($0[0] as! String, $0[1] as! String, $0.count > 2 ? $0[2] : nil) }
        card = (j["card"] as! [[Any]]).map { ($0[0] as! String, $0[1] as! String, $0.count > 2 ? $0[2] : nil) }
    }
}
func hex64(_ x: Double) -> String { if x.isNaN { return "7ff8000000000000" }; let s = String(x.bitPattern, radix: 16); return String(repeating: "0", count: 16 - s.count) + s }
func hex32(_ a: UInt32, _ b: UInt32) -> String { func h(_ v: UInt32) -> String { let s = String(v, radix: 16); return String(repeating: "0", count: 8 - s.count) + s }; return h(a) + h(b) }
func stateOf(_ run: Run) -> [Double] {
    let c = run.car, w = c.wheels
    return [c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.vel.x, c.vel.y, c.vel.z,
            c.angVel.x, c.angVel.y, c.angVel.z, c.angMom.x, c.angMom.y, c.angMom.z, c.air,
            Double(run.phase.rawValue), w[0].contact ? 1 : 0, w[1].contact ? 1 : 0, w[2].contact ? 1 : 0, w[3].contact ? 1 : 0]
}
/// scripts/vectors-lib.mjs mixState: two 32-bit lanes over each double's big-endian words.
func mixState(_ h: inout (UInt32, UInt32), _ vals: [Double]) {
    var (a, b) = h
    for v in vals {
        let bits = v.isNaN ? 0x7ff8000000000000 : v.bitPattern
        for wd in [UInt32(truncatingIfNeeded: bits >> 32), UInt32(truncatingIfNeeded: bits)] {
            a = (a ^ wd) &* 16777619
            b = (b ^ wd) &* 0x5bd1e995; b = b ^ (b >> 15)
        }
    }
    h = (a, b)
}

struct Replay { let checks: [Int: String]; let full: [Int: [Double]]; let final: String; let run: Run }
func replay(_ v: RunVector) throws -> Replay {
    var h: (UInt32, UInt32) = (0x811c9dc5, 0x9747b28c)
    var checks: [Int: String] = [:], full: [Int: [Double]] = [:]
    let run = try simulate(v.log, v.course) { r in
        let s = stateOf(r)
        mixState(&h, s)
        if r.tick % 24 == 0 { checks[r.tick] = hex32(h.0, h.1) }
        if r.tick % 240 == 0 { full[r.tick] = s }
    }
    return Replay(checks: checks, full: full, final: hex32(h.0, h.1), run: run)
}
/// The first place the replay leaves the JS's path, in words.
func firstMiss(_ v: RunVector, _ r: Replay) -> String? {
    for (tick, want) in v.checks where r.checks[tick] != want {
        let prior = v.full.last { $0.0 <= tick }
        var where_ = "state hash at tick \(tick) (JS \(want), Swift \(r.checks[tick] ?? "none"))"
        if let (ft, wantFull) = prior, let got = r.full[ft] {
            let diffs = wantFull.indices.filter { hex64(got[$0]) != wantFull[$0] }.map { "\(v.fields[$0]) JS \(wantFull[$0]) Swift \(hex64(got[$0]))" }
            where_ += diffs.isEmpty ? "; the full state at tick \(ft) still matched" : "; at tick \(ft): " + diffs.prefix(4).joined(separator: ", ")
        }
        return where_
    }
    return nil
}

func compare(_ want: [(String, String, Any?)], _ gotList: [(String, Value)], _ what: String) -> [String] {
    let got = Dictionary(uniqueKeysWithValues: gotList.map { ($0.0, $0.1) })
    var bad: [String] = []
    for (path, kind, val) in want {
        guard let g = got[path] else { bad.append("\(what) \(path): missing"); continue }
        switch (kind, g) {
        case ("n", .n(let x)): if hex64(x) != (val as! String) { bad.append("\(what) \(path) JS \(val!) Swift \(hex64(x))") }
        case ("b", .b(let x)): if x != (val as! Bool) { bad.append("\(what) \(path) JS \(val!) Swift \(x)") }
        case ("s", .s(let x)): if x != (val as! String) { bad.append("\(what) \(path) JS \(val!) Swift \(x)") }
        case ("z", .z): break
        default: bad.append("\(what) \(path): kind \(kind) vs \(g)")
        }
    }
    let extra = Set(got.keys).subtracting(want.map(\.0))
    if !extra.isEmpty { bad.append("\(what) has fields the JS hasn't: \(extra.sorted().prefix(4))") }
    return bad
}

@Suite("The Swift sim flies the JS sim's runs bit for bit", .serialized)
struct RunVectorTests {
    @Test("run vector", arguments: runNames())
    func runVector(_ name: String) throws {
        let v = RunVector(name)
        #expect(v.simVersion == SIM_VERSION, "SIM_VERSION: vectors \(v.simVersion), Swift \(SIM_VERSION)")
        let r: Replay
        do { r = try replay(v) } catch let e as SimUnsupported { Issue.record("\(name): \(e)"); return }
        if let miss = firstMiss(v, r) { Issue.record("\(name): \(miss)"); return }
        #expect(r.run.tick == v.ticks)
        #expect(r.final == v.final)
        var bad = compare(v.telemetry, r.run.t.flat(), "telemetry")
        bad += compare(v.card, scoreRun(r.run.t).flat, "card")
        #expect(bad.isEmpty, "\(name): \(bad.prefix(6).joined(separator: "; "))")
    }
}
#endif

#if canImport(CRapier)
@Suite("HapticScore fed by the Swift sim feels what it felt fed by the JS sim", .serialized)
struct NativeHapticsTests {
    @Test(arguments: ["ref-show", "ref-wall", "crash-show-carry5", "crash-lineup-rolls2"])
    func sameTrack(_ name: String) throws {
        let v = RunVector(name)
        let (_, feed) = try simulateWithFeed(v.log, v.course)
        let jsData = try Data(contentsOf: vectorsDir.appendingPathComponent("haptics/\(name).json"))
        let js = HapticFeed.load(jsData)!
        func events(_ f: [HapticFeed]) -> [String] {
            var s = HapticScore(course: v.course), out: [String] = []
            for t in f { s.step(t); s.drain { out.append("\($0.kind)@\($0.tick)/\($0.channel)") } }
            return out
        }
        #expect(feed.count == js.ticks.count)
        #expect(events(feed) == events(js.ticks))
    }
    @Test func vectorTraceChecksARun() throws {
        let r = try VectorTrace.check(Data(contentsOf: vectorsDir.appendingPathComponent("runs/ref-show.json")))
        #expect(r.ok, "final \(r.final) want \(r.want), total \(r.total) want \(r.wantTotal)")
    }
}
#endif
