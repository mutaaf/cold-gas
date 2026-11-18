// 0236, 0240: the crew's authored lines. Every situation gets three in-character lines from the run's numbers, the same run
// always gets the same words, a wreck gets the repair bill, a clean landing gets Vee's approval, and nothing names a real
// person, brand or model.
import Foundation
import Testing
@testable import ColdGasClient

private func card(_ course: String = "show", verdict: String = "Stuck it", total: Double = 88, _ extra: [(String, JSValue)] = []) -> ScoreCard {
    var base: [(String, JSValue)] = [("course", .string(course)), ("jumped", .bool(true)), ("crossedRow", .bool(true)), ("contact", .bool(false)),
        ("crashed", .bool(false)), ("flipped", .bool(false)), ("fellOff", .bool(false)), ("landedOnRamp", .bool(false)),
        ("progressPct", .number(100)), ("height", .number(27.4)), ("invertedS", .number(2.1)), ("maxG", .number(3.2)), ("launchHeight", .number(19.8)),
        ("clearance", .number(1.6)), ("rollDeg", .number(360)), ("rotations", .number(1)), ("pitchDeg", .number(12)), ("sink", .number(0.8)), ("tiltDeg", .number(3)),
        ("apex", .number(8.2)), ("padMiss", .number(0.6)), ("airPct", .number(41)), ("wheelSpreadMs", .number(12)), ("entryKmh", .number(22)),
        ("damagePct", .number(2)), ("damageZones", .object([("nose", .number(0)), ("roof", .number(3))]))]
    for (k, v) in extra { if let i = base.firstIndex(where: { $0.0 == k }) { base[i].1 = v } else { base.append((k, v)) } }
    return ScoreCard(total: total, verdict: verdict, tier: "assist", course: course, multiplier: 1,
                     judges: [JudgeScore(id: "engineer", name: "ENGINEER", score: 8.8), JudgeScore(id: "coordinator", name: "COORDINATOR", score: 9.1),
                              JudgeScore(id: "designer", name: "DESIGNER", score: 8.6)], categories: ["landing": 8.5], facts: .object(base))
}

private let WRECK: [(String, JSValue)] = [("crashed", .bool(true)), ("flipped", .bool(true)), ("damagePct", .number(72)),
    ("damageZones", .object([("nose", .number(80)), ("left", .number(40)), ("right", .number(35)), ("roof", .number(65)), ("susp", .number(55)), ("floor", .number(4))]))]

/// Every situation the crew talks about, on every course.
private func situations() -> [(String, ScoreCard)] {
    var out: [(String, ScoreCard)] = []
    for c in ["show", "wall", "lineup"] {
        out += [
            ("\(c) perfect", card(c, verdict: "Perfect 10", total: 95)),
            ("\(c) rough", card(c, verdict: "Rough landing", total: 60, [("sink", .number(3.4)), ("bottomOut", .bool(true)), ("padMiss", .number(6)), ("airPct", .number(9))])),
            ("\(c) tilted", card(c, verdict: "Clean", total: 74, [("tiltDeg", .number(11)), ("padMiss", .number(3)), ("airPct", .number(25))])),
            ("\(c) double", card(c, verdict: "Stuck it", [("rotations", .number(2)), ("rollDeg", .number(720))])),
            ("\(c) no jump", card(c, verdict: "No jump", total: 0, [("jumped", .bool(false)), ("progressPct", .number(40))])),
            ("\(c) wreck", card(c, verdict: "Wrecked", total: 12, WRECK)),
            ("\(c) rolled", card(c, verdict: "Rolled over", total: 30, [("crashed", .bool(true)), ("flipped", .bool(true)), ("damagePct", .number(20)),
                                                                          ("damageZones", .object([("roof", .number(30))]))])),
            ("\(c) contact", card(c, verdict: "Contact", total: 25, [("contact", .bool(true)), ("crashed", .bool(true))])),
        ]
    }
    out += [("wall off", card("wall", verdict: "Fell off the wall", total: 0, [("fellOff", .bool(true))])),
            ("wall deck", card("wall", verdict: "Came down on the deck", total: 20, [("landedOnRamp", .bool(true)), ("crashed", .bool(true))])),
            ("show short", card("show", verdict: "Short of the row", total: 40, [("crossedRow", .bool(false))]))]
    return out
}

