// The judges' call with no network in it: the Worker's event stream (POST /coldgas/api/judge/stream, text/event-stream:
// verify → prompt → reasoning/token… → done | error), a parser for it (src/ai/stream.js), the breaker that rests the AI
// panel after repeated failures (src/obs/breaker.js) and the deadlines (src/main.js, src/net.js). The call itself is
// ios/ColdGas/Net/Judges.swift.
import Foundation
import ColdGasCore

public let JUDGE_MS = 35_000.0          // invariant 5½: no AI call may block the results longer than this
public let JUDGES_FAIR_MS = 30_000.0    // src/net.js: a deadline counts against the breaker only if the provider had most of it
/// src/net.js judgesOverran.
public func judgesOverran(_ error: String?, providerMs: Double) -> Bool {
    (error ?? "").contains("too long") && providerMs >= JUDGES_FAIR_MS
}
/// Which brain writes the words: the free edge model unless the player brings a key (sent as x-cg-key for that one call).
public struct JudgeAI: Equatable {
    public var provider: String, model: String?, key: String?
    public init(provider: String = "edge", model: String? = "@cf/google/gemma-4-26b-a4b-it", key: String? = nil) { self.provider = provider; self.model = model; self.key = key }
    public static let edge = JudgeAI()   // src/ai/config.js EDGE_DEFAULT
}

// --- the events --------------------------------------------------------------------------------------
public struct JudgeVerify: Codable, Equatable {
    public var ms: Double?
    public var card: ScoreCard
    public var ticks: Double?
    public var replayed: Bool?
}
public struct JudgePrompt: Codable, Equatable {
    public var provider: String?, providerLabel: String?, vendor: String?, model: String?, colo: String?, `where`: String?, system: String?, user: String?, inTokensEst: Double?
}
public struct JudgeChunk: Codable, Equatable { public var t: String }
public struct JudgeNote: Codable, Equatable { public var message: String?, model: String? }
public struct JudgeDone: Codable, Equatable {
    public var words: JudgeWords
    public var provider: String?, model: String?, colo: String?, billedTo: String?, raw: String?
    public var ttftMs: Double?, totalMs: Double?, verifyMs: Double?, inTokens: Double?, outTokens: Double?, neurons: Double?, tokensPerSec: Double?, costUsd: Double?
    /// The app's own (0219), never sent by the Worker: where the token counts came from ("reported" or "estimate"), and
    /// whether the words were written on this device.
    public var tokens: String?, onDevice: Bool?
    public init(words: JudgeWords) { self.words = words }
}
public struct JudgeFailure: Codable, Equatable {
    public var message: String, fallback: Bool?, offline: Bool?
    public init(message: String, fallback: Bool? = true, offline: Bool? = nil) { self.message = message; self.fallback = fallback; self.offline = offline }
}
/// The receipt: who spoke, and if it wasn't the AI, why (invariant 5½, src/panel.js localMeta).
public struct JudgeMeta: Equatable {
    public var ok: Bool
    public var local: LocalReason?, error: String?
    public var provider: String?, model: String?, `where`: String?
    public var done: JudgeDone?, verify: JudgeVerify?
    /// Why Apple's on-device model didn't write these words when it was asked first (0219), for the receipt.
    public var onDeviceFailure: String?
    public init(ok: Bool, local: LocalReason? = nil, error: String? = nil, provider: String? = nil, model: String? = nil, where w: String? = nil, done: JudgeDone? = nil, verify: JudgeVerify? = nil) {
        self.ok = ok; self.local = local; self.error = error; self.provider = provider; self.model = model; self.where = w; self.done = done; self.verify = verify
    }
    public static func localMeta(_ reason: LocalReason) -> JudgeMeta {
        JudgeMeta(ok: false, local: reason, error: LOCAL_WHY[reason.rawValue] ?? LOCAL_WHY["chunk"], model: "", where: "")
    }
}
/// What `judges(…)` yields. `.finished` always comes last, exactly once: the words to show (the model's, or the local
/// lines) and the receipt. Everything before it is for the live strip and the theatre.
public enum JudgeEvent: Equatable {
    case verify(JudgeVerify)
    case prompt(JudgePrompt)
    case reasoning(String)
    /// A token, with the words parsed out of the text so far.
    case token(String, words: JudgeWords)
    case note(JudgeNote)
    case done(JudgeDone)
    case error(JudgeFailure)
    case finished(words: JudgeWords, meta: JudgeMeta)
}

