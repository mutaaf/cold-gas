// 0219: the judges on the device. The route, the on-device call against a fake model (words as they land, every way it can
// fail, a hang cut at its deadline), the fallback to the cloud with the time that's left, the receipt (invariant 5½) and
// the brief (the run's numbers only, as src/worker/ai/prompt.js writes them).
import Foundation
import Testing
@testable import ColdGasClient

private let FULL = JudgeWords(headline: "Clean over the row", engineer: "Sink 0.8 m/s, four wheels inside 12 ms. Signed off.",
                              coordinator: "Two seconds upside down at 27 metres. That is the shot.", designer: "Forty percent in the tanks. Quiet and exact.")

/// A model that plays a script: snapshots (with a pause before each), then an end, an error, or a hang.
private struct FakeModel: OnDeviceJudgeModel {
    enum End { case finish, fail(Error), hang }
    var steps: [OnDeviceSnapshot]
    var pauseMs: UInt64 = 1
    var end: End = .finish
    let asked = Counter()
    func judge(instructions: String, prompt: String) -> AsyncThrowingStream<OnDeviceSnapshot, Error> {
        asked.add()
        let steps = steps, pause = pauseMs, end = end
        return AsyncThrowingStream { c in
            let t = Task {
                for s in steps { try? await Task.sleep(nanoseconds: pause * 1_000_000); if Task.isCancelled { return }; c.yield(s) }
                switch end {
                case .finish: c.finish()
                case let .fail(e): c.finish(throwing: e)
                case .hang: try? await Task.sleep(nanoseconds: 60_000_000_000); c.finish()
                }
            }
            c.onTermination = { _ in t.cancel() }
        }
    }
    /// Each part landing in turn, as guided generation fills the schema's properties in order.
    static func streaming(_ w: JudgeWords = FULL, usage: OnDeviceUsage? = nil) -> [OnDeviceSnapshot] {
        [JudgeWords(headline: w.headline),
         JudgeWords(headline: w.headline, engineer: w.engineer),
         JudgeWords(headline: w.headline, engineer: w.engineer, coordinator: w.coordinator),
         JudgeWords(headline: w.headline, engineer: w.engineer, coordinator: w.coordinator, designer: w.designer)]
            .enumerated().map { OnDeviceSnapshot(words: $0.element, usage: $0.offset == 3 ? usage : nil) }
    }
}
final class Counter: @unchecked Sendable {
    private let lock = NSLock(); private var n = 0
    func add() { lock.lock(); n += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return n }
}
final class Events: @unchecked Sendable {
    private let lock = NSLock(); private var es: [JudgeEvent] = []
    func add(_ e: JudgeEvent) { lock.lock(); es.append(e); lock.unlock() }
    var all: [JudgeEvent] { lock.lock(); defer { lock.unlock() }; return es }
}

private func card(_ course: String = "show", tier: String = "assist", facts: [(String, JSValue)] = []) -> ScoreCard {
    let base: [(String, JSValue)] = [("course", .string(course)), ("jumped", .bool(true)), ("crossedRow", .bool(true)), ("contact", .bool(false)),
        ("progressPct", .number(100)), ("height", .number(27.4)), ("invertedS", .number(2.1)), ("maxG", .number(3.2)), ("launchHeight", .number(19.8)),
        ("clearance", .number(1.6)), ("rollDeg", .number(180)), ("pitchDeg", .number(12)), ("sink", .number(0.8)), ("tiltDeg", .number(3)),
        ("padMiss", .number(1.2)), ("airPct", .number(41)), ("wheelSpreadMs", .number(12))]
    return ScoreCard(total: 88.4, verdict: "Stuck it", tier: tier, course: course, multiplier: 1,
                     judges: [JudgeScore(id: "engineer", name: "ENGINEER", score: 8.8), JudgeScore(id: "coordinator", name: "COORDINATOR", score: 9.1), JudgeScore(id: "designer", name: "DESIGNER", score: 8.6)],
                     categories: ["landing": 8.5, "air": 9], facts: .object(base + facts))
}
private let localMeta = JudgeMeta(ok: false, error: "The judges are offline.", provider: "edge")

