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
/// The Lineup's run-up and lift (0367): the reveal's 25–30 km/h at the line, and about half a second of LIFT there.
public let COACH_LINEUP_RUNUP_KMH = (25.0, 30.0)
public let COACH_LINEUP_LIFT_HOLD = 0.5
/// km/h either side of the band before a fix names the speed.
public let COACH_LINEUP_SPEED_SLACK = (3.0, 4.0)
/// A LIFT press that ends this far (m) before the line is a tap on the run-up, not the lift.
public let COACH_LINEUP_TAP_BEFORE = 5.0
/// A LIFT press at the line that began more than this (m past COACH_LINEUP_LINE) late is named as late (0370, aim-words.js).
public let COACH_LINEUP_LIFT_LATE = 1.25
/// aim-words.js LINEUP_LIFT_HIGH, KICKFLIP_APEX (0362): Pro's lift-off burn past this peak (m) is named as a held LIFT.
public let COACH_LINEUP_LIFT_HIGH = 12.0
public let COACH_KICKFLIP_APEX = 8.0

// MARK: - pointer.js: the words

/// The controls a fix names, in the device's words.
public struct CoachWords: Equatable {
    public var drive, land, lift, release, boost, roll, aim, ranOut: String
    /// `drive` (0189): the drive-and-climb control, which "Stopped on the climb" names.
    public init(drive: String, land: String, lift: String, release: String, boost: String, roll: String, aim: String, ranOut: String) {
        self.drive = drive; self.land = land; self.lift = lift; self.release = release; self.boost = boost; self.roll = roll; self.aim = aim; self.ranOut = ranOut
    }
}
/// coach.js KEY_WORDS: a keyboard's, the coach's default.
public let COACH_KEY_WORDS = CoachWords(drive: "↑", land: "LAND (Shift)", lift: "LIFT (Space)", release: "RELEASE (Space)", boost: "BOOST (F)", roll: "← →", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)

/// src/pointer.js coachWords. `ctx.scheme` only counts on touch, as there.
public func coachWords(_ ctx: Daily.Pilot) -> CoachWords {
    let adv = ctx.tier == "advanced"
    switch ctx.device {
    case .touch:
        if ctx.scheme == .thumb { return CoachWords(drive: "the pad", land: "the pad", lift: "the pad", release: "the pad", boost: "the pad", roll: "the pad", aim: COACH_AIM_THUMB, ranOut: COACH_RANOUT_THUMB) }
        return CoachWords(drive: "GO", land: "LAND", lift: adv ? "the four down-jet pads" : "LIFT", release: "RELEASE", boost: "BOOST", roll: adv ? "the side pads" : "the stick", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)
    case .pad:
        return CoachWords(drive: "RT", land: "LAND (B)", lift: "LIFT (A)", release: "RELEASE (A)", boost: "BOOST (RB)", roll: adv ? "LB or RB" : "the left stick", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)
    case .key:
        return CoachWords(drive: "↑", land: "LAND (Shift)", lift: "LIFT (Space)", release: "RELEASE (Space)", boost: "BOOST (F)", roll: adv ? "Q+Z or E+C" : "← →", aim: COACH_AIM_LEAN, ranOut: COACH_RANOUT_LEAN)
    }
}

/// src/main.js pointerCtx and flownCtx: one thumb only on touch, off the Lineup, on Assist; everything else is classic.
/// `device` and `touchScheme` are what main.js reads from its input layer and settings. `tier`: the card's, for the
/// results (`card.tier`).
public func pointerCtx(course: String, tier: String, device: Daily.Pilot.Device = .touch, touchScheme: Daily.Pilot.Scheme = .thumb) -> Daily.Pilot {
    Daily.Pilot(device: device, scheme: device == .touch && touchScheme == .thumb && course != "lineup" && tier == "assist" ? .thumb : .classic, tier: tier)
}

// MARK: - coach.js: read the flight

/// The Lineup's lift-off line: where the "Hold LIFT at the line" cue sits (src/main.js LINEUP_LINE).
public let COACH_LINEUP_LINE = LINEUP.lineupZ0 - 6.5

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
    /// The Lineup's run-up (0367): the speed along the run as the car crossed the lift-off line, and how long the first
    /// press of LIFT at the line was held (s; -1 when LIFT was never pressed there; a press that ended more than
    /// COACH_LINEUP_TAP_BEFORE m short of the line doesn't count).
    public internal(set) var lineSpeed = -1.0, liftHeld = -1.0
    /// Where the car met the row (0369, coach.js): height above the ground, climb (+ up) and speed along the ground on the
    /// first tick of `t.contact`; contactH -1 when it never did.
    public internal(set) var contactH = -1.0, contactVy = 0.0, contactSpeed = -1.0
    /// Where that press of LIFT began (0370): m past the lift-off line (negative: before it); 0 when never pressed there.
    public internal(set) var liftAtZ = 0.0
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
        n("lineSpeed", lineSpeed); n("liftHeld", liftHeld)
        n("contactH", contactH); n("contactVy", contactVy); n("contactSpeed", contactSpeed)
        n("liftAtZ", liftAtZ)
        return kv
    }
}

