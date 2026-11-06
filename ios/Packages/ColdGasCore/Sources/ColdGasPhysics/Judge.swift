// src/sim/judge.js: scoreRun, a pure function of the telemetry (the client, the replay and the Worker agree). The card
// comes out flattened exactly as scripts/vectors-lib.mjs flattens the JS card, so the vectors compare it directly.
// The panel's weighted sums run in the JS objects' key order (a float sum's last bit depends on it).
#if canImport(CRapier)
import ColdGasCore

public typealias Value = Telemetry.Value
@inline(__always) func clamp01(_ v: Double) -> Double { v < 0 ? 0 : v > 1 ? 1 : v }
@inline(__always) func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
@inline(__always) func band(_ x: Double, _ bad: Double, _ good: Double) -> Double { clamp01((x - bad) / (good - bad)) }
@inline(__always) func r1(_ x: Double) -> Double { jsRound(x * 10) / 10 }

struct Judge { let id, name, title: String; let w: [(String, Double)] }
let PANEL: [Judge] = [
    Judge(id: "engineer", name: "The Engineer", title: "Chief Vehicle Engineer",
          w: [("height", 0.08), ("rotation", 0.17), ("clearance", 0.1), ("landing", 0.4), ("precision", 0.15), ("efficiency", 0.1)]),
    Judge(id: "coordinator", name: "The Coordinator", title: "Stunt Coordinator",
          w: [("height", 0.28), ("rotation", 0.32), ("clearance", 0.12), ("landing", 0.18), ("precision", 0.05), ("efficiency", 0.05)]),
    Judge(id: "designer", name: "The Designer", title: "Head of Design",
          w: [("height", 0.12), ("rotation", 0.22), ("clearance", 0.12), ("landing", 0.24), ("precision", 0.12), ("efficiency", 0.18)]),
]
let WALL_W: [String: [(String, Double)]] = [
    "engineer": [("climb", 0.12), ("inversion", 0.12), ("rotation", 0.12), ("landing", 0.38), ("precision", 0.16), ("efficiency", 0.1)],
    "coordinator": [("climb", 0.24), ("inversion", 0.24), ("rotation", 0.22), ("landing", 0.18), ("precision", 0.06), ("efficiency", 0.06)],
    "designer": [("climb", 0.14), ("inversion", 0.16), ("rotation", 0.16), ("landing", 0.24), ("precision", 0.14), ("efficiency", 0.16)],
]
let SHOW_W: [String: [(String, Double)]] = [
    "engineer": [("climb", 0.04), ("inversion", 0.03), ("rotation", 0.05), ("clearance", 0.08), ("landing", 0.34), ("precision", 0.36), ("efficiency", 0.10)],
    "coordinator": [("climb", 0.08), ("inversion", 0.10), ("rotation", 0.14), ("clearance", 0.16), ("landing", 0.16), ("precision", 0.28), ("efficiency", 0.08)],
    "designer": [("climb", 0.04), ("inversion", 0.06), ("rotation", 0.08), ("clearance", 0.10), ("landing", 0.24), ("precision", 0.34), ("efficiency", 0.14)],
]
func curve(_ x: Double, _ pts: [(Double, Double)]) -> Double {
    if x <= pts[0].0 { return pts[0].1 }
    for i in 1..<pts.count where x <= pts[i].0 { let (a, va) = pts[i - 1], (b, vb) = pts[i]; return va + ((vb - va) * (x - a)) / (b - a) }
    return pts[pts.count - 1].1
}
let SHOW_PRECISION: [(Double, Double)] = [(3.5, 1), (5, 0.85), (7, 0.45), (12, 0.15), (20, 0)]
let SHOW_GAS_FULL = 45.0
let DAMAGE_W: [String: Double] = ["engineer": 0.15, "coordinator": 0.08, "designer": 0.12]
public let WRECK_PCT = 60.0
let TIER_FACTOR: [String: Double] = ["assist": 1, "pro": 1.08, "advanced": 1.15]
@inline(__always) func damagePct(_ t: Telemetry) -> Double { t.damage?.pct ?? 0 }
func tierOfRun(_ t: Telemetry) -> String { TIER_FACTOR[t.tier] != nil && t.endTick >= 0 ? t.tier : "assist" }
func landingScore(_ t: Telemetry) -> Double {
    let sinkS = band(t.sink, 6, 0.9), tiltS = band(t.tiltDeg, 25, 1.5)
    let headS = band(abs(t.headingDeg) > 90 ? 180 - abs(t.headingDeg) : abs(t.headingDeg), 30, 2)
    let syncS = band(t.wheelSpreadMs, 250, 20), suspS = t.bottomOut ? 0.55 : 1
    return 10 * (0.38 * sinkS + 0.26 * tiltS + 0.14 * headS + 0.22 * syncS) * suspS * (t.bodyStrike ? 0.6 : 1)
}
let CLEARANCE: [(Double, Double)] = [(0, 0.82), (0.8, 1), (2, 1), (6, 0.85), (12, 0.75)]
func clearanceScore(_ t: Telemetry) -> Double {
    let clearance = t.minClearance.isFinite ? t.minClearance : 0
    return t.contact ? 0 : clearance <= 0 ? 0 : 10 * curve(clearance, CLEARANCE)
}

