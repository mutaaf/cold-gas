// 0221: Free Drive's loose things: real masses, standing at rest, sent flying by the car, and never on a scored course.
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld

@Suite("Free Drive's loose things", .serialized)
struct LooseTests {
    @Test func theScoredCoursesHaveNone() {
        for id in ["show", "wall", "lineup"] {
            let c = createVehicle(id)
            #expect(c.world.loose.isEmpty && c.world.rayFilter == RAY_ALL)
            c.world.free()
        }
    }

    @Test func eachSetHasItsThingsAndTheyStandAtRest() throws {
        for stage in ["show", "wall", "lineup"] {
            let spots = looseSet(stage)
            #expect(spots.count >= 20)
            let c = createVehicle(course: driveCourse(on: stage))
            defer { c.world.free() }
            c.world.streamer = DriveStreamer(world: FreeWorld(seed: "loose"))
            for s in spots { addLoose(c.world, s.kind, x: s.x, y: 0, z: s.z, yaw: s.yaw) }
            // Nothing stands inside a parked car or on the car's mark.
            for s in spots { for b in c.world.bodies { #expect(!(abs(s.x - b.cx) < b.hx + 0.3 && abs(s.z - b.cz) < b.hz + 0.3)) } }
            c.pos.x = 300; c.pos.z = 300   // out of the way
            let inp = Input()
            for _ in 0..<480 { try step(c, inp); readLoose(c.world) }
            for (b, s) in zip(c.world.loose, spots) {
                #expect(abs(b.x - s.x) < 0.05 && abs(b.z - s.z) < 0.05)
                #expect(abs(b.y - b.kind.half.1) < 0.05)        // on the floor
                #expect(1 - 2 * (b.qx * b.qx + b.qz * b.qz) > 0.99)  // upright
            }
        }
    }

    @Test func aCarAtFifteenMetresASecondSendsAConeFlyingAndBarelySlows() throws {
        let c = createVehicle(course: DRIVE_COURSE)
        defer { c.world.free() }
        c.world.streamer = DriveStreamer(world: FreeWorld(seed: "loose"))
        let cone = addLoose(c.world, .cone, x: 0, y: 0, z: -80, yaw: 0)
        #expect(LooseKind.cone.mass == 4.2)
        c.pos.x = 0; c.pos.y = SPEC.comHeight + 0.04; c.pos.z = -60
        M3.quatFromYaw(c.quat, DMath.PI)
        c.vel.z = -15
        let inp = Input()
        inp.throttle = 0.25
        var peak = 0.0
        for _ in 0..<(240 * 2) { try step(c, inp); readLoose(c.world); peak = max(peak, cone.speed) }
        #expect(peak > 12)                   // a 4.2 kg cone struck by ≈ 1.9 t leaves faster than the car
        #expect(abs(cone.z + 80) > 5)        // and it went
        #expect(-c.vel.z > 12)               // the car hardly noticed
    }
}
