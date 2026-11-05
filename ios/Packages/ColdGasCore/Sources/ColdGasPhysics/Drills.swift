// src/practice.js, line for line, and the part of src/sim/autopilot.js it flies (0160): drills that start anywhere in the
// flight. Each starts from a moment of the reference flight, flown by the same deterministic sim to that tick through
// stepRun and handed over, so the input log (prefix and all) still replays bit-exactly for the coach. Nothing here
// touches the sim: it only feeds it inputs. Held to the JS's bits by Tests/Vectors/coach.json and the drill-* input
// vectors (CoachVectorTests, LiveInputTests). Not scored, never posted.
//
// How the app flies one:
//   let built = try buildDrill(drill, course)
//   let live = LiveRun(drill: built, tier: .assist, oneThumb: true)    // then as any live run: touches, live.tick()
//   live.drillMoment                                                   // the carry drill's end, while the run flies on
//   live.endDrillMoment()                                              // 0.5 s after it (main.js beginAftermath)
//   live.drillSnap                                                     // the drill's result and own coaching, once the card is decided
//   try live.coachResult(say: coachWords(pointerCtx(…)))               // after .rest
#if canImport(CRapier)
import ColdGasCore
import ColdGasClient

// MARK: - autopilot.js: the Wall's and the Show's reference pilot

/// autopilot.js REVEAL merged with a pilot's opts: `carry` 0 is the JS's undefined (the Wall has no carry). `hangOnLedge`:
/// the opts the ledge drills fly with ({ releaseAt: 0.93, hang: 999, driveOff: false }).
struct DrillPlan {
    let spool, approach, climb, hang, releaseAt: Double, driveOff: Bool, driveSpeed, driveFrom, driveRelease, carry: Double
    init(_ courseId: String, hangOnLedge: Bool) {
        let show = courseId == "show"
        spool = show ? 0 : 1.0; approach = show ? 6 : 4; climb = 4
        hang = hangOnLedge ? 999 : 2.0; releaseAt = 0.93; driveOff = !hangOnLedge
        carry = show ? 7.5 : 0
        driveSpeed = show ? carry : 2.5   // (plan.driveSpeed ?? plan.carry): the Show's is undefined
        driveFrom = 0.8; driveRelease = show ? 0.95 : 0.96
    }
}

let drillRates = V3(), drillUp = V3(), drillFw = V3()
/// autopilot.js wallPilot: the Show and the Wall, Assist. (The Lineup's pilot and Advanced's byHand aren't ported: no drill flies them.)
final class DrillPilot {
    let plan: DrillPlan, pad: Pad
    let out = Input()
    var released = false, rolledOut = false, carried: Bool, hangT = 0.0
    init(_ courseId: String, hangOnLedge: Bool) {
        plan = DrillPlan(courseId, hangOnLedge: hangOnLedge)
        pad = COURSES[courseId]!.pad!
        carried = plan.carry == 0
    }
    /// autopilot.js steerToPad: fly the lift vector toward the pad like a drone. Off in the last `level` metres.
    func steerToPad(_ c: Vehicle, _ h: Double, _ level: Double) {
        M3.rotate(drillFw, c.quat, M3.set(drillFw, 0, 0, 1))
        let tGo = jsMax(1.5, h / 2.5 + 1.5)
        let dvz = (pad.z - c.pos.z) / tGo - c.vel.z, dvx = (pad.x - c.pos.x) / tGo - c.vel.x
        let along = dvz * drillFw.z + dvx * drillFw.x
        let side = dvz * drillFw.x - dvx * drillFw.z
        let k = h < level ? 0 : h < level + 2 ? 0.5 : 1
        out.roll = k * jsMax(-0.45, jsMin(0.45, side * 0.24))
        out.pitch = k * jsMax(-0.55, jsMin(0.55, along * 0.2))
    }
    /// autopilot.js laneKeep: hold the centreline.
    func laneKeep(_ c: Vehicle) { out.steer = jsMax(-1, jsMin(1, c.pos.x * 0.35 + c.vel.x * 0.25)) }

