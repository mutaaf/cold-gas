// The drive's safety nets (0229): whether the car's state is a number at all, how deep it sits in something solid, and
// the loose bodies' poses kept finite. Unscored: nothing here is called from `step` or a scored run (Run.swift ends a
// scored run on a non-finite state as "sim-fault", as the web's run.js does, and the vectors prove its bits).
#if canImport(CRapier)
import CRapier
import ColdGasCore

/// Every number the car's state carries is finite (position, rotation, velocities, angular momentum).
public func carFinite(_ c: Vehicle) -> Bool {
    (c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z + c.quat.x + c.quat.y + c.quat.z + c.quat.w
        + c.angVel.x + c.angVel.y + c.angVel.z + c.angMom.x + c.angMom.y + c.angMom.z).isFinite
}

private var sanPairs = [UInt64](repeating: 0, count: 32)
private var sanNormal = [Float](repeating: 0, count: 3)
private var sanContact = CgContact()
/// The deepest the car's hull sits inside anything this tick (m, ≤ 0; 0 when it touches nothing), from the engine's
/// contacts after the last step.
public func deepestPenetration(_ w: World) -> Double {
    guard !w.freed, w.carCol != CG_NONE else { return 0 }
    let n = min(sanPairs.count, cg_contact_pairs_with(w.rw, w.carCol, &sanPairs, sanPairs.count))
    var deepest = 0.0
    for j in 0..<n {
        let other = sanPairs[j]
        var flipped = false
        let mc = cg_contact_pair(w.rw, w.carCol, other, &flipped)
        if mc <= 0 { continue }
        for m in 0..<Int(mc) {
            let k = cg_manifold(w.rw, w.carCol, other, m, &sanNormal)
            if k <= 0 { continue }
            for c in 0..<Int(k) where cg_manifold_contact(w.rw, w.carCol, other, m, c, &sanContact) {
                let d = Double(sanContact.dist)
                if d.isFinite && d < deepest { deepest = d }
            }
        }
    }
    return deepest
}

/// A car wedged against something solid: nearly still with its hull touching (0229). On a scored course a set light, a
/// lamp post or the Wall's steel can stop the car dead on its wheels before the jump, and no end of the run (Run.swift)
/// is a wedge: the run would sit there until its 90 s timeout. The app watches for it on the frame clock (it never
/// touches the sim or the log) and starts the attempt again; Free Drive puts the car back on the road.
/// `warn` after `warnAfter` s (a cue), `act` after `actAfter` s; a car whose state isn't a number acts at once.
public struct WedgeWatch {
    public enum State: Equatable { case clear, warn, act }
    /// Slower than this (m/s) counts as still.
    public static let still = 0.5
    public let warnAfter: Double, actAfter: Double
    /// Going nowhere: within this far (m) of where the wedge began (a car pinned in a bank can jitter at 0.1–0.7 m/s
    /// without moving, so speed alone would miss it).
    public static let reach = 0.6
    public private(set) var held = 0.0
    private var ax = 0.0, az = 0.0
    public init(warnAfter: Double = 1.0, actAfter: Double = 2.0) { self.warnAfter = warnAfter; self.actAfter = actAfter }
    public mutating func reset() { held = 0 }
    /// One frame of `dt` seconds. `eligible`: the moment allows it (a scored run's drive phase, unpaused; Free Drive with
    /// a pedal pressed). It starts on a still car with its hull touching something, and holds while the car stays within
    /// `reach` of where it started (a contact that flickers tick to tick doesn't clear it); moving off clears it.
    public mutating func step(_ c: Vehicle, dt: Double, eligible: Bool) -> State {
        if !carFinite(c) { held = actAfter; return .act }
        guard eligible, dt.isFinite, dt > 0 else { held = 0; return .clear }
        let speed = (c.vel.x * c.vel.x + c.vel.y * c.vel.y + c.vel.z * c.vel.z).squareRoot()
        if held == 0 {
            guard c.hullContact && speed < WedgeWatch.still else { return .clear }
            ax = c.pos.x; az = c.pos.z
        } else {
            let dx = c.pos.x - ax, dz = c.pos.z - az
            if dx * dx + dz * dz > WedgeWatch.reach * WedgeWatch.reach || speed > 2 { held = 0; return .clear }
        }
        held += dt
        return held >= actAfter ? .act : held >= warnAfter ? .warn : .clear
    }
}
#endif
