// 0253: every link shape the web makes routes to the right screen, over the challenge vectors (src/challenge.js's own
// payloads): a universal link and the coldgas:// fallback, `#vs=` alone, a stale SIM_VERSION, junk, the 12,000-char cap.
import XCTest
import Foundation
@testable import ColdGasClient

final class ChallengeLinkTests: XCTestCase {
    private func json() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Vectors/challenge.json")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testEveryVectorCaseOpensItsChallengeByEitherDoor() throws {
        let j = try json()
        let sim = try XCTUnwrap(j["simVersion"] as? Int)
        let cases = try XCTUnwrap(j["cases"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 5)
        for c in cases {
            guard let p = c["payload"] as? String, let course = c["course"] as? String, (c["simVersion"] as? Int) == sim else { continue }
            let web = Challenge.url(base: "https://mutaafaziz.com/coldgas/", course: course, payload: p)
            for s in [web, web.replacingOccurrences(of: "https://mutaafaziz.com/coldgas/", with: "coldgas://play/"),
                      "https://mutaafaziz.com/coldgas/#vs=\(p)", "https://www.mutaafaziz.com/coldgas#vs=\(p)"] {
                let u = try XCTUnwrap(URL(string: s), s)
                guard case let .challenge(run) = ChallengeLink.route(u, simVersion: sim) else { XCTFail("\(c["name"] ?? "") \(s.prefix(60))"); continue }
                // What the web's decoder makes of it (scores and tiers clamped as it clamps them).
                let d = c["decoded"] as? [String: Any] ?? c
                XCTAssertEqual(run.course, d["course"] as? String ?? course)
                XCTAssertEqual(run.score, (d["score"] as? NSNumber)?.doubleValue ?? -1, accuracy: 0.05)
                XCTAssertEqual(run.tier, d["tier"] as? String)
            }
        }
    }

    func testStaleJunkPlainAndForeignLinks() throws {
        let j = try json()
        let sim = try XCTUnwrap(j["simVersion"] as? Int)
        let cases = try XCTUnwrap(j["cases"] as? [[String: Any]])
        let first = try XCTUnwrap(cases.first { ($0["payload"] as? String) != nil })
        let p = try XCTUnwrap(first["payload"] as? String), course = try XCTUnwrap(first["course"] as? String)
        // Another SIM_VERSION: stale, on its course.
        XCTAssertEqual(ChallengeLink.route(URL(string: "https://mutaafaziz.com/coldgas/?play=jump&course=\(course)#vs=\(p)")!, simVersion: sim + 1),
                       .stale(course: course))
        // Every reject in the vectors is a bad link, keeping the course the query names.
        for r in try XCTUnwrap(j["rejects"] as? [[String: Any]]) {
            guard let rp = r["payload"] as? String, !rp.isEmpty, let u = URL(string: "https://mutaafaziz.com/coldgas/?play=jump&course=wall#vs=\(rp)") else { continue }
            XCTAssertEqual(ChallengeLink.route(u, simVersion: sim), .bad(course: "wall"), "\(r["name"] ?? "")")
        }
        // Past the cap.
        let long = "z" + String(repeating: "A", count: Challenge.VS_MAX_CHARS + 10)
        XCTAssertEqual(ChallengeLink.route(URL(string: "https://mutaafaziz.com/coldgas/#vs=\(long)")!, simVersion: sim), .bad(course: nil))
        XCTAssertEqual(ChallengeLink.route(URL(string: "https://mutaafaziz.com/coldgas/?play=jump&course=lineup")!, simVersion: sim), .play(course: "lineup"))
        XCTAssertEqual(ChallengeLink.route(URL(string: "coldgas://play?course=moon")!, simVersion: sim), .play(course: nil))
        XCTAssertEqual(ChallengeLink.route(URL(string: "https://mutaafaziz.com/metaphases/#vs=\(p)")!, simVersion: sim), .none)
        XCTAssertEqual(ChallengeLink.route(URL(string: "https://example.com/coldgas/#vs=\(p)")!, simVersion: sim), .none)
        XCTAssertEqual(ChallengeLink.route(URL(string: "https://mutaafaziz.com/coldgasx/#vs=\(p)")!, simVersion: sim), .none)
    }
}
