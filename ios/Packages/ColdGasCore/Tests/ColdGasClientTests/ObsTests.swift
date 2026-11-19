// 0293: the app's health reports are the web's `/obs` batches. The signatures hash as src/obs/signature.js does (values
// from Node), the queue dedupes, caps and trims to the Worker's 8 kB, and MetricKit's JSON maps to entries that carry
// nothing about the device. tests/fixtures/obs-ios-batch.json is the batch built here, byte for byte, and
// tests/unit/obs-native.test.js holds the Worker's `cleanObs` to accepting it.
import Foundation
import Testing
@testable import ColdGasClient

@Suite struct ObsTests {
    @Test func hashesAsTheWeb() {
        // node -e "import('./src/obs/signature.js').then(m => console.log(m.hash12(s)))"
        #expect(Obs.hash12("") == "811c9dc5050c")
        #expect(Obs.hash12("a") == "e40c292c7077")
        #expect(Obs.hash12("pipeline cg_plume failed|build@Renderer.swift:190:0|ios-1.2.0-202611181400") == "7c5b665ed751")
        #expect(Obs.hash12("héllo ✓ 🚀") == "80b6f2eb7203")
    }
    @Test func normalisesAsTheWeb() {
        #expect(Obs.normMessage("sim stopped: trap at tick 1234 (0x1f2e) id deadbeefcafe") == "sim stopped: trap at tick N (<hex>) id <hex>")
        #expect(Obs.normMessage("see https://mutaafaziz.com/coldgas/api/x?y=1 now") == "see <url> now")
        #expect(Obs.normMessage("key sk-ant-abcdefghijklmnop123 leaked") == "key [redacted] leaked")
        #expect(Obs.normMessage("two\nlines") == "two")
        #expect(Obs.normMessage("value \"" + String(repeating: "x", count: 50) + "\" bad") == "value \"[redacted]\" bad")
        #expect(Obs.normMessage("  spaced   out\t tabs  ") == "spaced out tabs")
        #expect(Obs.normMessage("n=-3.5e10 and 42") == "n=N and N")
        #expect(Obs.normMessage(String(repeating: "word ", count: 80)).utf16.count <= 160)
    }
    @Test func framesFitTheWorkersPattern() {
        let re = try! NSRegularExpression(pattern: #"^[\w$.<>\[\]-]{1,40}@[\w.-]{1,48}(?::\d{1,7}:\d{1,7})?$"#)
        func ok(_ s: String) -> Bool { re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil }
        #expect(Obs.frame(function: "build(_:retry:then:)", file: "ColdGas/StageView.swift", line: 77) == "build@StageView.swift:77:0")
        #expect(Obs.frame(function: "init(device:course:replay:)", file: "ColdGas/Renderer.swift") == "init@Renderer.swift")
        for f in [Obs.frame(function: "", file: ""), Obs.frame(function: "élan(x:)", file: "A/B é.swift", line: 3), "0x1a2b@ColdGas", "exit@ColdGas.background"] {
            #expect(ok(f), "\(f)")
        }
        #expect(Obs.frameKey("build@StageView.swift:77:0") == "build@StageView.swift")
    }
    @Test func buildIdsFitTheWorkersPattern() {
        #expect(Obs.build(version: "1.2.0", build: "202611181400") == "ios-1.2.0-202611181400")
        #expect(Obs.build(version: "1.2.0", build: "") == "ios-1.2.0")
        #expect(Obs.build(version: "10.20.30", build: "20261118140059999").count <= 24)
        #expect(Obs.build(version: "", build: "") == "ios-0")
    }
    @Test func theQueueDedupesCountsAndCaps() {
        var q = Obs.Queue()
        let first = q.add(.render, .shader, message: "pipeline 1 failed", frame: "a@B.swift", build: "ios-1")
        let again = q.add(.render, .shader, message: "pipeline 2 failed", frame: "a@B.swift", build: "ios-1")
        #expect(first); #expect(!again)   // the number folds: one fault
        #expect(q.entries.count == 1 && q.entries[0].n == 2)
        for i in 0..<40 { q.add(.app, .error, message: "fault \(String(UnicodeScalar(65 + i % 26)!))\(i >= 26 ? "x" : "")", frame: "f@F.swift", build: "ios-1") }
        #expect(q.entries.count == Obs.MAX_SIGS)
        #expect(q.dropped > 0)
        for _ in 0..<20 { q.recovered(.webgl, ok: true) }
        #expect(q.rec.count == Obs.MAX_REC)
    }
    @Test func aBatchIsOneBuildUnder8kAndSentLeavesTheRest() throws {
        var q = Obs.Queue()
        q.add(.app, .unclean, message: "crash EXC_BREAKPOINT SIGTRAP", frame: "0x1a2b@ColdGas", build: "ios-1.1.0-1")
        let long = (0..<6).map { "0x\(String($0 * 4096 + 0xabcdef, radix: 16))@ColdGas" }.joined(separator: " < ")
        for i in 0..<30 { q.add(.render, .error, message: "fault \(String(repeating: "q", count: i + 1)) \(String(repeating: "z", count: 120))", frame: "f@F.swift", stack: long, build: "ios-1.2.0-2") }
        q.recovered(.webgl, ok: false)
        // The oldest build first, alone, and without the current build's recoveries.
        let b1 = try #require(q.next(currentBuild: "ios-1.2.0-2"))
        #expect(b1.build == "ios-1.1.0-1")
        let j1 = try #require(try JSONSerialization.jsonObject(with: b1.body) as? [String: Any])
        #expect((j1["errs"] as? [Any])?.count == 1); #expect((j1["rec"] as? [Any])?.count == 0)
        q.sent(b1)
        let b2 = try #require(q.next(currentBuild: "ios-1.2.0-2"))
        #expect(b2.build == "ios-1.2.0-2")
        #expect(b2.body.count <= Obs.MAX_BYTES)
        #expect(b2.count <= Obs.MAX_SEND)
        let j2 = try #require(try JSONSerialization.jsonObject(with: b2.body) as? [String: Any])
        #expect(j2["v"] as? Int == 1); #expect(j2["dc"] as? String == "phone-hi"); #expect(j2["tier"] as? String == "high")
        #expect(j2["first"] as? Bool == false); #expect(j2["auto"] as? Bool == false)
        #expect((j2["rec"] as? [Any])?.count == 1)
        // Nothing that could name a person or a device.
        let text = String(decoding: b2.body, as: UTF8.self)
        for banned in ["deviceType", "osVersion", "regionFormat", "install", "uuid", "iPhone"] { #expect(!text.contains(banned), "\(banned)") }
        let before = q.entries.count
        q.add(.render, .error, message: "fault q \(String(repeating: "z", count: 120))", frame: "f@F.swift", build: "ios-1.2.0-2")   // counted while sending
        q.sent(b2)
        #expect(q.entries.count == before - b2.count + 1)   // the one counted meanwhile stays
        #expect(q.rec.isEmpty)
    }
    @Test func theQueueSurvivesARoundTripAndJunk() {
        var q = Obs.Queue()
        q.add(.net, .fetch, message: "board timeout", frame: "fetchBoard@Board.swift:70:0", build: "ios-1")
        #expect(Obs.Queue.decode(q.encoded()) == q)
        #expect(Obs.Queue.decode(Data("junk".utf8)) == Obs.Queue())
        #expect(Obs.Queue.decode(nil).isEmpty)
    }
    /// The fixture both sides hold: tests/unit/obs-native.test.js feeds it to the Worker's cleanObs.
    @Test func theFixtureIsWhatTheQueueBuilds() throws {
        var q = Obs.Queue()
        q.add(.render, .shader, message: "pipeline cg_plume_vertex cg_plume_fragment failed: MTLLibraryErrorDomain 3", frame: "pipeline@Renderer.swift:1010:0", build: "ios-1.2.0-202611181400")
        q.add(.app, .unclean, message: "crash EXC_BREAKPOINT SIGTRAP", frame: "0x1a2b3c@ColdGas", stack: "0x1a2b3c@ColdGas < 0x4d5e@ColdGas < 0x9f00@libswiftCore.dylib", build: "ios-1.2.0-202611181400")
        q.add(.frame, .frame, message: "main thread hang long", frame: "0x77aa@ColdGas", build: "ios-1.2.0-202611181400", count: 3)
        q.add(.physics, .trap, message: "sim stopped: engine trap", frame: "step@Game.swift:405:0", build: "ios-1.2.0-202611181400")
        q.recovered(.physics, ok: true)
        q.recovered(.webgl, ok: false)
        let b = try #require(q.next(currentBuild: "ios-1.2.0-202611181400"))
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../../tests/fixtures/obs-ios-batch.json").standardizedFileURL
        if ProcessInfo.processInfo.environment["OBS_FIXTURE_WRITE"] == "1" { try b.body.write(to: url) }
        let want = try Data(contentsOf: url)
        #expect(String(decoding: b.body, as: UTF8.self) == String(decoding: want, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // --- MetricKit -------------------------------------------------------------------------------------
    static let diagnostics = #"""
    {"timeStampBegin":"2026-11-18 10:00:00","timeStampEnd":"2026-11-18 10:00:00",
     "crashDiagnostics":[{"version":"1.0.0","callStackTree":{"callStackPerThread":true,"callStacks":[
        {"threadAttributed":false,"callStackRootFrames":[{"binaryName":"Other","offsetIntoBinaryTextSegment":1,"binaryUUID":"X","address":1,"sampleCount":1}]},
        {"threadAttributed":true,"callStackRootFrames":[{"binaryUUID":"AAAA-1111","offsetIntoBinaryTextSegment":4096,"sampleCount":1,"binaryName":"libswiftCore.dylib","address":7000,
          "subFrames":[{"binaryUUID":"BBBB-2222","offsetIntoBinaryTextSegment":1715004,"sampleCount":1,"binaryName":"ColdGas","address":8000,
            "subFrames":[{"binaryUUID":"BBBB-2222","offsetIntoBinaryTextSegment":19806,"sampleCount":1,"binaryName":"ColdGas","address":9000}]}]}]}]},
      "diagnosticMetaData":{"appBuildVersion":"202611171400","appVersion":"1.1.0","regionFormat":"GB","exceptionType":6,"osVersion":"iPhone OS 27.1 (25B5)",
        "deviceType":"iPhone18,2","exceptionCode":0,"signal":5,"terminationReason":"Namespace SIGNAL, Code 5 Trace/BPT trap: 5","platformArchitecture":"arm64",
        "exceptionReason":{"exceptionName":"NSRangeException","composedMessage":"index 7 beyond bounds for someone@example.com","className":"NSException"}}}],
     "hangDiagnostics":[{"callStackTree":{"callStacks":[{"threadAttributed":true,"callStackRootFrames":[{"binaryName":"ColdGas","offsetIntoBinaryTextSegment":30634}]}]},
        "diagnosticMetaData":{"appVersion":"1.2.0","appBuildVersion":"202611181400","hangDuration":"3.25 sec","deviceType":"iPhone18,2"}}],
     "cpuExceptionDiagnostics":[{"diagnosticMetaData":{"totalCPUTime":"90 sec"}}],
     "diskWriteExceptionDiagnostics":[{"diagnosticMetaData":{"writesCaused":"2,147 MB"}}],
     "appLaunchDiagnostics":[{"diagnosticMetaData":{"launchDuration":"12,500 ms"}}]}
    """#
    @Test func diagnosticsMapToEntriesWithNothingAboutTheDevice() {
        let f = Obs.fromDiagnostics(json: Data(ObsTests.diagnostics.utf8), fallbackBuild: "ios-now")
        #expect(f.count == 5)
        let crash = f[0]
        #expect(crash.mod == .app && crash.kind == .unclean)
        #expect(crash.message == "crash EXC_BREAKPOINT SIGTRAP NSRangeException")
        #expect(crash.frame == "0x1a2b3c@ColdGas")   // the app's own first frame groups, not the runtime's
        #expect(crash.stack == "0x1000@libswiftCore.dylib < 0x1a2b3c@ColdGas < 0x4d5e@ColdGas")
        #expect(crash.build == "ios-1.1.0-202611171400")   // the build that crashed, not the one that delivered it
        #expect(f[1].message == "main thread hang long" && f[1].kind == .frame && f[1].frame == "0x77aa@ColdGas" && f[1].build == "ios-1.2.0-202611181400")
        #expect(f[2].message == "cpu exception" && f[2].build == "ios-now")
        #expect(f[3].message == "disk write exception")
        #expect(f[4].message == "slow launch severe")
        let all = f.map { "\($0.message) \($0.frame) \($0.stack) \($0.build)" }.joined(separator: " ")
        for banned in ["iPhone", "GB", "27.1", "example.com", "index", "AAAA", "BBBB", "NSException"] { #expect(!all.contains(banned), "\(banned)") }
    }
    @Test func aWatchdogAndAMemoryKillAreNamed() {
        let j = #"{"crashDiagnostics":[{"diagnosticMetaData":{"exceptionType":10,"signal":9,"terminationReason":"Namespace FRONTBOARD, Code 0x8badf00d"}}]}"#
        #expect(Obs.fromDiagnostics(json: Data(j.utf8), fallbackBuild: "b").first?.message == "crash EXC_CRASH SIGKILL watchdog")
        #expect(Obs.fromDiagnostics(json: Data("not json".utf8), fallbackBuild: "b").isEmpty)
    }
    @Test func dailyExitsCountWhatWasntThePlayers() {
        let j = #"""
        {"latestApplicationVersion":"1.2.0","metaData":{"appBuildVersion":"202611181400","deviceType":"iPhone18,2","osVersion":"27.1"},
         "applicationExitMetrics":{"foregroundExitData":{"cumulativeNormalAppExitCount":40,"cumulativeMemoryResourceLimitExitCount":2,"cumulativeAppWatchdogExitCount":1,"cumulativeBadAccessExitCount":0},
                                   "backgroundExitData":{"cumulativeMemoryPressureExitCount":30,"cumulativeBackgroundTaskAssertionTimeoutExitCount":3}}}
        """#
        let f = Obs.fromMetrics(json: Data(j.utf8), fallbackBuild: "b")
        #expect(f.map(\.message) == ["exit foreground memory resource limit", "exit foreground app watchdog", "exit background background task assertion timeout"])
        #expect(f.map(\.count) == [2, 1, 3])
        #expect(f[0].kind == .unclean && f[2].kind == .error)
        #expect(f.allSatisfy { $0.build == "ios-1.2.0-202611181400" })
        #expect(Obs.fromMetrics(json: Data("{}".utf8), fallbackBuild: "b").isEmpty)
    }
}

// 0293: a save that won't read is restored from the mirror, and its bytes are kept aside, never overwritten.
@Suite struct SaveMirror {
    let good = Data(#"{"initials":"ACE","medals":{"show:assist":91.3}}"#.utf8)
    @Test func theStoreWins() {
        let (s, how) = SaveData.load(stored: good, mirror: Data(#"{"initials":"OLD"}"#.utf8))
        #expect(how == .stored); #expect(s.cleanedInitials == "ACE")
    }
    @Test func aDamagedStoreIsRestoredFromTheMirror() {
        let bad = Data(#"{"initials":"AC"#.utf8)   // cut off mid-write
        let (s, how) = SaveData.load(stored: bad, mirror: good)
        #expect(how == .restored(damaged: bad)); #expect(s.cleanedInitials == "ACE")
        #expect(s.medalBook.held(course: "show", tier: "assist").medal == .silver)
        for junk in ["[1,2]", "5", "null", "junk"] { #expect(SaveData.load(stored: Data(junk.utf8), mirror: good).1 == .restored(damaged: Data(junk.utf8)), "\(junk)") }
    }
    @Test func aStoreThatsGoneIsRestoredToo() {
        let (s, how) = SaveData.load(stored: nil, mirror: good)
        #expect(how == .restored(damaged: nil)); #expect(s.cleanedInitials == "ACE")
    }
    @Test func noMirrorMeansAFreshSaveAndTheBytesKept() {
        let bad = Data("garbage".utf8)
        #expect(SaveData.load(stored: bad, mirror: nil) == (SaveData(), .lost(damaged: bad)))
        #expect(SaveData.load(stored: bad, mirror: Data("also bad".utf8)).1 == .lost(damaged: bad))
        #expect(SaveData.load(stored: nil, mirror: nil).1 == .fresh)
        #expect(SaveData.load(stored: Data(), mirror: nil).1 == .fresh)
    }
}
