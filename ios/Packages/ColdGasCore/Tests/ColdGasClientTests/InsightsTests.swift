// 0246: the app's usage events. The vocabulary is the web's (0245), props are numbers and enums only, nothing is queued
// while a run counts down, flies or plays back, off clears everything, and the queue survives a relaunch, caps itself and
// keeps what a failed send didn't deliver.
import XCTest
import Foundation
@testable import ColdGasClient

final class InsightsTests: XCTestCase {
    func testVocabularyIsTheWebsAndPropsAreNumbersOrEnums() {
        XCTAssertEqual(Set(Insights.EVENTS.keys), ["session_start", "first_input", "jump_start", "jump_end", "first_landing",
                                                   "share_tap", "share_done", "challenge_open", "challenge_play", "license_pass"])
        // Nothing that could carry a person: no initials, names, ids or free text among the props.
        for (_, props) in Insights.EVENTS {
            for (k, _) in props { XCTAssertFalse(["initials", "name", "id", "text", "url", "log"].contains(k), k) }
        }
        XCTAssertNil(Insights.clean("page_view", [:]))
        let c = Insights.clean("jump_end", ["n": .num(2), "course": .text("show"), "tier": .text("pro"), "landed": .num(1),
                                            "score": .num(82.4), "initials": .text("ABC"), "course2": .num(1)])
        XCTAssertEqual(c, ["n": .num(2), "course": .text("show"), "tier": .text("pro"), "landed": .num(1), "score": .num(82.4)])
        // Out of range, the wrong type or not one of the values: dropped.
        XCTAssertEqual(Insights.clean("jump_start", ["n": .num(9), "course": .text("moon"), "tier": .num(1)]), [:])
        XCTAssertEqual(Insights.clean("first_input", ["ms_since_load": .num(.nan)]), [:])
        XCTAssertEqual(Insights.nBucket(0), 1); XCTAssertEqual(Insights.nBucket(2), 2); XCTAssertEqual(Insights.nBucket(40), 3)
    }

