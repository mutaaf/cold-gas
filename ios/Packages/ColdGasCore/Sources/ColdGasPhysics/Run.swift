// src/sim/run.js: one attempt (phases drive → ramp → air → landed → done), its telemetry, the input log, simulate().
// Replay frames for the renderer come with phase 2.
#if canImport(CRapier)
import ColdGasCore

public let SIM_VERSION = 32   // 0190: LAND's line hold to 1.5 m, auto-land to two wheels
public let FRAME_EVERY = 4
public let MAX_TICKS = 240 * 90
public let STALL_TICKS = 240 * 6, HANG_STALL_TICKS = 240 * 20
public let HANG_AT = 0.92
public let G_WIN = 120

/// Everything the judges score (newTelemetry), with the JS's field names.
public final class Telemetry {
    public var course: String
    public var crossedRow = false, deckScrape = false
    public var launchSpeed = 0.0, launchTick = -1.0, airStartTick = -1.0, touchTick = -1.0, endTick = -1.0
    public var apex = 0.0, apexZ = 0.0, rollAccum = 0.0, pitchAccum = 0.0, yawAccum = 0.0, offAxis = 0.0
    public var minClearance = Double.infinity, contact = false, contactSpeed = 0.0, contactTick = -1.0
    public var airAtLaunch = CAR.airMass, airAtTouch = 0.0, airEnd = 0.0
    public var sink = 0.0, tiltDeg = 0.0, headingDeg = 0.0, lateral = 0.0, landZ = 0.0, landSpeed = 0.0
    public var wheelTouch: [Double] = [-1, -1, -1, -1], wheelSpreadMs = 0.0, maxCompression = 0.0, bottomOut = false
    public var bodyStrike = false, flipped = false, settledUpright = false, maxSpeed = 0.0
    public var thrustChanges = 0.0, endReason = ""
    public var usedAssist = false, usedPro = false, usedManual = false, tier = "assist"
    public var zeroToSixty: Double? = nil
    public var rampEntrySpeed = 0.0, rampTick = -1.0, maxRampHeight = 0.0, progress = 0.0, invertedTime = 0.0, maxG = 0.0
    public var brakePeakG = 0.0, brakePeakH = 0.0
    public var launchHeight = 0.0, launchUpY = 1.0, launchProgress = 0.0, fellOff = false, landedOnRamp = false
    public var damage: (pct: Double, integrity: Double, zones: [(String, Double)])? = nil
    public var mass: Double? = nil
    init(_ course: String) { self.course = course }

    public enum Value: Equatable { case n(Double), b(Bool), s(String), z }
    /// scripts/vectors-lib.mjs flat(run.t): every leaf as (path, value), keys sorted as JS sorts them.
    public func flat() -> [(String, Value)] {
        var kv: [(String, Value)] = []
        func n(_ k: String, _ v: Double) { kv.append((k, .n(v))) }
        func b(_ k: String, _ v: Bool) { kv.append((k, .b(v))) }
        n("airAtLaunch", airAtLaunch); n("airAtTouch", airAtTouch); n("airEnd", airEnd); n("airStartTick", airStartTick)
        n("apex", apex); n("apexZ", apexZ); b("bodyStrike", bodyStrike); b("bottomOut", bottomOut); n("brakePeakG", brakePeakG); n("brakePeakH", brakePeakH)
        b("contact", contact); n("contactSpeed", contactSpeed); n("contactTick", contactTick); kv.append(("course", .s(course))); b("crossedRow", crossedRow)
        if let d = damage {
            n("damage.integrity", d.integrity); n("damage.pct", d.pct)
            for (z, v) in d.zones.sorted(by: { $0.0 < $1.0 }) { n("damage.zones.\(z)", v) }
        } else { kv.append(("damage", .z)) }
        b("deckScrape", deckScrape); kv.append(("endReason", .s(endReason))); n("endTick", endTick); b("fellOff", fellOff); b("flipped", flipped)
        n("headingDeg", headingDeg); n("invertedTime", invertedTime); n("landSpeed", landSpeed); n("landZ", landZ); b("landedOnRamp", landedOnRamp)
        n("lateral", lateral); n("launchHeight", launchHeight); n("launchProgress", launchProgress); n("launchSpeed", launchSpeed); n("launchTick", launchTick)
        n("launchUpY", launchUpY)
        if let m = mass { n("mass", m) }
        n("maxCompression", maxCompression); n("maxG", maxG); n("maxRampHeight", maxRampHeight); n("maxSpeed", maxSpeed); n("minClearance", minClearance)
        n("offAxis", offAxis); n("pitchAccum", pitchAccum); n("progress", progress); n("rampEntrySpeed", rampEntrySpeed); n("rampTick", rampTick)
        n("rollAccum", rollAccum); b("settledUpright", settledUpright); n("sink", sink); n("thrustChanges", thrustChanges); kv.append(("tier", .s(tier)))
        n("tiltDeg", tiltDeg); n("touchTick", touchTick); b("usedAssist", usedAssist); b("usedManual", usedManual); b("usedPro", usedPro)
        for i in 0..<4 { n("wheelTouch[\(i)]", wheelTouch[i]) }
        n("wheelSpreadMs", wheelSpreadMs); n("yawAccum", yawAccum)
        if let z = zeroToSixty { n("zeroToSixty", z) } else { kv.append(("zeroToSixty", .z)) }
        return kv.sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) }
    }
}