// --- the stream --------------------------------------------------------------------------------------
/// Reads server-sent events as src/ai/stream.js does: blocks split on a blank line, an `event: ` line and a `data: ` line
/// each. Fed bytes, because a chunk can end anywhere (UTF-8 never has a newline inside a character).
public struct SSEParser {
    var buf: [UInt8] = []
    public init() {}
    public struct Message: Equatable { public let event: String, data: String }
    public mutating func feed<S: Sequence>(_ bytes: S) -> [Message] where S.Element == UInt8 {
        buf.append(contentsOf: bytes)
        var out: [Message] = []
        var start = 0, i = 0
        while i + 1 < buf.count {
            if buf[i] == 10 && buf[i + 1] == 10 {
                if let m = SSEParser.block(buf[start..<i]) { out.append(m) }
                i += 2; start = i
            } else { i += 1 }
        }
        if start > 0 { buf.removeFirst(start) }
        return out
    }
    static func block(_ b: ArraySlice<UInt8>) -> Message? {
        var ev: String?, data: String?
        for line in b.split(separator: 10, omittingEmptySubsequences: true) {
            let s = String(decoding: line, as: UTF8.self)
            if ev == nil, s.hasPrefix("event: "), s.count > 7 { ev = String(s.dropFirst(7)) }
            else if data == nil, s.hasPrefix("data: "), s.count > 6 { data = String(s.dropFirst(6)) }
        }
        guard let ev, let data else { return nil }
        return Message(event: ev, data: data)
    }
}
/// One message as an event, nil for an unknown event or a data line that doesn't decode (the web logs and carries on).
/// `text` accumulates the model's words for the live parse.
public func judgeEvent(_ m: SSEParser.Message, text: inout String) -> JudgeEvent? {
    func dec<T: Decodable>(_ t: T.Type) -> T? { try? JSONDecoder().decode(T.self, from: Data(m.data.utf8)) }
    switch m.event {
    case "verify": return dec(JudgeVerify.self).map { .verify($0) }
    case "prompt": return dec(JudgePrompt.self).map { .prompt($0) }
    case "reasoning": return dec(JudgeChunk.self).map { .reasoning($0.t) }
    case "token":
        guard let c = dec(JudgeChunk.self) else { return nil }
        text += c.t
        return .token(c.t, words: parseWords(text))
    case "note": return dec(JudgeNote.self).map { .note($0) }
    case "done": return dec(JudgeDone.self).map { .done($0) }
    case "error": return dec(JudgeFailure.self).map { .error($0) }
    default: return nil
    }
}