/// A scorecard: the total, the panel, the verdict, and the whole card flattened as the vectors hold it.
public struct Card {
    public let total: Double, verdict: String, tier: String
    public let judges: [(id: String, score: Double)]
    public let flat: [(String, Value)]
}

public func scoreRun(_ t: Telemetry) -> Card { t.course == "lineup" ? scoreLineup(t) : scoreWall(t) }

func sortedFlat(_ kv: [(String, Value)]) -> [(String, Value)] { kv.sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) } }
func damageFactsFlat(_ t: Telemetry, _ kv: inout [(String, Value)]) {
    kv.append(("facts.damagePct", .n(damagePct(t)))); kv.append(("facts.integrity", .n(100 - damagePct(t))))
    if let d = t.damage { for (z, v) in d.zones { kv.append(("facts.damageZones.\(z)", .n(v))) } } else { kv.append(("facts.damageZones", .z)) }
}
func panelFlat(_ judges: [(Judge, Double)], _ kv: inout [(String, Value)]) {
    for (i, (j, s)) in judges.enumerated() {
        kv.append(("judges[\(i)].id", .s(j.id))); kv.append(("judges[\(i)].name", .s(j.name)))
        kv.append(("judges[\(i)].score", .n(s))); kv.append(("judges[\(i)].title", .s(j.title)))
    }
}

