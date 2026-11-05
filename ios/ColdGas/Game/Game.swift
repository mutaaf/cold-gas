// The game (0154): a run flown live by the Swift sim (bit-exact with the web, 0152), as src/main.js liveStep flies it:
// the display link's frame time is cut into 240 Hz ticks, each tick's input sampled from the controls (one-thumb or
// classic touch, src/onethumb.js / src/input.js), wallAssist's fan and release added, stepped and logged. The renderer
// only reads (a track of the ticks, drawn one tick behind, between the last two), the haptics read a feed per tick, and
// the scorer reads the telemetry once the run is done. Nothing here writes the sim's state.
//
// Screens: the title (the reference run looping behind it), the countdown, the run, the results. The board and the
// settings are sheets over the title or the results.
import Foundation
import QuartzCore
import SwiftUI
import simd
import ColdGasClient
import ColdGasCore
import ColdGasPhysics

enum Screen: Equatable { case title, run, results }
enum Control: String, CaseIterable, Codable { case oneThumb, classic }

/// What the HUD shows, refreshed a few times a second (SwiftUI never sees the 240 Hz state).
struct HudState: Equatable {
    var speed = 0.0, alt = 0.0, sink = 0.0, gas = 1.0, phase: UInt8 = 0
    var cue = "", stage = "climb", held = false, released = false, aimLive = false
    var sinkBand = 0   // 0 on profile, 1 fast but stoppable, 2 past stopping
    var throttles = [Double](repeating: 0, count: 10)   // the live valves, for Advanced's pad
    var hardware = false                                 // a controller or keyboard is flying: the touch controls hide
    var markX = 0.0, markY = 0.0, hasMark = false   // the pad's sight: the mark from the predicted touchdown
}

@MainActor
final class Game: ObservableObject {
    static let shared = Game()

    @Published var screen: Screen = .title
    @Published var course = Launch.value("-course") ?? UserDefaults.standard.string(forKey: "cg.course") ?? "show" { didSet { UserDefaults.standard.set(course, forKey: "cg.course"); showTitleLoop() } }
    @Published var tier = Launch.value("-tier") ?? UserDefaults.standard.string(forKey: "cg.tier") ?? "assist" { didSet { UserDefaults.standard.set(tier, forKey: "cg.tier") } }
    @Published var control = Control(rawValue: UserDefaults.standard.string(forKey: "cg.control") ?? "") ?? .oneThumb { didSet { UserDefaults.standard.set(control.rawValue, forKey: "cg.control") } }
    @Published private(set) var hud = HudState()
    @Published private(set) var countdown = 0
    @Published private(set) var result: RunResult?
    @Published var paused = false
    /// The results are up and the flight is playing back behind them (the track the run recorded).
    @Published private(set) var replaying = false
    private var replayT = 0.0

    /// The stage view the game draws through (set by the root).
    weak var stage: StageView?
    let controls = Controls()

    private(set) var live: LiveRun?
    private var track: Replay?
    private var acc = 0.0
    private var doneFor = 0.0, momentFor = 0.0
    private(set) var activeDrill: String?
    private var titleTracks: [String: Replay] = [:]
    private var haptics = HapticScore(course: "show"), seen = 0
    private var countT = 0.0
    private var lastHud = 0.0
    private var touched = false   // the touchdown has reached the camera (main.js: once per run, keyed on the touch tick)

    /// One-thumb flies only Assist on the Show and the Wall (src/onethumb.js); everything else is classic touch.
    var oneThumb: Bool { control == .oneThumb && tier == "assist" && course != "lineup" }

    // --- Flow ----------------------------------------------------------------------------------
    func showTitleLoop() {
        guard screen == .title else { return }
        // Flown once per course and kept: Home must never wait on a whole flight (and the sim stays on this one thread).
        let tr = titleTracks[course] ?? Replay(runVector: "ref-\(course)")
        titleTracks[course] = tr
        stage?.load(course: course, track: tr)
    }