    func callAsFunction(_ run: Run) -> Input {
        let c = run.car
        clearInput(out)
        out.assist = 1
        let speed = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z)
        if run.phase == .drive {
            laneKeep(c)
            out.fan = c.pos.z > -14 ? 1 : 0                // spool the fan up before the foot of the ramp
            if plan.spool != 0 && Double(run.tick) < plan.spool * 240 { out.brake = 1; return out }   // parked: let it spool
            let err = plan.approach - speed
            out.throttle = plan.spool == 0 ? (speed < plan.approach ? 1 : 0) : jsMax(0, jsMin(1, 0.45 + err * 0.3))
            out.brake = speed > plan.approach + 0.8 ? 0.3 : 0
            return out
        }
        if run.phase == .ramp && !released {
            laneKeep(c)
            out.fan = 1
            let prog = wallProgress(c.pos)
            if plan.driveOff && prog >= plan.driveFrom {
                out.throttle = speed < plan.driveSpeed ? 1 : 0
                if prog >= plan.driveRelease { released = true }
                return out
            }
            if prog >= plan.releaseAt {
                // On the ledge: stop and hang upside down, then let go.
                out.brake = 1
                hangT += 1.0 / 240
                if hangT >= plan.hang { released = true }
                return out
            }
            // Crawl governor up the deck: hold the climb speed against gravity.
            let err = plan.climb - speed
            out.throttle = jsMax(0, jsMin(1, 0.45 + err * 0.3))
            out.brake = err < -1.5 ? jsMin(1, (-err - 1.5) * 0.4) : 0
            return out
        }
        // Released: fan off and gravity peels the car off the overhang. Then roll upright, level, ease the sink rate,
        // and use the front jets to stop on the pad.
        released = true
        out.fan = 0
        if run.phase == .landed { out.brake = 1; return out }
        M3.rotate(drillUp, c.quat, M3.set(drillUp, 0, 1, 0))
        if !carried {
            if -c.vel.z >= plan.carry { carried = true }
            else { out.thrust = 1; return out }
        }
        out.level = c.grounded == 0 ? 1 : 0
        if drillUp.y > 0.94 { rolledOut = true }
        if rolledOut && (c.vel.y < landWant(c, massOf(c)) + 0.5 || c.vel.y > -3) { steerToPad(c, jsMax(0, c.pos.y - SPEC.comHeight), plan.carry != 0 ? 1 : 4) }
        return out
    }
}

// MARK: - practice.js: the drills

let DRILL_PUSH = 24, DRILL_HANDOVER = 36   // the release drills: a RELEASE tap's push-off (ticks), then the hand-over
let drillUv = V3()

/// What buildDrill's loop keeps while it flies to the hand-over.
struct DrillStage { var releasedTicks = 0, hanging = false }

public struct Drill {
    public let id, n, label: String, courses: [String]
    /// With metres in the text, as the web's: put it through Units.localize.
    public let blurb, goal: String
    public let hang: Bool, released: Bool
    let at: (Run, DrillStage) -> Bool
    /// The run's end, for a drill that ends before the run does (the carry drill).
    public let done: ((Run) -> Bool)?
}
public let DRILLS: [Drill] = [
    Drill(id: "ledge", n: "01", label: "On the ledge", courses: ["show", "wall"],
          blurb: "Hanging upside down, 27.7 m up. Let go, carry, roll out, land.", goal: "Land it from the ledge",
          hang: true, released: false, at: { _, st in st.hanging }, done: nil),
    Drill(id: "release", n: "02", label: "Just let go", courses: ["show", "wall"],
          blurb: "Falling inverted off the lip. Boost, roll out, brake, set it down.", goal: "Roll out high, brake by the line",
          hang: true, released: true, at: { _, st in st.releasedTicks >= DRILL_HANDOVER }, done: nil),
    Drill(id: "carry", n: "03", label: "Over the row", courses: ["show"],
          blurb: "Only the boost: carry over five roofs with a metre or two to spare. Ends past the row.", goal: "Clear the roofs by 1–3 m",
          hang: true, released: true, at: { _, st in st.releasedTicks >= DRILL_HANDOVER },
          done: { run in run.t.contact || run.car.pos.z < SHOW.rowFar - 2 || run.phase == .landed || run.phase == .done }),
    Drill(id: "land", n: "04", label: "10 m up", courses: ["show", "wall"],
          blurb: "Roof up over the pad, falling fast. Catch it and put it down soft.", goal: "Touch down under 1.5 m/s",
          hang: false, released: true, at: { run, _ in
              run.phase == .air && run.car.vel.y < -2 && run.car.pos.y - SPEC.comHeight <= 10 && M3.rotate(drillUv, run.car.quat, M3.set(drillUv, 0, 1, 0)).y > 0.8
          }, done: nil),
]
public func drillById(_ id: String) -> Drill? { DRILLS.first { $0.id == id } }
public func drillsFor(_ course: String) -> [Drill] { DRILLS.filter { $0.courses.contains(course) } }

/// A run flown to a drill's start, ready to hand to LiveRun(drill:). `startTick` is what main.js keeps as run.drillStartTick.
public struct BuiltDrill {
    public let drill: Drill, run: Run, released: Bool, startTick: Int
}

