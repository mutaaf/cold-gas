// 0271/0272: the sets' dressing at its real masses, and Roam's challenges. The dressing stands still where it's put (a stack
// of tyres doesn't creep or jitter), the drive's car shoves a stack over and is barely slowed by a tyre, and the generator
// barely notices it; the challenges fire on the moment they describe and nowhere else.
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld
import CRapier

@Suite("The sets' dressing and Roam's challenges", .serialized)
struct SetDressingTests {
    func up(_ b: LooseBody) -> Double { 1 - 2 * (b.qx * b.qx + b.qz * b.qz) }

    @Test func theDressingStandsWhereItIsPutAndStaysStill() throws {
        for stage in ["show", "wall", "lineup"] {
            let c = createVehicle(course: driveCourse(on: stage))
            defer { c.world.free() }
            c.world.streamer = DriveStreamer(world: FreeWorld(seed: "dress"))
            let spots = dressingSet(stage)
            #expect(spots.count >= 20)
            let first = c.world.loose.count
            for s in spots { addLoose(c.world, s.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw) }
            // The car parked far off; three seconds of the world.
            c.pos.x = 300; c.pos.z = -300; c.pos.y = SPEC.comHeight + 0.02
            let inp = Input(), dm = DriveModel()
            for _ in 0..<720 { try driveStep(c, inp, dm); readLoose(c.world) }
            for (i, s) in spots.enumerated() {
                let b = c.world.loose[first + i]
                let drift = ((b.x - s.x) * (b.x - s.x) + (b.z - s.z) * (b.z - s.z)).squareRoot()
                #expect(drift < 0.05, "\(stage) \(s.kind) drifted \(drift) m")
                #expect(abs(b.y - (s.y + s.kind.half.1)) < 0.05, "\(stage) \(s.kind) sank or rose to \(b.y)")
                #expect(up(b) > 0.99)
                #expect(b.speed < 0.05)
            }
        }
    }

    @Test func aRoamOpensWithEveryTyreStanding() throws {
        // As FreeDrive builds a roam: the set's loose things then its dressing, the car on the mark, five seconds idle.
        for stage in ["show", "lineup"] {
            let course = driveCourse(on: stage)
            let c = createVehicle(course: course)
            defer { c.world.free() }
            c.world.streamer = DriveStreamer(world: FreeWorld(seed: "cold gas"))
            let spots = looseSet(stage) + dressingSet(stage)
            #expect(c.world.loose.isEmpty)
            for s in spots { addLoose(c.world, s.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw) }
            let mark = COURSES[stage]!
            c.pos.x = mark.startX; c.pos.z = mark.startZ; c.pos.y = SPEC.comHeight + 0.04
            let inp = Input(), dm = DriveModel()
            // Everything awake (as a roam's world wakes them: a cell built, a knock nearby): the stacks must still stand.
            for b in c.world.loose { cg_body_set_linvel(c.world.rw, b.rb, 0, 0, 0, true) }
            for _ in 0..<(240 * 30) { try driveStep(c, inp, dm); readLoose(c.world) }
            var down = 0
            for (i, s) in spots.enumerated() where s.kind == .tyre {
                let b = c.world.loose[i]
                let moved = ((b.x - s.x) * (b.x - s.x) + (b.z - s.z) * (b.z - s.z)).squareRoot()
                if b.y < s.y + b.kind.half.1 - 0.08 || moved > 1.0 || up(b) < 0.7 { down += 1; print("DOWN \(stage) \(i) y \(b.y) want \(s.y + b.kind.half.1) moved \(moved) up \(up(b))") }
            }
            #expect(down == 0, "\(stage): \(down) tyres down at the start")
        }
    }

