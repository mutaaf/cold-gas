// The Wreck score's eyes (0237, 0239): once a tick, after the sim has stepped (live, in a replay of a log, or in the
// aftermath), it reads what the sim already recorded and writes Wreck events (ColdGasClient's Wreck.swift scores them).
// Read-only: it never touches the car, the world or the log, so the scored run and the vectors are bit-exact.
//
// What counts, and only once the wreck has started (a hull hit of WRECK_START m/s or more, any touch on a parked car, or
// the car over past its side after coming down), so a clean landing scores nothing:
//   slam      a hull hit of HIT_COUNT m/s or more, nose, tail or floor first
//   roof      a hit or scrape on the roof
//   swipe     a hit or scrape down a side
//   grind     the floor dragged along at speed
//   crush     the hull's permanent crush stepping deeper
//   airborne  off the ground again for AIR_TICKS, mid-wreck
//   rollover  the car going over past its side (again each time it comes back up and goes over)
//   shove     a parked car pushed SHOVE_M from where it stood (once per car)
//   topple    a parked car past 60° from upright (once per car)
#if canImport(CRapier)
import ColdGasCore
import ColdGasClient

public let WRECK_START = 5.0, HIT_COUNT = 4.0, SHOVE_M = 0.6, GRIND_MIN = 6.0
/// 0.35 s off the ground, mid-wreck, is a flight of its own.
public let AIR_TICKS = 84
/// cos 60°: a parked car whose up axis has dropped below this has gone over.
let TOPPLE_UP = 0.5

public final class WreckTracker {
    public private(set) var events: [WreckEvent] = []
    public private(set) var started = false
    /// Events stop counting this many ticks after the scored run ends (the aftermath's first 2.5 s): the card is the same
    /// however long the results take to come up.
    public static let afterTicks = 600
    private var seen = 0, endTick = -1, airFor = 0
    private var shoved: [Bool] = [], toppled: [Bool] = []
    private var over = false
    private let up = V3(), unitY = V3()
    public init() { events.reserveCapacity(64) }

    /// Read the tick that just ran. Call after every stepRun / aftermathStep / simulate callback.
    public func step(_ run: Run) {
        let c = run.car, im = c.impacts, tick = run.tick
        if run.phase == .done && endTick < 0 { endTick = tick }
        if endTick >= 0 && tick > endTick + WreckTracker.afterTicks { seen = im.count; return }
        let bodies = c.world.bodies
        if shoved.count != bodies.count { shoved = .init(repeating: false, count: bodies.count); toppled = shoved }
        // Impacts since the last tick (the buffer only grows within a run; a full one stops recording).
        while seen < im.count {
            let i = seen; seen += 1
            let kind = im.kind[i], v = Double(im.speed[i]), part = im.part[i]
            if kind == ImpactKind.WHEEL { continue }
            if !started && ((kind == ImpactKind.HIT && v >= WRECK_START) || im.body[i] >= 0) { started = true }
            guard started else { continue }
            let t = Int(im.tick[i])
            if kind == ImpactKind.CRUSH { add(t, .crush, WreckPoints.crush); continue }
            let hit = kind == ImpactKind.HIT
            if hit && v < HIT_COUNT { continue }
            if part == PART.roof { add(t, .roof, hit ? WreckPoints.roofHit(v) : WreckPoints.scrape(v)) }
            else if part == PART.side { add(t, .swipe, hit ? WreckPoints.sideHit(v) : WreckPoints.scrape(v)) }
            else if hit { add(t, .slam, WreckPoints.slam(v)) }
            else if part == PART.floor && v >= GRIND_MIN { add(t, .grind, WreckPoints.grind) }
        }
        // The car going over past its side. Not the stunt's own roll in the air, nor the Wall's hang under the ledge: only
        // once the car has come down, or the wreck has started.
        M3.rotate(up, c.quat, M3.set(unitY, 0, 1, 0))
        if up.y < 0 && !over {
            over = true
            if started || run.phase == .landed || run.phase == .done { started = true; add(tick, .rollover, WreckPoints.rollover) }
        } else if up.y > 0.5 { over = false }
        guard started else { return }
        // Off the ground again, mid-wreck: once per flight.
        if c.grounded == 0 && !c.hullContact { airFor += 1; if airFor == AIR_TICKS { add(tick, .airborne, WreckPoints.airborne) } } else { airFor = 0 }
        // The parked cars: shoved and toppled, each once.
        for (k, b) in bodies.enumerated() {
            if !toppled[k] && 1 - 2 * (b.qx * b.qx + b.qz * b.qz) < TOPPLE_UP { toppled[k] = true; add(tick, .topple, WreckPoints.topple) }
            if !shoved[k] {
                let ox = (b.spec.minX + b.spec.maxX) / 2, oz = (b.spec.minZ + b.spec.maxZ) / 2
                if DMath.dhypot(b.cx - ox, b.cz - oz) >= SHOVE_M { shoved[k] = true; add(tick, .shove, WreckPoints.shove) }
            }
        }
    }
    private func add(_ t: Int, _ k: WreckKind, _ points: Double) {
        if events.count >= 512 { return }
        events.append(WreckEvent(tick: t, kind: k, points: points))
        // The live chain, as comboCalls reads it: a call each time its multiplier rises (the HUD shows it, the phone plays it).
        if chainLast == Int.min || t - chainLast > COMBO_WINDOW { chain.removeAll(keepingCapacity: true) }
        chainLast = t
        if !chain.contains(k) { chain.append(k); if chain.count >= 2 { pending.append(ComboCall(tick: t, multiplier: chain.count, kind: k)) } }
    }
    private var chain: [WreckKind] = [], chainLast = Int.min, pending: [ComboCall] = []
    /// The combo calls since the last drain, in order.
    public func drainCalls(_ f: (ComboCall) -> Void) {
        if pending.isEmpty { return }
        for c in pending { f(c) }
        pending.removeAll(keepingCapacity: true)
    }
    /// The card so far.
    public var card: WreckCard { wreckCard(events) }
}

/// A run's Wreck card from its input log alone (tests, tools): simulate's loop with the tracker reading every tick, then the
/// aftermath (where most of a wreck happens) up to the tracker's window. The scored run is exactly simulate's.
public func wreckOf(_ inputLog: [[Int]], _ courseId: String) throws -> (run: Run, card: WreckCard) {
    let run = armAftermath(createRun(courseId)), tracker = WreckTracker()
    let inp = Input()
    var li = 0
    while run.phase != .done && run.tick < MAX_TICKS {
        while li < inputLog.count && inputLog[li][0] <= run.tick { unpack(inputLog[li], inp); li += 1 }
        try advance(run, inp)
        tracker.step(run)
    }
    if run.phase != .done { finish(run, "timeout") }
    run.inputLog = inputLog
    let end = run.tick
    while run.tick <= end + WreckTracker.afterTicks, try !aftermathStep(run) { tracker.step(run) }
    if !(run.after?.done ?? true) { _ = endAftermath(run) }
    return (run, tracker.card)
}
#endif