public enum Phase: Int { case drive = 0, ramp, air, landed, done }

public final class Run {
    public let course: String
    public let car: Vehicle
    public let damage = Damage()
    public var phase = Phase.drive
    public var tick = 0
    public var flippedTicks = 0, airTicks = 0, offTicks = 0, hang = false
    public var gWin = [Double](repeating: 0, count: G_WIN), gSum = 0.0, hWin = [Double](repeating: 0, count: G_WIN)
    /// [tick, 23 channels in hundredths] whenever the quantised input changes (stepRun; Live.swift). simulate() sets it to the log it replayed.
    public internal(set) var inputLog: [[Int]] = []
    var lastPacked = [Int](repeating: 0, count: 23), hasPacked = false
    /// Armed (armAftermath) before the run ends, finish() keeps the world for the aftermath (Live.swift).
    public internal(set) var after: Aftermath? = nil
    public let t: Telemetry
    init(_ courseId: String) {
        let c = COURSES[courseId] ?? COURSES[DEFAULT_COURSE]!
        course = c.id
        car = Vehicle(c)
        t = Telemetry(c.id)
    }
}
public func createRun(_ courseId: String = DEFAULT_COURSE) -> Run { Run(courseId) }

/// One entry's 23 channels (hundredths) into the input, as run.js unpack: a 12-channel (legacy) entry leaves the rest 0.
@inline(__always) func unpack(_ e: [Int], _ o: Input) {
    func ch(_ i: Int) -> Double { i + 1 < e.count ? Double(e[i + 1]) / 100 : 0 }
    o.throttle = ch(0); o.brake = ch(1); o.steer = ch(2); o.pitch = ch(3); o.roll = ch(4); o.yaw = ch(5)
    o.lift = ch(6); o.thrust = ch(7); o.retro = ch(8); o.level = ch(9); o.fan = ch(10); o.assist = ch(11)
    o.manual = ch(12)
    for k in 0..<10 { o.v[k] = ch(13 + k) }
}

@inline(__always) public func wallProgress(_ pos: V3) -> Double { wallArcLength(pos.z, pos.y) / WALL.length }
let upv = V3(), rates = V3(), pv3 = V3(), fw = V3()

