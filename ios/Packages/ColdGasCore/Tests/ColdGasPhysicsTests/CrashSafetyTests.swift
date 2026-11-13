// 0229: "Turning left and crashing into a pole caused the game to break." The car driven hard into every pole-like thing
// there is (the scored sets' lights, the Lineup's lamp posts, the Wall's steel; Free Drive's bend signs, rails, fences,
// trunks and boulders; Roam's sets) at a range of speeds and angles: nothing becomes NaN or infinite, nothing stays sunk
// inside geometry, a scored run always ends, and a car wedged before the jump is seen by WedgeWatch (the app then starts
// the attempt again; the sim and its log are untouched, so the run vectors stay bit-exact).
import Testing
import Foundation
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld

@Suite("Crashes never break the game", .serialized)
struct CrashSafetyTests {
    /// A scored run on Assist, full throttle, the stick held at `steer` from `delay` ticks: its car each tick, until it ends.
    func hardTurn(_ course: String, steer: Double, delay: Int, each: (Run) -> Void = { _ in }) throws -> Run {
        let run = armAftermath(createRun(course))
        let inp = Input(); inp.assist = 1; inp.throttle = 1
        while run.phase != .done {
            inp.steer = run.tick > delay ? steer : 0
            try stepRun(run, inp)
            each(run)
        }
        return run
    }

