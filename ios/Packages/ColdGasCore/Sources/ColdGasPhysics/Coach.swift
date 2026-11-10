// src/sim/coach.js and src/sim/aim-words.js, line for line, and the words half of src/pointer.js (0160): what happened in
// a flight, and the fixes that matter most, in this device's words. It re-flies the input log through the same sim and
// reads the flight tick by tick. Held to the JS's bits, words included, by Tests/Vectors/coach.json (CoachVectorTests).
//
// It flies a whole run on the sim's module-global scratch, so it wants the sim's thread with no tick in flight: after
// LiveRun.tick() says .rest, as main.js's finishRun does.
//
// Every module-level name here is prefixed: a Swift module's `let` is public to the module, and one that shares a name
// with ColdGasCore's silently wins (docs/LESSONS.md, 0155).
#if canImport(CRapier)
import ColdGasCore
import ColdGasClient

// MARK: - aim-words.js

public let COACH_AIM_LEAN = "lean toward the pad (pitch or roll) above 5 m to walk the touchdown marker onto the rings, then level"
public let COACH_AIM_THUMB = "hold the pad in the air and slide onto the amber dot: the touchdown follows it onto the rings"
public let COACH_RANOUT_LEAN = "Stay on the brake through the last 2 m: hold the sink in the green band to the ground."
public let COACH_RANOUT_THUMB = "Keep holding the pad all the way to the ground: the held pad is the brake."

// MARK: - pointer.js: the words

/// The controls a fix names, in the device's words.
public struct CoachWords: Equatable {
    public var land, lift, release, boost, roll, aim, ranOut: String
    public init(land: String, lift: String, release: String, boost: String, roll: String, aim: String, ranOut: String) {
        self.land = land; self.lift = lift; self.release = release; self.boost = boost; self.roll = roll; self.aim = aim; self.ranOut = ranOut
    }
}
/// coach.js KEY_WORDS: a keyboard's, the coach's default.
public let COACH_KEY_WORDS = CoachWords(land: "LAND (Shift)", lift: "LIFT (Space)", release: "RELEASE (Space)", boost: "BOOST (F)", roll: "← →", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)

/// src/pointer.js coachWords. `ctx.scheme` only counts on touch, as there.
public func coachWords(_ ctx: Daily.Pilot) -> CoachWords {
    let adv = ctx.tier == "advanced"
    switch ctx.device {
    case .touch:
        if ctx.scheme == .thumb { return CoachWords(land: "the pad", lift: "the pad", release: "the pad", boost: "the pad", roll: "the pad", aim: COACH_AIM_THUMB, ranOut: COACH_RANOUT_THUMB) }
        return CoachWords(land: "LAND", lift: adv ? "the four down-jet pads" : "LIFT", release: "RELEASE", boost: "BOOST", roll: adv ? "the side pads" : "the stick", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)
    case .pad:
        return CoachWords(land: "LAND (B)", lift: "LIFT (A)", release: "RELEASE (A)", boost: "BOOST (RB)", roll: adv ? "LB or RB" : "the left stick", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)
    case .key:
        return CoachWords(land: "LAND (Shift)", lift: "LIFT (Space)", release: "RELEASE (Space)", boost: "BOOST (F)", roll: adv ? "Q+Z or E+C" : "← →", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)
    }
}

/// src/main.js pointerCtx and flownCtx: one thumb only on touch, off the Lineup, on Assist; everything else is classic.
/// `device` and `touchScheme` are what main.js reads from its input layer and settings. `tier`: the card's, for the
/// results (`card.tier`).
public func pointerCtx(course: String, tier: String, device: Daily.Pilot.Device = .touch, touchScheme: Daily.Pilot.Scheme = .thumb) -> Daily.Pilot {
    Daily.Pilot(device: device, scheme: device == .touch && touchScheme == .thumb && course != "lineup" && tier == "assist" ? .thumb : .classic, tier: tier)
}

// MARK: - coach.js: read the flight

let COACH_LIFT_IDX = NOZZLES.indices.filter { NOZZLES[$0].group == "lift" }
let COACH_REAR_IDX = NOZZLES.indices.filter { NOZZLES[$0].group == "rear" }