func advance(_ run: Run, _ input: Input) throws {
    let c = run.car, t = run.t
    if truthy(input.assist) { t.usedAssist = true }
    else if truthy(input.manual) { t.usedManual = true }
    else if run.phase == .air || run.phase == .ramp { t.usedPro = true }
    let show = run.course == "show"
    let wall = run.course != "lineup"
    let course = show ? SHOW : wall ? WALL_COURSE : LINEUP
    let prevLift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3]
    let prevVx = c.vel.x, prevVy = c.vel.y, prevVz = c.vel.z
    try step(c, input)
    updateDamage(run.damage, c.impacts) { $0 < HULL.count ? HULL[$0].x : nil }
    run.tick += 1

    let speed = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z)
    t.maxSpeed = jsMax(t.maxSpeed, speed)
    if t.zeroToSixty == nil && DMath.dhypot(c.vel.x, c.vel.z) >= 26.8224 { t.zeroToSixty = jsRound(Double(run.tick) * DT * 100) / 100 }
    let lift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3]
    if abs(lift - prevLift) > 0.08 { t.thrustChanges += 1 }
    let ax = (c.vel.x - prevVx) / DT, ay = (c.vel.y - prevVy) / DT + 9.81, az = (c.vel.z - prevVz) / DT
    let g = jsMin(25, DMath.dhypot(ax, ay, az) / 9.81)
    if run.tick > 30 { t.maxG = jsMax(t.maxG, g) }
    let wi = run.tick % G_WIN
    run.gSum += g - run.gWin[wi]; run.gWin[wi] = g; run.hWin[wi] = jsMax(0, c.pos.y - SPEC.comHeight)
    if c.obstacleContact && !t.contact { t.contact = true; t.contactSpeed = c.obstacleSpeed; t.contactTick = Double(run.tick) }
    M3.rotate(upv, c.quat, M3.set(upv, 0, 1, 0))
    if run.phase == .air && run.tick >= G_WIN && upv.y > 0.7 && c.vel.y < 0 && lift > 1 && run.gSum / Double(G_WIN) > t.brakePeakG {
        t.brakePeakG = run.gSum / Double(G_WIN); t.brakePeakH = run.hWin[(run.tick + G_WIN / 2) % G_WIN]
    }
    let airborne = c.grounded == 0 && !c.hullContact
    let lx = c.pos.x, lz = c.pos.z

    if run.phase == .drive {
        if wall {
            if c.onWall || (c.pos.z > 0.5 && c.pos.y > 1.2 && abs(c.pos.x) < WALL.width / 2 + 2) {
                run.phase = .ramp; t.rampTick = Double(run.tick); t.rampEntrySpeed = speed
            }
        } else {
            run.airTicks = c.grounded == 0 ? run.airTicks + 1 : 0
            if run.airTicks > 12 {
                run.phase = .air; t.airStartTick = Double(run.tick - 12)
                t.launchTick = t.airStartTick; t.launchSpeed = speed; t.airAtLaunch = c.air
            }
        }
    } else if run.phase == .ramp {
        if c.grounded > 0 {
            t.maxRampHeight = jsMax(t.maxRampHeight, c.pos.y - SPEC.comHeight)
            t.progress = jsMax(t.progress, wallProgress(c.pos))
            if upv.y < -0.3 { t.invertedTime += DT }
        }
        if abs(c.pos.x) > WALL.width / 2 + 0.3 && c.pos.y > 1.5 { t.fellOff = true }
        run.airTicks = airborne ? run.airTicks + 1 : 0
        if run.airTicks > 24 {
            run.phase = .air
            t.airStartTick = Double(run.tick - 24)
            t.launchTick = t.airStartTick
            t.launchHeight = c.pos.y; t.launchUpY = upv.y; t.launchProgress = t.progress; t.airAtLaunch = c.air
            t.launchSpeed = speed
        } else if c.pos.y < SPEC.comHeight + 0.3 && c.pos.z < 0 && c.grounded > 0 && t.progress < 0.3 {
            run.phase = .drive
        }
    } else if run.phase == .air {
        M3.rotateInv(rates, c.quat, c.angVel)
        t.rollAccum += rates.z * DT
        t.pitchAccum += rates.x * DT
        t.yawAccum += rates.y * DT
        t.offAxis += (abs(rates.x) + abs(rates.y)) * DT
        if c.pos.y > t.apex { t.apex = c.pos.y; t.apexZ = c.pos.z }
        let overRow = show ? lz < course.rowNear + 3 && lz > course.rowFar - 3 : !wall && lz > course.lineupZ0 - 3 && lz < course.lineupEnd + 3
        if overRow {
            for i in 0..<HULL.count {
                M3.rotate(pv3, c.quat, HULL[i]); M3.add(pv3, pv3, c.pos)
                let roof = roofUnder(c.world.bodies, pv3.x, pv3.z)
                if roof > -.infinity { t.minClearance = jsMin(t.minClearance, pv3.y - roof) }
            }
        }
        if show && lz < course.rowFar { t.crossedRow = true }
        let minAir = wall ? 48.0 : 36.0
        let deckScrape = wall && (c.grounded > 0 || c.hullGround) && c.pos.y > 3 && wallArcLength(c.pos.z, c.pos.y) > 1
        if deckScrape { t.deckScrape = true }
        if (c.grounded > 0 || c.hullGround) && !deckScrape && Double(run.tick) - t.airStartTick > minAir {
            run.phase = .landed
            t.touchTick = Double(run.tick)
            t.sink = jsMax(jsMax(0, -prevVy), -c.vel.y)
            M3.rotate(fw, c.quat, M3.set(fw, 0, 0, 1))
            t.tiltDeg = DMath.dacos(jsMax(-1, jsMin(1, upv.y))) * 180 / DMath.PI
            t.headingDeg = DMath.datan2(wall ? -fw.x : fw.x, wall ? -fw.z : fw.z) * 180 / DMath.PI
            t.lateral = lx - (course.pad?.x ?? 0)
            t.landZ = lz
            t.landSpeed = DMath.dhypot(c.vel.x, c.vel.z)
            t.airAtTouch = c.air
            if wall && c.pos.y > 1.2 && wallArcLength(c.pos.z, c.pos.y) > 1 { t.landedOnRamp = true }
        } else if !wall && c.grounded > 0 && Double(run.tick) - t.airStartTick <= 36 {
            run.phase = .drive; run.airTicks = 0
            t.rollAccum = 0; t.pitchAccum = 0; t.yawAccum = 0; t.offAxis = 0; t.apex = 0
        }
    }

    if run.phase == .landed {
        let since = Double(run.tick) - t.touchTick
        if since <= 72 {
            for i in 0..<4 {
                if t.wheelTouch[i] < 0 && c.wheels[i].contact { t.wheelTouch[i] = Double(run.tick) }
                t.maxCompression = jsMax(t.maxCompression, c.wheels[i].compression)
            }
            if c.hullContact && !c.obstacleContact { t.bodyStrike = true }
        }
    }

    let onDeck = wall && run.phase == .ramp
    if !onDeck && upv.y < 0.25 && (c.grounded > 0 || c.hullContact) && run.phase != .air { run.flippedTicks += 1 } else { run.flippedTicks = 0 }
    if run.flippedTicks > 120 { t.flipped = true }
    run.offTicks = onDeck && speed < 0.5 ? run.offTicks + 1 : 0
    run.hang = run.offTicks > 0 && (run.hang || (c.grounded > 0 && c.fanForce > 0 && wallProgress(c.pos) >= HANG_AT))
    let hanging = run.hang

    var end = ""
    if !(c.pos.x + c.pos.y + c.pos.z + c.quat.w + c.angVel.x + c.angVel.y + c.angVel.z + c.vel.x + c.vel.y + c.vel.z).isFinite { finish(run, "sim-fault"); return }
    let tt = Double(run.tick)
    if t.flipped { end = "flipped" }
    else if t.contact && tt - t.contactTick > 480 { end = "contact" }
    else if run.phase == .landed && ((speed < 1.2 && tt - t.touchTick > 72) || tt - t.touchTick > 240 * 5) && (upv.y >= 0.25 || tt - t.touchTick > 240 * 5) { end = "settled" }
    else if c.pos.z > course.runoutMax || c.pos.z < course.runoutMin { end = "runout" }
    else if Double(run.offTicks) > Double(hanging ? HANG_STALL_TICKS : STALL_TICKS) { end = "stalled" }
    else if run.tick >= MAX_TICKS { end = "timeout" }
    else if !wall && run.phase == .drive && lz > course.lineupEnd + 4 && c.grounded > 0 { end = "no-jump" }
    if !end.isEmpty { finish(run, end) }
}