func scoreWall(_ t: Telemetry) -> Card {
    let show = t.course == "show"
    let course = COURSES[show ? "show" : "wall"]!
    let wrecked = damagePct(t) >= WRECK_PCT
    let crashed = t.flipped || !t.settledUpright || t.fellOff || t.landedOnRamp || (show && t.contact) || wrecked
    let launched = t.airStartTick >= 0
    let jumped = launched && t.touchTick >= 0
    let rollDeg = abs(t.rollAccum) * 180 / DMath.PI
    let pitchDeg = abs(t.pitchAccum) * 180 / DMath.PI
    let turned = jsMax(rollDeg, pitchDeg)
    let rollShare = rollDeg / jsMax(1, rollDeg + pitchDeg)
    let airPct = (t.airEnd / CAR.airMass) * 100
    let padMiss = DMath.dhypot(t.lateral, t.landZ - course.pad!.z)
    var c: [String: Double] = [:]
    c["climb"] = 10 * clamp01(t.progress) * jsSqrt(clamp01(t.progress))
    c["inversion"] = t.progress > 0.8 ? 10 * band(t.invertedTime, 0, 1.0) : 0
    c["rotation"] = 10 * clamp01(turned / 160) * (0.7 + 0.3 * rollShare)
    c["landing"] = landingScore(t)
    c["precision"] = show ? 10 * curve(padMiss, SHOW_PRECISION) : 10 * band(padMiss, 20, 1)
    c["efficiency"] = 10 * band(airPct, 0, show ? SHOW_GAS_FULL : 50) * clamp01(turned / 120)
    if show { c["clearance"] = t.crossedRow ? clearanceScore(t) : 0 }
    c["damage"] = 10 * (1 - damagePct(t) / 100)
    if !jumped { c["rotation"] = 0; c["landing"] = 0; c["precision"] = 0; c["efficiency"] = 0; c["clearance"] = 0 }
    if crashed { c["landing"] = 0; c["precision"] = c["precision"]! * 0.3 }
    let tier = tierOfRun(t), factor = TIER_FACTOR[tier]!
    let W = show ? SHOW_W : WALL_W
    let judges: [(Judge, Double)] = PANEL.map { j in
        var s = 0.0
        for (k, wk) in W[j.id]! { s += wk * (c[k] ?? .nan) }
        s = s * (1 - DAMAGE_W[j.id]!) + DAMAGE_W[j.id]! * c["damage"]!
        if crashed { s = jsMin(s, 3.5) } else if !jumped { s = jsMin(s, 3) } else if show && !t.crossedRow { s = jsMin(s, 5) }
        return (j, r1(jsMin(10, s * factor)))
    }
    let total = r1(judges.reduce(0) { $0 + $1.1 } * 10 / 3)
    let verdict: String
    if t.fellOff { verdict = "Fell off the wall" }
    else if wrecked { verdict = "Wrecked" }
    else if show && t.contact { verdict = "Contact" }
    else if !launched { verdict = t.progress > 0.5 ? "Stalled on the wall" : "No climb" }
    else if t.landedOnRamp { verdict = "Came down on the deck" }
    else if t.flipped || !t.settledUpright { verdict = "Rolled over" }
    else if crashed { verdict = "Crash" }
    else if show && !t.crossedRow { verdict = "Short of the row" }
    else if total >= 92 { verdict = "Perfect 10" }
    else if total >= 84 { verdict = "Stuck it" }
    else if total >= 72 { verdict = "Clean" }
    else if total >= 55 { verdict = "Rough landing" }
    else { verdict = "Survived" }
    var kv: [(String, Value)] = []
    for (k, v) in c { kv.append(("categories.\(k)", .n(r1(v)))) }
    kv.append(("course", .s(course.id)))
    func f(_ k: String, _ v: Value) { kv.append(("facts.\(k)", v)) }
    f("course", .s(course.id)); f("height", .n(r1(t.maxRampHeight))); f("progressPct", .n(jsRound(t.progress * 100))); f("invertedS", .n(r1(t.invertedTime)))
    f("launchHeight", .n(r1(t.launchHeight))); f("launchKmh", .n(jsRound(t.launchSpeed * 3.6))); f("entryKmh", .n(jsRound(t.rampEntrySpeed * 3.6)))
    f("apex", .n(r1(t.apex))); f("maxG", .n(r1(t.maxG))); f("brakeG", .n(r1(jsOr(t.brakePeakG, 0)))); f("brakeH", .n(r1(jsOr(t.brakePeakH, 0))))
    f("rollDeg", .n(jsRound(rollDeg))); f("pitchDeg", .n(jsRound(pitchDeg))); f("rotations", .n(jsRound(turned / 360)))
    f("sink", .n(r1(t.sink))); f("tiltDeg", .n(r1(t.tiltDeg))); f("headingDeg", .n(r1(t.headingDeg))); f("wheelSpreadMs", .n(jsRound(t.wheelSpreadMs)))
    f("padMiss", .n(r1(padMiss))); f("airPct", .n(jsRound(airPct))); f("zeroToSixty", t.zeroToSixty.map { .n($0) } ?? .z)
    f("bottomOut", .b(t.bottomOut)); f("bodyStrike", .b(t.bodyStrike)); f("contact", .b(show && t.contact))
    f("clearance", show && t.minClearance.isFinite ? .n(r1(t.minClearance)) : .z); f("crossedRow", show ? .b(t.crossedRow) : .z); f("apexOverRoof", .z)
    f("flipped", .b(t.flipped)); f("fellOff", .b(t.fellOff)); f("landedOnRamp", .b(t.landedOnRamp)); f("crashed", .b(crashed)); f("jumped", .b(jumped))
    f("endReason", .s(t.endReason))
    damageFactsFlat(t, &kv)
    panelFlat(judges, &kv)
    kv.append(("multiplier", .n(factor))); kv.append(("tier", .s(tier))); kv.append(("total", .n(total))); kv.append(("verdict", .s(verdict)))
    return Card(total: total, verdict: verdict, tier: tier, judges: judges.map { ($0.0.id, $0.1) }, flat: sortedFlat(kv))
}

