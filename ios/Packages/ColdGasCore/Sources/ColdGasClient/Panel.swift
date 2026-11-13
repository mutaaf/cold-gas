// src/panel.js, the parts with no network: the judges' local lines (localWords, the receipt's reasons), the board's row
// and the player's words for a post, and the Worker's parseWords (the live strip reads the words out of the stream).
// The network half is ios/ColdGas/Net. Pinned by Tests/Vectors/client.json.
import Foundation
import ColdGasCore

public let COURSE_IDS = ["show", "wall", "lineup"]

/// What the panel said. `source`: "ai" (the model's) or "local" (the game's own lines).
public struct JudgeWords: Codable, Equatable, Sendable {
    public var headline: String, engineer: String, coordinator: String, designer: String
    public var source: String?
    public init(headline: String = "", engineer: String = "", coordinator: String = "", designer: String = "", source: String? = nil) {
        self.headline = headline; self.engineer = engineer; self.coordinator = coordinator; self.designer = designer; self.source = source
    }
}

// --- the local lines ---------------------------------------------------------------------------------
/// Why the panel spoke from local lines (invariant 5½: they're never passed off as the judges').
public enum LocalReason: String, Codable { case stale, chunk, breaker }
public let LOCAL_WHY: [String: String] = [
    "stale": "A new version is live: the AI judges come back from the title",
    "chunk": "The judges\u{2019} chunk didn\u{2019}t load",
    "breaker": "The judges are resting",
]
/// `Math.abs(Math.round(seed * 997)) % arr.length`: which line, from the same facts.
func pick(_ arr: [String], _ seed: Double) -> String {
    let r = abs(jsRound(seed * 997))
    guard r.isFinite else { return arr[0] }
    return arr[Int(r.truncatingRemainder(dividingBy: Double(arr.count)))]
}
private func local(_ h: String, _ e: String, _ c: String, _ d: String) -> JudgeWords { JudgeWords(headline: h, engineer: e, coordinator: c, designer: d, source: "local") }

public func localWords(_ card: ScoreCard) -> JudgeWords {
    let f = Facts(card)
    if f.n("damagePct") >= 60 {
        return local("Wrecked", "The damage sensor reads \(f.s("damagePct"))%. That car does not drive home: it goes back on a flatbed.", "Big, brave, and expensive. Land the next one in one piece.", "The shape was the point. You bent it.")
    }
    if f.v("course") == .string("wall") { return wallWords(card, f) }
    if f.v("course") == .string("show") { return showWords(card, f) }
    let s = f.n("sink") + f.n("tiltDeg") + f.n("padMiss")
    if !f.b("jumped") {
        return local("No jump recorded", "The car never left the ground long enough to measure. Nothing to grade.", "The ramp is right there. Hit it with intent and give me something.", "Restraint is a virtue. This was too much of it.")
    }
    if f.b("contact") {
        return local("Contact with the lineup", "Hull contact with a parked vehicle at \(f.s("apex")) m apex. That ends the evaluation.", "You had the nerve. You needed another metre of altitude.", "The line was there. The clearance was not.")
    }
    if f.b("flipped") || f.b("crashed") {
        return local("Over the bar, off its wheels", "Touchdown at \(f.s("sink")) m/s with \(f.s("tiltDeg"))\u{B0} of tilt. The suspension never had a chance.", "Big air, big rotation, and then gravity collected its fee.", "Everything before the ground was beautiful.")
    }
    let engineer = f.n("sink") < 1.5 && f.n("wheelSpreadMs") < 40
        ? pick(["Four wheels inside \(f.s("wheelSpreadMs")) ms at \(f.s("sink")) m/s. That is a production-grade landing.", "Sink rate \(f.s("sink")) m/s, tilt \(f.s("tiltDeg"))\u{B0}. I would sign that off."], s)
        : pick(["Touchdown at \(f.s("sink")) m/s with \(f.s("wheelSpreadMs")) ms between first and last wheel. Tighten the retro burn.", "\(f.s("tiltDeg"))\u{B0} of tilt at contact. Level earlier and let the computer settle it."], s)
    let coordinator = f.n("rotations") >= 2
        ? "A \(f.s("rollDeg"))\u{B0} double over a semi. I have waited my whole career for that."
        : f.v("rotations") == .number(1)
            ? pick(["\(f.s("apex")) metres and a full \(f.s("rollDeg"))\u{B0} roll. That is the shot.", "Clean roll, \(f.s("clearance")) m over the roofs. The crowd felt that one."], s)
            : "You flew it, but you did not roll it. Give me the rotation."
    let designer = f.n("airPct") > 40
        ? pick(["\(f.s("airPct"))% of the air still in the tanks. Nothing wasted, nothing missing.", "Quiet, exact, \(f.s("airPct"))% in reserve. That is how it should feel."], s)
        : pick(["Effective, but \(f.s("airPct"))% left in the tanks tells me it was loud in places.", "The shape was right. The burn was heavy."], s)
    return JudgeWords(headline: card.verdict, engineer: engineer, coordinator: coordinator, designer: designer, source: "local")
}

