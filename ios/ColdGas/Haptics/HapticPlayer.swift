// HapticScore's track, played on Core Haptics (docs/NATIVE.md §6, 0149).
// - One CHHapticEngine for the app; it restarts itself after the system stops it (a call, Siri, an audio
//   interruption) and is stopped in the background.
// - Three continuous players (rumble, hiss, grind) made ONCE, looping, and modulated with dynamic parameters only
//   when a channel moves (≥ 0.02), never every frame.
// - Transients from a fixed bank of players (8 intensities × 3 sharpnesses) made once: nothing is built per event.
// - Off / Subtle / Full (default Full; Subtle halves intensity and drops the rumble). A device without haptics
//   (`supportsHaptics` false, the simulator) logs instead of playing. Haptics never carry anything the screen and
//   the sound don't also say.
import CoreHaptics
import UIKit
import ColdGasCore

final class HapticPlayer {
    enum Level: String, CaseIterable { case off, subtle, full }
    static let shared = HapticPlayer()

    private(set) var level: Level
    let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    var log = Launch.value("-haptics") == "log" || Launch.args.contains("-haptics-log")
    private var engine: CHHapticEngine?
    private var rumble, hiss, grind: CHHapticAdvancedPatternPlayer?
    private var bank: [[CHHapticPatternPlayer]] = []          // [intensity step][sharpness step]
    private static let iSteps: [Float] = [0.15, 0.25, 0.35, 0.45, 0.6, 0.72, 0.86, 1.0], sSteps: [Float] = [0.15, 0.5, 0.85]
    private var sent = HapticContinuous(rumble: -1, rumbleSharp: -1, hiss: -1, hissSharp: -1, grind: -1)
    /// The results' moments (0249): a landing, the first landing and a wreck each feel different. Made once.
    enum Moment { case landed, firstLanding, wrecked }
    private var moments: [Moment: CHHapticPatternPlayer] = [:]