    /// 0245 generates the web's vocabulary into the vectors (`npm run vectors`). Once it's there, every name and prop the app
    /// sends must be one the web has.
    func testParityWithTheWebsVocabularyFile() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Vectors/events.json")
        guard let d = try? Data(contentsOf: url) else { throw XCTSkip("Vectors/events.json not generated yet (0245)") }
        let j = try JSONSerialization.jsonObject(with: d)
        var web: [String: Set<String>] = [:]
        func props(_ v: Any?) -> Set<String> {
            if let o = v as? [String: Any] { return Set((o["props"] as? [String: Any]).map { Array($0.keys) } ?? Array(o.keys)) }
            if let a = v as? [String] { return Set(a) }
            return []
        }
        let root = (j as? [String: Any])?["events"] ?? j
        if let o = root as? [String: Any] { for (k, v) in o { web[k] = props(v) } }
        if let a = root as? [[String: Any]] { for e in a { if let n = e["name"] as? String { web[n] = props(e["props"]) } } }
        XCTAssertFalse(web.isEmpty, "events.json read as nothing: its shape changed")
        for (name, spec) in Insights.EVENTS {
            guard let w = web[name] else { XCTFail("\(name) isn't in the web's vocabulary"); continue }
            for p in spec.keys { XCTAssertTrue(w.contains(p), "\(name).\(p) isn't a web prop") }
        }
    }

    func testNothingIsQueuedDuringACountdownARunOrAReplay() {
        var q = Insights.Queue()
        for m in [Insights.Moment.countdown, .run, .replay] {
            XCTAssertTrue(q.add("first_input", ["ms_since_load": .num(900)], at: 1, moment: m, on: true))
            XCTAssertTrue(q.events.isEmpty, "\(m)")
            XCTAssertTrue(q.next(moment: m, on: true).isEmpty)
        }
        XCTAssertEqual(q.held.count, 3)
        q.release()
        XCTAssertEqual(q.events.count, 3); XCTAssertTrue(q.held.isEmpty)
        XCTAssertEqual(q.next(moment: .results, on: true).count, 3)
        XCTAssertTrue(q.next(moment: .run, on: true).isEmpty)
    }

    func testOffSendsNothingAndClearsTheQueueAndTheId() {
        var q = Insights.Queue()
        XCTAssertFalse(q.add("session_start", [:], at: 1, moment: .title, on: false))
        XCTAssertNil(q.installId)
        q.add("session_start", ["returning": .num(0)], at: 1, moment: .title, on: true)
        q.add("jump_start", ["n": .num(1)], at: 2, moment: .run, on: true)
        let id = q.installId
        XCTAssertNotNil(id); XCTAssertNotNil(UUID(uuidString: id ?? ""))
        XCTAssertTrue(q.next(moment: .title, on: false).isEmpty)
        q.clear()
        XCTAssertTrue(q.events.isEmpty); XCTAssertTrue(q.held.isEmpty); XCTAssertNil(q.installId)
        q.add("session_start", [:], at: 3, moment: .title, on: true)
        XCTAssertNotEqual(q.installId, id, "a new id once it's on again")
    }

    func testTheQueueSurvivesARelaunchCapsItselfAndKeepsAFailedSend() throws {
        var q = Insights.Queue()
        for i in 0..<(Insights.QUEUE_CAP + 20) { q.add("first_input", ["ms_since_load": .num(Double(i))], at: Double(i), moment: .title, on: true) }
        XCTAssertEqual(q.events.count, Insights.QUEUE_CAP)
        XCTAssertEqual(q.events.first?.props["ms_since_load"], .num(20), "the oldest go first")
        q.add("jump_start", [:], at: 9999, moment: .run, on: true)   // held: not saved, a run in flight at a relaunch is lost
        let back = Insights.Queue.decode(q.encoded())
        XCTAssertEqual(back.events, q.events); XCTAssertEqual(back.installId, q.installId); XCTAssertTrue(back.held.isEmpty)
        XCTAssertEqual(Insights.Queue.decode(Data("junk".utf8)), Insights.Queue())
        // A batch that failed is still there; one that went is gone, and what arrived meanwhile stays.
        var r = back
        let batch = r.next(moment: .title, on: true)
        XCTAssertEqual(batch.count, Insights.BATCH_MAX)
        XCTAssertEqual(r.next(moment: .title, on: true), batch, "unsent: the same batch next time")
        r.add("session_start", [:], at: 10_000, moment: .title, on: true)
        r.sent(batch)
        XCTAssertEqual(r.events.count, Insights.QUEUE_CAP - Insights.BATCH_MAX + 1)
        XCTAssertEqual(r.events.last?.name, "session_start")
    }

    func testTheBatchIsPostHogsShapeWithTheAppsProps() throws {
        var q = Insights.Queue()
        q.add("jump_end", ["n": .num(1), "course": .text("wall"), "tier": .text("assist"), "landed": .num(1), "score": .num(71.2)],
              at: 1_763_000_000_000, moment: .results, on: true)
        let body = try XCTUnwrap(Insights.body(q.events, installId: "abc", release: "1.2.0"))
        let j = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(j["api_key"] as? String, Insights.token)
        let e = try XCTUnwrap((j["batch"] as? [[String: Any]])?.first)
        XCTAssertEqual(e["event"] as? String, "jump_end")
        XCTAssertNotNil(e["timestamp"] as? String)
        let p = try XCTUnwrap(e["properties"] as? [String: Any])
        XCTAssertEqual(p["distinct_id"] as? String, "abc")
        XCTAssertEqual(p["platform"] as? String, "ios")
        XCTAssertEqual(p["surface"] as? String, "app")
        XCTAssertEqual(p["app"] as? String, "cold-gas")
        XCTAssertEqual(p["release"] as? String, "1.2.0")
        XCTAssertEqual(p["$geoip_disable"] as? Bool, true)
        XCTAssertEqual(p["score"] as? Double, 71.2)
        XCTAssertEqual(p["course"] as? String, "wall")
        XCTAssertTrue(Insights.endpoint.hasPrefix("https://mutaafaziz.com/boxoffice/e/"))
        XCTAssertEqual(Insights.referer, "https://mutaafaziz.com/coldgas/")
    }

    func testTheCountersOnThisDevice() {
        var p = Progress()
        XCTAssertTrue(p.firstRun)
        let day: Double = 86_400_000
        XCTAssertEqual(p.startSession(at: 100 * day), ["returning": .num(0), "days_since_last": .num(0)])
        XCTAssertEqual(p.startSession(at: 103 * day + 5), ["returning": .num(1), "days_since_last": .num(3)])
        XCTAssertEqual(p.startJump(), 1)
        XCTAssertFalse(p.endJump(landed: false, at: 0))
        XCTAssertTrue(p.firstRun)
        XCTAssertEqual(p.startJump(), 2)
        XCTAssertTrue(p.endJump(landed: true, at: 104 * day))
        XCTAssertFalse(p.firstRun)
        XCTAssertEqual(p.firstLandingJump, 2); XCTAssertEqual(p.firstLandingDay, 104)
        _ = p.startJump()
        XCTAssertFalse(p.endJump(landed: true, at: 105 * day), "only the first landing is the first")
        XCTAssertEqual(p.landingCount, 2)
        // In the save: an old save has none, a damaged field costs only itself.
        var s = SaveData(); s.progress = p
        XCTAssertEqual(SaveData.decode(s.encoded()).counters, p)
        let bad = SaveData.decode(Data(#"{"progress":{"jumps":"x","landings":4},"settings":{"usage":false}}"#.utf8))
        XCTAssertEqual(bad.counters.landingCount, 4); XCTAssertEqual(bad.counters.jumpCount, 0)
        XCTAssertFalse(bad.resolvedSettings.usageOn)
        XCTAssertTrue(SaveData().resolvedSettings.usageOn)
    }
}
