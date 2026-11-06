// Live play (0154): one run flown from the hand, tick by tick, logged exactly as the web logs it.
//
// Ports, line for line and held to the JS's bits by Tests/Vectors/input/*.json (`npm run vectors`, LiveInputTests):
//   src/sim/run.js     stepRun, logInput (packInput/unpackInts: the hundredths quantisation), the input log, the
//                      aftermath (armAftermath, aftermathStep, aftermath) and finish()'s "keep the world if armed"
//   src/main.js        liveStep's input for a tick: wallAssist (the Wall's fan) and noteRelease (the released flag)
//   OneThumb.swift     src/onethumb.js            Predict.swift   src/sim/predict.js (the pad's sight)
//   Hands.swift        src/hands.js, src/driving.js, and src/input.js sample()'s touch path
//
// ── How the app drives it ─────────────────────────────────────────────────────────────────────────────────
//   let live = LiveRun(course: "show", tier: .assist, oneThumb: true, level: .standard)
//   // touches, as they arrive on the main thread (no sim state is read or written by these):
//   //   one-thumb pad   live.thumb.down() · live.thumb.up() · live.thumb.move(dx, dy)
//   //                   dx, dy: the held thumb's slide from where it pressed, in points, +x right, +y UP the glass
//   //                   (UIKit's y grows down: dy = pressY − nowY). A tap shorter than a tick still counts (`pending`).
//   //                   The pad's first finger only: input.js ignores a second press, and up() is that finger's
//   //                   (touch cancelled too). Touches off the pad do nothing.
//   //   classic         live.touch.stick(x, y)   the stick's knob, −1…1 each way, y + DOWN the glass, inside the unit
//   //                                            disc (TouchControls.stickXY(dx:dy:) from the finger's offset in points)
//   //                   live.touch.stickUp()
//   //                   live.touch.press(.go | .brk | .lift | .land, amount:)  · live.touch.release(...)
//   //                   amount: an Advanced driving pedal's travel (TouchControls.pedalAmount(fy), fy 0 top … 1 bottom
//   //                   of the pad); 1 otherwise.
//   //   Advanced flight live.sampler.nozzleValves[i] = 0…1 per nozzle (NOZZLE_SPEC order), what the nozzle pad holds
//   //   tilt            live.sampler.tilt = TouchControls.tiltSteer(roll:zero:)   (0 when tilt steering is off)
//   //   keys / a pad    live.sampler.keys, live.sampler.pads (Hands.swift; not yet covered by vectors)
//   // then, on the sim's thread, once per 240 Hz tick (an accumulator over the frame's dt, as main.js liveStep):
//   switch try live.tick() {
//   case .flew:      break              // a scored tick: live.run (car, phase, telemetry) is this tick's
//   case .aftermath: break              // the run is over and scored (live.card); the wreck rolls on, unscored
//   case .rest:      break              // at rest: show the results; nothing more to step
//   }
//   live.run.inputLog                   // POST this with the telemetry: the Worker re-simulates it (simulate())
//   live.onRelease = { … }              // the release (LIFT on the deck, or the first tick in the air): buzz
//   // a drill (Drills.swift): LiveRun(drill: try buildDrill(drill, course), tier:, oneThumb:, level:), then the same
//   // the pad's sight, once a frame in the air (read-only on the car):
//   //   predict(car, h, pr, land: live.thumb.landing); let mark = markOffset(car, pr, course, live.thumb.ref)    // px on the pad
//   //   h: the floor's height over what's below. The vectors (and scripts/human-phone.mjs) use jsMax(0, pos.y −
//   //   SPEC.comHeight); the page's HUD also subtracts a roof or the launch site (main.js heightAboveSurface, not ported).
//
// One LiveRun at a time, on one thread: the sim's scratch is module-global, as the JS module's is.
#if canImport(CRapier)
import ColdGasCore

public let AFTER_CAP = 240 * 6, AFTER_STILL = 120
public let AFTER_SPEED = 0.3, AFTER_SPIN = 0.3

