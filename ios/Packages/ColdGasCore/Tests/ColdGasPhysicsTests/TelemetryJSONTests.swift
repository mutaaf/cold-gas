// 0154: what the board and the judges receive is what the web sends. For every run vector the Swift sim's telemetry
// serialises to exactly the bytes of JSON.stringify(run.t) from the JS sim (Tests/Vectors/client.json), Infinity → null
// included; the request bodies match byte for byte; and the sim's own card speaks the same local lines as the JS.
#if canImport(CRapier)
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasClient

let clientVectors: JSValue = JSValue.parse(try! Data(contentsOf: vectorsDir.appendingPathComponent("client.json")))!
func logOf(_ name: String) -> (log: [[Int]], course: String) {
    let v = JSValue.parse(try! Data(contentsOf: vectorsDir.appendingPathComponent("runs/\(name).json")))!
    return ((v["log"]?.arrayValue ?? []).map { ($0.arrayValue ?? []).map { Int($0.numberValue ?? 0) } }, v["course"]?.stringValue ?? "")
}

@Suite(.serialized) struct TelemetryJSONTests {
    @Test func everyRunsTelemetrySerialisesAsTheWebs() throws {
        let rows = clientVectors["telemetry"]?.arrayValue ?? []
        #expect(rows.count == 52)
        var nulls = 0
        for row in rows {
            let a = row.arrayValue!, name = a[0].stringValue!, want = a[1].stringValue!
            let (log, course) = logOf(name)
            let run = try simulate(log, course)
            let got = run.t.json.json
            #expect(got == want, "\(name): the telemetry's JSON differs")
            if got.contains("\"minClearance\":null") { nulls += 1 }
        }
        #expect(nulls > 0, "no run exercised Infinity → null")
    }
    @Test func theBodiesMatchByteForByte() throws {
        let bodies = Dictionary(uniqueKeysWithValues: (clientVectors["bodies"]?.arrayValue ?? []).map { ($0.arrayValue![0].stringValue!, $0.arrayValue![1].stringValue!) })
        let (log, course) = logOf("ref-lineup")
        let run = try simulate(log, course), t = run.t.json
        #expect(RequestBody.post(log: log, t: t, initials: "ABC", course: course).json == bodies["post"])
        #expect(RequestBody.dry(log: log, t: t, course: course).json == bodies["dry"])
        #expect(RequestBody.judges(log: log, t: t, assist: true, course: course).json == bodies["judges"])
    }
    @Test func theSimsCardSpeaksTheSameLocalLines() throws {
        let want = Dictionary((clientVectors["words"]?.arrayValue ?? []).map { ($0.arrayValue![0].stringValue!, $0.arrayValue![3]) }, uniquingKeysWith: { a, _ in a })
        for name in ["ref-show", "ref-wall", "ref-lineup", "crash-show-carry5", "crash-wall-early", "crash-lineup-rolls2", "pro-fuzz-0", "naive-show-4-0.85-0"] {
            let (log, course) = logOf(name)
            let run = try simulate(log, course)
            let card = try #require(scoreRun(run.t).scoreCard, "\(name): no card")
            let w = localWords(card), j = try #require(want[name])
            #expect(w.headline == j["headline"]?.stringValue, "\(name)")
            #expect(w.engineer == j["engineer"]?.stringValue, "\(name)")
            #expect(w.coordinator == j["coordinator"]?.stringValue, "\(name)")
            #expect(w.designer == j["designer"]?.stringValue, "\(name)")
            #expect(card.judges?.count == 3)
        }
    }
}
#endif