// --- the breaker -------------------------------------------------------------------------------------
/// src/obs/breaker.js's state, plain so the save can keep it: a subsystem that broke last session stays off at the next
/// boot until its cooldown has passed, then gets one trial. Times are ms since the epoch.
public struct BreakerState: Codable, Equatable {
    public var state = "closed", fails = 0, firstFail = 0.0, openUntil = 0.0, trips = 0, lastError = "", lastChange = 0.0
    public init() {}
    enum CodingKeys: String, CodingKey { case state, fails, firstFail, openUntil, trips, lastError, lastChange }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = (try? c.decodeIfPresent(String.self, forKey: .state)).flatMap { $0 } ?? "closed"
        fails = (try? c.decodeIfPresent(Int.self, forKey: .fails)).flatMap { $0 } ?? 0
        firstFail = (try? c.decodeIfPresent(Double.self, forKey: .firstFail)).flatMap { $0 } ?? 0
        openUntil = (try? c.decodeIfPresent(Double.self, forKey: .openUntil)).flatMap { $0 } ?? 0
        trips = (try? c.decodeIfPresent(Int.self, forKey: .trips)).flatMap { $0 } ?? 0
        lastError = (try? c.decodeIfPresent(String.self, forKey: .lastError)).flatMap { $0 } ?? ""
        lastChange = (try? c.decodeIfPresent(Double.self, forKey: .lastChange)).flatMap { $0 } ?? 0
    }
}
/// closed: calls go through; 2 failures inside a minute open it. open: refused until `openUntil` (30 s, doubling to 30 min).
/// half-open: one trial, success closes it, failure re-opens it for twice as long.
public struct Breaker: Equatable {
    public static let threshold = 2, windowMs = 60_000.0, baseCooldownMs = 30_000.0, maxCooldownMs = 30 * 60_000.0
    public var s: BreakerState
    public init(_ s: BreakerState = BreakerState()) { self.s = s }
    public var state: String { s.state }
    private mutating func change(_ to: String, _ now: Double) { if s.state != to { s.state = to; s.lastChange = now } }
    /// May the subsystem be used now? (Open past its cooldown → half-open: one trial.)
    public mutating func allow(now: Double) -> Bool {
        if s.state == "closed" { return true }
        if s.state == "open" && now >= s.openUntil { change("half-open", now) }
        return s.state == "half-open"
    }
    public mutating func success(now: Double) {
        if s.state == "closed" && s.fails == 0 { return }
        s.fails = 0; s.firstFail = 0
        if s.state != "closed" { s.trips = Swift.max(0, s.trips - 1); change("closed", now) }
    }
    public mutating func failure(_ error: String, now: Double) {
        s.lastError = jsSlice(error, 120)
        if s.state == "half-open" { open(now); return }
        if s.state == "open" { return }
        if s.fails == 0 || now - s.firstFail > Breaker.windowMs { s.fails = 0; s.firstFail = now }
        s.fails += 1
        if s.fails >= Breaker.threshold { open(now) }
    }
    private mutating func open(_ t: Double) {
        let cooldown = Swift.min(Breaker.maxCooldownMs, Breaker.baseCooldownMs * jsPow2(s.trips))
        s.openUntil = t + cooldown
        s.trips += 1; s.fails = 0; s.firstFail = 0
        change("open", t)
    }
    /// Ms until a trial is allowed (0 when closed or due).
    public func retryIn(now: Double) -> Double { s.state == "open" ? Swift.max(0, s.openUntil - now) : 0 }
    public mutating func reset() { s = BreakerState() }
}
private func jsPow2(_ n: Int) -> Double { n >= 1023 ? .infinity : Double(sign: .plus, exponent: Swift.max(0, n), significand: 1) }

// --- request bodies ----------------------------------------------------------------------------------
/// The bodies the web posts, byte for byte (the Worker reads them as JSON, so the order isn't load-bearing, but the
/// goldens pin them to JSON.stringify's output). `t` is the run's telemetry (Telemetry.json in ColdGasPhysics).
public enum RequestBody {
    public static func log(_ log: [[Int]]) -> JSValue { .array(log.map { .array($0.map { .number(Double($0)) }) }) }
    /// postScore: { log, t, initials, course }.
    public static func post(log l: [[Int]], t: JSValue, initials: String, course: String) -> JSValue {
        .object([("log", log(l)), ("t", t), ("initials", .string(initials)), ("course", .string(course))])
    }
    /// dryRank: { log, t, course, dry: true }. No initials: a Worker that knows `dry` needs none, and one from before
    /// `dry` answers 400 'initials' instead of storing it, so a dry call can never become a real row.
    public static func dry(log l: [[Int]], t: JSValue, course: String) -> JSValue {
        .object([("log", log(l)), ("t", t), ("course", .string(course)), ("dry", .bool(true))])
    }
    /// streamPanel: { log, t, assist, course, provider, model }.
    public static func judges(log l: [[Int]], t: JSValue, assist: Bool, course: String, ai: JudgeAI = .edge) -> JSValue {
        var kv: [(String, JSValue)] = [("log", log(l)), ("t", t), ("assist", .bool(assist)), ("course", .string(course)), ("provider", .string(ai.provider))]
        if let m = ai.model { kv.append(("model", .string(m))) }
        return .object(kv)
    }
}
