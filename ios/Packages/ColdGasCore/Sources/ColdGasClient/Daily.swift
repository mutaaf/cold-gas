// src/daily.js: the daily jump, pure. One objective a day on the existing events, the same for everyone, picked from
// the UTC date by a seeded walk; judged from the run's scorecard; and a streak of consecutive UTC days, kept on this
// device. Pinned against the JS by Tests/Vectors/client.json (the walk over 1,500 days, every check on real and bent
// cards, each hint in each device's words). Times are milliseconds since the epoch, as the web's are.
import Foundation
import ColdGasCore

public enum Daily {
    public static let DAY_MS = 86_400_000.0
    public static let EPOCH = 20454             // 2026-01-01
    public static let COURSE_NAME = ["show": "The Show", "wall": "The Wall", "lineup": "The Lineup"]
    public static func courseName(_ id: String) -> String { COURSE_NAME[id] ?? id }

    /// The device and scheme a hint is worded for (src/pointer.js ctx).
    public struct Pilot: Equatable {
        public enum Device: String { case touch, pad, key }
        public enum Scheme: String { case thumb, classic }
        public var device: Device, scheme: Scheme, tier: String
        public init(device: Device = .touch, scheme: Scheme = .thumb, tier: String = "assist") { self.device = device; self.scheme = scheme; self.tier = tier }
        var thumbOn: Bool { device == .touch && scheme == .thumb }
        /// src/pointer.js coachWords, the three words the Daily's hint uses.
        func word(_ act: String) -> String {
            if thumbOn { return "the pad" }
            let adv = tier == "advanced"
            switch device {
            case .touch:
                switch act { case "land": return "LAND"; case "lift": return adv ? "the four down-jet pads" : "LIFT"; default: return "BOOST" }
            case .pad:
                switch act { case "land": return "LAND (B)"; case "lift": return "LIFT (A)"; default: return "BOOST (RB)" }
            case .key:
                switch act { case "land": return "LAND (Shift)"; case "lift": return "LIFT (Space)"; default: return "BOOST (F)" }
            }
        }
    }

    public struct Result: Equatable {
        public var ok: Bool, miss: String, fix: Bool
        static let done = Result(ok: true, miss: "", fix: false)
        static func missed(_ why: String, fix: Bool = false) -> Result { Result(ok: false, miss: why, fix: fix) }
    }
    public struct Objective {
        public let id: String, course: String, tier: String?
        let goalText: (Units) -> String
        let checkFn: (ScoreCard, Facts, Units) -> Result
        let hint: ((Pilot) -> String)?
        let titleHintFn: ((Pilot, Bool) -> String)?
        /// The line the title shows.
        public func goal(_ units: Units) -> String { goalText(units) }
    }

    private static func landed(_ f: Facts) -> Bool { f.b("jumped") && !f.b("crashed") }
    private static func cleanOver(_ f: Facts) -> Bool { landed(f) && f.b("crossedRow") && !f.b("contact") }
    private static func r1(_ x: Double) -> String { jsToFixed(jsRound(x * 10) / 10, 1) }