func finish(_ run: Run, _ reason: String) {
    run.phase = .done
    closeBook(run, run.t, reason)
    // The engine's memory back, unless the run is armed for its aftermath (a live run): then the world steps on
    // until the car is at rest (aftermathStep, Live.swift), and frees it then.
    if run.after == nil { run.car.world.free() }
}
func closeBook(_ run: Run, _ t: Telemetry, _ reason: String) {
    let c = run.car
    t.endTick = Double(run.tick)
    t.endReason = reason
    t.tier = t.usedAssist ? "assist" : t.usedManual && !t.usedPro ? "advanced" : "pro"
    t.airEnd = c.air
    M3.rotate(upv, c.quat, M3.set(upv, 0, 1, 0))
    t.settledUpright = upv.y > 0.8 && !t.flipped
    if t.wheelTouch.allSatisfy({ $0 >= 0 }) { t.wheelSpreadMs = (t.wheelTouch.reduce(-.infinity, jsMax) - t.wheelTouch.reduce(.infinity, jsMin)) * DT * 1000 }
    else { t.wheelSpreadMs = 1000 }
    t.bottomOut = t.maxCompression > CAR.restLen - CAR.mountToCentre + CAR.maxTravel + 0.02
    t.mass = massOf(c)
    t.damage = damageFacts(run.damage)
}

/// Re-simulate a run from its input log alone (the server's verification, a replay, a challenge).
/// `onTick(run)` sees every tick, as simulate's does in the JS (the vectors' trace reads it).
@discardableResult
public func simulate(_ inputLog: [[Int]], _ courseId: String = DEFAULT_COURSE, maxTicks: Int = MAX_TICKS, onTick: ((Run) -> Void)? = nil) throws -> Run {
    try simulateReading(inputLog, courseId, maxTicks: maxTicks) { r, _ in onTick?(r) }
}
/// simulate, with the tick's input as well: the JS's `onTick(run, inp)` (the coach reads it, Coach.swift).
func simulateReading(_ inputLog: [[Int]], _ courseId: String, maxTicks: Int = MAX_TICKS, onTick: (Run, Input) -> Void) throws -> Run {
    let run = createRun(courseId)
    let inp = Input()
    var li = 0
    while run.phase != .done && run.tick < maxTicks {
        while li < inputLog.count && inputLog[li][0] <= run.tick { unpack(inputLog[li], inp); li += 1 }
        try advance(run, inp)
        onTick(run, inp)   // after the whole tick, the end decided (as the JS's simulate)
    }
    if run.phase != .done { finish(run, "timeout") }
    run.inputLog = inputLog
    return run
}
#endif