    /// `drill`: practise one part of the flight, handed over mid-run (src/practice.js). A drill's id; nil is a whole run.
    func play(drill: String? = nil) {
        let t: FlyTier = tier == "pro" ? .pro : tier == "advanced" ? .advanced : .assist
        var built: BuiltDrill?
        if let drill, let d = drillById(drill) { built = try? buildDrill(d, course) }
        activeDrill = built == nil ? nil : drill
        let l = built.map { LiveRun(drill: $0, tier: t, oneThumb: control == .oneThumb) } ?? LiveRun(course: course, tier: t, oneThumb: control == .oneThumb)
        if Launch.args.contains("-autopilot") { l.script = Game.referenceLog(course) }
        if let v = Launch.value("-script") { l.script = Game.vectorLog(v) }   // a recorded run flown live (store captures, a crash)
        #if DEBUG
        if let n = Launch.value("-script-end").flatMap(Int.init) { l.script = l.script?.filter { ($0.first ?? 0) < n } }   // hands off at that tick: a real crash
        #endif
        l.onRelease = { Sound.shared.release() }   // the haptic release is the HapticScore's (it reads the feed's lift)
        live = l; controls.live = l
        acc = 0; seen = 0; doneFor = 0; momentFor = 0; result = nil; paused = false; touched = false
        haptics = HapticScore(course: course)
        let tr = Replay(live: course)
        tr.tickBase = l.run.tick
        tr.append(l.run)
        track = tr
        stage?.load(course: course, track: tr)
        countdown = 3; countT = 0
        replaying = false
        Hardware.shared.startRun()
        screen = .run
        UISelectionFeedbackGenerator().selectionChanged()
    }
    func retry() { play(drill: activeDrill) }
    func home() {
        live = nil; controls.live = nil; track = nil; result = nil; paused = false; activeDrill = nil
        HapticPlayer.shared.apply(HapticContinuous())
        screen = .title
        showTitleLoop()
    }

