// 0215: Free Drive's car on the streamed world (docs/NATIVE-FREEDRIVE.md §5): it rests on its wheels 30 km out, drives
// a road without falling through, and the engine's origin moves under it without a jump. The scored courses never
// stream (their vectors are RunVectorTests').
import Testing
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld

@Suite("Free Drive on the streamed world", .serialized)
struct FreeDriveTests {
    /// A car on DRIVE_COURSE with its streamer, on the road nearest (x, z), at rest.
    func car(_ world: FreeWorld, near x: Double, _ z: Double) throws -> (Vehicle, DriveStreamer, RoadWalker) {
        let s = DriveStreamer(world: world)
        let c = createVehicle(course: DRIVE_COURSE)
        c.world.streamer = s
        let w = try #require(RoadWalker(world: world, nearX: x, z: z, headingX: 0, z: 1))
        let p = w.pose(lane: 1.8)
        c.pos.x = p.x; c.pos.y = p.y + SPEC.comHeight + 0.04; c.pos.z = p.z
        M3.quatFromYaw(c.quat, DMath.datan2(p.hx, p.hz))
        return (c, s, w)
    }

    @Test func itRestsOnItsWheelsThirtyKilometresOut() throws {
        let world = FreeWorld(seed: "rest")
        let (c, s, w) = try car(world, near: 30_000, -12_000)
        defer { c.world.free() }
        let road = w.pose(lane: 1.8)
        let inp = Input()
        for _ in 0..<480 { try step(c, inp) }
        #expect(c.grounded == 4)
        #expect(abs(c.vel.y) < 0.05)
        #expect(abs(c.pos.y - SPEC.comHeight - road.y) < 0.35)
        // The engine works near zero, not 30 km out.
        #expect(abs(c.world.ox - c.pos.x) < DriveStreamer.rebase + DriveStreamer.cell && c.world.ox != 0)
        #expect(s.rebases >= 1)
    }

    @Test func itDrivesTheRoadAndTheOriginMovesUnderItWithoutAJump() throws {
        let world = FreeWorld(seed: "drive")
        let (c, s, w) = try car(world, near: 6_000, 9_000)
        defer { c.world.free() }
        let inp = Input()
        var last = (c.pos.x, c.pos.y, c.pos.z), maxStep = 0.0, airborne = 0, rebases0 = -1
        // A simple driver: hold ~20 m/s, steer for a point 15 m on along the lane.
        for t in 0..<(240 * 30) {
            let f = (2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y), 1 - 2 * (c.quat.x * c.quat.x + c.quat.y * c.quat.y))
            for _ in 0..<4 {
                let p = w.pose(lane: 1.8), along = (c.pos.x - p.x) * p.hx + (c.pos.z - p.z) * p.hz
                if along > 0.5 { w.advance(min(along, 20)) } else { break }
            }
            let probe = w.copy(); probe.advance(15)
            let a = probe.pose(lane: 1.8), tx = a.x - c.pos.x, tz = a.z - c.pos.z
            let right = f.0 * tz - f.1 * tx, ahead = f.0 * tx + f.1 * tz
            let v = DMath.dhypot(c.vel.x, 0, c.vel.z)
            inp.steer = jsMax(-1, jsMin(1, DMath.datan2(right, ahead) * 2.2))
            inp.throttle = v < 20 ? 0.6 : 0; inp.brake = v > 23 ? 0.3 : 0
            if t == 240 { rebases0 = s.rebases }
            try step(c, inp)
            let d = DMath.dhypot(c.pos.x - last.0, c.pos.y - last.1, c.pos.z - last.2)
            maxStep = jsMax(maxStep, d)
            last = (c.pos.x, c.pos.y, c.pos.z)
            if c.grounded == 0 { airborne += 1 }
        }
        let p = w.pose(lane: 1.8)
        let off = DMath.dhypot(c.pos.x - p.x, 0, c.pos.z - p.z)
        #expect(w.travelled > 400)            // it went somewhere
        #expect(off < 4)                      // and it's still on the road
        #expect(airborne < 240)               // with its wheels down (a crest or two aside)
        #expect(maxStep < 30.0 / 240 + 0.02)  // no tick moved it more than its speed allows: no jump at a rebase
        #expect(s.rebases > rebases0)         // and the origin did move under it
    }

    @Test func theScoredCoursesNeverStream() {
        for id in ["show", "wall", "lineup"] {
            let c = createVehicle(id)
            #expect(c.world.streamer == nil)
            #expect(c.world.ox == 0 && c.world.oz == 0)
            c.world.free()
        }
        #expect(COURSES["drive"] == nil)
    }
}