public struct CoachTouch {
    public let sink, tilt, x, z, padMiss, along: Double
    public init(sink: Double, tilt: Double, x: Double, z: Double, padMiss: Double, along: Double) {
        self.sink = sink; self.tilt = tilt; self.x = x; self.z = z; self.padMiss = padMiss; self.along = along
    }
}
/// The events the coach and the drills talk about, with the JS's field names. Numbers stay Double, ticks too.
public final class CoachFlight {
    public let course: String
    public internal(set) var releaseTick = -1.0, releaseH = 0.0, releaseProgress = 0.0
    public internal(set) var boostTicks = 0.0, carry = 0.0, rowCleared = false
    public internal(set) var rollStartTick = -1.0, uprightTick = -1.0, uprightH = -1.0, rollDeg = 0.0
    public internal(set) var brakeTick = -1.0, brakeH = 0.0, brakeSink = 0.0, brakeA = 0.0, brakeBy = 0.0
    public internal(set) var needTick = -1.0, needH = 0.0, needSink = 0.0, needA = 0.0, needUp = 1.0, brakeGoverned = false
    public internal(set) var maxSinkBeforeBrake = 0.0, lowestMargin = Double.infinity, redTicks = 0.0
    public internal(set) var touch: CoachTouch? = nil
    public internal(set) var wasInverted = false, gasAtTouch = 0.0, pressureAtTouch = 0.0, apexTick = -1.0, landedTick = -1.0, levelHeld = 0.0, airTicks = 0.0
    /// The re-flown run's telemetry; set once the replay is over.
    public internal(set) var t: Telemetry!
    init(_ course: String) { self.course = course }

    /// scripts/vectors-lib.mjs flat(flight), `t` aside: every leaf as (path, value).
    public var flat: [(String, Value)] {
        var kv: [(String, Value)] = [("course", .s(course))]
        func n(_ k: String, _ v: Double) { kv.append((k, .n(v))) }
        func b(_ k: String, _ v: Bool) { kv.append((k, .b(v))) }
        n("releaseTick", releaseTick); n("releaseH", releaseH); n("releaseProgress", releaseProgress); n("boostTicks", boostTicks); n("carry", carry); b("rowCleared", rowCleared)
        n("rollStartTick", rollStartTick); n("uprightTick", uprightTick); n("uprightH", uprightH); n("rollDeg", rollDeg)
        n("brakeTick", brakeTick); n("brakeH", brakeH); n("brakeSink", brakeSink); n("brakeA", brakeA); n("brakeBy", brakeBy)
        n("needTick", needTick); n("needH", needH); n("needSink", needSink); n("needA", needA); n("needUp", needUp); b("brakeGoverned", brakeGoverned)
        n("maxSinkBeforeBrake", maxSinkBeforeBrake); n("lowestMargin", lowestMargin); n("redTicks", redTicks)
        if let m = touch {
            n("touch.sink", m.sink); n("touch.tilt", m.tilt); n("touch.x", m.x); n("touch.z", m.z); n("touch.padMiss", m.padMiss); n("touch.along", m.along)
        } else { kv.append(("touch", .z)) }
        b("wasInverted", wasInverted); n("gasAtTouch", gasAtTouch); n("pressureAtTouch", pressureAtTouch); n("apexTick", apexTick); n("landedTick", landedTick); n("levelHeld", levelHeld); n("airTicks", airTicks)
        return kv
    }
}

