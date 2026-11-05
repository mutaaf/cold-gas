// src/medals.js: bronze, silver and gold per event and flight tier, the best on this device. A medal is a reading of the
// score, never a score. The thresholds and where they come from are the web's (docs/backlog/0121-thumb-mastery.md).
// `Medals` is a value: the app keeps it in its save (ios/ColdGas/Model/SaveStore.swift).
import Foundation
import ColdGasCore

public enum Medal: String, Codable, CaseIterable {
    case bronze, silver, gold
    public var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

public struct Medals: Equatable {
    public static let MEDALS: [String: [String: [Double]]] = [
        "show": ["assist": [80, 90, 95], "pro": [82, 92, 96.5], "advanced": [83, 93, 97.5]],
        "wall": ["assist": [84, 90, 94], "pro": [86, 92, 96], "advanced": [87, 93, 97.5]],
        "lineup": ["assist": [72, 84, 90], "pro": [75, 87, 93], "advanced": [77, 89, 95]],
    ]
    /// [bronze, silver, gold], the Show's when the course is unknown, Assist's when the tier is.
    public static func thresholds(course: String, tier: String) -> [Double] {
        let c = MEDALS[course] ?? MEDALS["show"] ?? [:]
        return c[tier] ?? c["assist"] ?? [80, 90, 95]
    }
    /// The medal a total earns (nil under bronze, or not a number).
    public static func medalFor(course: String, tier: String, total: Double) -> Medal? {
        guard total.isFinite else { return nil }
        let th = thresholds(course: course, tier: tier)
        var m: Medal? = nil
        for (i, k) in Medal.allCases.enumerated() where total >= th[i] - 1e-9 { m = k }
        return m
    }
    static func r1(_ x: Double) -> Double { jsRound(x * 10) / 10 }
    public struct Next: Equatable { public var medal: Medal, at: Double, toGo: Double }
    /// The next medal above `best` and how far `from` is short of it (nil when gold is held).
    public static func nextMedal(course: String, tier: String, best: Double?, from: Double? = nil) -> Next? {
        let th = thresholds(course: course, tier: tier), b = best ?? .nan
        for (i, k) in Medal.allCases.enumerated() where !(b >= th[i]) {
            let f = from ?? best ?? .nan, ref = f.isFinite ? f : 0
            return Next(medal: k, at: th[i], toGo: r1(jsMax(0.1, th[i] - ref)))
        }
        return nil
    }
    /// "Silver at 90 · 3.2 to go" (or the gold line when it's held).
    public static func nextTargetText(course: String, tier: String, best: Double?, from: Double? = nil) -> String {
        guard let n = nextMedal(course: course, tier: tier, best: best, from: from) else { return "Gold held \u{B7} beat your best" }
        return "\(n.medal.label) at \(jsNumberString(n.at)) \u{B7} \(jsToFixed(n.toGo, 1)) to go"
    }

    /// `"<course>:<tier>"` → best total. Junk entries are dropped on the way in, as the web's load does.
    public private(set) var best: [String: Double] = [:]
    public init(_ stored: [String: Double] = [:]) {
        for (k, v) in stored where Medals.validKey(k) && v.isFinite && v >= 0 && v <= 100 { best[k] = v }
    }
    static func validKey(_ k: String) -> Bool {
        let p = k.split(separator: ":", omittingEmptySubsequences: false)
        return p.count == 2 && p.allSatisfy { !$0.isEmpty && $0.utf8.allSatisfy { $0 >= 97 && $0 <= 122 } }
    }

    /// getMedals: what's held on this device for an event and tier.
    public struct Held: Equatable {
        public var course: String, tier: String, best: Double?, medal: Medal?, thresholds: [Double], next: Next?
    }
    public func held(course: String, tier: String) -> Held {
        let b = best["\(course):\(tier)"]
        return Held(course: course, tier: tier, best: b, medal: b.flatMap { Medals.medalFor(course: course, tier: tier, total: $0) },
                    thresholds: Medals.thresholds(course: course, tier: tier), next: Medals.nextMedal(course: course, tier: tier, best: b ?? -1))
    }
    public struct Record: Equatable { public var before: Held, after: Held, earned: Medal?, isNew: Bool }
    /// recordRun: count a finished run. The medal it earned, the one held before, and whether it's new.
    public mutating func record(course: String, tier: String, total: Double) -> Record {
        let before = held(course: course, tier: tier)
        guard total.isFinite, Medals.MEDALS[course] != nil else { return Record(before: before, after: before, earned: nil, isNew: false) }
        let k = "\(course):\(tier)"
        if !((best[k] ?? .nan) >= total) { best[k] = Medals.r1(total) }
        let after = held(course: course, tier: tier)
        return Record(before: before, after: after, earned: Medals.medalFor(course: course, tier: tier, total: total),
                      isNew: after.medal != nil && after.medal != before.medal)
    }
}
