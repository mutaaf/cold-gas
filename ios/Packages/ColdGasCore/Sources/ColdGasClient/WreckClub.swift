// Wreck Club ranks (0242; operator's call 2026-11-13): feats earned by play, on this device, no accounts. Feats raise the
// rank; ranks unlock paints for the car. Cosmetic only: an unlock never touches a score, the physics, a tier, a course or
// the log. No timers, no purchases, no ads, nothing that expires: every feat is reachable by flying.
import Foundation
import ColdGasCore

public enum WreckClub {
    /// One feat: an id that's stored, the name shown, and how to earn it (shown before it's earned: the feats are goals).
    public struct Feat: Equatable, Sendable {
        public let id: String, name: String, how: String
    }
    public static let feats: [Feat] = [
        Feat(id: "first-wreck", name: "Write-off", how: "Wreck the car."),
        Feat(id: "stick", name: "Stuck it", how: "Land a run the crew calls Stuck it or better."),
        Feat(id: "combo3", name: "Chain reaction", how: "A \u{D7}3 combo in one wreck."),
        Feat(id: "rollover2", name: "Barrel roll", how: "Roll the car over twice in one wreck."),
        Feat(id: "topple", name: "Domino", how: "Knock a parked car onto its side."),
        Feat(id: "double", name: "Double", how: "Land a 720."),
        Feat(id: "wreck50", name: "Scrap value", how: "Score 50 or more on Wreck."),
        Feat(id: "mark", name: "On the mark", how: "Land within a metre of the mark."),
        Feat(id: "combo5", name: "Choreographer", how: "A \u{D7}5 combo in one wreck."),
        Feat(id: "three-sets", name: "Backlot tour", how: "Land on the Show, the Wall and the Lineup."),
        Feat(id: "perfect", name: "Perfect 10", how: "A Perfect 10."),
        Feat(id: "wreck75", name: "Total loss", how: "Score 75 or more on Wreck."),
    ]
    /// The ranks, by feats earned.
    public struct Rank: Equatable, Sendable { public let name: String, feats: Int }
    public static let ranks: [Rank] = [
        Rank(name: "Rookie", feats: 0), Rank(name: "Stand-in", feats: 2), Rank(name: "Stunt double", feats: 4),
        Rank(name: "Wheel artist", feats: 6), Rank(name: "Crew chief", feats: 9), Rank(name: "Legend of the lot", feats: 12),
    ]
    /// A paint for the car (linear-ish sRGB 0…1), unlocked at a rank. "factory" is everyone's from the start.
    public struct Paint: Equatable, Sendable {
        public let id: String, name: String, rank: Int, r: Float, g: Float, b: Float
        /// The car as it was built: no colour of ours over it.
        public var isFactory: Bool { id == "factory" }
    }
    public static let paints: [Paint] = [
        Paint(id: "factory", name: "Factory", rank: 0, r: -1, g: -1, b: -1),
        Paint(id: "dust", name: "Backlot dust", rank: 1, r: 0.62, g: 0.55, b: 0.45),
        Paint(id: "signal", name: "Signal red", rank: 2, r: 0.78, g: 0.09, b: 0.11),
        Paint(id: "night", name: "Blue hour", rank: 3, r: 0.10, g: 0.17, b: 0.34),
        Paint(id: "hazard", name: "Hazard", rank: 4, r: 0.92, g: 0.62, b: 0.05),
        Paint(id: "chrome", name: "Gaffer chrome", rank: 5, r: 0.86, g: 0.87, b: 0.89),
    ]

