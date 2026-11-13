// The judges on the device (0219): when the phone has Apple's on-device model (Apple Intelligence), the panel's words are
// written there, with no network call, no key and no cost; otherwise the edge model (POST /judge/stream), then the local
// lines, exactly as before. The numbers never change: they are scoreRun's, and the model only ever sees them.
//
// This is the pure half, tested on macOS with a fake model: the brief (src/worker/ai/prompt.js, ported), the route, the
// on-device call raced against its own deadline inside JUDGE_MS, the fallback, and the receipt's words (invariant 5½).
// The framework half (FoundationModels, iOS 26+) is ios/ColdGas/Net/OnDeviceJudge.swift; the call is ios/ColdGas/Net/Judges.swift.
import Foundation
import ColdGasCore

// --- the brief ---------------------------------------------------------------------------------------
/// src/worker/ai/prompt.js SYSTEM: the event and the three voices, word for word. The cloud's last paragraph (reply in four
/// labelled lines) becomes the schema here: guided generation fills the four parts, so the format can't drift.
public let ON_DEVICE_INSTRUCTIONS = """
You are the judging panel for COLD GAS, a stunt game. A roadster with a suction fan and ten cold-gas thrusters performs THE SHOW (one flight: up the Wall, let go from the inverted ledge, boost over five parked EVs on the rear jets, roll upright and land beyond them) or a single stunt: either THE WALL (crawl up a 28 m concrete curl on fan suction, hang upside down under the ledge, let go, roll upright, brake on the down-jets, land) or THE LINEUP (no ramp: lift off flat ground on thrust, a 360-degree roll over five parked EVs, landing). The event is named in the facts.

Three judges:
- ENGINEER (Chief Vehicle Engineer): dry and exacting; cares about sink rate, wheel sync, g-load and attitude at touchdown.
- COORDINATOR (Stunt Coordinator): warm and theatrical; cares about height, rotation and nerve.
- DESIGNER (Head of Design): minimal and precise; cares about clean lines, restraint and air left in the tanks.

The scores are final and already decided. Never change them or invent numbers that are not in the facts. Each judge writes one remark of at most 22 words, in their own voice, about something specific in the facts. No emoji, hashtags, brand names or real people.

Write a headline of at most 6 words, then each judge's remark.
"""

private let TIER_LINE = [
    "pro": "Flown in Pro: rate control by hand, no LAND governor (scores x1.08).",
    "advanced": "Flown in Advanced: all ten valves by hand, no flight computer at all (scores x1.15). Raw piloting.",
]

/// src/worker/ai/prompt.js userPrompt: the verified card as compact facts. The run's numbers and nothing else.
public func judgePrompt(_ card: ScoreCard) -> String {
    [userFacts(card), damageLine(card.facts), TIER_LINE[card.tier ?? ""] ?? ""].filter { !$0.isEmpty }.joined(separator: "\n")
}

private func damageLine(_ f: JSValue) -> String {
    guard let d = f["damagePct"], d != .null else { return "" }
    var zones: [(String, Double)] = []
    if case let .object(kv)? = f["damageZones"] { zones = kv.map { ($0.0, jsNumber($0.1)) }.filter { $0.1 >= 5 } }
    zones = zones.enumerated().sorted { $0.element.1 != $1.element.1 ? $0.element.1 > $1.element.1 : $0.offset < $1.offset }.map(\.element)
    let z = zones.map { "\($0.0) \(jsNumberString($0.1))%" }.joined(separator: ", ")
    return "Damage sensor: \(jsString(d))% damage, \(jsString(f["integrity"]))% intact\(z.isEmpty ? "" : " (\(z))")\(jsNumber(d) >= 60 ? "; the car is a write-off" : "")."
}