    // --- The frame -----------------------------------------------------------------------------
    /// Once a display frame, before the draw: step the sim by the frame's time (scaled by the crash's slow motion).
    func frame(dt: Double, slowK: Double) {
        stage?.renderer?.crash.audible = screen == .run || replaying
        if replaying, let tr = track { replayFrame(dt: dt, slowK: slowK, tr); return }
        guard screen == .run, let l = live, let tr = track, !paused else {
            Sound.shared.update(speed: 0, throttles: Game.quiet, grounded: true, phase: screen == .title ? .title : .quiet)
            if paused { HapticPlayer.shared.apply(HapticContinuous()) }
            return
        }
        let r = l.run
        if countdown > 0 {
            countT += dt
            if countT >= 0.7 { countT = 0; countdown -= 1; UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5) }
            stage?.renderer?.liveTime = 0
            refreshHud(l)
            return
        }
        #if DEBUG
        thumbBot(l)
        #endif
        if !paused && r.phase != .done { Hardware.shared.poll(l) { self.paused = true } }
        acc += min(dt, 0.1) * slowK
        var atRest = false
        do {
            while acc >= DT && !atRest {
                let wasFlying = r.phase != .done, wasLanded = r.phase == .landed
                let ticked = try l.tick()
                acc -= DT
                if ticked == .rest { atRest = true; break }   // the world is freed: nothing to read
                tr.append(r)
                if wasFlying { haptics.step(HapticFeed(run: r, input: l.input, seen: &seen)) }
                if !wasLanded && r.phase == .landed { Sound.shared.thud(sink: r.t.sink) }
                if !touched && r.t.touchTick >= 0 { touched = true; stage?.renderer?.cam.touchdown(sink: r.t.sink) }
                if wasFlying && r.phase == .done { finished(l) }
            }
        } catch { print("SIM stopped: \(error)"); if result == nil { home() }; return }
        haptics.drain { HapticPlayer.shared.play($0) }
        HapticPlayer.shared.apply(r.phase == .done ? HapticContinuous() : haptics.continuous)
        if !atRest && !(r.after?.done ?? false) {
            let c = r.car, g = Double(stage?.renderer?.crash.grind ?? 0) * slowK
            Sound.shared.update(speed: DMath.dhypot(c.vel.x, c.vel.y, c.vel.z), throttles: r.phase == .done ? Game.quiet : c.throttles, grounded: c.grounded > 0, grind: g, phase: .run)
        } else { Sound.shared.update(speed: 0, throttles: Game.quiet, grounded: true, phase: .run) }
        // Drawn one tick behind the newest, between it and the one before (the fraction of a tick left in `acc`).
        stage?.renderer?.liveTime = (Double(max(0, tr.ticks - 2)) + min(1, acc / DT)) / Replay.hz
        // A drill that ends before its run does (the carry, past the row): half a second more of flight, then its card.
        if result == nil && l.drillMoment && r.phase != .done { momentFor += dt; if momentFor > 0.5 { l.endDrillMoment(); finished(l) } }
        // The results come up when the wreck is at rest, or after a few seconds of it rolling.
        if result != nil { doneFor += dt; if atRest || doneFor > 3.5 { showResults(l) } }
        lastHud += dt
        if lastHud > 1.0 / 15, !(r.after?.done ?? false) { lastHud = 0; refreshHud(l) }
    }

    // --- Watch it back -------------------------------------------------------------------------------
    /// The flight again from the top, at the speed it flew, with its sound and its crash, from the track it recorded. The sim
    /// isn't touched: the run is over.
    func watch() {
        guard track != nil else { return }
        replayT = 0; replaying = true
        UISelectionFeedbackGenerator().selectionChanged()
    }
    func stopWatching() { replaying = false; if let tr = track { stage?.renderer?.liveTime = Double(max(0, tr.ticks - 1)) / Replay.hz }; Sound.shared.update(speed: 0, throttles: Game.quiet, grounded: true, phase: .quiet) }
    private func replayFrame(dt: Double, slowK: Double, _ tr: Replay) {
        replayT += min(dt, 0.1) * slowK
        let end = Double(tr.ticks) / Replay.hz
        if replayT >= end { stopWatching(); return }
        stage?.renderer?.liveTime = replayT
        let i = Int(replayT * Replay.hz), v = tr.velocity(at: i)
        var th = Game.quiet
        for k in 0..<10 { th[k] = Double(tr.nozzle(k, at: i)) }
        Sound.shared.update(speed: Double(simd_length(v)), throttles: th, grounded: tr.phase(at: i) != 2, phase: .run)
    }

    /// Leaving the screen: pause the run, let go of everything (a finger lifted while we weren't listening must not stay held).
    func resignActive() {
        if screen == .run && !paused && result == nil { paused = true }
        live?.thumb.up(); live?.touch.stickUp()
        for k in [Controls.Key.go, .brake, .lift, .land] { controls.press(k, false) }
        HapticPlayer.shared.apply(HapticContinuous())
    }

    #if DEBUG
    /// `-thumbbot`: a thumb on the one-thumb pad: hold to the ledge, a tap, hold to land (the path a touch takes, minus the glass).
    private var botWait = 0
    private func thumbBot(_ l: LiveRun) {
        guard Launch.args.contains("-thumbbot") else { return }
        switch thumbStage(l.run, l.released) {
        case .climb: if !l.thumb.held { controls.thumbDown() }
        case .ledge:
            botWait += 1
            if botWait == 30 { controls.thumbUp() }
            if botWait == 90 { controls.thumbDown() }
            if botWait == 96 { controls.thumbUp() }
        case .fly: if !l.thumb.held { controls.thumbDown() }
        default: if l.thumb.held { controls.thumbUp() }
        }
    }
    #endif

    private func showResults(_ l: LiveRun) {
        // The coach re-flies the log on the sim's shared scratch: here, with no tick in flight, and the run stepping no more.
        let say = coachWords(pointerCtx(course: l.run.course, tier: l.card?.tier ?? "assist", touchScheme: l.oneThumb ? .thumb : .classic))
        result?.coach = (try? l.coachResult(say: say))?.items ?? []
        screen = .results
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    private func finished(_ l: LiveRun) {
        guard result == nil else { return }
        print(String(format: "RUN %@ %@ %.1f %@ end=%@ ticks=%d log=%d", l.run.course, l.tier == .pro ? "pro" : "assist", l.card?.total ?? -1, l.card?.verdict ?? "", l.run.t.endReason, l.run.tick, l.run.inputLog.count))
        guard let card = l.card else { return }
        track?.setScore(card.total, card.verdict)
        let res = RunResult(course: l.run.course, card: card, log: l.run.inputLog, telemetry: l.run.t, ticks: l.run.tick)
        if let snap = l.drillSnap, let d = l.drill {
            res.drill = (d.label, snap.result.pass, snap.result.headline, snap.result.stats.map(\.text))
        } else { Records.shared.note(res) }
        result = res
    }

    // --- The HUD ---------------------------------------------------------------------------------
    private let pr = Prediction()
    private func refreshHud(_ l: LiveRun) {
        let r = l.run, c = r.car
        var h = HudState()
        h.speed = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z)
        h.alt = max(0, c.pos.y - SPEC.comHeight)
        h.sink = max(0, -c.vel.y)
        h.gas = max(0, min(1, c.air / CAR.airMass))
        h.phase = UInt8(r.phase.rawValue)
        h.released = l.released
        h.held = l.thumb.held
        h.stage = thumbStage(r, l.released).rawValue
        h.aimLive = l.thumb.aimLive
        h.throttles = c.throttles
        h.hardware = Hardware.shared.inUse
        if r.phase == .air && l.oneThumb {
            predict(c, h.alt, pr, land: l.thumb.landing)
            let m = markOffset(c, pr, r.course)
            h.markX = m.x; h.markY = m.y; h.hasMark = true
        }
        h.sinkBand = r.phase == .air && c.vel.y < 0 ? landingBand(l, h) : 0
        h.cue = cue(l, h)
        if h != hud { hud = h }
    }
    private func landingBand(_ l: LiveRun, _ h: HudState) -> Int {
        predict(l.run.car, h.alt, pr, land: l.thumb.landing)
        return pr.status == "green" ? 0 : pr.status == "amber" ? 1 : 2
    }

    /// The cue line (src/main.js thumbCues / cues), in the app's words.
    private func cue(_ l: LiveRun, _ h: HudState) -> String {
        let r = l.run, released = l.released
        if r.phase == .done { return result?.card.verdict ?? "" }
        let c = r.car, v = h.speed
        if l.oneThumb {
            let held = h.held
            if r.phase == .drive { return held || v > 2 ? "Climbing · let go to stop" : "Hold the pad to climb" }
            if r.phase == .ramp && !released && r.t.progress >= 0.92 && l.thumb.driving { return "Letting go · out to the lip" }
            if r.phase == .ramp && !released { return r.t.progress >= 0.92 ? "On the ledge · tap to let go" : "Up the curl on suction" }
            if r.phase == .air || released {
                if r.course == "show" && !r.t.crossedRow && c.pos.z > SHOW.rowNear { return "Carrying you over the row" }
                if !held && (c.autoLand > 0 || l.thumb.landing) { return "Auto-land · braking for you" }
                if !held { return "Hold to land: it rolls you out and brakes" }
            }
            if r.phase == .landed { return "Touchdown" }
            return ""
        }
        if r.phase == .drive && v < 2 { return "Hold GO to drive" }
        if r.course != "lineup" {
            if r.phase == .drive && c.pos.z > -40 { return "Fan spooling · crawl in, about 20 km/h" }
            if r.phase == .ramp && r.t.progress < 0.88 { return tier == "assist" ? "Hold GO: Assist holds a crawl on suction" : "Feather GO: crawl up on suction" }
            if r.phase == .ramp && !released && r.t.progress < 0.92 { return "Onto the ledge, then stop" }
            if r.phase == .ramp && !released { return "Upside down on the ledge · RELEASE to let go" }
            let vh = DMath.dhypot(c.vel.x, 0, c.vel.z)
            if r.course == "show" && r.phase == .air && !r.t.crossedRow && vh < 10 && c.pos.z > SHOW.rowNear { return tier == "assist" ? "Hold BOOST + LAND · over the row" : "BOOST · carry about 10 m/s over the row" }
            if tier == "assist" {
                if r.phase == .air && c.autoLand > 0 { return "Auto-LAND · braking for you · LAND next time" }
                if r.phase == .air { return "Hold LAND: it rolls you out and brakes" }
                return ""
            }
            if r.phase == .air { return "Brake: hold LIFT at the BRAKE line" }
            return ""
        }
        let lz = c.pos.z
        if r.phase == .drive && lz > -14 && lz < LINEUP.lineupZ0 { return "Hold LIFT at the line" }
        if r.phase == .air && abs(r.t.rollAccum) < 0.3 && c.vel.y < 4 { return "Stick sideways to roll" }
        if r.phase == .air && abs(r.t.rollAccum) > 5.6 && c.vel.y < 0 { return "Hold LAND" }
        return ""
    }

    static let quiet = [Double](repeating: 0, count: 10)

    static func referenceLog(_ course: String) -> [[Int]]? { vectorLog("ref-\(course)") }
    static func vectorLog(_ name: String) -> [[Int]]? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "runs"),
              let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let log = j["log"] as? [[NSNumber]] else { return nil }
        return log.map { $0.map(\.intValue) }
    }
}

/// A finished run: what the results sheet, the board and the records read.
@MainActor
final class RunResult: Identifiable {
    let post = PostModel(), judges = JudgesModel()
    let id = UUID()
    let course: String
    let card: Card
    let log: [[Int]]
    let telemetry: Telemetry
    let ticks: Int
    init(course: String, card: Card, log: [[Int]], telemetry: Telemetry, ticks: Int) {
        self.course = course; self.card = card; self.log = log; self.telemetry = telemetry; self.ticks = ticks
    }
    /// Eligible for the board: a scored run (the web's `eligible`).
    var eligible: Bool { card.total > 0 && drill == nil }
    var coach: [CoachItem] = []
    var drill: (label: String, pass: Bool, headline: String, stats: [String])?
    var dailyOK = false, dailyLine: String?
    /// A link to the same jump on the web (src/challenge.js): opens the game with this run to beat.
    lazy var challengeURL: URL? = {
        guard eligible, let p = try? Challenge.encode(log: log, course: course, score: card.total, tier: card.tier, initials: SaveStore.shared.initials, simVersion: SIM_VERSION) else { return nil }
        return URL(string: Challenge.url(base: "https://mutaafaziz.com/coldgas/", course: course, payload: p))
    }()
}