private func wallWords(_ card: ScoreCard, _ f: Facts) -> JudgeWords {
    let s = f.n("height") + f.n("sink") + f.n("padMiss")
    if f.b("fellOff") { return local("Off the side of the deck", "Lateral drift exceeded the deck width at height. Keep it on the centreline before you add speed.", "The wall doesn\u{2019}t forgive a wandering line. Straighten up and go again.", "Symmetry first. Everything else follows.") }
    if !f.b("jumped") { return local(f.n("progressPct") > 50 ? "Stalled on the wall" : "No climb", "\(f.s("progressPct"))% of the curl at \(f.s("entryKmh")) km/h entry. The fan holds you; the motors have to lift you.", "Commit to the climb. Hold GO all the way to the ledge.", "Hesitation reads from the grandstand.") }
    if f.b("landedOnRamp") { return local("Came down on the deck", "You released too low; the car fell back onto the curl. Release at the ledge.", "So close. Ride it higher before you let go.", "The landing belongs on the pad, not the ramp.") }
    if f.b("flipped") || f.b("crashed") { return local("Down, not done", "Touchdown at \(f.s("sink")) m/s with \(f.s("tiltDeg"))\u{B0} of tilt. Finish the roll before you land.", "\(f.s("height")) m up and \(f.s("invertedS")) s inverted. The hard part was right.", "Everything before the ground was beautiful.") }
    let engineer = f.n("sink") < 1.5 && f.n("wheelSpreadMs") < 60
        ? pick(["\(f.s("sink")) m/s at contact after a \(f.s("launchHeight")) m drop. That is a controlled descent.", "Four wheels inside \(f.s("wheelSpreadMs")) ms, \(f.s("maxG")) g peak on the curl. Clean."], s)
        : pick(["Touchdown at \(f.s("sink")) m/s, \(f.s("tiltDeg"))\u{B0} of tilt. Hold LAND longer and let it level.", "\(f.s("wheelSpreadMs")) ms between first and last wheel. Level before contact."], s)
    let coordinator = f.n("invertedS") > 0.8
        ? "\(f.s("invertedS")) seconds upside down at \(f.s("height")) metres. That is the shot."
        : pick(["Up the curl, over the ledge, \(jsNumberString(jsMax(f.n("rollDeg"), f.n("pitchDeg"))))\u{B0} to upright. The crowd felt that.", "Hang it longer under the ledge next time. Make them wait."], s)
    let designer = f.n("airPct") > 30
        ? "\(f.s("airPct"))% of the nitrogen left. Restraint, not panic."
        : "\(f.s("airPct"))% gas left. Effective, but the burn was heavy."
    return JudgeWords(headline: card.verdict, engineer: engineer, coordinator: coordinator, designer: designer, source: "local")
}