private func userFacts(_ card: ScoreCard) -> String {
    let f = Facts(card)
    let head = [
        "Total \(jsNumberString(card.total))/100, verdict \"\(card.verdict)\".",
        "Judges: \((card.judges ?? []).map { "\($0.name ?? $0.id) \(jsNumberString($0.score))" }.joined(separator: ", ")).",
        // The card's categories come as a dictionary here, so in a fixed order (the web's is scoreRun's insertion order).
        "Categories (0-10): \((card.categories ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key) \(jsNumberString($0.value))" }.joined(separator: ", ")).",
    ]
    let turned = jsNumberString(jsMax(f.n("rollDeg"), f.n("pitchDeg")))
    if f.v("course") == .string("show") {
        return ([
            "Event: THE SHOW. One flight on one fill of nitrogen: crawl up a 28 m concrete curl on fan suction, hang upside down under the ledge, let go, fire the rear jets to carry out over five parked EVs (a semi among them), roll upright on the way down, brake on the down-jets and land on a pad beyond the row.",
        ] + head + [
            "Climbed \(f.s("progressPct"))% to \(f.s("height")) m; hung inverted \(f.s("invertedS")) s; peak load \(f.s("maxG")) g.",
            f.b("jumped") ? "Released at \(f.s("launchHeight")) m; \(f.b("contact") ? "came down on a parked vehicle" : f.b("crossedRow") ? "cleared the roofs by \(f.s("clearance")) m" : "fell short of the row"); turned \(turned) degrees; touchdown \(f.s("sink")) m/s, tilt \(f.s("tiltDeg")) degrees, \(f.s("padMiss")) m from the mark; gas left \(f.s("airPct"))%." : "Never left the wall.",
            f.b("fellOff") ? "The car slid off the side of the deck." : "", f.b("landedOnRamp") ? "It came down on the deck." : "", f.b("flipped") ? "It rolled over after the landing." : "",
        ]).filter { !$0.isEmpty }.joined(separator: "\n")
    }
    if f.v("course") == .string("wall") {
        return ([
            "Event: THE WALL. A concrete curl turns 170 degrees from the ground into an inverted ledge about 28 m up. The car crawls up it on four suction fans (46 kN), hangs upside down under the ledge, lets go, rolls upright in the air, brakes on four nitrogen down-jets and lands on a target pad.",
        ] + head + [
            "Entered the curl at \(f.s("entryKmh")) km/h; climbed \(f.s("progressPct"))% of the curl to \(f.s("height")) m; hung inverted \(f.s("invertedS")) s; peak load \(f.s("maxG")) g.",
            f.b("jumped") ? "Released at \(f.s("launchHeight")) m doing \(f.s("launchKmh")) km/h; turned \(turned) degrees (roll \(f.s("rollDeg")), pitch \(f.s("pitchDeg")))." : "Never left the wall.",
            f.b("jumped") ? "Touchdown sink \(f.s("sink")) m/s, tilt \(f.s("tiltDeg")) degrees, four wheels within \(f.s("wheelSpreadMs")) ms; \(f.s("padMiss")) m from the mark; gas left \(f.s("airPct"))%." : "",
            f.b("fellOff") ? "The car slid off the side of the deck." : "", f.b("landedOnRamp") ? "It came down on the deck." : "", f.b("flipped") ? "It rolled over after landing." : "",
        ]).filter { !$0.isEmpty }.joined(separator: "\n")
    }
    return (head + [
        "Launch \(f.s("launchKmh")) km/h; apex \(f.s("apex")) m (\(f.s("apexOverRoof")) m over the semi); roll \(f.s("rollDeg")) degrees (\(f.s("rotations")) rotation\(f.v("rotations") == .number(1) ? "" : "s")).",
        f.b("contact") ? "The car hit a parked vehicle." : "Closest clearance over the roofs \(f.s("clearance")) m.",
        "Touchdown sink \(f.s("sink")) m/s, tilt \(f.s("tiltDeg")) degrees, heading \(f.s("headingDeg")) degrees, four wheels within \(f.s("wheelSpreadMs")) ms; \(f.s("padMiss")) m from the mark.",
        "Air left \(f.s("airPct"))%.\(f.b("bottomOut") ? " Suspension bottomed out." : "")\(f.b("flipped") ? " The car rolled over after landing." : "")",
    ]).joined(separator: "\n")
}