    public static let OBJECTIVES: [Objective] = [
        Objective(id: "mark-show", course: "show", tier: nil, goalText: { "Land within \($0.one(.len, 3.5, 1)) of the mark" },
                  checkFn: { _, f, u in !landed(f) ? .missed("no clean landing yet") : f.n("padMiss") <= 3.5 ? .done : .missed("\(u.one(.len, f.n("padMiss"), 1)) off the mark") }, hint: nil, titleHintFn: nil),
        Objective(id: "gas-show", course: "show", tier: nil, goalText: { _ in "Clear the row with more than 25 % gas left" },
                  checkFn: { _, f, _ in !cleanOver(f) ? .missed("clear the row and land clean first") : f.n("airPct") > 25 ? .done : .missed("\(f.s("airPct")) % gas left, need 26 %", fix: true) },
                  hint: { p in p.thumbOn ? "hold the pad from the tap to the ground; letting go and then sliding costs gas"
                      : "shorter \(p.word("boost")) bursts and one late \(p.tier == "assist" ? p.word("land") : p.word("lift"))" },
                  titleHintFn: { p, whole in !p.thumbOn ? "" : whole ? "Hold the pad from the tap to the ground" : "Hold the pad from the tap" }),
        Objective(id: "soft-wall", course: "wall", tier: nil, goalText: { "Touch down at \($0.one(.rate, 0.8, 1)) or softer" },
                  checkFn: { _, f, u in !landed(f) ? .missed("no clean landing yet") : f.n("sink") <= 0.8 ? .done : .missed("touched down at \(u.one(.rate, f.n("sink"), 1))") }, hint: nil, titleHintFn: nil),
        Objective(id: "pro-wall", course: "wall", tier: "pro", goalText: { _ in "Score 85+ on Pro or Advanced" },
                  checkFn: { c, _, _ in c.tier == "assist" ? .missed("fly it on Pro or Advanced") : c.total >= 85 ? .done : .missed("\(r1(c.total)), need 85") }, hint: nil, titleHintFn: nil),
        Objective(id: "skim-show", course: "show", tier: nil, goalText: { "Clear the roofs by under \($0.one(.len, 1.5, 1)) and land clean" },
                  checkFn: { _, f, u in !cleanOver(f) ? .missed("clear the row and land clean first") : f.n("clearance") < 1.5 ? .done : .missed("cleared by \(u.one(.len, f.n("clearance"), 1))") }, hint: nil, titleHintFn: nil),
        Objective(id: "roll-lineup", course: "lineup", tier: nil, goalText: { _ in "Roll a clean 360\u{B0} over the row" },
                  checkFn: { _, f, _ in landed(f) && f.n("rotations") >= 1 ? .done : !landed(f) ? .missed("no clean landing yet") : .missed("rolled \(f.s("rollDeg"))\u{B0}, need 360\u{B0}") }, hint: nil, titleHintFn: nil),
        Objective(id: "stick-wall", course: "wall", tier: nil, goalText: { _ in "Stick it: score 84+" },
                  checkFn: { c, f, _ in c.total >= 84 && landed(f) ? .done : .missed("\(r1(c.total)), need 84") }, hint: nil, titleHintFn: nil),
        Objective(id: "ninety-show", course: "show", tier: nil, goalText: { _ in "Score 90 or more" },
                  checkFn: { c, _, _ in c.total >= 90 ? .done : .missed("\(r1(c.total)), need 90") }, hint: nil, titleHintFn: nil),
        Objective(id: "mark-lineup", course: "lineup", tier: nil, goalText: { "Land within \($0.one(.len, 7)) of the mark" },
                  checkFn: { _, f, u in !landed(f) ? .missed("no clean landing yet") : f.n("padMiss") <= 7 ? .done : .missed("\(u.one(.len, f.n("padMiss"), 1)) off the mark") }, hint: nil, titleHintFn: nil),
        Objective(id: "scratch-show", course: "show", tier: nil, goalText: { _ in "Clear the row without a scratch" },
                  checkFn: { _, f, _ in
                      // (f.damagePct ?? 0) === 0
                      let dmg: JSValue? = { if let d = f.v("damagePct"), d != .null { return d }; return .number(0) }()
                      if cleanOver(f) && dmg == .number(0) { return .done }
                      return !cleanOver(f) ? .missed("clear the row and land clean first") : .missed("\(jsString(f.v("damagePct"))) % damage")
                  }, hint: nil, titleHintFn: nil),
    ]

    /// missLine: the results' line for a missed Daily: the reason with its number, then what to change in this device's words.
    public static func missLine(_ obj: Objective, _ r: Result, _ pilot: Pilot) -> String {
        if r.fix, let h = obj.hint?(pilot), !h.isEmpty { return "Daily: \(r.miss) \u{B7} \(h)" }
        return "Daily: \(r.miss) \u{2014} try again"
    }
    /// titleHint: the title card's hint for today's objective on this device ("" when there is none).
    public static func titleHint(_ obj: Objective, _ pilot: Pilot, whole: Bool = false) -> String { obj.titleHintFn?(pilot, whole) ?? "" }