// MARK: - run.js: the input log

/// The 23 logged channels (INPUT_KEYS): throttle … assist, manual, v0 … v9.
public let INPUT_CHANNELS = 23

/// run.js `newInput()`'s values written into an input that exists (vehicle.js clearInput): no garbage per tick.
@inline(__always) public func clearInput(_ i: Input) {
    i.throttle = 0; i.brake = 0; i.steer = 0; i.pitch = 0; i.roll = 0; i.yaw = 0; i.lift = 0
    i.thrust = 0; i.retro = 0; i.level = 0; i.fan = 0; i.assist = 1; i.manual = 0
    for k in 0..<10 { i.v[k] = 0 }
}

/// run.js qi: `Math.round(Math.max(-1, Math.min(1, v || 0)) * 100)` (NaN → 0; a half rounds toward +∞).
@inline(__always) func qi(_ v: Double) -> Int { Int(jsRound(jsMax(-1, jsMin(1, v.isNaN ? 0 : v)) * 100)) }
var packScratch = [Int](repeating: 0, count: INPUT_CHANNELS)
let liveQ = Input()

@inline(__always) func packInput(_ r: Input) {
    packScratch[0] = qi(r.throttle); packScratch[1] = qi(r.brake); packScratch[2] = qi(r.steer); packScratch[3] = qi(r.pitch)
    packScratch[4] = qi(r.roll); packScratch[5] = qi(r.yaw); packScratch[6] = qi(r.lift); packScratch[7] = qi(r.thrust)
    packScratch[8] = qi(r.retro); packScratch[9] = qi(r.level); packScratch[10] = qi(r.fan); packScratch[11] = qi(r.assist)
    packScratch[12] = qi(r.manual)
    for k in 0..<10 { packScratch[13 + k] = qi(r.v[k]) }
}
@inline(__always) func unpackInts(_ o: Input) {
    packScratch.withUnsafeBufferPointer { n in
        o.throttle = Double(n[0]) / 100; o.brake = Double(n[1]) / 100; o.steer = Double(n[2]) / 100; o.pitch = Double(n[3]) / 100
        o.roll = Double(n[4]) / 100; o.yaw = Double(n[5]) / 100; o.lift = Double(n[6]) / 100; o.thrust = Double(n[7]) / 100
        o.retro = Double(n[8]) / 100; o.level = Double(n[9]) / 100; o.fan = Double(n[10]) / 100; o.assist = Double(n[11]) / 100
        o.manual = Double(n[12]) / 100
        for k in 0..<10 { o.v[k] = Double(n[13 + k]) / 100 }
    }
}

/// Quantise a raw input to the canonical integers client and server share, into `out` (run.js quantise).
@discardableResult public func quantise(_ raw: Input, _ out: Input) -> Input { packInput(raw); unpackInts(out); return out }

/// Quantise this tick's input, log it if it changed (`[tick, …23 ints]`), and return it quantised, in a shared
/// Input (run.js logInput). Nothing is allocated unless the input changed.
@discardableResult public func logInput(_ run: Run, _ raw: Input) -> Input {
    packInput(raw)
    var same = run.hasPacked
    if same { for i in 0..<INPUT_CHANNELS where packScratch[i] != run.lastPacked[i] { same = false; break } }
    if !same {
        var e = [Int](); e.reserveCapacity(INPUT_CHANNELS + 1)
        e.append(run.tick); e.append(contentsOf: packScratch)
        run.inputLog.append(e)
        // Copied into the run's own buffer: sharing packScratch's would copy on the next tick's write.
        for i in 0..<INPUT_CHANNELS { run.lastPacked[i] = packScratch[i] }
        run.hasPacked = true
    }
    unpackInts(liveQ)
    return liveQ
}

/// Advance one tick with a raw input (run.js stepRun): quantised and logged first, so the run replays from its log.
@discardableResult public func stepRun(_ run: Run, _ raw: Input) throws -> Run {
    if run.phase == .done { return run }
    try advance(run, logInput(run, raw))
    return run
}