/// Re-fly the log and read the flight. `fromTick`: a drill's hand-over (what the reference flew before it isn't yours
/// to be coached on).
public func readFlight(_ inputLog: [[Int]], _ courseId: String, fromTick: Int = 0) throws -> (run: Run, flight: CoachFlight) {
    let course = COURSES[courseId] ?? COURSES[DEFAULT_COURSE]!
    let pr = Prediction(), u = V3(), fwd = V3()
    let f = CoachFlight(courseId)
    var lastPhase: Phase? = nil, wasInverted = false
    let start = Double(fromTick) + (fromTick > 0 ? 24 : 0)
    let run = try simulateReading(inputLog, courseId) { r, inp in
        let c = r.car, t = Double(r.tick)
        if r.phase == .air && lastPhase != .air && f.releaseTick < 0 {
            f.releaseTick = r.t.airStartTick; f.releaseH = r.t.launchHeight - SPEC.comHeight; f.releaseProgress = r.t.launchProgress
        }
        lastPhase = r.phase
        // (After a drill's hand-over the reference's valves take ≈0.1 s to close: not yours either.)
        if r.phase != .air || t < start { return }
        f.airTicks += 1
        M3.rotate(u, c.quat, M3.set(u, 0, 1, 0))
        let h = jsMax(0, c.pos.y - SPEC.comHeight)
        predict(c, h, pr)
        if truthy(inp.level) { f.levelHeld += 1 }
        // The carry: rear jets, and the speed along the run they leave you with.
        var rear = 0.0
        for i in COACH_REAR_IDX { rear += c.throttles[i] }
        let vh = DMath.dhypot(c.vel.x, c.vel.z)
        if rear > 0.4 { f.boostTicks += 1; f.carry = vh }
        else if f.boostTicks == 0 && t - f.releaseTick < 120 { f.carry = vh }   // no boost (yet): what the release gave
        M3.rotate(fwd, c.quat, M3.set(fwd, 0, 0, 1))
        if r.t.crossedRow { f.rowCleared = true }
        // The roll-out: from upside down to the roof up.
        if u.y < -0.3 { wasInverted = true; f.wasInverted = true }
        if wasInverted && f.rollStartTick < 0 && abs(c.angVel.x * fwd.x + c.angVel.y * fwd.y + c.angVel.z * fwd.z) > 1 { f.rollStartTick = t }
        if wasInverted && f.uprightTick < 0 && u.y > 0.85 { f.uprightTick = t; f.uprightH = h }
        // Braking: the first tick the four down-jets push hard while the car is roof-up and falling.
        var lift = 0.0
        for i in COACH_LIFT_IDX { lift += c.throttles[i] }
        let falling = c.vel.y < -1
        if f.brakeTick < 0 && falling && u.y > 0.5 { f.maxSinkBeforeBrake = jsMax(f.maxSinkBeforeBrake, pr.sink) }
        if f.brakeTick < 0 && falling && u.y > 0.5 && lift > 2 {
            f.brakeTick = t; f.brakeH = h; f.brakeSink = pr.sink; f.brakeA = pr.aMax; f.brakeBy = pr.brakeBy; f.brakeGoverned = truthy(inp.level) && truthy(inp.assist)
        }
        // The brake-by line: the first moment the stop from here (plus a reaction and a metre) no longer fits under
        // the car. That's when braking had to start.
        if falling && f.needTick < 0 && pr.margin <= 0 { f.needTick = t; f.needH = h; f.needSink = pr.sink; f.needA = pr.aMax; f.needUp = u.y }
        if falling && u.y > 0.5 {
            f.lowestMargin = jsMin(f.lowestMargin, pr.margin)
            if pr.status == "red" { f.redTicks += 1 }
        }
    }
    let t = run.t, pad = course.pad!
    f.gasAtTouch = t.touchTick >= 0 ? (t.airAtTouch / CAR.airMass) * 100 : (t.airEnd / CAR.airMass) * 100
    f.touch = t.touchTick >= 0 ? CoachTouch(sink: t.sink, tilt: t.tiltDeg, x: t.lateral, z: t.landZ, padMiss: DMath.dhypot(t.lateral, t.landZ - pad.z), along: t.landZ - pad.z) : nil
    f.rollDeg = jsMax(abs(t.rollAccum), abs(t.pitchAccum)) * 180 / DMath.PI
    f.t = t
    return (run, f)
}

// MARK: - coach.js: what a miss cost

extension Card {
    /// One fact off the card (`facts.<name>`), as the vectors flatten it.
    public func fact(_ name: String) -> Value? { let k = "facts.\(name)"; return flat.first { $0.0 == k }?.1 }
    /// `card.facts.crashed`.
    public var crashed: Bool { if case .b(let x)? = fact("crashed") { return x }; return false }
}