@Suite struct CrewLines {
    @Test func theCrewIsOurOwn() {
        #expect(Crew.members.map(\.name) == ["Hollis", "Mags", "Vee"])
        #expect(Crew.member("engineer")?.name == "Hollis" && Crew.member("coordinator")?.name == "Mags" && Crew.member("designer")?.name == "Vee")
    }
    @Test func everySituationGetsThreeLinesInTheCrewsName() {
        for (name, c) in situations() {
            let w = crewWords(c)
            #expect(w.source == Crew.source, "\(name)")
            for line in [w.headline, w.engineer, w.coordinator, w.designer] {
                #expect(!line.isEmpty, "\(name)")
                #expect(line.utf16.count <= 200, "\(name): \(line)")
                #expect(!line.contains("undefined") && !line.contains("NaN") && !line.contains("null"), "\(name): \(line)")
            }
        }
    }
    @Test func theSameRunAlwaysGetsTheSameWords() {
        for (_, c) in situations() { #expect(crewWords(c) == crewWords(c)) }
    }
    @Test func aWreckGetsTheRepairBill() {
        let w = crewWords(card("lineup", verdict: "Wrecked", total: 12, WRECK))
        // The parts over 20 %: the nose, both doors, the roof and a wheel; 72 % is 58 hours.
        #expect(w.engineer.lowercased().contains("the nose"), "\(w.engineer)")
        #expect(w.engineer.contains("58 hours"), "\(w.engineer)")
        #expect(!w.engineer.contains("floor"))
        #expect(repairBill(card("lineup", WRECK)).parts == ["the nose", "the roof", "a wheel", "both doors"])
    }
    @Test func aComboIsCheeredAndHeadlined() {
        let wreck = CrewWreck(total: 64, bestCombo: 4, chain: ["Roof scrape", "Topple", "Tumble", "Crush"], toppled: 1)
        let w = crewWords(card("show", verdict: "Wrecked", total: 12, WRECK), wreck: wreck)
        #expect(w.headline == "Wrecked \u{B7} \u{D7}4 combo")
        #expect(w.coordinator.contains("\u{D7}4") || w.coordinator.contains("64 wreck points"), "\(w.coordinator)")
    }
    @Test func aCleanLandingGetsVeesApproval() {
        let w = crewWords(card("show", verdict: "Perfect 10", total: 95))
        #expect(w.designer.hasPrefix("On the mark") || w.designer == "Exact. Quiet. Yes.", "\(w.designer)")
        #expect(w.engineer.contains("0.8 m/s"), "\(w.engineer)")
        // And a wreck never gets it.
        let wr = crewWords(card("show", verdict: "Wrecked", total: 12, WRECK))
        #expect(!wr.designer.contains("On the mark"))
    }
    @Test func theNumbersFollowTheUnits() {
        let us = crewWords(card("wall", verdict: "Clean", total: 74, [("invertedS", .number(2.4))]), units: Units(.us))
        #expect(us.coordinator.contains("ft") && !us.coordinator.contains(" m,") , "\(us.coordinator)")
        #expect(us.engineer.contains("ft/s"), "\(us.engineer)")
    }
    /// §3.7: no real people, brands or model names in anything the crew says (the scan covers every situation's words).
    @Test func noBrandsPeopleOrModels() {
        let banned = ["tesla", "elon", "musk", "roadster reveal", "ford", "toyota", "bmw", "porsche", "ferrari", "gemma", "llama", "gpt", "claude",
                      "gemini", "openai", "anthropic", "google", "meta ", "@cf", "chief vehicle engineer", "head of design"]
        for (name, c) in situations() {
            for wreck in [nil, CrewWreck(total: 80, bestCombo: 5, chain: ["Hit", "Topple"], toppled: 2)] {
                let w = crewWords(c, wreck: wreck)
                let all = " " + [w.headline, w.engineer, w.coordinator, w.designer].joined(separator: " ").lowercased().map { $0.isLetter || $0 == "@" ? String($0) : " " }.joined() + " "
                for b in banned { #expect(!all.contains(" " + b + " ") && !all.contains(" " + b), "\(name): \(b)") }
            }
        }
    }
}