func scoreLineup(_ t: Telemetry) -> Card {
    let PAD = LINEUP.pad!, TALLEST = LINEUP.tallest
    let wrecked = damagePct(t) >= WRECK_PCT
    let crashed = t.contact || t.flipped || !t.settledUpright || wrecked
    let jumped = t.airStartTick >= 0 && t.touchTick >= 0
    let rollDeg = abs(t.rollAccum) * 180 / DMath.PI
    let rotations = jsRound(rollDeg / 360)
    let rollError = rotations > 0 ? abs(rollDeg - rotations * 360) : 360
    let clearance = t.minClearance.isFinite ? t.minClearance : 0
    let airPct = (t.airEnd / CAR.airMass) * 100
    let padMiss = DMath.dhypot(t.lateral, t.landZ - PAD.z)
    let apexOverRoof = t.apex - TALLEST
    var c: [(String, Double)] = []
    c.append(("height", 10 * band(t.apex, 3.5, 9.5)))
    let purity = clamp01(1 - t.offAxis / 1.4), finish = clamp01(1 - rollError / 60)
    if rotations == 0 { c.append(("rotation", 3 * clamp01(rollDeg / 300))) }
    else { c.append(("rotation", jsMin(10, (rotations == 1 ? 7.2 : 8.8) + 1.2 * purity * finish) * lerp(0.55, 1, finish))) }
    c.append(("clearance", t.contact ? 0 : clearance <= 0 ? 0 : 10 * (clearance < 0.8 ? lerp(0.82, 1, clearance / 0.8) : lerp(1, 0.72, clamp01((clearance - 0.8) / 4)))))
    let sinkS = band(t.sink, 6, 0.9), tiltS = band(t.tiltDeg, 25, 1.5), headS = band(abs(t.headingDeg), 30, 2)
    let syncS = band(t.wheelSpreadMs, 250, 20), suspS = t.bottomOut ? 0.55 : 1
    c.append(("landing", 10 * (0.38 * sinkS + 0.26 * tiltS + 0.14 * headS + 0.22 * syncS) * suspS * (t.bodyStrike ? 0.6 : 1)))
    c.append(("precision", 10 * band(padMiss, 16, 0.8)))
    c.append(("efficiency", 10 * band(airPct, 0, 65) * clamp01(rollDeg / 330)))
    if !jumped { c = c.map { ($0.0, 0) } }
    if crashed { c = c.map { $0.0 == "landing" ? ($0.0, 0) : $0.0 == "precision" ? ($0.0, $0.1 * 0.3) : $0 } }
    c.append(("damage", 10 * (1 - damagePct(t) / 100)))
    let cv = Dictionary(uniqueKeysWithValues: c)
    let tier = tierOfRun(t), factor = TIER_FACTOR[tier]!
    let judges: [(Judge, Double)] = PANEL.map { j in
        var s = 0.0
        for (k, wk) in j.w { s += wk * cv[k]! }
        s = s * (1 - DAMAGE_W[j.id]!) + DAMAGE_W[j.id]! * cv["damage"]!
        if crashed { s = jsMin(s, 3.5) } else if rotations == 0 { s = jsMin(s, 4.5) }
        return (j, r1(jsMin(10, s * factor)))
    }
    let total = r1(judges.reduce(0) { $0 + $1.1 } * 10 / 3)
    let verdict: String
    if wrecked && jumped { verdict = "Wrecked" }
    else if !jumped { verdict = "No jump" }
    else if t.contact { verdict = "Contact" }
    else if t.flipped { verdict = "Rolled over" }
    else if crashed { verdict = "Crash" }
    else if abs(t.rollAccum) < DMath.PI { verdict = "No trick" }
    else if total >= 92 { verdict = "Perfect 10" }
    else if total >= 84 { verdict = "Stuck it" }
    else if total >= 72 { verdict = "Clean" }
    else if total >= 55 { verdict = "Rough landing" }
    else { verdict = "Survived" }
    var kv: [(String, Value)] = []
    for (k, v) in c { kv.append(("categories.\(k)", .n(r1(v)))) }
    func f(_ k: String, _ v: Value) { kv.append(("facts.\(k)", v)) }
    f("apex", .n(r1(t.apex))); f("apexOverRoof", .n(r1(apexOverRoof))); f("rollDeg", .n(jsRound(rollDeg))); f("rotations", .n(rotations))
    f("clearance", .n(r1(clearance))); f("sink", .n(r1(t.sink))); f("tiltDeg", .n(r1(t.tiltDeg))); f("headingDeg", .n(r1(t.headingDeg)))
    f("wheelSpreadMs", .n(jsRound(t.wheelSpreadMs))); f("padMiss", .n(r1(padMiss))); f("airPct", .n(jsRound(airPct)))
    f("launchKmh", .n(jsRound(t.launchSpeed * 3.6))); f("bottomOut", .b(t.bottomOut)); f("bodyStrike", .b(t.bodyStrike))
    f("contact", .b(t.contact)); f("flipped", .b(t.flipped)); f("crashed", .b(crashed)); f("jumped", .b(jumped)); f("endReason", .s(t.endReason))
    damageFactsFlat(t, &kv)
    panelFlat(judges, &kv)
    kv.append(("multiplier", .n(factor))); kv.append(("tier", .s(tier))); kv.append(("total", .n(total))); kv.append(("verdict", .s(verdict)))
    return Card(total: total, verdict: verdict, tier: tier, judges: judges.map { ($0.0.id, $0.1) }, flat: sortedFlat(kv))
}
#endif