/// The total with `patch` minus the total as flown: the judges' own weights and the tier, so neither cost can drift from
/// judge.js. The JS scores a copy with the patch spread over it; this patches the telemetry for the one call and puts
/// it back.
func coachCost(_ t: Telemetry, _ patch: (Telemetry) -> Void, restore: (Telemetry) -> Void) -> Double {
    patch(t)
    let bent = scoreRun(t).total
    restore(t)
    return jsMax(0, jsRound((bent - scoreRun(t).total) * 10) / 10)
}
/// What the mark cost the total: the run re-scored as if it had touched down on the mark, everything else the same.
public func markCost(_ t: Telemetry) -> Double {
    if t.touchTick < 0 { return 0 }
    guard let pad = COURSES[t.course]?.pad else { return 0 }
    let lateral = t.lateral, landZ = t.landZ
    return coachCost(t, { $0.lateral = 0; $0.landZ = pad.z }, restore: { $0.lateral = lateral; $0.landZ = landZ })
}
/// The judges' full-marks sink (judge.js band(sink, 6, 0.9)).
public let COACH_SINK_PERFECT = 0.9
/// What the touchdown's sink cost the total: the run re-scored at the full-marks sink, everything else the same.
public func sinkCost(_ t: Telemetry) -> Double {
    if t.touchTick < 0 || !(t.sink > COACH_SINK_PERFECT) { return 0 }
    let sink = t.sink
    return coachCost(t, { $0.sink = COACH_SINK_PERFECT }, restore: { $0.sink = sink })
}
/// The Show names the mark once a miss costs this many points of the total.
public let COACH_MARK_POINTS = 3.0
public func namesBraking(_ sink: Double, _ cost: Double, show: Bool = false, drill: Bool = false) -> Bool {
    if !(sink > SINK_SOFT) { return false }
    return !(show && !drill) || sink >= SINK_FIRM || cost >= COACH_MARK_POINTS
}
public func namesMark(_ padMiss: Double, _ cost: Double, show: Bool = false, drill: Bool = false) -> Bool {
    padMiss > 7 || (show && !drill && cost >= COACH_MARK_POINTS)
}

let COACH_SIDE_MIN = 0.5   // m: a part this small isn't worth a word
/// Which way the touchdown missed the mark, so a player slides the way that fixes it. `side`: "left", "right" or nil.
public func markMiss(_ touch: CoachTouch?, show: Bool = true) -> (title: String, where: String, side: String?) {
    guard show, let touch else { return ("Off the mark", "", nil) }
    let s = jsNumberString
    let along = touch.along, across = touch.x
    let past = s(r1(-along)) + " m past", short = s(r1(along)) + " m short"
    let side = across > 0 ? "right" : "left"
    let sideTxt = "\(s(r1(abs(across)))) m \(side)"
    if r1(abs(across)) > r1(abs(along)) {   // as printed: never "Wide" over two equal figures
        let a = abs(along) >= COACH_SIDE_MIN ? ", \(along < 0 ? past : short)" : ""
        return ("Wide of the mark", " (\(sideTxt) of it\(a))", side)
    }
    let w = abs(across) >= COACH_SIDE_MIN ? ", \(sideTxt)" : ""
    return along < 0
        ? ("Long of the mark", " (\(past) it\(w))", w.isEmpty ? nil : side)
        : ("Short of the mark", " (\(short) of it\(w))", w.isEmpty ? nil : side)
}

// MARK: - coach.js: the fixes

public struct CoachItem: Equatable {
    public let id: String, weight: Double, title: String, detail: String, fix: String
    public init(id: String, weight: Double, title: String, detail: String, fix: String) { self.id = id; self.weight = weight; self.title = title; self.detail = detail; self.fix = fix }
}
public struct CoachResult {
    public let items: [CoachItem]
    /// The flight the fixes came from. nil only for the carry drill's own coaching (drillCoach), which reads no flight.
    public let flight: CoachFlight?
}

/// The fixes, most costly first, at most three (always at least one: "Clean"). Only the words depend on `say`.
/// `card`: the run's card, as the results hold it. `fromTick`: a drill's hand-over, 0 for a whole run.
public func coach(_ inputLog: [[Int]], _ courseId: String, card: Card? = nil, fromTick: Int = 0, say: CoachWords = COACH_KEY_WORDS) throws -> CoachResult {
    let (run, f) = try readFlight(inputLog, courseId, fromTick: fromTick)
    return coachReading(run, f, courseId, card: card, fromTick: fromTick, say: say)
}