    @Test func dressingStaysClearOfEveryScoredLine() {
        // Pixels only in a scored run, so nothing of it may stand where a run goes: off the run line, the row, the pad's rings.
        for stage in ["show", "wall", "lineup"] {
            let course = COURSES[stage]!
            for s in dressingSet(stage) {
                let r = max(s.kind.half.0, s.kind.half.2)
                #expect(abs(s.x) - r > 6, "\(stage) \(s.kind) at x \(s.x) is on the run's line")
                if let p = course.pad { #expect(((s.x - p.x) * (s.x - p.x) + (s.z - p.z) * (s.z - p.z)).squareRoot() > 8) }
            }
        }
    }

    @Test func theCarShovesAStackOverAndATyreBarelySlowsIt() throws {
        // Out on the slab, clear of the set: a stack of four tyres, the car at 10 m/s straight into it.
        let X0 = -900.0, Z0 = -1300.0
        let c = createVehicle(course: DRIVE_COURSE)
        defer { c.world.free() }
        c.world.streamer = DriveStreamer(world: FreeWorld(seed: "tyres"))
        c.pos.x = X0; c.pos.y = SPEC.comHeight + 0.02; c.pos.z = Z0
        M3.quatFromYaw(c.quat, 0)
        let T = 2 * LooseKind.tyre.half.1 + 0.002
        let stack = (0..<4).map { addLoose(c.world, .tyre, x: X0, y: Double($0) * T, z: Z0 + 12, yaw: 0) }
        let dm = DriveModel(), inp = Input()
        for _ in 0..<120 { c.vel.x = 0; c.vel.z = 0; try driveStep(c, inp, dm); readLoose(c.world) }
        c.vel.z = 10; for i in 0..<4 { c.wheels[i].omega = 10 / RW[i] }
        for _ in 0..<480 { try driveStep(c, inp, dm); readLoose(c.world) }
        let down = stack.filter { $0.y < 3 * T || up($0) < 0.7 }.count
        #expect(down >= 2, "the stack stood")
        // 38 kg of tyres against a 2-tonne car: it keeps most of its speed (the driver lifted, so rolling and drag take some).
        #expect(c.vel.z > 7, "the car lost too much: \(c.vel.z)")
    }

    @Test func theGeneratorIsHeavy() {
        #expect(LooseKind.generator.mass > 1000 && LooseKind.kRail.mass > 500 && LooseKind.tyre.mass < 12 && LooseKind.drum.mass < 25)
    }

    // MARK: - The challenges

    @Test func landingOnTheMarkCountsOnlyAfterAFlight() {
        let ch = SetChallenges(stage: "show")
        let pad = SHOW.pad!
        // Rolling over the pad is not landing on it.
        #expect(ch.update(dt: 0.1, x: pad.x, y: 0.5, z: pad.z, speed: 3, airborne: false, tyresDown: 0, conesMoved: false).isEmpty)
        // A flight, then down 1.2 m from its centre.
        for _ in 0..<8 { _ = ch.update(dt: 0.1, x: 0, y: 5, z: pad.z + 10, speed: 12, airborne: true, tyresDown: 0, conesMoved: false) }
        let e = ch.update(dt: 0.1, x: 1.2, y: 0.5, z: pad.z, speed: 8, airborne: false, tyresDown: 0, conesMoved: false)
        #expect(e == [SetChallengeEvent(kind: .mark, first: true, value: 1.2)])
        #expect(ch.states[.mark]?.done == true)
        // A worse landing isn't news; a better one is.
        for _ in 0..<8 { _ = ch.update(dt: 0.1, x: 0, y: 5, z: pad.z + 10, speed: 12, airborne: true, tyresDown: 0, conesMoved: false) }
        #expect(ch.update(dt: 0.1, x: 1.8, y: 0.5, z: pad.z, speed: 8, airborne: false, tyresDown: 0, conesMoved: false).isEmpty)
        for _ in 0..<8 { _ = ch.update(dt: 0.1, x: 0, y: 5, z: pad.z + 10, speed: 12, airborne: true, tyresDown: 0, conesMoved: false) }
        #expect(ch.update(dt: 0.1, x: 0.4, y: 0.5, z: pad.z, speed: 8, airborne: false, tyresDown: 0, conesMoved: false).first?.first == false)
    }

    @Test func theRowIsFlownEndToEndOrNotAtAll() {
        let ch = SetChallenges(stage: "lineup")
        let z0 = LINEUP_BOXES.first!.minZ, z1 = LINEUP_BOXES.last!.maxZ
        // A flight that comes down in the middle of the row doesn't count.
        var z = z0 - 3
        while z < (z0 + z1) / 2 { _ = ch.update(dt: 1 / 60.0, x: 0, y: 6, z: z, speed: 20, airborne: true, tyresDown: 0, conesMoved: false); z += 0.3 }
        #expect(ch.update(dt: 1 / 60.0, x: 0, y: 2, z: z, speed: 20, airborne: false, tyresDown: 0, conesMoved: false).isEmpty)
        // End to end, over it.
        z = z0 - 3
        while z < z1 + 3 { _ = ch.update(dt: 1 / 60.0, x: 0, y: 7, z: z, speed: 20, airborne: true, tyresDown: 0, conesMoved: false); z += 0.3 }
        let e = ch.update(dt: 1 / 60.0, x: 0, y: 0.5, z: z, speed: 20, airborne: false, tyresDown: 0, conesMoved: false)
        #expect(e.first?.kind == .row)
        // Beside the row is not over it.
        let side = SetChallenges(stage: "lineup")
        z = z0 - 3
        while z < z1 + 3 { _ = side.update(dt: 1 / 60.0, x: 12, y: 7, z: z, speed: 20, airborne: true, tyresDown: 0, conesMoved: false); z += 0.3 }
        #expect(side.update(dt: 1 / 60.0, x: 12, y: 0.5, z: z, speed: 20, airborne: false, tyresDown: 0, conesMoved: false).isEmpty)
    }

    @Test func theLipIsLeftFromTheDeckHigh() {
        let ch = SetChallenges(stage: "wall")
        #expect(ch.kinds == [.lip, .mark, .tyres])
        // Jumping off the floor near the curl is not the lip.
        _ = ch.update(dt: 0.01, x: 0, y: 0.6, z: 2, speed: 10, airborne: false, tyresDown: 0, conesMoved: false)
        #expect(ch.update(dt: 0.01, x: 0, y: 0.9, z: 2, speed: 10, airborne: true, tyresDown: 0, conesMoved: false).isEmpty)
        _ = ch.update(dt: 0.01, x: 0, y: 0.6, z: 2, speed: 10, airborne: false, tyresDown: 0, conesMoved: false)
        // On the deck up by the lip, then off it.
        _ = ch.update(dt: 0.01, x: 0, y: WALL.lipY, z: WALL.lipZ, speed: 9, airborne: false, tyresDown: 0, conesMoved: false)
        let e = ch.update(dt: 0.01, x: 0, y: WALL.lipY + 0.2, z: WALL.lipZ - 0.1, speed: 9, airborne: true, tyresDown: 0, conesMoved: false)
        #expect(e == [SetChallengeEvent(kind: .lip, first: true, value: 9)])
    }

    @Test func tyresAndTheLane() {
        let ch = SetChallenges(stage: "lineup")
        #expect(ch.update(dt: 0.1, x: 30, y: 0.5, z: 0, speed: 0, airborne: false, tyresDown: 5, conesMoved: false).isEmpty)
        #expect(ch.update(dt: 0.1, x: 30, y: 0.5, z: 0, speed: 0, airborne: false, tyresDown: 6, conesMoved: false).first?.kind == .tyres)
        // The lane: in at −70, along it, out past −4 fast and clean.
        func run(_ ch: SetChallenges, touch: Bool, exit v: Double) -> [SetChallengeEvent] {
            var out: [SetChallengeEvent] = []
            var z = -70.0
            while z < 0 { out += ch.update(dt: 1 / 60.0, x: 0.4, y: 0.5, z: z, speed: v, airborne: false, tyresDown: 0, conesMoved: touch && z > -30 && z < -29); z += 0.25 }
            return out.filter { $0.kind == .lane }
        }
        #expect(run(SetChallenges(stage: "lineup"), touch: true, exit: 16).isEmpty)
        #expect(run(SetChallenges(stage: "lineup"), touch: false, exit: 10).isEmpty)
        #expect(run(SetChallenges(stage: "lineup"), touch: false, exit: 16).count == 1)
    }

    @Test func doneStaysDoneAcrossARoam() {
        let saved: [SetChallengeKind: SetChallengeState] = [.mark: SetChallengeState(done: true, best: 0.8)]
        let ch = SetChallenges(stage: "show", saved: saved)
        #expect(ch.doneCount == 1 && ch.states[.mark]?.best == 0.8)
    }
}