/// The cloud's side, recorded: when it was asked, with what deadline; it answers like the edge model.
final class FakeCloud: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var deadlines: [Double] = []
    var answer: (JudgeWords, JudgeMeta) = (JudgeWords(headline: "From the edge", engineer: "e", coordinator: "c", designer: "d", source: "ai"),
                                           JudgeMeta(ok: true, provider: "edge", model: "@cf/google/gemma-4-26b-a4b-it"))
    func call(_ ms: Double) async -> (JudgeWords, JudgeMeta) { lock.withLock { deadlines.append(ms) }; return answer }
}

@Suite struct OnDeviceRoute {
    @Test func onTheDeviceOnlyWhenAvailableAndWanted() {
        #expect(judgeRoute(status: .available, preferOnDevice: true) == .onDevice)
        #expect(judgeRoute(status: .available, preferOnDevice: false) == .cloud)
        for s in OnDeviceStatus.allCases where s != .available {
            #expect(judgeRoute(status: s, preferOnDevice: true) == .cloud, "\(s)")
            #expect(!s.line.isEmpty)
        }
    }
    @Test func theSettingDefaultsOnAndSurvivesAnOldSave() {
        #expect(Settings().judgeOnDeviceOn)
        let old = SaveData.decode(Data(#"{"settings":{"haptics":false}}"#.utf8))
        #expect(old.resolvedSettings.judgeOnDeviceOn)
        let off = SaveData.decode(Data(#"{"settings":{"judgeOnDevice":false}}"#.utf8))
        #expect(!off.resolvedSettings.judgeOnDeviceOn)
        let junk = SaveData.decode(Data(#"{"settings":{"judgeOnDevice":"yes","sound":false}}"#.utf8))
        #expect(junk.resolvedSettings.judgeOnDeviceOn); #expect(!junk.resolvedSettings.soundOn)
    }
}

@Suite struct OnDeviceCall {
    @Test func theDeviceSpeaksAndTheCloudIsNeverAsked() async throws {
        let model = FakeModel(steps: FakeModel.streaming()), cloud = FakeCloud(), events = Events()
        let r = await judgePanel(card: card(), route: .onDevice, model: model, place: "this iPhone", emit: { events.add($0) }, cloud: cloud.call)
        let (words, meta) = try #require(r)
        #expect(cloud.deadlines.isEmpty)
        #expect(model.asked.count == 1)
        #expect(words.headline == FULL.headline && words.designer == FULL.designer && words.source == "ai")
        #expect(meta.ok && meta.provider == ON_DEVICE_PROVIDER && meta.model == ON_DEVICE_MODEL && meta.where == "this iPhone")
        let d = try #require(meta.done)
        #expect(d.costUsd == 0 && d.onDevice == true && d.tokens == "estimate")
        #expect((d.inTokens ?? 0) > 100 && (d.outTokens ?? 0) > 10)
        // The stream: who's asked first, then the words as they land (each part in turn), then done.
        let es = events.all
        guard case let .prompt(p)? = es.first else { Issue.record("no prompt first"); return }
        #expect(p.provider == ON_DEVICE_PROVIDER && p.system == ON_DEVICE_INSTRUCTIONS && p.user == judgePrompt(card()))
        let tokens = es.compactMap { if case let .token(_, w) = $0 { return w }; return nil }
        #expect(tokens.count == 4)
        #expect(tokens.first?.engineer == "" && tokens.first?.headline == FULL.headline)
        guard case .done? = es.last else { Issue.record("no done last"); return }
    }
    @Test func reportedUsageIsShownAsReported() async throws {
        let model = FakeModel(steps: FakeModel.streaming(usage: OnDeviceUsage(inTokens: 612, outTokens: 88, source: .reported)))
        let r = await judgePanel(card: card(), route: .onDevice, model: model, place: "this iPad", emit: { _ in }, cloud: FakeCloud().call)
        let d = try #require(r?.1.done)
        #expect(d.inTokens == 612 && d.outTokens == 88 && d.tokens == "reported")
        let line = judgeReceipt(try #require(r?.1))
        #expect(line.contains("612 in + 88 out tokens") && !line.contains("estimated") && line.contains("this iPad"))
    }
    @Test func everyFailureFallsBackToTheCloudWithTheTimeLeft() async throws {
        let failures: [FakeModel.End] = [.fail(OnDeviceJudgeError("a guardrail stopped it")), .fail(OnDeviceJudgeError("the brief was too long for it")),
                                         .fail(OnDeviceJudgeError("its model isn\u{2019}t ready yet")), .fail(CocoaError(.featureUnsupported))]
        for end in failures {
            let model = FakeModel(steps: Array(FakeModel.streaming().prefix(1)), end: end), cloud = FakeCloud(), events = Events()
            let r = await judgePanel(card: card(), route: .onDevice, model: model, place: "this iPhone", emit: { events.add($0) }, cloud: cloud.call)
            let (words, meta) = try #require(r)
            #expect(cloud.deadlines.count == 1)
            #expect(cloud.deadlines[0] > JUDGE_MS - 2_000 && cloud.deadlines[0] <= JUDGE_MS)
            #expect(words.headline == "From the edge" && meta.provider == "edge")
            #expect(meta.onDeviceFailure != nil)
            #expect(events.all.contains { if case .note = $0 { return true }; return false })
            // Nothing from the device after the call gave up on it.
            #expect(!events.all.contains { if case .done = $0 { return true }; return false })
        }
    }
    @Test func aHangIsCutAtItsDeadlineAndTheCloudGetsTheRest() async throws {
        let model = FakeModel(steps: Array(FakeModel.streaming().prefix(2)), end: .hang), cloud = FakeCloud()
        let start = Date()
        let r = await judgePanel(card: card(), route: .onDevice, model: model, place: "this iPhone", totalMs: 1_200, onDeviceMs: 300, emit: { _ in }, cloud: cloud.call)
        let took = Date().timeIntervalSince(start) * 1000
        #expect(took < 1_100, "took \(took) ms")
        #expect(r?.1.onDeviceFailure == "it took too long")
        #expect(cloud.deadlines.count == 1)
        #expect(cloud.deadlines[0] >= 1_000)   // what's left, and never less than a second
    }
    @Test func aJudgeLeftWithoutAWordIsAFailureNotTheirWords() async throws {
        let model = FakeModel(steps: Array(FakeModel.streaming().prefix(3))), cloud = FakeCloud()
        let r = await judgePanel(card: card(), route: .onDevice, model: model, place: "this iPhone", emit: { _ in }, cloud: cloud.call)
        #expect(r?.1.onDeviceFailure == "it left a judge without a word")
        #expect(cloud.deadlines.count == 1)
    }
    @Test func theCloudRouteNeverAsksTheDevice() async throws {
        let model = FakeModel(steps: FakeModel.streaming()), cloud = FakeCloud()
        let r = await judgePanel(card: card(), route: .cloud, model: model, place: "this iPhone", emit: { _ in }, cloud: cloud.call)
        #expect(model.asked.count == 0)
        #expect(cloud.deadlines == [JUDGE_MS])
        #expect(r?.1.onDeviceFailure == nil)
        // On the device, but no model (an OS without the framework): the cloud, as before.
        let r2 = await judgePanel(card: card(), route: .onDevice, model: nil, place: "this iPhone", emit: { _ in }, cloud: cloud.call)
        #expect(r2?.0.headline == "From the edge")
    }
    @Test func overlongWordsAreCappedAsTheCloudsAre() async throws {
        let long = JudgeWords(headline: String(repeating: "h", count: 90), engineer: "  " + String(repeating: "e", count: 300), coordinator: "c", designer: "d")
        let model = FakeModel(steps: [OnDeviceSnapshot(words: long)])
        let r = await judgePanel(card: card(), route: .onDevice, model: model, place: "this iPhone", emit: { _ in }, cloud: FakeCloud().call)
        #expect(r?.0.headline.count == 60 && r?.0.engineer.count == 200)
    }
}

@Suite struct OnDeviceReceipt {
    @Test func theDevicesReceiptSaysWhereWhatAndThatNothingLeft() {
        var d = JudgeDone(words: FULL)
        d.inTokens = 640; d.outTokens = 92; d.totalMs = 2_340; d.costUsd = 0; d.tokens = "estimate"; d.onDevice = true
        let line = judgeReceipt(JudgeMeta(ok: true, provider: ON_DEVICE_PROVIDER, model: ON_DEVICE_MODEL, where: "this iPhone", done: d))
        #expect(line == "Words by Apple\u{2019}s on-device model, on this iPhone \u{B7} 640 in + 92 out tokens (estimated) \u{B7} 2.3 s \u{B7} $0 \u{B7} no data left the device")
    }
    @Test func theEdgeModelsReceiptNamesTheModel() {
        var d = JudgeDone(words: FULL)
        d.inTokens = 700; d.outTokens = 80; d.costUsd = 0; d.model = "@cf/google/gemma-4-26b-a4b-it"
        let line = judgeReceipt(JudgeMeta(ok: true, provider: "edge", model: "@cf/google/gemma-4-26b-a4b-it", done: d))
        #expect(line == "Words by the edge model (@cf/google/gemma-4-26b-a4b-it) \u{B7} 700 in + 80 out tokens \u{B7} $0")
    }
    @Test func localLinesAreNeverPassedOffAsAModels() {
        var m = localMeta
        m.onDeviceFailure = "a guardrail stopped it"
        let line = judgeReceipt(m)
        #expect(line.hasPrefix("The game\u{2019}s own lines, not a model\u{2019}s"))
        #expect(line.contains("The judges are offline.") && line.contains("a guardrail stopped it"))
        #expect(!line.contains("Words by"))
        #expect(judgeReceipt(.localMeta(.breaker)).contains("resting"))
    }
}

@Suite struct OnDeviceBrief {
    @Test func theShowsBriefIsTheWorkersFacts() {
        let p = judgePrompt(card())
        let lines = p.split(separator: "\n").map(String.init)
        #expect(lines[0].hasPrefix("Event: THE SHOW."))
        #expect(lines[1] == "Total 88.4/100, verdict \"Stuck it\".")
        #expect(lines[2] == "Judges: ENGINEER 8.8, COORDINATOR 9.1, DESIGNER 8.6.")
        #expect(lines[3] == "Categories (0-10): air 9, landing 8.5.")
        #expect(lines[4] == "Climbed 100% to 27.4 m; hung inverted 2.1 s; peak load 3.2 g.")
        #expect(lines[5] == "Released at 19.8 m; cleared the roofs by 1.6 m; turned 180 degrees; touchdown 0.8 m/s, tilt 3 degrees, 1.2 m from the mark; gas left 41%.")
        #expect(lines.count == 6)   // assist: no tier line; no damage reading: no damage line
    }
    @Test func tierAndDamageLinesFollowTheWorkers() {
        let p = judgePrompt(card("wall", tier: "advanced", facts: [("damagePct", .number(64)), ("integrity", .number(36)),
            ("damageZones", .object([("front", .number(3)), ("roof", .number(40)), ("rear", .number(22))]))]))
        #expect(p.contains("Event: THE WALL."))
        #expect(p.contains("Damage sensor: 64% damage, 36% intact (roof 40%, rear 22%); the car is a write-off."))
        #expect(p.hasSuffix("Flown in Advanced: all ten valves by hand, no flight computer at all (scores x1.15). Raw piloting."))
    }
    @Test func theLineupSaysRotationsAsTheWorkerDoes() {
        let p = judgePrompt(card("lineup", facts: [("rotations", .number(1)), ("apex", .number(7)), ("apexOverRoof", .number(2.4)), ("launchKmh", .number(88)), ("headingDeg", .number(4))]))
        #expect(p.contains("roll 180 degrees (1 rotation)."))
        #expect(!p.contains("Event:"))
    }
    @Test func theBriefCarriesTheVoicesAndNoBrand() {
        for v in ["ENGINEER (Chief Vehicle Engineer)", "COORDINATOR (Stunt Coordinator)", "DESIGNER (Head of Design)", "Never change them"] {
            #expect(ON_DEVICE_INSTRUCTIONS.contains(v))
        }
        #expect(estimateTokens("abcd") == 1 && estimateTokens("") == 1 && estimateTokens(String(repeating: "x", count: 400)) == 100)
    }
}