// MARK: - run.js: the aftermath (0062)

/// A crashed car finishing its crash: brakes on (ABS), no drive, no fan, valves shut, wheel straight. Unscored and
/// unlogged: the score was decided when the run ended. A stalled car (0145) keeps its fan.
public final class Aftermath { public internal(set) var ticks = 0, still = 0, done = false, startTick = -1 }
let AFTER_INPUT: Input = { let i = Input(); i.assist = 0; i.manual = 1; i.brake = 1; return i }()
let STALL_INPUT: Input = { let i = Input(); i.assist = 0; i.manual = 1; i.brake = 1; i.fan = 1; return i }()

/// Arm a run for its aftermath before it ends: finish() then keeps its world.
@discardableResult public func armAftermath(_ run: Run) -> Run { run.after = Aftermath(); return run }

/// One aftermath tick. True once the car is at rest (or at the cap), the world freed then.
public func aftermathStep(_ run: Run) throws -> Bool {
    guard let a = run.after else { return true }
    if a.done { return true }
    let c = run.car
    if c.world.freed || run.t.endReason == "sim-fault" { return endAftermath(run) }
    if a.startTick < 0 { a.startTick = run.tick }
    try step(c, run.t.endReason == "stalled" ? STALL_INPUT : AFTER_INPUT)
    run.tick += 1; a.ticks += 1
    if !(c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z + c.angVel.x + c.angVel.y + c.angVel.z).isFinite { return endAftermath(run) }
    let rest = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z) < AFTER_SPEED && DMath.dhypot(c.angVel.x, c.angVel.y, c.angVel.z) < AFTER_SPIN
    a.still = rest ? a.still + 1 : 0
    if a.still >= AFTER_STILL || a.ticks >= AFTER_CAP { return endAftermath(run) }
    return false
}
func endAftermath(_ run: Run) -> Bool {
    run.after!.done = true
    run.car.world.free()
    return true
}
/// The whole aftermath at once (tests, tools).
@discardableResult public func aftermath(_ run: Run) throws -> Run {
    if run.after == nil { armAftermath(run) }
    while try !aftermathStep(run) {}
    return run
}

// MARK: - main.js: a live run

/// The flight tier a run is flown in (the top bar's Assist / Pro / Advanced).
public enum FlyTier: String { case assist, pro, advanced }

/// One live run as src/main.js liveStep flies it: the controls sampled (one-thumb or classic touch), the Wall's fan
/// and the release added (wallAssist / noteRelease), stepped and logged; then its aftermath.
public final class LiveRun {
    public enum Tick { case flew, aftermath, rest }
    public let run: Run
    /// Latched as the run starts (main.js latchTier).
    public let tier: FlyTier
    /// The one-thumb pad flies this tick (true) or the classic stick and pedals. Setting it is the player's choice
    /// (or the device: a keyboard or a pad takes a run off one-thumb); main.js syncScheme offers one-thumb only on the
    /// Show and the Wall, on Assist, so elsewhere this stays false.
    public var oneThumb: Bool {
        get { wantsThumb && run.course != "lineup" && tier == .assist }
        set { wantsThumb = newValue }
    }
    var wantsThumb: Bool
    public let thumb = OneThumb()
    /// The classic controls, the tilt, keys and pads (src/input.js sample).
    public let sampler: InputSampler
    public var touch: TouchControls { sampler.touch }
    /// Let go of the Wall: LIFT on the deck, or the first tick in the air (main.js S.released, S.releaseTick).
    public private(set) var released = false, releaseTick = -1
    public var onRelease: (() -> Void)?
    /// This tick's input as sampled, before quantisation (main.js liveInput).
    public let input = Input()
    /// scoreRun's card, decided on the tick the run ends (main.js closeCard).
    public private(set) var card: Card?
    /// A recorded input log to fly instead of the hand (the app's `-autopilot`, a demo): entries applied at their ticks.
    public var script: [[Int]]?
    private var scriptAt = 0