/// The fixes from a flight already read: the same words without flying it again.
func coachReading(_ run: Run, _ f: CoachFlight, _ courseId: String, card: Card?, fromTick: Int, say: CoachWords) -> CoachResult {
    let s = jsNumberString
    let assist = (card?.tier ?? run.t.tier) == "assist"
    let t = run.t
    let wall = courseId != "lineup", show = courseId == "show"
    var out: [CoachItem] = []
    func add(_ id: String, _ weight: Double, _ title: String, _ detail: String, _ fix: String) { out.append(CoachItem(id: id, weight: weight, title: title, detail: detail, fix: fix)) }
    let drill = fromTick > 0, scored = show && !drill

    if wall && t.airStartTick < 0 {
        if t.fellOff { add("fell-off", 10, "Slid off the deck", "The car left the side of the curl \(s(r1(t.maxRampHeight))) m up.", "Keep it on the centreline: small steering corrections, and crawl (≈20 km/h) so the fan holds you.") }
        else { add("no-release", 10, "Never let go", "You hung \(s(r1(t.invertedTime))) s inverted but never released.", "On the ledge, tap \(say.release) to let go.") }
        return coachFinish(out, f, nil)
    }
    if wall && f.releaseProgress < 0.95 && f.releaseTick >= 0 {
        add("early-release", 6, "Let go before the ledge", "Released \(s(jsRound(f.releaseProgress * 100))) % up the curl: the deck was still under you.", "Crawl all the way onto the inverted ledge, stop, then release.")
    }
    if show && t.contact {
        let need = 9.5
        add("short", 9, "Came down on the row", "You carried \(s(r1(f.carry))) m/s off the ledge; the far roofs need about \(s(need)) m/s.",
            f.boostTicks == 0 ? "Right after the release, hold \(say.boost) until the cue goes: about a third of a second." : "Hold BOOST a little longer, and don't pitch back to chase the mark until you're past the roofs.")
    }
    // Braking. On the Show (not a drill) it weighs what the sink cost the total, as the mark does (0125). A crash scores
    // its landing 0 whatever the sink, so the re-score can't price it: a crashed run keeps the old bar. From SINK_FIRM a
    // hard landing keeps its full weight (a capped Pro/Advanced card can price it at nothing).
    let priced = scored && !(card?.crashed ?? scoreRun(t).crashed)
    let sinkPts = priced ? sinkCost(t) : 0
    func brakeW(_ w: Double) -> Double { priced && !(t.sink >= SINK_FIRM) ? jsMin(w, jsMax(3, 2 + sinkPts / 3)) : w }
    let brakeNamed = namesBraking(f.t.sink, sinkPts, show: priced, drill: drill)
    let brakePts = sinkPts >= 1 ? ": about \(s(jsRound(sinkPts))) point\(jsRound(sinkPts) == 1 ? "" : "s")" : ""
    if t.touchTick >= 0 && !t.contact && brakeNamed {
        if f.brakeTick < 0 {
            add("no-brake", brakeW(9), "Never braked", "You hit the ground at \(s(r1(t.sink))) m/s\(brakePts).", assist ? "Hold \(say.land) right after you let go: it rolls you out and brakes you to the ground." : "Hold \(say.lift) by the BRAKE line on the descent tape\(f.needTick >= 0 ? ": it passed at \(s(jsCeil(f.needH))) m on this fall" : "").")
        } else {
            let late = f.needTick >= 0 && f.brakeTick > f.needTick + 12
            // With LAND held the computer brakes as soon as the car is roof-up: a late brake there is a late roll-out
            // (or a late LAND), and the roll-out finding says so.
            let governedLate = late && f.brakeGoverned && f.levelHeld > 0
            if governedLate {
                if !(f.uprightH >= 0 && f.uprightH < 12) {
                    add("late-land", brakeW(8), "LAND came too late", "The stop needed to start at \(s(jsCeil(f.needH))) m; LAND was braking from \(s(r1(f.brakeH))) m.",
                        "Hold \(say.land) from the release: it rolls you out and paces the whole fall.")
                }
            } else if late {
                let needAt = s(jsCeil(f.needH))
                add("late-brake", brakeW(8 + jsMin(2, (f.needH - f.brakeH) / 3)), "Braked too late",
                    "You started braking at \(s(r1(f.brakeH))) m, falling \(s(r1(f.brakeSink))) m/s\(brakePts.isEmpty ? "" : " (it cost\(brakePts.dropFirst()))"). With \(s(r1(f.needA))) m/s² of braking available, the stop needed to start at \(needAt) m (you were falling \(s(r1(f.needSink))) m/s there\(f.needUp < 0.85 ? ", still rolling out" : "")).",
                    "Hold \(assist ? say.land : say.lift) from \(needAt) m or higher: the BRAKE line on the descent tape.\(assist ? " Or hold it from the release and let it pace the fall." : "")")
            } else {
                add("ran-out", brakeW(6), "Out of braking at the bottom", "You braked from \(s(r1(f.brakeH))) m but still touched down at \(s(r1(t.sink))) m/s with \(s(jsRound(f.gasAtTouch))) % gas\(brakePts).",
                    f.gasAtTouch < 25 ? "The tanks blow down as they empty: below about 40 % the jets lose thrust. Boost less and brake once, hard, near the BRAKE line." : say.ranOut)
            }
        }
    }
    // Roll-out.
    if wall && f.uprightTick > 0 && f.uprightH >= 0 && f.uprightH < 12 && f.releaseTick >= 0 {
        add("late-roll", brakeNamed ? 8.5 : 6, "Upright too low", "You were roof-up only \(s(r1(f.uprightH))) m above the ground: the roll-out ate the height the brake needed.",
            assist ? "Hold \(say.land) straight after the release: it rolls you out the nearer way." : "Roll with \(say.roll) straight after the release.")
    }
    if wall && f.rollDeg > 230 && !t.flipped {
        add("over-roll", 4, "Rolled past upright", "The car turned \(s(jsRound(f.rollDeg)))°: about \(s(jsRound(f.rollDeg - 180)))° more than the half-roll you needed.",
            "Let go of the roll about 40° early: the car keeps turning for a reaction time. Watch the roll-out arrow on the dial.")
    }
    if wall && f.wasInverted && f.uprightTick < 0 && t.touchTick >= 0 {
        add("no-roll", 9, "Never rolled upright", "You touched down \(s(jsRound(t.tiltDeg)))° from level.", assist ? "Hold \(say.land) after the release: it rolls you upright." : "Roll out with \(say.roll) straight after the release.")
    }
    // Touchdown attitude and the mark.
    if t.touchTick >= 0 && t.tiltDeg > 10 && f.uprightTick >= 0 {
        add("tilt", 4, "Touched down tilted", "\(s(jsRound(t.tiltDeg)))° off level at touchdown: the wheels met the ground one at a time.",
            assist ? "Stop steering for the last 2 m and let the car level (\(say.land) levels it for you)." : "Level it by the dial before the last 2 m: the horizon flat, the roll and pitch cues gone.")
    }
    if let touch = f.touch, !t.contact {
        let aim = say.aim, Aim = aim.prefix(1).uppercased() + aim.dropFirst()
        let cost = wall && !drill ? markCost(t) : 0   // 0182: the Wall's miss is weighed as the Show's
        if namesMark(touch.padMiss, cost, show: wall, drill: drill) {
            let (title, where_, _) = markMiss(touch, show: show)
            // On the Show the finding weighs what it cost: a 6–7 m miss (≈ 15–17 points) outranks a tilt or the gas,
            // never a crash-grade braking or carry fix (8–10).
            let weight = jsMax(3 + jsMin(3, touch.padMiss / 15), jsMin(7.5, 2 + cost / 3))
            add("mark", weight, title,
                "You landed \(s(r1(touch.padMiss))) m from the mark\(where_)\(cost >= 1 ? ": about \(s(jsRound(cost))) points" : "").",
                title == "Long of the mark" && f.carry > 11 && say.aim != COACH_AIM_THUMB ? "You carried \(s(r1(f.carry))) m/s: about 9.5 clears the roofs. Then pitch the nose up a touch to walk the touchdown marker onto the pad." : "\(Aim).")
        }
    }
    if t.touchTick >= 0 && f.gasAtTouch < 10 {
        add("gas", 3, "Nearly out of gas", "\(s(jsRound(f.gasAtTouch))) % left at touchdown.", "Shorter boosts and one hard, late brake use the least gas.")
    }
    if t.flipped && out.isEmpty { add("flipped", 8, "Rolled over", "The car ended on its roof.", "Touch down level, slowly: watch the sink band and the attitude dial.") }
    return coachFinish(out, f, card)
}

func coachFinish(_ found: [CoachItem], _ f: CoachFlight, _ card: Card?) -> CoachResult {
    // JS's sort is stable, Swift's only in practice: the index keeps ties in the order they were added.
    var out = found.enumerated().sorted { a, b in
        a.element.weight != b.element.weight ? a.element.weight > b.element.weight : a.offset < b.offset
    }.map(\.element)
    if out.isEmpty {
        out.append(CoachItem(id: "clean", weight: 0, title: "Clean", detail: card.map { "\($0.verdict): nothing big to fix." } ?? "Nothing big to fix.",
                             fix: card?.tier == "assist" ? "Want more? Try Pro: you fly the landing yourself, and it scores ×1.08." : "Chase the details: sink under 1 m/s, the 2 m ring, more gas left."))
    }
    return CoachResult(items: Array(out.prefix(3)), flight: f)
}
#endif