/// The Show: the Wall's lines, plus the carry over the row.
private func showWords(_ card: ScoreCard, _ f: Facts) -> JudgeWords {
    var words = wallWords(card, f)
    if !f.b("jumped") || f.b("fellOff") || f.b("landedOnRamp") { return words }
    if f.b("contact") {
        words.headline = "Contact with the row"
        words.engineer = "Released at \(f.s("launchHeight")) m, but the car came down on a parked vehicle. Boost harder off the ledge."
        words.coordinator = "\(f.s("invertedS")) s inverted, then into the roofs. The carry is the stunt."
        words.designer = "The row was the frame. You hit the frame."
        return words
    }
    if !f.b("crossedRow") {
        words.headline = "Short of the row"
        words.coordinator = "Let go, then light the rear jets: you have to carry out over all five."
        return words
    }
    words.coordinator = pick(["\(f.s("invertedS")) seconds upside down at \(f.s("height")) metres, then \(f.s("clearance")) m over the roofs. That is the show.",
                              "Off the ledge and over the semi in one flight. The crowd got all of it."], f.n("height") + f.n("sink"))
    return words
}

// --- parseWords (src/worker/ai/prompt.js) ------------------------------------------------------------------
private let WORD_LABELS: [(WritableKeyPath<JudgeWords, String>, String, Int)] = [(\.headline, "HEADLINE", 60), (\.engineer, "ENGINEER", 200), (\.coordinator, "COORDINATOR", 200), (\.designer, "DESIGNER", 200)]
private let WORD_RES: [NSRegularExpression] = WORD_LABELS.map {
    // JS's `\s` spans lines here too; `[^\n]+` is the rest of the label's line.
    try! NSRegularExpression(pattern: "(?:^|\\n)\\s*[-*]?\\s*\($0.1)\\s*[:\\-\u{2013}]\\s*([^\\n]+)", options: [.caseInsensitive])
}
/// The words in a model's raw text (tolerant: labels may be bolded or lower-case; missing parts come back empty).
public func parseWords(_ text: String) -> JudgeWords {
    var out = JudgeWords()
    let clean = text.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "**", with: "")
    let ns = clean as NSString
    for (i, (path, _, cap)) in WORD_LABELS.enumerated() {
        guard let m = WORD_RES[i].firstMatch(in: clean, range: NSRange(location: 0, length: ns.length)) else { continue }
        var s = jsTrim(ns.substring(with: m.range(at: 1)))
        if s.hasPrefix("\"") || s.hasPrefix("\u{201C}") { s.removeFirst() }
        if s.hasSuffix("\"") || s.hasSuffix("\u{201D}") { s.removeLast() }
        out[keyPath: path] = jsSlice(s, cap)
    }
    return out
}
/// `s.slice(0, n)`: UTF-16 code units, as JS counts.
func jsSlice(_ s: String, _ n: Int) -> String {
    let u = s.utf16
    return u.count <= n ? s : String(decoding: Array(u.prefix(n)), as: UTF16.self)
}

// --- the board ---------------------------------------------------------------------------------------
/// A row as the board draws it.
public struct BoardRow: Equatable {
    public var initials: String, verdict: String, rollDeg: Double, sink: Double, total: Double
    public var tier: String?, course: String?
}
private func num(_ v: JSValue?) -> Double? { let n = jsNumber(v); return n.isFinite ? n : nil }
/// `v ?? …`'s test: null and undefined are both "nothing".
private func present(_ v: JSValue?) -> JSValue? { if let v, v != .null { return v }; return nil }
private let TIER_LABEL = ["assist": "Assist", "pro": "Pro", "advanced": "Advanced"]
/// boardRow: a row, or nil if it can't be drawn. One malformed row from the server never blanks the whole list.
public func boardRow(_ r: JSValue?) -> BoardRow? {
    guard let r, r.isObject || r.isArray, let total = num(r["total"]) else { return nil }
    let fv = r["facts"], f: JSValue = truthy(fv) && (fv?.isObject == true || fv?.isArray == true) ? fv! : .object([])
    let rawIni = present(r["initials"]) ?? .string("???")
    let letters = String(String.UnicodeScalarView(jsString(rawIni).unicodeScalars.filter { ($0.value >= 65 && $0.value <= 90) || ($0.value >= 97 && $0.value <= 122) }))
    let ini = String(letters.prefix(3)).uppercased()
    let rawV = present(r["verdict"]) ?? .string("")
    let verdict = jsSlice(jsString(rawV), 40)
    return BoardRow(initials: ini.isEmpty ? "???" : ini, verdict: verdict.isEmpty ? "Judged" : verdict,
                    rollDeg: num(f["rollDeg"]) ?? 0, sink: num(f["sink"]) ?? 0, total: total,
                    tier: TIER_LABEL[jsString(r["tier"])], course: r["course"]?.stringValue.flatMap { COURSE_IDS.contains($0) ? $0 : nil })
}

