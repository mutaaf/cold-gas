// 0300: a session's performance summary and feature use, carried in the existing `/obs` batch. The meter takes the web's
// histogram (src/obs/frames.js EDGES), shrugs off NaN, infinity and an app that was away, and never grows; a summary needs
// enough frames to say something; its words survive the Worker's normalisation; and a batch carrying it is still one the
// Worker takes (tests/fixtures/obs-ios-session.json, which tests/unit/obs-native.test.js feeds to cleanObs).
import Foundation
import Testing
@testable import ColdGasClient

@Suite struct PerfTests {
    static let build = "ios-1.2.0-202611181400"

    @Test func bucketsAndPercentilesAreTheWebs() {
        #expect(Perf.EDGES.count + 1 == Perf.NB)
        #expect(Perf.bucket(6) == 0); #expect(Perf.bucket(6.01) == 1); #expect(Perf.bucket(8.3) == 1)
        #expect(Perf.bucket(16.7) == 4); #expect(Perf.bucket(33.4) == 7); #expect(Perf.bucket(999) == 12)
        // node -e "import('./src/obs/frames.js').then(m => console.log(m.percentile([0,90,0,0,10,0,0,0,0,0,0,0,0], .5), …))"
        let h = [0, 90, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0]
        #expect(Perf.percentile(h, 0.5) == 7.7)
        #expect(Perf.percentile(h, 0.95) == 16.3)
        #expect(Perf.percentile([Int](repeating: 0, count: 13), 0.95) == 0)
    }

    @Test func theMeterCountsFramesHitchesAndWindows() {
        var m = Perf.Meter()
        for _ in 0..<1200 { m.frame(ms: 8.33, cadence: 120, scale: 1, look: 0) }
        for _ in 0..<5 { m.frame(ms: 60, cadence: 120, scale: 0.8, look: 1) }   // five hitches
        m.frame(ms: 150, cadence: 60, scale: 0.8, look: 1)                        // a hitch that lost sim time
        #expect(m.frames == 1206); #expect(m.hitches == 6); #expect(m.drop == 1)
        #expect(m.hist[1] == 1200); #expect(m.hist[9] == 5); #expect(m.hist[11] == 1)
        #expect(m.at120 == 1205)
        #expect(m.low == 0)
        var slow = Perf.Meter()
        for _ in 0..<120 { slow.frame(ms: 40, cadence: 60, scale: 1, look: 2) }   // 4.8 s under 30 fps: two windows
        #expect(slow.low == 2)
    }

    @Test func nonsenseNeverReachesTheMeter() {
        var m = Perf.Meter()
        for bad in [Double.nan, .infinity, -.infinity, -5, 0, 1000, 86_400_000] { m.frame(ms: bad, cadence: 120, scale: 1, look: 0) }
        #expect(m.frames == 0); #expect(m.hist.reduce(0, +) == 0)
        m.frame(ms: 8, cadence: 120, scale: .nan, look: 7)                // a bad scale and look cost only themselves
        m.frame(ms: 8, cadence: 120, scale: .infinity, look: -1)
        #expect(m.frames == 2); #expect(m.scaleSum == 0); #expect(m.looks == [0, 0, 0])
        m.thermal(-4); m.thermal(99); #expect(m.thermalPeak == 3)
        m.launch(ms: .nan); m.launch(ms: -1); m.launch(ms: 9e9); #expect(m.launchMs == nil)
        m.launch(ms: 1234.4); m.launch(ms: 99); #expect(m.launchMs == 1234)   // once per launch
        m.memory(bytes: .max); #expect(m.memPeakMB == 1_000_000)
    }

    @Test func theMeterIsBoundedAndASummaryNeedsFrames() {
        var m = Perf.Meter()
        #expect(m.summary(build: PerfTests.build) == nil)
        for _ in 0..<(Perf.MIN_FRAMES - 1) { m.frame(ms: 8, cadence: 120, scale: 1, look: 0) }
        #expect(m.summary(build: PerfTests.build) == nil)
        m.frame(ms: 8, cadence: 120, scale: 1, look: 0)
        #expect(m.summary(build: PerfTests.build) != nil)
        // A session that never ends stops counting at the Worker's cap: the histogram never grows past it.
        var big = Perf.Meter()
        for _ in 0..<(Perf.MAX_FRAMES + 50) { big.frame(ms: 8, cadence: 120, scale: 1, look: 0) }
        #expect(big.frames == Perf.MAX_FRAMES); #expect(big.hist.count == Perf.NB)
        big.reset(); #expect(big == Perf.Meter())
    }

