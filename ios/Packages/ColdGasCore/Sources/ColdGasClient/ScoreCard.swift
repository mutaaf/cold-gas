// The scorecard, as the Worker answers it (`card` on POST /scores and in the judges' `verify` event) and as the Swift
// sim's flat card unflattens to: the same JSON shape as src/sim/judge.js scoreRun. The facts stay loosely typed, because
// the code ported from the web reads them as JS reads a plain object (null ≠ undefined, ToNumber on compare).
import Foundation

public struct JudgeScore: Codable, Equatable {
    public var id: String, name: String?, title: String?, score: Double
    public init(id: String, name: String? = nil, title: String? = nil, score: Double) { self.id = id; self.name = name; self.title = title; self.score = score }
}

public struct ScoreCard: Codable, Equatable {
    public var total: Double
    public var verdict: String
    public var tier: String?
    public var course: String?
    public var multiplier: Double?
    public var judges: [JudgeScore]?
    public var categories: [String: Double]?
    public var facts: JSValue
    public init(total: Double, verdict: String, tier: String? = nil, course: String? = nil, multiplier: Double? = nil, judges: [JudgeScore]? = nil, categories: [String: Double]? = nil, facts: JSValue) {
        self.total = total; self.verdict = verdict; self.tier = tier; self.course = course; self.multiplier = multiplier
        self.judges = judges; self.categories = categories; self.facts = facts
    }
    enum CodingKeys: String, CodingKey { case total, verdict, tier, course, multiplier, judges, categories, facts }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = try c.decode(Double.self, forKey: .total)
        verdict = (try? c.decodeIfPresent(String.self, forKey: .verdict)) ?? ""
        tier = try? c.decodeIfPresent(String.self, forKey: .tier)
        course = try? c.decodeIfPresent(String.self, forKey: .course)
        multiplier = try? c.decodeIfPresent(Double.self, forKey: .multiplier)
        judges = try? c.decodeIfPresent([JudgeScore].self, forKey: .judges)
        categories = try? c.decodeIfPresent([String: Double].self, forKey: .categories)
        facts = (try? c.decodeIfPresent(JSValue.self, forKey: .facts)) ?? .object([])
    }
    /// A card from JSON text, with its facts in the text's key order.
    public init?(json: JSValue) {
        guard let c = json.decode(ScoreCard.self) else { return nil }
        self = c
        if let f = json["facts"] { facts = f }
    }
    /// A card from the sim's flattened form (Card.flat): paths like "facts.sink", "judges[0].score", "categories.landing".
    public init?(flat: [(String, JSValue)]) { self.init(json: JSValue.unflatten(flat)) }
}

/// The facts as the web's ported code reads them: `n` is ToNumber, `s` is ToString, `b` is ToBoolean, `v` the raw value.
struct Facts {
    let o: JSValue
    init(_ card: ScoreCard) { o = card.facts }
    func v(_ k: String) -> JSValue? { o[k] }
    func n(_ k: String) -> Double { jsNumber(o[k]) }
    func s(_ k: String) -> String { jsString(o[k]) }
    func b(_ k: String) -> Bool { truthy(o[k]) }
}
