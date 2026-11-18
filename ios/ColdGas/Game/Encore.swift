// The encore (0271): when a run is over, its moment plays once more before the card, from the track it recorded (the sim is
// done and is never touched): the touchdown of a landing, or the first big hit of a wreck. A long lens low beside it
// (Director.encore), the clock easing down to a quarter through the moment and back (the presentation's clock only: the
// track is already flown), the sparks, dust, dents and parts as the run threw them (Crash replays its events, seeded), and the
// hands and the ears in step with it: each impact's haptic and sound again as the replay reaches it. About three seconds; a
// tap skips it. Reduce Motion and drills skip it altogether.
import simd
import ColdGasCore

struct Encore {
    /// Track time (s): where it starts, the moment, where it ends.
    let from, moment, to: Double
    /// Where the moment happens and how the car was going into it (the camera's placement).
    let at: SIMD3<Float>, vel: SIMD3<Float>
    let landing: Bool
    /// The real seconds it lasts at `rate`.
    let seconds: Double

    static let slow = 0.25
    /// The clock's rate at track time t: full speed into it, down to `slow` just before the moment, held through it, then back.
    func rate(_ t: Double) -> Double {
        let s = t - moment
        func ease(_ a: Double, _ b: Double, _ x: Double) -> Double { let k = max(0, min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k) }
        if s < 0 { return 1 + (Encore.slow - 1) * ease(-0.42, -0.06, s) }
        return Encore.slow + (1 - Encore.slow) * ease(0.3, 0.72, s)
    }

    /// The moment in a finished track, if it has one worth seeing again: the first hit over 6.5 m/s (the one the crash cut
    /// cuts to), else the hardest hit over 3, else the first scrape over 5 (a roof taken across the row), else the touchdown.
    static func plan(_ tr: Replay) -> Encore? {
        guard tr.ticks > 120 else { return nil }
        var pick: Replay.Impact?, landing = false
        let base = tr.tickBase
        pick = tr.impacts.first { $0.kind == ImpactKind.HIT && $0.speed > 6.5 }
        if pick == nil { pick = tr.impacts.filter { $0.kind == ImpactKind.HIT && $0.speed > 3 }.max { $0.speed < $1.speed } }
        if pick == nil { pick = tr.impacts.first { $0.kind == ImpactKind.SCRAPE && $0.speed > 5 } }
        var tick: Int, at: SIMD3<Float>
        if let p = pick { tick = p.tick - base; at = p.pos }
        else if tr.touchTick >= 0 { tick = tr.touchTick - base; at = tr.car(at: Double(tick) / Replay.hz).pos; landing = true }
        else { return nil }
        guard tick > 0 && tick < tr.ticks else { return nil }
        let m = Double(tick) / Replay.hz, end = Double(tr.ticks - 1) / Replay.hz
        let from = max(0, m - 0.75), to = min(end, m + 1.05)
        guard to - from > 0.6 else { return nil }
        let vel = tr.velocity(at: max(0, tick - 24))
        var e = Encore(from: from, moment: m, to: to, at: at, vel: vel, landing: landing, seconds: 0)
        var t = from, real = 0.0
        while t < to { let k = e.rate(t); t += k / 120; real += 1.0 / 120 }
        e = Encore(from: from, moment: m, to: to, at: at, vel: vel, landing: landing, seconds: real)
        return e
    }
}