/// src/worker/ai/prompt.js estimateTokens: ≈ 4 characters a token, for a count the framework doesn't report.
public func estimateTokens(_ s: String) -> Double { Swift.max(1, jsRound(Double(s.utf16.count) / 4)) }
/// src/worker/ai/prompt.js complete: all four parts written.
public func wordsComplete(_ w: JudgeWords) -> Bool { !w.headline.isEmpty && !w.engineer.isEmpty && !w.coordinator.isEmpty && !w.designer.isEmpty }
/// The parts trimmed and capped as parseWords caps the cloud's (60 for the headline, 200 for a remark).
public func cappedWords(_ w: JudgeWords, source: String? = "ai") -> JudgeWords {
    JudgeWords(headline: jsSlice(jsTrim(w.headline), 60), engineer: jsSlice(jsTrim(w.engineer), 200), coordinator: jsSlice(jsTrim(w.coordinator), 200),
               designer: jsSlice(jsTrim(w.designer), 200), source: source)
}

// --- the model, as the call sees it --------------------------------------------------------------------
public let ON_DEVICE_PROVIDER = "apple"
/// The framework's own name for it: there is no version string to show (invariant 5½: the real id, never a made-up one).
public let ON_DEVICE_MODEL = "SystemLanguageModel.default"
/// The on-device call's share of JUDGE_MS. A judging is a few seconds on a phone; if it hangs, the edge model still has
/// JUDGE_MS minus this (15 s) and the results never wait longer than they did before. (The simulator on the operator's Mac:
/// 10.5 s cold, 8.3 s warm; no prewarm during a run, which would spend the run's frame budget.)
public let ON_DEVICE_MS = 20_000.0

/// Whether this device can judge on-device, and if not, why (SystemLanguageModel.Availability, plus what the app knows).
public enum OnDeviceStatus: String, Equatable, Sendable, CaseIterable {
    case available
    case osTooOld            // before iOS 26, or a build without the framework
    case deviceNotEligible
    case notEnabled          // Apple Intelligence is off in the system's Settings
    case notReady            // the model is still downloading or preparing
    case unknown
    /// For Settings and the receipt: what the player can do about it, in a line.
    public var line: String {
        switch self {
        case .available: return "Apple Intelligence is on: the judges write their words on this device."
        case .osTooOld: return "Judging on the device needs iOS 26 or later with Apple Intelligence."
        case .deviceNotEligible: return "This device doesn\u{2019}t support Apple Intelligence."
        case .notEnabled: return "Apple Intelligence is turned off in Settings."
        case .notReady: return "Apple Intelligence is still getting ready on this device."
        case .unknown: return "Apple Intelligence isn\u{2019}t available on this device."
        }
    }
}

/// Which brain is asked first.
public enum JudgeRoute: Equatable, Sendable { case onDevice, cloud }
/// On the device when it can and the player hasn't sent the panel to the edge model in Settings; otherwise the cloud.
public func judgeRoute(status: OnDeviceStatus, preferOnDevice: Bool) -> JudgeRoute {
    status == .available && preferOnDevice ? .onDevice : .cloud
}

/// How many tokens the call used, and where the numbers came from (invariant 5½: an estimate is labelled as one).
public struct OnDeviceUsage: Equatable, Sendable {
    public enum Source: String, Sendable { case reported, estimate }
    public var inTokens: Double, outTokens: Double, source: Source
    public init(inTokens: Double, outTokens: Double, source: Source) { self.inTokens = inTokens; self.outTokens = outTokens; self.source = source }
}
/// One step of the stream: the words so far (parts not yet written are empty) and, when the framework reports it, usage.
public struct OnDeviceSnapshot: Equatable, Sendable {
    public var words: JudgeWords, usage: OnDeviceUsage?
    public init(words: JudgeWords, usage: OnDeviceUsage? = nil) { self.words = words; self.usage = usage }
}
/// The model's own failure, already said in a player's words ("a guardrail stopped it", "the brief was too long"…).
public struct OnDeviceJudgeError: Error, Equatable, Sendable {
    public var reason: String
    public init(_ reason: String) { self.reason = reason }
}
/// The on-device model, as the call needs it: the framework in the app, a fake in the tests.
public protocol OnDeviceJudgeModel: Sendable {
    /// Snapshots as the words land; finishes when the model is done, throws OnDeviceJudgeError (or anything) if it fails.
    func judge(instructions: String, prompt: String) -> AsyncThrowingStream<OnDeviceSnapshot, Error>
}