    static func session() -> Perf.Meter {
        var m = Perf.Meter()
        for i in 0..<2400 { m.frame(ms: i % 100 == 0 ? 16.6 : 8.33, cadence: 120, scale: 1, look: i < 600 ? 0 : 1) }
        for _ in 0..<3 { m.frame(ms: 70, cadence: 120, scale: 0.9, look: 1) }
        m.thermal(1); m.memory(bytes: 612 * 1_048_576); m.launch(ms: 1840); m.run(); m.run()
        return m
    }

    @Test func aSummaryIsSaidInWordsTheWorkerKeeps() throws {
        let s = try #require(PerfTests.session().summary(build: PerfTests.build))
        #expect(s.look == "anime")
        #expect(s.message == "perf p50_9 p95_9 hitch_lt5 hz120 look_anime scale_100 heat_fair mem_lt800 launch_lt2s")
        #expect(Obs.normMessage(s.message) == s.message)   // nothing folds to N: the buckets survive the Worker's normalisation
        var u = Perf.Use()
        #expect(u.message == nil)
        for f in [Perf.Feature.roamChallenge, .lookPixel, .driftOff, .roam, .roamChallenge] { u.note(f) }
        #expect(u.message == "use look_pixel drift_off roam roamch")   // a flag each, in a fixed order
        var all = Perf.Use(); for f in Perf.Feature.allCases { all.note(f) }
        #expect(Obs.normMessage(all.message ?? "") == all.message)
        #expect((all.message ?? "").utf16.count <= 160)
        #expect(Perf.frame("perf", build: PerfTests.build) == "perf@ios-1.2.0-202611181400")
        let fr = s.fr
        #expect((fr["h"] as? [Int])?.count == 13); #expect(fr["n"] as? Int == 2403); #expect(fr["hitch"] as? Int == 3)
    }

    @Test func aSessionRidesTheQueueAndSurvivesAnUpdate() throws {
        var q = Obs.Queue()
        q.add(session: Obs.Session(build: PerfTests.build, perf: nil, use: Perf.Use()))   // nothing to say: not kept
        #expect(q.isEmpty)
        var u = Perf.Use(); u.note(.lookAnime); u.note(.club)
        q.add(session: Obs.Session(build: PerfTests.build, perf: PerfTests.session().summary(build: PerfTests.build), use: u))
        #expect(!q.isEmpty)
        // A queue saved before 0300 (no `sessions`) still reads, faults and all.
        let old = Data(#"{"entries":[],"rec":[{"kind":"webgl","ok":true}],"dropped":0}"#.utf8)
        #expect(Obs.Queue.decode(old).rec.count == 1)
        #expect(Obs.Queue.decode(q.encoded()) == q)
        let b = try #require(q.next(currentBuild: PerfTests.build))
        let j = try #require(try JSONSerialization.jsonObject(with: b.body) as? [String: Any])
        let errs = try #require(j["errs"] as? [[String: Any]])
        #expect(errs.map { $0["fr"] as? String } == ["perf@ios-1.2.0-202611181400", "use@ios-1.2.0-202611181400"])
        #expect((j["fr"] as? [String: Any])?["n"] as? Int == 2403)
        #expect(j["first"] as? Bool == false)   // never a session in the digest's sense: the web's current build stays the web's
        q.sent(b)
        #expect(q.isEmpty)
        // Capped: a phone offline for weeks keeps the newest few.
        for _ in 0..<20 { q.add(session: Obs.Session(build: PerfTests.build, perf: nil, use: u)) }
        #expect(q.sessions?.count == Obs.MAX_SESSIONS)
    }

    /// The fixture both sides hold: tests/unit/obs-native.test.js feeds it to the Worker's cleanObs.
    @Test func theSessionFixtureIsWhatTheQueueBuilds() throws {
        var q = Obs.Queue()
        var u = Perf.Use(); for f in [Perf.Feature.lookAnime, .absOff, .handbrake, .roam, .roamChallenge, .club] { u.note(f) }
        q.add(session: Obs.Session(build: PerfTests.build, perf: PerfTests.session().summary(build: PerfTests.build), use: u))
        q.add(.render, .shader, message: "pipeline cg_glow failed", frame: "pipeline@Renderer.swift:1010:0", build: PerfTests.build)
        let b = try #require(q.next(currentBuild: PerfTests.build))
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../../tests/fixtures/obs-ios-session.json").standardizedFileURL
        if ProcessInfo.processInfo.environment["OBS_FIXTURE_WRITE"] == "1" { try b.body.write(to: url) }
        let want = try Data(contentsOf: url)
        #expect(String(decoding: b.body, as: UTF8.self) == String(decoding: want, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