    // --- dates (UTC) ---------------------------------------------------------------------------------
    public static func dayNumber(_ ms: Double) -> Int { Int((ms / DAY_MS).rounded(.down)) }
    /// Days from 1970-01-01 to a civil date (proleptic Gregorian; month 1–12, a day past the month's end overflows, as Date.parse does).
    static func daysFromCivil(_ y0: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
    static func civilFromDays(_ z0: Int) -> (y: Int, m: Int, d: Int) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp + (mp < 10 ? 3 : -9)
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }
    /// "YYYY-MM-DD" (UTC) for a time.
    public static func dayKey(_ ms: Double) -> String {
        let (y, m, d) = civilFromDays(dayNumber(ms))
        func p(_ v: Int, _ n: Int) -> String { let s = String(v); return String(repeating: "0", count: Swift.max(0, n - s.count)) + s }
        return "\(p(y, 4))-\(p(m, 2))-\(p(d, 2))"
    }
    /// The day number of "YYYY-MM-DD", or nil if it isn't one. V8's parser takes any day 1–31 for any month and overflows.
    public static func keyToDay(_ key: String?) -> Int? {
        guard let key else { return nil }
        let b = Array(key.utf8)
        guard b.count == 10, b[4] == 45, b[7] == 45,
              b.enumerated().allSatisfy({ ($0.offset == 4 || $0.offset == 7) || ($0.element >= 48 && $0.element <= 57) }) else { return nil }
        func int(_ r: Range<Int>) -> Int { r.reduce(0) { $0 * 10 + Int(b[$1]) - 48 } }
        let y = int(0..<4), m = int(5..<7), d = int(8..<10)
        guard m >= 1 && m <= 12 && d >= 1 && d <= 31 else { return nil }
        return daysFromCivil(y, m, d)
    }

    // --- the walk ------------------------------------------------------------------------------------
    /// The 32-bit integer mix (integer ops only: the same in every engine).
    static func mix(_ n: Int) -> UInt32 {
        var h = UInt32(truncatingIfNeeded: n) ^ 0x9E3779B9
        h = h &* 0x85EBCA6B
        h ^= h >> 13
        h = h &* 0xC2B2AE35
        h ^= h >> 16
        return h
    }
    /// The objective for a UTC day: a seeded walk from EPOCH that never gives the same objective two days running.
    /// Days before EPOCH take the plain hash.
    public static func objectiveIndex(_ day: Int) -> Int {
        let N = UInt32(OBJECTIVES.count)
        if day <= EPOCH { return Int(mix(day) % N) }
        var i = mix(EPOCH) % N, d = EPOCH
        while d < day { d += 1; i = (i + 1 + mix(d) % (N - 1)) % N }
        return Int(i)
    }
    public static func objectiveFor(_ ms: Double) -> Objective { OBJECTIVES[objectiveIndex(dayNumber(ms))] }
    /// Judge a run against an objective. Only a run on the objective's course counts.
    public static func evaluate(_ obj: Objective, _ card: ScoreCard, course: String, units: Units) -> Result? {
        guard course == obj.course else { return nil }
        return obj.checkFn(card, Facts(card), units)
    }

    // --- the streak ------------------------------------------------------------------------------------
    /// What's stored: the last UTC day completed, the streak and the best. Alive while the last day is today or yesterday.
    public struct Streak: Codable, Equatable {
        public var last: String, streak: Int, best: Int
        public init(last: String = "", streak: Int = 0, best: Int = 0) { self.last = last; self.streak = streak; self.best = best }
        enum CodingKeys: String, CodingKey { case last, streak, best }
        // Merge rule: whatever's stored goes through readStreak, so a junk field never fails a save.
        public init(from decoder: Decoder) throws { self = readStreak(try JSValue(from: decoder)) }
    }
    public static func readStreak(_ raw: JSValue?) -> Streak {
        guard let o = raw, keyToDay(o["last"]?.stringValue) != nil, let last = o["last"]?.stringValue else { return Streak() }
        func n(_ x: JSValue?) -> Int {
            guard let v = x?.numberValue, v == v.rounded(), v >= 0, v < 100000 else { return 0 }
            return Int(v)
        }
        return Streak(last: last, streak: n(o["streak"]), best: Swift.max(n(o["best"]), n(o["streak"])))
    }
    public static func readStreak(json: String?) -> Streak { readStreak(json.flatMap { JSValue.parse($0) }) }

    public struct StreakNow: Equatable { public var streak: Int, doneToday: Bool, best: Int }
    public static func streakNow(_ s: Streak, _ ms: Double) -> StreakNow {
        let today = dayNumber(ms), last = keyToDay(s.last)
        let doneToday = last == today
        return StreakNow(streak: doneToday || last == today - 1 ? s.streak : 0, doneToday: doneToday, best: s.best)
    }
    /// Today completed: counted once a day; yesterday's streak carries on, a gap starts again at 1.
    public static func complete(_ s: Streak, _ ms: Double) -> Streak {
        let today = dayNumber(ms), last = keyToDay(s.last)
        if last == today { return s }
        let streak = last == today - 1 ? s.streak + 1 : 1
        return Streak(last: dayKey(ms), streak: streak, best: Swift.max(s.best, streak))
    }
}