    /// The repro: on the Show, full lock left from the start curls the car into the set light at (13, 25)… it stops dead
    /// on its wheels, and the sim's run has no end for that: it sits there until the 90 s timeout. WedgeWatch sees it
    /// within two seconds of the car stopping (the app's retry), and every state on the way is a number.
    @Test(arguments: [("show", -1.0, 0), ("show", 1.0, 0), ("wall", -1.0, 0), ("wall", -1.0, 120), ("lineup", -0.6, 360)])
    func aScoredRunWedgedOnAPoleIsSeenWithinTwoSeconds(_ course: String, _ steer: Double, _ delay: Int) throws {
        var watch = WedgeWatch()
        var warnAt = -1, actAt = -1, stillSince = -1
        let run = try hardTurn(course, steer: steer, delay: delay) { r in
            #expect(carFinite(r.car))
            if r.phase == .done { return }
            let c = r.car, v = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z)
            if v < WedgeWatch.still && c.hullContact { if stillSince < 0 { stillSince = r.tick } } else { stillSince = -1 }
            switch watch.step(c, dt: DT, eligible: r.phase == .drive) {
            case .warn: if warnAt < 0 { warnAt = r.tick }
            case .act: if actAt < 0 { actAt = r.tick }
            case .clear: break
            }
        }
        // The sim alone: the wedged car never ends its run before the timeout (this is what the player saw).
        #expect(run.t.endReason == "timeout")
        #expect(warnAt > 0 && actAt > warnAt)
        #expect(stillSince > 0 && actAt - stillSince <= Int(2.05 / DT))
        try aftermath(run)
        #expect(run.after?.done == true)
    }

    /// Every recorded run (the 52 vectors: references, crashes, naive players) flies without the watch ever acting: a run
    /// that's still going somewhere is never cut short.
    @Test func noRecordedRunIsTakenForAWedge() throws {
        let names = runNames()
        #expect(names.count >= 40)
        for name in names {
            let v = RunVector(name)
            var watch = WedgeWatch(), acted = -1
            try simulate(v.log, v.course) { r in if r.phase != .done && acted < 0 && watch.step(r.car, dt: DT, eligible: r.phase == .drive) == .act { acted = r.tick } }
            #expect(acted < 0, "\(name): taken for a wedge at tick \(acted)")
        }
    }

    /// Hard turns in every direction on every course: every run reaches a valid end, finite all the way, and its aftermath ends.
    @Test(arguments: ["show", "wall", "lineup"])
    func everyHardTurnEndsValidly(_ course: String) throws {
        for steer in [-1.0, -0.3, 0.3, 1.0] { for delay in [120, 360] {
            var finite = true
            let run = try hardTurn(course, steer: steer, delay: delay) { r in if !carFinite(r.car) { finite = false } }
            #expect(finite)
            #expect(["timeout", "runout", "settled", "stalled", "no-jump", "flipped", "contact"].contains(run.t.endReason))
            try aftermath(run)
            #expect(run.after?.done == true)
        } }
    }

    // MARK: - Free Drive and Roam

    func items(_ world: FreeWorld, _ kind: PropSolid.Kind, near x: Double, _ z: Double) -> PropSolid? {
        let C = PropSpec.cell
        for r in 0..<14 { for j in -r...r { for i in -r...r where max(abs(i), abs(j)) == r {
            let cell = world.props(Int((x / C).rounded(.down)) + i, Int((z / C).rounded(.down)) + j)
            if let s = cell.solids.first(where: { s in s.kind == kind && abs(world.ground(s.x + 8, s.z).y - s.y) < 1 && abs(world.ground(s.x - 8, s.z).y - s.y) < 1
                && abs(world.ground(s.x, s.z + 8).y - s.y) < 1 && abs(world.ground(s.x, s.z - 8).y - s.y) < 1 }) { return s }
        } } }
        return nil
    }
    /// The drive's car `back` metres from (tx, tz), aimed at it turned by `off` (and a little right of it when it'll steer
    /// left, so the turn carries it in), at `v` m/s, steering `steer`: finite every tick, never sunk ≥ 25 cm for a second.
    func ram(_ c: Vehicle, _ st: DriveStreamer, _ ground: (Double, Double) -> Double, at tx: Double, _ tz: Double, v: Double, off: Double, steer: Double, wait: Bool) throws -> (finite: Bool, sunk: Int) {
        let dm = DriveModel(), inp = Input()
        let a0 = off * .pi / 180, back = 14.0
        let px = tx - sin(a0) * back, pz = tz - cos(a0) * back
        c.pos.x = px; c.pos.y = ground(px, pz) + SPEC.comHeight + 0.05; c.pos.z = pz
        inp.brake = 1
        // the roadside's colliders are built off the main thread: wait for them, held still
        for _ in 0..<400 where wait && st.standingCount == 0 { try driveStep(c, inp, dm); usleep(5_000) }
        for _ in 0..<30 { try driveStep(c, inp, dm) }
        inp.brake = 0
        let aim = a0 + (steer < 0 ? 0.25 : 0)
        M3.quatFromYaw(c.quat, aim)
        c.vel.x = sin(aim) * v; c.vel.y = 0; c.vel.z = cos(aim) * v
        for x in [c.angVel, c.angMom] { x.x = 0; x.y = 0; x.z = 0 }
        var sunk = 0, worst = 0
        for t in 0..<(240 * 3) {
            inp.steer = t > 20 ? steer : 0; inp.throttle = 0.6
            try driveStep(c, inp, dm)
            st.breakCheck(c.world, car: c)
            readLoose(c.world)
            if !carFinite(c) || c.world.loose.contains(where: { !($0.x + $0.y + $0.z + $0.qx + $0.qy + $0.qz + $0.qw).isFinite }) { return (false, worst) }
            sunk = deepestPenetration(c.world) < -0.25 ? sunk + 1 : 0
            worst = max(worst, sunk)
        }
        return (true, worst)
    }

    @Test(arguments: [PropSolid.Kind.sign, .rail, .fence, .trunk, .boulder])
    func freeDriveIntoTheRoadsideAndTheTrees(_ kind: PropSolid.Kind) throws {
        let world = FreeWorld(seed: "cold gas")
        let s = try #require(items(world, kind, near: 3000, 3000))
        for v in [8.0, 25.0, 60.0] { for off in [-20.0, 20.0] { for steer in [-1.0, 0.0] {
            let st = DriveStreamer(world: world), c = createVehicle(course: DRIVE_COURSE)
            c.world.streamer = st
            defer { c.world.free() }
            let r = try ram(c, st, { world.ground($0, $1).y }, at: s.x, s.z, v: v, off: off, steer: steer, wait: s.breakable)
            #expect(r.finite, "\(kind) at \(v) m/s, \(off)°, steer \(steer)")
            #expect(r.sunk < 240, "\(kind) at \(v) m/s, \(off)°, steer \(steer): sunk for \(r.sunk) ticks")
        } } }
    }

    @Test(arguments: ["show", "wall", "lineup"])
    func roamIntoTheSetsPolesAndSteel(_ stage: String) throws {
        let world = FreeWorld(seed: "cold gas")
        var targets = fixturesOf(stage).map { ($0.x, $0.z) }
        if stage == "wall" { targets += [(-1.7, WALL.r1 + 0.85), (1.9, 8)] }
        for (tx, tz) in targets.prefix(4) { for v in [10.0, 40.0] { for off in [-25.0, 25.0] {
            let st = DriveStreamer(world: world), c = createVehicle(course: driveCourse(on: stage))
            c.world.streamer = st
            for l in looseSet(stage) { addLoose(c.world, l.kind, x: l.x, y: 0, z: l.z, yaw: l.yaw) }
            defer { c.world.free() }
            let r = try ram(c, st, { _, _ in 0 }, at: tx, tz, v: v, off: off, steer: -1, wait: false)
            #expect(r.finite)
            #expect(r.sunk < 240)
        } } }
    }

    // MARK: - The safety nets themselves

    @Test func aCarThatIsNotANumberIsWedgedAtOnceAndTheStreamerLeavesItBe() throws {
        let st = DriveStreamer(world: FreeWorld(seed: "nan")), c = createVehicle(course: DRIVE_COURSE)
        c.world.streamer = st
        defer { c.world.free() }
        var w = WedgeWatch()
        #expect(w.step(c, dt: 1.0 / 60, eligible: false) == .clear)
        c.vel.x = .nan
        #expect(w.step(c, dt: 1.0 / 60, eligible: false) == .act)
        // the streamer converts the car's position to a cell index: a NaN or a wild one must not trap
        c.world.carPos = V3(); c.world.carPos?.x = .nan
        st.tick(c.world)
        c.world.carPos?.x = 1e300
        st.tick(c.world)
    }

    @Test func theWatchClearsWhenTheCarMovesAndWaitsForItsMoment() throws {
        let c = createVehicle(course: DRIVE_COURSE)
        defer { c.world.free() }
        c.hullContact = true
        var w = WedgeWatch(warnAfter: 1, actAfter: 2)
        for _ in 0..<70 { _ = w.step(c, dt: 1.0 / 60, eligible: true) }
        #expect(w.step(c, dt: 1.0 / 60, eligible: true) == .warn)
        c.vel.z = 3   // backing out
        #expect(w.step(c, dt: 1.0 / 60, eligible: true) == .clear)
        c.vel.z = 0
        for _ in 0..<200 { #expect(w.step(c, dt: 1.0 / 60, eligible: false) == .clear) }   // in the air, paused, a pedal up
        for _ in 0..<124 { _ = w.step(c, dt: 1.0 / 60, eligible: true) }
        #expect(w.step(c, dt: 1.0 / 60, eligible: true) == .act)
    }
}