    /// What this device has earned: the feats (by id, the day each was earned), the sets landed, and the paint chosen.
    public struct Book: Codable, Equatable, Sendable {
        public var feats: [String: Double] = [:]
        public var landed: [String] = []
        public var paint: String?
        public init() {}
        enum CodingKeys: String, CodingKey { case feats, landed, paint }
        public init(from decoder: Decoder) throws {
            guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
            // Unknown feats from a newer build are kept; junk entries cost only themselves.
            if let raw = try? c.decodeIfPresent([String: JSValue].self, forKey: .feats) { feats = raw.compactMapValues { $0.numberValue } }
            landed = ((try? c.decodeIfPresent([String].self, forKey: .landed)).flatMap { $0 } ?? []).filter { COURSE_IDS.contains($0) }
            paint = (try? c.decodeIfPresent(String.self, forKey: .paint)).flatMap { $0 }
        }
        public var count: Int { WreckClub.feats.reduce(0) { $0 + (feats[$1.id] != nil ? 1 : 0) } }
        public var rankIndex: Int { WreckClub.ranks.lastIndex { count >= $0.feats } ?? 0 }
        public var rank: Rank { WreckClub.ranks[rankIndex] }
        /// The next rank and how many more feats it needs, or nil at the top.
        public var next: (rank: Rank, more: Int)? {
            let i = rankIndex + 1
            guard i < WreckClub.ranks.count else { return nil }
            return (WreckClub.ranks[i], WreckClub.ranks[i].feats - count)
        }
        public func unlocked(_ p: Paint) -> Bool { p.rank <= rankIndex }
        /// The paint on the car: the chosen one if it's still unlocked, else the factory's.
        public var currentPaint: Paint {
            WreckClub.paints.first { $0.id == paint && unlocked($0) } ?? WreckClub.paints[0]
        }
    }

    /// What one finished run is, for the feats: the card's facts and the Wreck card's summary. Pure inputs.
    public struct RunFacts: Equatable, Sendable {
        public var course: String, landed: Bool, verdict: String, rotations: Double, padMiss: Double?, crashed: Bool
        public var wreckTotal: Double, bestCombo: Int, rollovers: Int, toppled: Int
        public init(course: String, landed: Bool, verdict: String, rotations: Double = 0, padMiss: Double? = nil, crashed: Bool,
                    wreckTotal: Double = 0, bestCombo: Int = 0, rollovers: Int = 0, toppled: Int = 0) {
            self.course = course; self.landed = landed; self.verdict = verdict; self.rotations = rotations; self.padMiss = padMiss
            self.crashed = crashed; self.wreckTotal = wreckTotal; self.bestCombo = bestCombo; self.rollovers = rollovers; self.toppled = toppled
        }
    }

    /// The feats this run earns (whether or not they're new).
    public static func earned(_ r: RunFacts, landedSets: [String]) -> [String] {
        var out: [String] = []
        if r.crashed && r.wreckTotal > 0 || r.verdict == "Wrecked" { out.append("first-wreck") }
        if r.landed && ["Stuck it", "Perfect 10"].contains(r.verdict) { out.append("stick") }
        if r.landed && r.verdict == "Perfect 10" { out.append("perfect") }
        if r.bestCombo >= 3 { out.append("combo3") }
        if r.bestCombo >= 5 { out.append("combo5") }
        if r.rollovers >= 2 { out.append("rollover2") }
        if r.toppled >= 1 { out.append("topple") }
        if r.landed && abs(r.rotations) >= 2 { out.append("double") }
        if r.wreckTotal >= 50 { out.append("wreck50") }
        if r.wreckTotal >= 75 { out.append("wreck75") }
        if r.landed, let m = r.padMiss, m.isFinite, m <= 1 { out.append("mark") }
        if Set(landedSets + (r.landed ? [r.course] : [])).isSuperset(of: COURSE_IDS) { out.append("three-sets") }
        return out
    }

    /// Fold a run into the book: the feats it newly earned (in the list's order) and whether the rank rose.
    @discardableResult
    public static func record(_ r: RunFacts, into book: inout Book, now: Double) -> (new: [Feat], rankUp: Rank?) {
        let before = book.rankIndex
        if r.landed && COURSE_IDS.contains(r.course) && !book.landed.contains(r.course) { book.landed.append(r.course) }
        let got = Set(earned(r, landedSets: book.landed))
        var new: [Feat] = []
        for f in feats where got.contains(f.id) && book.feats[f.id] == nil { book.feats[f.id] = now; new.append(f) }
        return (new, book.rankIndex > before ? book.rank : nil)
    }
}