/// Fly the reference to the drill's start and hand the run over. The ledge drills fly it onto the inverted ledge (93 %
/// of the curl), stop and hang there; the release drills then let go as a player does (fan off, a 0.1 s RELEASE tap on
/// the down-jets) and hand over 0.15 s after the release: every decision after it is yours.
public func buildDrill(_ drill: Drill, _ course: String) throws -> BuiltDrill {
    let run = createRun(course)
    let ap = DrillPilot(course, hangOnLedge: drill.hang)
    var st = DrillStage()
    let idle = Input()
    var i = 0
    while i < 240 * 60 && run.phase != .done {
        let c = run.car
        if drill.hang && !st.hanging && run.phase == .ramp && wallProgress(c.pos) >= 0.92 && DMath.dhypot(c.vel.x, c.vel.y, c.vel.z) < 0.2 { st.hanging = true }
        if drill.at(run, st) { break }
        if drill.released && st.hanging {
            clearInput(idle); idle.fan = 0; idle.lift = st.releasedTicks < DRILL_PUSH ? 1 : 0; st.releasedTicks += 1
            try stepRun(run, idle)
            i += 1
            continue
        }
        try stepRun(run, ap(run))
        i += 1
    }
    return BuiltDrill(drill: drill, run: run, released: drill.released || run.phase == .air, startTick: run.tick)
}

/// The drill's own scorecard: what it trains, in numbers, with a pass mark. Each stat: its line, and whether it's flagged.
public struct DrillResult {
    public let pass: Bool, headline: String, stats: [(text: String, flagged: Bool)]
}
public func drillResult(_ drill: Drill, _ run: Run, _ card: Card?) -> DrillResult {
    let t = run.t
    if drill.id == "carry" {
        let clear: Double? = t.minClearance.isFinite ? t.minClearance : nil
        let pass = !t.contact && t.crossedRow && clear != nil && clear! >= 0.8 && clear! <= 4
        let carry = DMath.dhypot(run.car.vel.x, run.car.vel.z)
        return DrillResult(
            pass: pass,
            headline: t.contact ? "On the roofs" : !t.crossedRow ? "Short of the row" : (clear ?? 0) > 4 ? "Over, with room to spare" : "Over the row",
            stats: [(t.contact ? "contact" : clear.map { "\(jsToFixed($0, 1)) m over the roofs" } ?? "no clearance", t.contact || (clear != nil && clear! < 0.8)),
                    ("\(jsToFixed(carry, 1)) m/s carry", carry > 12)])
    }
    let landed = t.touchTick >= 0 && card != nil && !card!.crashed
    let soft = landed && t.sink <= 1.5
    var stats: [(text: String, flagged: Bool)] = []
    if landed, let card {
        let padMiss = drillFactNumber(card, "padMiss")
        stats = [("\(jsToFixed(t.sink, 1)) m/s touchdown", t.sink > 3), ("\(jsToFixed(t.tiltDeg, 0))° tilt", t.tiltDeg > 15),
                 ("\(jsNumberString(padMiss)) m from the mark", padMiss > 7), ("\(jsNumberString(drillFactNumber(card, "airPct")))% gas left", false)]
    }
    return DrillResult(pass: drill.id == "land" ? soft : landed && t.sink <= 3,
                       headline: !landed ? (card?.verdict ?? "Crash") : soft ? "Soft" : t.sink <= 3 ? "Firm" : "Hard",
                       stats: stats)
}
func drillFactNumber(_ card: Card, _ name: String) -> Double { if case .n(let x)? = card.fact(name) { return x }; return .nan }

/// The carry drill ends over the row, so its coaching is its own: the boost, nothing after it. nil for every other
/// drill (the coach reads those). Its items carry no weight in the JS; here it's 0.
public func drillCoach(_ drill: Drill, _ run: Run) -> [CoachItem]? {
    if drill.id != "carry" { return nil }
    let t = run.t, carry = jsToFixed(DMath.dhypot(run.car.vel.x, run.car.vel.z), 1)
    let clear: String? = t.minClearance.isFinite ? jsToFixed(t.minClearance, 1) : nil
    if t.contact || !t.crossedRow {
        return [CoachItem(id: "short", weight: 0, title: t.contact ? "Came down on the row" : "Short of the row", detail: "You carried \(carry) m/s off the ledge; the far roofs need about 9.5 m/s.", fix: "Hold BOOST (F) right after the release, until the cue goes: about a third of a second.")]
    }
    if let clear, jsStringToNumber(clear) > 4 {
        return [CoachItem(id: "long", weight: 0, title: "More boost than the roofs need", detail: "\(clear) m over the roofs at \(carry) m/s. Every extra m/s off the ledge lands you about 4 m further past the mark.", fix: "Let go of BOOST as the cue goes (about 9.5 m/s): a metre or two over the roofs is the art.")]
    }
    return [CoachItem(id: "clean", weight: 0, title: "Just enough", detail: "\(clear ?? "null") m over the roofs at \(carry) m/s.", fix: "Now fly it all the way down: drill 02, Just let go.")]
}
#endif