/// Re-fly the log and read the flight. `fromTick`: a drill's hand-over (what the reference flew before it isn't yours
/// to be coached on).
/// `simVersion`: the version the log was flown at (Run.swift simVersionOf; today's when nil).
public func readFlight(_ inputLog: [[Int]], _ courseId: String, fromTick: Int = 0, simVersion: Int? = nil) throws -> (run: Run, flight: CoachFlight) {
    let course = COURSES[courseId] ?? COURSES[DEFAULT_COURSE]!
    let pr = Prediction(), u = V3(), fwd = V3()
    let f = CoachFlight(courseId)
    var lastPhase: Phase? = nil, wasInverted = false, liftFrom = -1.0, liftFromZ = 0.0
    let start = Double(fromTick) + (fromTick > 0 ? 24 : 0)
    let lineZ = courseId == "lineup" ? COACH_LINEUP_LINE : .nan
    let run = try simulateReading(inputLog, courseId, simVersion: simVersion) { r, inp in
        let c = r.car, t = Double(r.tick)
        if courseId == "lineup" && t >= Double(fromTick) {
            if f.lineSpeed < 0 && c.pos.z >= lineZ { f.lineSpeed = DMath.dhypot(c.vel.x, c.vel.z) }
            if f.contactH < 0 && r.t.contact { f.contactH = jsMax(0, c.pos.y - SPEC.comHeight); f.contactVy = c.vel.y; f.contactSpeed = DMath.dhypot(c.vel.x, c.vel.z) }
            if f.liftHeld < 0 {
                if inp.lift > 0.5 && liftFrom < 0 { liftFrom = t; liftFromZ = c.pos.z - lineZ }
                else if !(inp.lift > 0.5) && liftFrom >= 0 {
                    if c.pos.z >= lineZ - COACH_LINEUP_TAP_BEFORE { f.liftHeld = (t - liftFrom) * DT; f.liftAtZ = liftFromZ }
                    liftFrom = -1
                }
            }
        }
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
    if f.liftHeld < 0 && liftFrom >= 0 { f.liftHeld = (Double(run.tick) - liftFrom) * DT; f.liftAtZ = liftFromZ }   // still held at the end
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
public func coach(_ inputLog: [[Int]], _ courseId: String, card: Card? = nil, fromTick: Int = 0, say: CoachWords = COACH_KEY_WORDS, simVersion: Int? = nil) throws -> CoachResult {
    let (run, f) = try readFlight(inputLog, courseId, fromTick: fromTick, simVersion: simVersion)
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
    // 0367: a crash and its card. A crash is never "Clean", and never told to try Pro (coachFinish).
    let crashed = card?.crashed ?? scoreRun(t).crashed
    if courseId == "lineup" && !drill {
        coachLineupWrecks(t, f, COURSES[courseId]!, say, crashed, add, card?.tier ?? t.tier)
        coachHeldLift(t, f, say, add, card?.tier ?? t.tier)
    }

    if wall && t.airStartTick < 0 {
        // 0189: stopped short of the ledge (a thumb lifted on the climb) names the climb, not the release.
        if t.fellOff { add("fell-off", 10, "Slid off the deck", "The car left the side of the curl \(s(r1(t.maxRampHeight))) m up.", "Keep it on the centreline: small steering corrections, and crawl (≈20 km/h) so the fan holds you.") }
        else if t.progress < HANG_AT {
            add("stopped-climb", 10, "Stopped on the climb", t.rampTick < 0 ? "You stopped before the Wall." : t.maxRampHeight < 1 ? "You stopped at the foot of the Wall." : "You stopped \(s(r1(t.maxRampHeight))) m up the curl, short of the ledge.",
                "Keep holding \(say.drive) until you're upside down on the ledge.")
        }
        else { add("no-release", 10, "Never let go", "You hung \(s(r1(t.invertedTime))) s inverted but never released.", "On the ledge, tap \(say.release) to let go.") }
        return coachFinish(out, f, card, crashed, ring: say.aim == COACH_AIM_THUMB && !drill)
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
                    f.gasAtTouch < 25 ? "The tanks blow down as they empty: below about 40 % the jets lose thrust. \(f.boostTicks > 0 ? "Boost less and brake once" : "Save the gas for the brake, then brake once"), hard, near the BRAKE line." : say.ranOut)
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
    return coachFinish(out, f, card, crashed, ring: say.aim == COACH_AIM_THUMB && !drill)
}

let COACH_INTO_ROW_H = 1.5
/// coach.js CRASH_FIX: a crash with nothing else to name, and a Lineup crash whose run-up, press and hold were all in the band.
let COACH_CRASH_FIX = "Run it again and follow the cues: each one calls its step as you reach it."
/// coach.js lineupWrecks (0367): the Lineup's two wrecks, ahead of everything else on its card.
func coachLineupWrecks(_ t: Telemetry, _ f: CoachFlight, _ course: Course, _ say: CoachWords, _ crashed: Bool, _ add: (String, Double, String, String, String) -> Void, _ tier: String) {
    let s = jsNumberString
    let apexH = t.airStartTick >= 0 ? jsMax(0, t.apex - SPEC.comHeight) : 0
    let neverUp = t.airStartTick < 0 || apexH < course.tallest
    if !(neverUp && (crashed || t.touchTick < 0)) && !t.contact { return }
    let (lo, hi) = COACH_LINEUP_RUNUP_KMH
    let kmh = f.lineSpeed >= 0 ? jsRound(f.lineSpeed * 3.6) : -1
    // The one-thumb pad commits the lift itself past the line; on Advanced LIFT isn't a valve.
    let thumb = say.aim == COACH_AIM_THUMB, timed = !thumb && tier != "advanced"
    // 0362: on Assist a press on the run-up is a lift-off command (src/lift-off.js): its hold is never named or asked for.
    let holdTimed = timed && tier != "assist"
    let heldS = r1(f.liftHeld)
    let held = !timed ? "" : f.liftHeld < 0 ? "never pressed \(say.lift)" : holdTimed ? "held \(say.lift) \(s(heldS)) s" : ""
    let atLine = kmh >= 0 ? "\(s(kmh)) km/h at the line" : "you never reached the line"
    let speedOff = !thumb && kmh >= 0 && (kmh < lo - COACH_LINEUP_SPEED_SLACK.0 || kmh > hi + COACH_LINEUP_SPEED_SLACK.1)
    let speedFix = !speedOff ? "" :
        kmh > hi ? "Ease off \(say.drive) before the line: between \(s(lo)) km/h and \(s(hi)) km/h, not \(s(kmh)) km/h. " : "Carry between \(s(lo)) km/h and \(s(hi)) km/h to the line, not \(s(kmh)) km/h. "
    let shortHold = timed && (holdTimed ? !(f.liftHeld >= COACH_LINEUP_LIFT_HOLD - 0.05) : f.liftHeld < 0)
    let holdFix = thumb ? "Keep holding the pad through the line: it lifts you over the row, then rolls you."
        : timed && !holdTimed ? "Press \(say.lift) at the line: it lifts you over the row, then roll."
        : "Hold \(say.lift) at the line for about \(s(COACH_LINEUP_LIFT_HOLD)) s\(shortHold && f.liftHeld >= 0 ? " (you held \(s(heldS)) s)" : ""), then roll."
    // 0370: a press that began past the line is named, with how far; a crash is never "right".
    let late = timed && f.liftHeld >= 0 && f.liftAtZ > COACH_LINEUP_LIFT_LATE
    let into = t.airStartTick >= 0 && t.contact && f.contactH >= 0 && f.contactH < COACH_INTO_ROW_H && f.contactVy >= 0
    let lateFix = "Press \(say.lift) on the line, not \(s(r1(f.liftAtZ))) m past it\(into ? ": the nose met the first car on the way up" : ""). "
        + (holdTimed ? "Hold it about \(s(COACH_LINEUP_LIFT_HOLD)) s\(shortHold ? " (you held \(s(heldS)) s)" : ""), then roll." : "Then roll.")
    let right = timed && kmh >= 0 && !speedOff && !shortHold && !late
    let fix = late ? speedFix + lateFix
        : right && !crashed ? "Your run-up and \(say.lift) were right: fly it the same again."
        : right ? COACH_CRASH_FIX
        : !speedFix.isEmpty || thumb || kmh >= 0 ? speedFix + holdFix : "Keep between \(s(lo)) km/h and \(s(hi)) km/h to the line. \(holdFix)"
    let heldPart = held.isEmpty ? "" : ", \(held)"
    // 0369: under COACH_INTO_ROW_H and not yet falling as it met the row, the car went into it on the way up.
    let lead = kmh >= 0 ? "You reached the line at \(s(kmh)) km/h\(held.isEmpty ? "" : " and \(held)"): the car" : !held.isEmpty ? "You \(held): the car" : "The car"
    if into {
        let up = f.contactH >= 0.1 ? " \(s(r1(f.contactH))) m up" : ", its wheels barely off the ground,"
        add("no-lift", 10, "Into the row", "\(lead) went into the row\(up) at \(s(jsRound(f.contactSpeed * 3.6))) km/h, before it rose over the roofs.", fix)
        return
    }
    if neverUp {
        let under = r1(jsMax(0.1, course.tallest - apexH))
        add("no-lift", 10, "Never got over the roofs",
            t.airStartTick < 0 ? "You never got off the ground: \(atLine)\(heldPart)." : "You only rose \(s(r1(apexH))) m, \(s(under)) m under the roofs: \(atLine)\(heldPart).",
            fix)
        return
    }
    add("row", 9.5, "Came down on the row", "\(lead) peaked \(s(r1(apexH))) m up and came down on the roofs.", fix)
}

/// coach.js heldLift (0362): on Pro a lift-off press that flew the car past COACH_LINEUP_LIFT_HIGH is the finding.
func coachHeldLift(_ t: Telemetry, _ f: CoachFlight, _ say: CoachWords, _ add: (String, Double, String, String, String) -> Void, _ tier: String) {
    let s = jsNumberString
    if tier != "pro" || !(f.liftHeld > COACH_LINEUP_LIFT_HOLD + 0.05) || t.airStartTick < 0 { return }
    let apexH = jsMax(0, t.apex - SPEC.comHeight)
    if !(apexH > COACH_LINEUP_LIFT_HIGH) { return }
    add("held-lift", 10.5, "Held LIFT too long", "You held \(say.lift) \(s(r1(f.liftHeld))) s from the line: the car climbed to \(s(r1(apexH))) m (the kickflip peaks near \(s(COACH_KICKFLIP_APEX)) m) and touched down with \(s(jsRound(f.gasAtTouch))) % gas.",
        "Let go of \(say.lift) sooner: about \(s(COACH_LINEUP_LIFT_HOLD)) s at the line lifts you to the kickflip's height and leaves the gas for the brake.")
}

/// 0371 (aim-words.js ringMiss): an Assist card on the rings (the Show, the Wall) with Precision under 10 missed the 2 m
/// bullseye, so its clean step is the ring: the card's padMiss, or -1 (Pro, Advanced, no card, the Lineup).
public func coachRingMiss(_ card: Card?) -> Double {
    guard let card, card.tier == "assist" else { return -1 }
    func str(_ k: String) -> String? { if case .s(let x)? = card.flat.first(where: { $0.0 == k })?.1 { return x }; return nil }
    func num(_ k: String) -> Double? { if case .n(let x)? = card.flat.first(where: { $0.0 == k })?.1 { return x }; return nil }
    let course = str("course") ?? str("facts.course") ?? "lineup"   // a Lineup card carries no course
    guard course == "show" || course == "wall", let p = num("categories.precision"), p < 10,
          let miss = num("facts.padMiss"), miss.isFinite else { return -1 }
    return miss
}

/// A card with no finding: "Clean", with the next step. A crash is never clean (0367): it reads its own verdict.
/// `ring` (0371): one thumb's words on a scored run (not a drill), as coach.js finish.
func coachFinish(_ found: [CoachItem], _ f: CoachFlight, _ card: Card?, _ crashed: Bool = false, ring: Bool = false) -> CoachResult {
    // JS's sort is stable, Swift's only in practice: the index keeps ties in the order they were added.
    var out = found.enumerated().sorted { a, b in
        a.element.weight != b.element.weight ? a.element.weight > b.element.weight : a.offset < b.offset
    }.map(\.element)
    if out.isEmpty && crashed {
        let v = card?.verdict ?? "Crash"
        out.append(CoachItem(id: "crash", weight: 0, title: v, detail: "\(v): the replay names no single cause.", fix: COACH_CRASH_FIX))
    }
    if out.isEmpty {
        let miss = ring ? coachRingMiss(card) : -1, s = jsNumberString
        out.append(CoachItem(id: "clean", weight: 0, title: "Clean", detail: card.map { "\($0.verdict): nothing big to fix." } ?? "Nothing big to fix.",
                             fix: miss >= 0 ? "Land inside the \(s(SHOW_MARK_RING)) m ring for full marks: this one was \(s(r1(miss))) m from the mark."
                                : card?.tier == "assist" ? "Want more? Try Pro: you fly the landing yourself, and it scores ×1.08." : "Chase the details: sink under 1 m/s, the 2 m ring, more gas left."))
    }
    return CoachResult(items: Array(out.prefix(3)), flight: f)
}
#endif