    /// The drill this run practises, nil on a whole run (Drills.swift).
    public let drill: Drill?
    /// The tick the drill handed over at (main.js run.drillStartTick), 0 on a whole run: the coach's `fromTick`.
    public let drillStartTick: Int
    /// A drill's own card and coaching, decided with the card and before the aftermath moves the car (main.js closeCard).
    public private(set) var drillSnap: (result: DrillResult, coach: [CoachItem]?)?
    private var drillEnded = false

    public init(course: String, tier: FlyTier = .assist, oneThumb: Bool = true, level: DriveLevel = .standard) {
        run = armAftermath(createRun(course))
        self.tier = tier; wantsThumb = oneThumb
        sampler = InputSampler(level: level)
        drill = nil; drillStartTick = 0
    }
    /// A drill's run, handed over mid-flight (main.js startDrillNow and newFlight: the hand-over's released flag, and a
    /// release that's already behind it).
    public init(drill built: BuiltDrill, tier: FlyTier = .assist, oneThumb: Bool = true, level: DriveLevel = .standard) {
        run = armAftermath(built.run)
        self.tier = tier; wantsThumb = oneThumb
        sampler = InputSampler(level: level)
        drill = built.drill; drillStartTick = built.startTick
        released = built.released; releaseTick = built.released ? built.startTick - 240 : -1
    }

    /// main.js closeCard.
    private func closeCard() {
        card = scoreRun(run.t)
        if let drill { drillSnap = (drillResult(drill, run, card), drillCoach(drill, run)) }
    }
    /// A drill that ends before its run does has reached its end (the carry drill, past the row). main.js gives it half a
    /// second more of flight, then calls endDrillMoment().
    public var drillMoment: Bool { drill?.done?(run) ?? false }
    /// main.js beginAftermath on a drill's moment: the card is decided here, and tick() goes on to the aftermath.
    public func endDrillMoment() {
        if card == nil { closeCard() }
        drillEnded = true
    }
    /// What the results show (main.js finishRun): a drill's own coaching, or the coach over this run's log. Once tick()
    /// says .rest: it flies the whole log again on the sim's scratch.
    public func coachResult(say: CoachWords) throws -> CoachResult {
        if let own = drillSnap?.coach { return CoachResult(items: own, flight: nil) }
        return try coach(run.inputLog, run.course, card: card, fromTick: drillStartTick, say: say)
    }

    /// One 240 Hz tick: a scored tick while the run is on, then the aftermath's, then nothing.
    @discardableResult public func tick() throws -> Tick {
        if run.phase != .done && !drillEnded {
            if let log = script {
                while scriptAt < log.count && log[scriptAt][0] <= run.tick { unpack(log[scriptAt], input); scriptAt += 1 }
                if noteRelease(input) { onRelease?() }
                try stepRun(run, input)
                if run.phase == .done && card == nil { closeCard() }
                return .flew
            }
            if oneThumb { clearInput(input); thumb.sample(run, released, input, sampler.tilt) }
            else { sampler.sample(run.phase, tier, input, released, run.car) }
            wallAssist(input)
            try stepRun(run, input)
            if run.phase == .done && card == nil { closeCard() }
            return .flew
        }
        if let a = run.after, !a.done { return try aftermathStep(run) ? .rest : .aftermath }
        return .rest
    }

    /// main.js wallAssist: the Wall's fan is a car system, spooled up before the foot of the ramp and holding the
    /// car to the deck until the release.
    func wallAssist(_ i: Input) {
        if run.course == "lineup" { i.fan = 0; return }
        if noteRelease(i) { onRelease?() }
        i.fan = !released && (run.phase == .ramp || (run.phase == .drive && run.car.pos.z > -16)) ? 1 : 0
    }
    /// main.js noteRelease: LIFT on the deck, or the first tick in the air.
    func noteRelease(_ i: Input) -> Bool {
        if released || run.course == "lineup" || !((run.phase == .ramp && i.lift > 0) || run.phase == .air) { return false }
        released = true; releaseTick = run.tick
        return true
    }
}
#endif