// --- the call ----------------------------------------------------------------------------------------
/// Events go out through here until the call closes; a late one from a stream still unwinding is dropped.
private final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var closed = false
    private let emit: @Sendable (JudgeEvent) -> Void
    init(_ emit: @escaping @Sendable (JudgeEvent) -> Void) { self.emit = emit }
    func send(_ e: JudgeEvent) { lock.lock(); defer { lock.unlock() }; if !closed { emit(e) } }
    func close() { lock.lock(); closed = true; lock.unlock() }
}
/// The first of the stream's end and the deadline (true: the deadline), whichever task is still unwinding.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<Bool, Never>?, result: Bool?
    func wait(_ c: CheckedContinuation<Bool, Never>) {
        lock.lock()
        if let r = result { lock.unlock(); c.resume(returning: r) } else { waiter = c; lock.unlock() }
    }
    func fire(_ v: Bool) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        result = v
        let w = waiter; waiter = nil
        lock.unlock()
        w?.resume(returning: v)
    }
}
private final class Box<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var v: T
    init(_ v: T) { self.v = v }
    var value: T { get { lock.lock(); defer { lock.unlock() }; return v } set { lock.lock(); v = newValue; lock.unlock() } }
}

public enum OnDeviceJudging {
    public enum Outcome: Equatable {
        case spoke(JudgeWords, JudgeMeta)
        case failed(String)
    }

    /// One on-device judging: `.prompt`, then `.token` as each part lands, then `.done`; or the reason it couldn't.
    /// Never longer than `deadlineMs`. `place` is where it ran, for the receipt ("this iPhone").
    public static func run(model: OnDeviceJudgeModel, card: ScoreCard, place: String, deadlineMs: Double = ON_DEVICE_MS,
                           now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
                           emit: @escaping @Sendable (JudgeEvent) -> Void) async -> Outcome {
        let user = judgePrompt(card)
        let gate = Gate(emit)
        let inEst = estimateTokens(ON_DEVICE_INSTRUCTIONS) + estimateTokens(user)
        gate.send(.prompt(JudgePrompt(provider: ON_DEVICE_PROVIDER, providerLabel: "Apple\u{2019}s on-device model", vendor: "Apple", model: ON_DEVICE_MODEL,
                                      colo: nil, where: place, system: ON_DEVICE_INSTRUCTIONS, user: user, inTokensEst: inEst)))
        let t0 = now()
        let last = Box<OnDeviceSnapshot?>(nil), firstAt = Box<Double?>(nil), failure = Box<String?>(nil)
        let once = Once()
        let work = Task {
            do {
                for try await s in model.judge(instructions: ON_DEVICE_INSTRUCTIONS, prompt: user) {
                    if Task.isCancelled { break }
                    let w = cappedWords(s.words)
                    if firstAt.value == nil, !(w.headline + w.engineer + w.coordinator + w.designer).isEmpty { firstAt.value = now() }
                    if last.value?.words != w { gate.send(.token("", words: w)) }
                    last.value = OnDeviceSnapshot(words: w, usage: s.usage ?? last.value?.usage)
                }
            } catch let e as OnDeviceJudgeError {
                failure.value = e.reason
            } catch {
                if !Task.isCancelled { failure.value = "it stopped (\(String(describing: error).prefix(80)))" }
            }
            once.fire(false)
        }
        let timer = Task {
            try? await Task.sleep(nanoseconds: UInt64(Swift.max(0, deadlineMs) * 1_000_000))
            if !Task.isCancelled { once.fire(true) }
        }
        let timedOut = await withTaskCancellationHandler {
            await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in once.wait(c) }
        } onCancel: { once.fire(false) }
        work.cancel(); timer.cancel()
        if Task.isCancelled { gate.close(); return .failed("cancelled") }
        if timedOut { gate.close(); return .failed("it took too long") }
        if let f = failure.value { gate.close(); return .failed(f) }
        guard let snap = last.value, wordsComplete(snap.words) else { gate.close(); return .failed("it left a judge without a word") }
        let total = now() - t0
        let outText = [snap.words.headline, snap.words.engineer, snap.words.coordinator, snap.words.designer].joined(separator: "\n")
        let usage = snap.usage ?? OnDeviceUsage(inTokens: inEst, outTokens: estimateTokens(outText), source: .estimate)
        let genMs = total - ((firstAt.value ?? t0) - t0)
        var done = JudgeDone(words: snap.words)
        done.provider = ON_DEVICE_PROVIDER; done.model = ON_DEVICE_MODEL; done.billedTo = "nobody: it ran on \(place)"
        done.ttftMs = firstAt.value.map { $0 - t0 }; done.totalMs = total
        done.inTokens = usage.inTokens; done.outTokens = usage.outTokens
        done.tokensPerSec = genMs > 0 ? jsRound(usage.outTokens / (genMs / 1000) * 10) / 10 : nil
        done.costUsd = 0; done.tokens = usage.source.rawValue; done.onDevice = true
        gate.send(.done(done))
        gate.close()
        return .spoke(snap.words, JudgeMeta(ok: true, provider: ON_DEVICE_PROVIDER, model: ON_DEVICE_MODEL, where: place, done: done))
    }
}

