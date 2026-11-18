// The crew (0236, 0240; operator's call 2026-11-13, Option B): three invented characters of our own who talk about the run,
// in lines the game writes from the run's numbers. Free, instant, offline, never a model and never a network call. Apple's
// on-device model may replace them where the device has it (OnDeviceJudge.swift); everywhere else these lines are the panel.
//
//   Hollis  · the engineer     dry, exact, keeps a running repair bill ("that's a door, a wheel and my weekend")
//   Mags    · the coordinator  loud and warm; wants it bigger, and cheers the wreck as loudly as the landing
//   Vee     · the designer     few words; loves a clean landing, mourns the paint
//
// The numbers come from scoreRun's card (and the Wreck card beside it) and nowhere else: a line never invents one. Which
// line is said is picked from the run's own numbers, so the same run always gets the same words. No real people, brands
// or likenesses (invariant 3.7). The judge ids stay the card's ("engineer", "coordinator", "designer").
import Foundation
import ColdGasCore

public enum Crew {
    public struct Member: Equatable, Sendable {
        public let id: String, name: String, role: String
    }
    public static let hollis = Member(id: "engineer", name: "Hollis", role: "engineer")
    public static let mags = Member(id: "coordinator", name: "Mags", role: "stunt coordinator")
    public static let vee = Member(id: "designer", name: "Vee", role: "designer")
    public static let members = [hollis, mags, vee]
    /// The crew member who sits in a judge's chair (the card's ids).
    public static func member(_ judgeId: String) -> Member? { members.first { $0.id == judgeId } }
    /// The source tag on the crew's own words.
    public static let source = "crew"
}

/// What the crew needs to know about the wreck, if the run had one (the Wreck card's summary; WreckScore.swift).
public struct CrewWreck: Equatable, Sendable {
    public var total: Double, bestCombo: Int, chain: [String], toppled: Int, shoved: Int, tumbles: Int
    public init(total: Double, bestCombo: Int, chain: [String] = [], toppled: Int = 0, shoved: Int = 0, tumbles: Int = 0) {
        self.total = total; self.bestCombo = bestCombo; self.chain = chain; self.toppled = toppled; self.shoved = shoved; self.tumbles = tumbles
    }
}

/// The parts a damaged zone stands for, for the repair bill (damage.js ZONES).
private let ZONE_PART: [String: String] = ["nose": "the nose", "tail": "the tail", "left": "a door", "right": "a door", "roof": "the roof",
                                           "floor": "the floor pan", "susp": "a wheel"]

/// The repair bill: the parts worth fixing, worst first (each part once), and the hours (≈ 0.8 h a damage point).
func repairBill(_ card: ScoreCard) -> (parts: [String], hours: Int) {
    var zones: [(String, Double)] = []
    if case let .object(kv)? = card.facts["damageZones"] { zones = kv.map { ($0.0, jsNumber($0.1)) }.filter { $0.1 >= 20 } }
    zones = zones.enumerated().sorted { $0.element.1 != $1.element.1 ? $0.element.1 > $1.element.1 : $0.offset < $1.offset }.map(\.element)
    var parts: [String] = []
    for (z, _) in zones {
        guard let p = ZONE_PART[z] else { continue }
        if p == "a door", let i = parts.firstIndex(of: p) { parts[i] = "both doors"; continue }
        if !parts.contains(p) { parts.append(p) }
    }
    let pct = jsNumber(card.facts["damagePct"])
    return (parts, pct.isFinite ? Int(jsRound(pct * 0.8)) : 0)
}
/// "the roof, a wheel and my weekend": a list in prose, the last joined with "and".
func prose(_ items: [String]) -> String {
    switch items.count {
    case 0: return ""
    case 1: return items[0]
    default: return items.dropLast().joined(separator: ", ") + " and " + (items.last ?? "")
    }
}