/// GET /scores: `rows` may be anything; each is checked by boardRow.
public struct BoardResponse: Codable {
    public var board: String?, course: String?
    public var rows: JSValue?
    enum CodingKeys: String, CodingKey { case board, course, rows }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        board = try? c.decodeIfPresent(String.self, forKey: .board)
        course = try? c.decodeIfPresent(String.self, forKey: .course)
        rows = try? c.decodeIfPresent(JSValue.self, forKey: .rows)
    }
    /// The drawable rows, or nil when `rows` isn't a list (as if offline).
    public var boardRows: [BoardRow]? { rows?.arrayValue?.compactMap { boardRow($0) } }
}

/// POST /scores' body: { card, course, tier, rank, dry } or { error[, why] }.
public struct ScoresResponse: Codable, Equatable {
    public var card: ScoreCard?, course: String?, tier: String?, rank: Double?, dry: Bool?, error: String?, why: String?
    public init(card: ScoreCard? = nil, course: String? = nil, tier: String? = nil, rank: Double? = nil, dry: Bool? = nil, error: String? = nil, why: String? = nil) {
        self.card = card; self.course = course; self.tier = tier; self.rank = rank; self.dry = dry; self.error = error; self.why = why
    }
    enum CodingKeys: String, CodingKey { case card, course, tier, rank, dry, error, why }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        card = try? c.decodeIfPresent(ScoreCard.self, forKey: .card)
        course = try? c.decodeIfPresent(String.self, forKey: .course)
        tier = try? c.decodeIfPresent(String.self, forKey: .tier)
        rank = try? c.decodeIfPresent(Double.self, forKey: .rank)
        dry = try? c.decodeIfPresent(Bool.self, forKey: .dry)
        error = try? c.decodeIfPresent(String.self, forKey: .error)
        why = try? c.decodeIfPresent(String.self, forKey: .why)
    }
    /// The whole-number rank ≥ 1, if the answer has one.
    public var validRank: Int? { rank.flatMap { $0 >= 1 && $0 == $0.rounded() && $0 < 1e9 ? Int($0) : nil } }
}
/// postScore's answer: the HTTP outcome and the body.
public struct PostResult: Equatable {
    public var ok: Bool, status: Int, timeout: Bool
    public var response: ScoresResponse
    public init(ok: Bool, status: Int, timeout: Bool = false, response: ScoresResponse = ScoresResponse()) {
        self.ok = ok; self.status = status; self.timeout = timeout; self.response = response
    }
    public var rank: Int? { response.validRank }
    public var error: String? { response.error }
}
/// rankLabel: the button's words for that rank ("would be #1 today"), or nothing.
public func rankLabel(_ rank: Int?) -> String { if let rank, rank >= 1 { return "would be #\(rank) today" }; return "" }
/// postMessage: what the player reads after a post.
public func postMessage(_ res: PostResult) -> String {
    if res.ok { return "Posted \u{B7} #\(res.response.rank.map { jsNumberString($0) } ?? "undefined") today" }
    if res.status == 429 { return "Slow down a little." }
    if res.timeout || res.status == 0 { return "The board didn\u{2019}t answer. Try again." }
    switch res.error {
    case "update": return "This page is out of date: reload to post."
    case "no jump": return "Only a landed jump goes on the board."
    case "implausible", "bad run": return "The board couldn\u{2019}t check this run."
    case "initials": return "Three letters."
    default: return "The board is offline."
    }
}