/// The whole choice, as Judges.swift makes it: on the device first when it can, then the cloud with the time that's left
/// (the cloud call ends in the local lines on its own, as before). Returns the words to show and the receipt.
/// `cloud(deadlineMs)` is the edge model's call (breaker, network, local lines), and is never asked if the device spoke.
public func judgePanel(card: ScoreCard, route: JudgeRoute, model: OnDeviceJudgeModel?, place: String,
                       totalMs: Double = JUDGE_MS, onDeviceMs: Double = ON_DEVICE_MS,
                       now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
                       emit: @escaping @Sendable (JudgeEvent) -> Void,
                       cloud: (_ deadlineMs: Double) async -> (JudgeWords, JudgeMeta)) async -> (JudgeWords, JudgeMeta)? {
    var why: String?
    let t0 = now()
    if route == .onDevice, let model {
        switch await OnDeviceJudging.run(model: model, card: card, place: place, deadlineMs: Swift.min(onDeviceMs, totalMs), now: now, emit: emit) {
        case let .spoke(w, m): return (w, m)
        case let .failed(reason):
            if Task.isCancelled { return nil }
            why = reason
            emit(.note(JudgeNote(message: "Apple\u{2019}s on-device model couldn\u{2019}t judge this one (\(reason)): asking the edge model", model: ON_DEVICE_MODEL)))
        }
    }
    let left = Swift.max(1_000, totalMs - (now() - t0))
    var (words, meta) = await cloud(left)
    if Task.isCancelled { return nil }
    meta.onDeviceFailure = why
    return (words, meta)
}

// --- the receipt -------------------------------------------------------------------------------------
private func tokens(_ n: Double?) -> String { n.map { jsGrouped(jsRound($0)) } ?? "?" }
/// The line under the judges (invariant 5½): who wrote the words, where, the tokens and the cost; or, for the local lines,
/// that they are the game's own and why. Never the model's name on the local lines.
public func judgeReceipt(_ meta: JudgeMeta) -> String {
    if meta.ok, let d = meta.done {
        let n = "\(tokens(d.inTokens)) in + \(tokens(d.outTokens)) out tokens\(d.tokens == OnDeviceUsage.Source.estimate.rawValue ? " (estimated)" : "")"
        if meta.provider == ON_DEVICE_PROVIDER {
            let secs = d.totalMs.map { " \u{B7} \(jsToFixed($0 / 1000, 1)) s" } ?? ""
            return "Words by Apple\u{2019}s on-device model, on \(meta.where ?? "this device") \u{B7} \(n)\(secs) \u{B7} $0 \u{B7} no data left the device"
        }
        let cost = d.costUsd.map { $0 == 0 ? " \u{B7} $0" : " \u{B7} $\(jsToFixed($0, 5))" } ?? ""
        let model = (d.model ?? meta.model).map { " (\($0))" } ?? ""
        let brain = meta.provider == nil || meta.provider == "edge" ? "the edge model" : (meta.provider ?? "")
        return "Words by \(brain)\(model) \u{B7} \(n)\(cost)"
    }
    let why = meta.error ?? "No answer."
    let also = meta.onDeviceFailure.map { " Apple\u{2019}s on-device model: \($0)." } ?? ""
    return "The game\u{2019}s own lines, not a model\u{2019}s \u{B7} \(why)\(also)"
}