/// The crew's words on a run: a headline and one line each, from the card's numbers (and the wreck's, if any).
public func crewWords(_ card: ScoreCard, wreck: CrewWreck? = nil, units: Units = Units(.metric)) -> JudgeWords {
    let f = Facts(card)
    func len(_ k: String) -> String { units.one(.len, f.n(k), units.system == .us ? 0 : 1) }
    func rate(_ k: String) -> String { units.one(.rate, f.n(k), 1) }
    // Which of a pool is said: the run's own numbers, so the same run always gets the same line.
    let seed = f.n("sink") + f.n("tiltDeg") + f.n("padMiss") + f.n("height") + f.n("apex") + f.n("airPct") / 7 + (wreck?.total ?? 0) / 3
    func say(_ pool: [String], _ salt: Double = 0) -> String { pick(pool, seed + salt) }
    let course = f.s("course")
    let bill = repairBill(card)
    let combo = wreck.map { $0.bestCombo >= 2 } ?? false
    let comboLine = wreck.map { w in "\u{D7}\(w.bestCombo)\(w.chain.isEmpty ? "" : ": " + w.chain.joined(separator: ", ").lowercased())" } ?? ""
    let wreckPts = wreck.map { jsNumberString(jsRound($0.total)) } ?? ""

    // Hollis on a crash: the repair bill.
    func hollisBill() -> String {
        if bill.parts.isEmpty {
            return say(["Scuffs. I\u{2019}ll have it back on the mark in an hour.", "Cosmetic. The frame\u{2019}s straight, the bill\u{2019}s small.",
                        "Barely a dent. Do that again and mean it."], 1)
        }
        let list = prose(bill.parts + ["my weekend"])
        return say(["That\u{2019}s \(list). \(bill.hours) hours in the shop.", "Repair bill: \(prose(bill.parts)). Call it \(bill.hours) hours.",
                    "\(bill.parts[0].prefix(1).uppercased() + bill.parts[0].dropFirst()) is scrap. \(bill.hours) hours, and that\u{2019}s if the jig is free."], 2)
    }
    func magsWreck() -> String {
        if combo, let w = wreck {
            return say(["A \u{D7}\(w.bestCombo) combo! Somebody get that on the big screen.", "\(comboLine). That\u{2019}s not a crash, that\u{2019}s choreography.",
                        "\(wreckPts) wreck points and the crowd is on its feet. Again!"], 3)
        }
        if let w = wreck, w.toppled > 0 { return "You put a parked car on its side. I\u{2019}m not even mad." }
        return say(["Big, brave, and sideways. I\u{2019}ll take it.", "That\u{2019}s the stuff the crowd stays for. Now land one.",
                    "Commit like that on the way down and you\u{2019}re a legend."], 4)
    }
    func veeWreck() -> String {
        say(["The paint had a good life.", "It was a beautiful car this morning.", "No. Just no.", "I\u{2019}ll be in the paint shop. Don\u{2019}t follow me."], 5)
    }
    func words(_ h: String, _ e: String, _ c: String, _ d: String) -> JudgeWords {
        JudgeWords(headline: h, engineer: e, coordinator: c, designer: d, source: Crew.source)
    }

    if f.b("fellOff") {
        return words(card.verdict, "Lateral drift took it past the deck edge at \(len("height")). Line first, speed second.",
                     say(["Off the side! Not the exit I wrote, but it was an exit.", "Straight up the middle next time, then let it fly."], 6),
                     "Symmetry. It starts with the centreline.")
    }
    if !f.b("jumped") {
        if course == "lineup" {
            return words(card.verdict, "Never left the ground long enough to measure. Nothing on my clipboard.",
                         "The air is right there. Lift and give me something!", "Restraint is a virtue. This was too much of it.")
        }
        return words(card.verdict, "\(f.s("progressPct"))% of the curl at \(units.one(.speed, f.n("entryKmh") / 3.6)) in. The fan holds you; the motors lift you.",
                     "Commit to the climb. All the way to the ledge.", "Hesitation reads from the grandstand.")
    }
    let wrecked = f.n("damagePct") >= 60
    if wrecked || (wreck.map { $0.total >= 25 } ?? false) && f.b("crashed") {
        let head = combo ? "Wrecked \u{B7} \u{D7}\(wreck?.bestCombo ?? 0) combo" : card.verdict
        return words(head, hollisBill(), magsWreck(), veeWreck())
    }
    if f.b("contact") {
        return words(card.verdict, course == "show" ? "Released at \(len("launchHeight")) and came down on a parked car. \(hollisBill())" : "Hull contact at \(len("apex")) apex. \(hollisBill())",
                     say(["You had the nerve. You needed another metre.", "Into the roofs! Wrong kind of headline, right kind of nerve."], 7),
                     say(["The row was the frame. You hit the frame.", "Their paint too, now."], 8))
    }
    if f.b("landedOnRamp") {
        return words(card.verdict, "Let go too low; it fell back onto the curl. Release at the ledge.",
                     "So close. Ride it higher before you let go.", "The landing belongs on the pad, not the ramp.")
    }
    if f.b("flipped") || f.b("crashed") {
        return words(card.verdict, "Down at \(rate("sink")) with \(f.s("tiltDeg"))\u{B0} of tilt. \(hollisBill())",
                     course == "lineup" ? "\(len("apex")) up and a \(f.s("rollDeg"))\u{B0} roll. Gravity sent the invoice." : magsWreck(),
                     say(["Everything before the ground was beautiful.", "Finish the roll before you meet the ground.", veeWreck()], 9))
    }
    if course == "show" && !f.b("crossedRow") {
        return words(card.verdict, "Touchdown \(rate("sink")), but short of the row. Light the rear jets once you\u{2019}re clear of the ledge.",
                     "Let go, then carry it out over all five. The carry is the stunt!", "Half a stunt, cleanly done.")
    }

    // A landing. Hollis: the touchdown.
    let sink = f.n("sink"), spread = f.n("wheelSpreadMs"), tilt = f.n("tiltDeg")
    let hollis: String
    if sink < 1.2 && spread < 40 && tilt < 5 {
        hollis = say(["\(rate("sink")), four wheels inside \(f.s("wheelSpreadMs")) ms. Nothing for me to fix. Unsettling.",
                      "Sink \(rate("sink")), tilt \(f.s("tiltDeg"))\u{B0}. I\u{2019}d sign that off and go home early.",
                      "Four wheels, \(f.s("wheelSpreadMs")) ms apart. The dampers barely noticed."], 10)
    } else if f.b("bottomOut") || sink >= 3 {
        hollis = "\(rate("sink")) at contact. The bump stops felt that, and so did I. Brake earlier."
    } else if tilt >= 8 {
        hollis = "\(f.s("tiltDeg"))\u{B0} of tilt at touchdown. Level it before the wheels find the ground."
    } else {
        hollis = say(["\(rate("sink")) with \(f.s("wheelSpreadMs")) ms between first and last wheel. Tighten the retro burn.",
                      "Landed at \(rate("sink")). Fine. Fine is not a compliment."], 11)
    }
    // Mags: height, rotation, nerve.
    let rot = f.n("rotations")
    let mags: String
    if rot >= 2 {
        mags = "A \(f.s("rollDeg"))\u{B0} double! I have waited my whole career for that one."
    } else if course == "lineup" {
        mags = rot == 1 ? say(["\(len("apex")) up and a full roll. That\u{2019}s the shot!", "Clean roll, \(len("clearance")) over the roofs. The crowd felt that."], 12)
                        : "You flew it, but you didn\u{2019}t roll it. Give me the rotation!"
    } else if f.n("invertedS") > 1.5 {
        mags = course == "show" ? "\(f.s("invertedS")) seconds upside down at \(len("height")), then \(len("clearance")) over the roofs. That\u{2019}s the show!"
                                : "\(f.s("invertedS")) seconds upside down at \(len("height")). Make them wait like that every time."
    } else {
        mags = say(["Up the curl, off the ledge, onto the pad. Now hang it longer.", "Good. Next time make the crowd hold its breath."], 13)
    }
    // Vee: the mark and the gas.
    let miss = f.n("padMiss"), air = f.n("airPct")
    let vee: String
    if miss <= 1 && air >= 35 { vee = say(["On the mark, \(f.s("airPct"))% in the tanks. That\u{2019}s the whole idea.", "Exact. Quiet. Yes."], 14) }
    else if miss <= 1 { vee = "On the mark. Loud getting there, but on the mark." }
    else if air >= 40 { vee = "\(f.s("airPct"))% of the gas left. Restraint looks good on you." }
    else if air < 15 { vee = "\(f.s("airPct"))% left. That burn was a shout, not a sentence." }
    else { vee = say(["\(len("padMiss")) off the mark. Close is a different word from on.", "The shape was right. The finish wasn\u{2019}t."], 15) }
    return words(card.verdict, hollis, mags, vee)
}