    private init() {
        level = Level(rawValue: UserDefaults.standard.string(forKey: "coldgas.haptics") ?? "") ?? .full
        build()
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.engine?.stop(completionHandler: nil)
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.restart()
        }
    }

    func setLevel(_ l: Level) {
        level = l
        UserDefaults.standard.set(l.rawValue, forKey: "coldgas.haptics")
        sent = HapticContinuous(rumble: -1, rumbleSharp: -1, hiss: -1, hissSharp: -1, grind: -1)
        if l == .off { silence() } else { restart() }
    }
    func cycleLevel() { let all = Level.allCases; setLevel(all[(all.firstIndex(of: level)! + 1) % all.count]) }

    private func build() {
        guard supported, level != .off else { return }
        do {
            let e = try CHHapticEngine()
            e.isAutoShutdownEnabled = false
            e.playsHapticsOnly = false   // shares the audio session, so the hiss and the buzz line up
            e.stoppedHandler = { [weak self] reason in
                if self?.log == true { print("HAPTIC engine stopped (\(reason.rawValue)); restarting") }
                DispatchQueue.main.async { self?.restart() }
            }
            e.resetHandler = { [weak self] in DispatchQueue.main.async { self?.rebuildPlayers(); self?.restart() } }
            try e.start()
            engine = e
            rebuildPlayers()
        } catch { print("HAPTIC engine failed: \(error)") }
    }
    private func rebuildPlayers() {
        guard let e = engine else { return }
        func loop(sharp: Float) -> CHHapticAdvancedPatternPlayer? {
            let ev = CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharp)], relativeTime: 0, duration: 30)
            guard let p = try? e.makeAdvancedPlayer(with: CHHapticPattern(events: [ev], parameters: [])) else { return nil }
            p.loopEnabled = true
            try? p.start(atTime: CHHapticTimeImmediate)
            try? p.sendParameters([CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: 0, relativeTime: 0)], atTime: CHHapticTimeImmediate)
            return p
        }
        rumble = loop(sharp: 0.25); hiss = loop(sharp: 0.6); grind = loop(sharp: 0.9)
        func tap(_ t: Double, _ i: Float, _ s: Float) -> CHHapticEvent {
            CHHapticEvent(eventType: .hapticTransient, parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: i),
                                                                    CHHapticEventParameter(parameterID: .hapticSharpness, value: s)], relativeTime: t)
        }
        func hum(_ t: Double, _ d: Double, _ i: Float, _ s: Float) -> CHHapticEvent {
            CHHapticEvent(eventType: .hapticContinuous, parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: i),
                                                                     CHHapticEventParameter(parameterID: .hapticSharpness, value: s)], relativeTime: t, duration: d)
        }
        func curve(_ pts: [(Double, Float)]) -> CHHapticParameterCurve {
            CHHapticParameterCurve(parameterID: .hapticIntensityControl, controlPoints: pts.map { .init(relativeTime: $0.0, value: $0.1) }, relativeTime: 0)
        }
        // A landing: two crisp beats, the car settling on its springs.
        let landed = try? CHHapticPattern(events: [tap(0, 0.85, 0.55), tap(0.11, 0.55, 0.9)], parameters: [])
        // The first landing: a rising swell into the settle, then the two beats.
        let first = try? CHHapticPattern(events: [hum(0, 0.7, 1, 0.35), tap(0.72, 1, 0.6), tap(0.86, 0.6, 0.95), tap(1.02, 0.35, 0.95)],
                                          parameterCurves: [curve([(0, 0.05), (0.55, 0.8), (0.7, 0)])])
        // A wreck: one heavy dull blow and a rumble that dies away.
        let wreck = try? CHHapticPattern(events: [tap(0, 1, 0.1), hum(0.02, 0.55, 0.8, 0.2)],
                                          parameterCurves: [curve([(0, 0.9), (0.55, 0)])])
        moments = [:]
        for (m, p) in [(Moment.landed, landed), (.firstLanding, first), (.wrecked, wreck)] {
            if let p, let pl = try? e.makePlayer(with: p) { moments[m] = pl }
        }
        bank = HapticPlayer.iSteps.map { i in HapticPlayer.sSteps.compactMap { s in
            let ev = CHHapticEvent(eventType: .hapticTransient, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: i),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: s)], relativeTime: 0)
            return try? e.makePlayer(with: CHHapticPattern(events: [ev], parameters: []))
        } }
    }
    private func restart() {
        guard supported, level != .off else { return }
        if engine == nil { build(); return }
        try? engine?.start()
    }
    private func silence() {
        for p in [rumble, hiss, grind] { try? p?.sendParameters([CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: 0, relativeTime: 0)], atTime: CHHapticTimeImmediate) }
    }

    /// The continuous channels as of this frame.
    func apply(_ c: HapticContinuous) {
        guard level != .off else { return }
        let k: Float = level == .subtle ? 0.5 : 1
        let rumbleOn: Float = level == .subtle ? 0 : 1
        // Copies, not two inouts into `sent` at once (Swift's exclusivity rule).
        var r = sent.rumble, rs = sent.rumbleSharp, h = sent.hiss, hs = sent.hissSharp, g = sent.grind, gs: Float = 0.9
        send(rumble, c.rumble * k * rumbleOn, c.rumbleSharp, &r, &rs)
        send(hiss, c.hiss * k, c.hissSharp, &h, &hs)
        send(grind, c.grind * k, 0.9, &g, &gs)
        sent = HapticContinuous(rumble: r, rumbleSharp: rs, hiss: h, hissSharp: hs, grind: g)
    }
    private func send(_ p: CHHapticAdvancedPatternPlayer?, _ i: Float, _ s: Float, _ si: inout Float, _ ss: inout Float) {
        guard abs(i - si) >= 0.02 || abs(s - ss) >= 0.05 else { return }
        si = i; ss = s
        guard let p else { return }
        // Intensity control multiplies the pattern's 1.0; sharpness control adds to the pattern's base.
        try? p.sendParameters([CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: i, relativeTime: 0),
                               CHHapticDynamicParameter(parameterID: .hapticSharpnessControl, value: s - 0.5, relativeTime: 0)], atTime: CHHapticTimeImmediate)
    }

    /// A results moment (0249). Where Core Haptics can't play (no engine, the simulator), the system's own feedback.
    func moment(_ m: Moment) {
        if log { print("HAPTIC moment \(m)") }
        guard level != .off else { return }
        if let p = moments[m] { try? p.start(atTime: CHHapticTimeImmediate); return }
        UINotificationFeedbackGenerator().notificationOccurred(m == .wrecked ? .error : .success)
    }

    /// One transient.
    func play(_ e: HapticEvent) {
        if log { print(String(format: "HAPTIC t=%d %@ ch=%d i=%.2f s=%.2f", e.tick, "\(e.kind)", e.channel, e.intensity, e.sharpness)) }
        guard level != .off, !bank.isEmpty else { return }
        let i = e.intensity * (level == .subtle ? 0.5 : 1)
        let ii = HapticPlayer.iSteps.indices.min { abs(HapticPlayer.iSteps[$0] - i) < abs(HapticPlayer.iSteps[$1] - i) } ?? 0
        let si = HapticPlayer.sSteps.indices.min { abs(HapticPlayer.sSteps[$0] - e.sharpness) < abs(HapticPlayer.sSteps[$1] - e.sharpness) } ?? 0
        guard si < bank[ii].count else { return }
        try? bank[ii][si].start(atTime: CHHapticTimeImmediate)
    }
}
