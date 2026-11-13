// 0227: the roadside out in Free Drive's world breaks. Fences, bend signs and guard rails stand fixed beside the roads
// (ColdGasWorld's placement, pure), hold a nudge, and break loose as free bodies with their real masses when the car hits
// them harder than they hold; the car keeps what went past their strength. Scored courses have no streamer, so none.
import Testing
import Foundation
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld

@Suite("The roadside breaks", .serialized)
struct RoadsideTests {
    /// The unit vector from the item toward its road (across the road, its local ±x).
    func toRoad(_ world: FreeWorld, _ s: PropSolid) -> (Double, Double) {
        let nx = DMath.dcos(s.yaw), nz = -DMath.dsin(s.yaw)
        return world.ground(s.x + nx * 6, s.z + nz * 6).road < world.ground(s.x - nx * 6, s.z - nz * 6).road ? (nx, nz) : (-nx, -nz)
    }
    /// The first roadside item of `kind` near the roads round (x, z), and its cell.
    func find(_ world: FreeWorld, _ kind: PropSolid.Kind, near x: Double, _ z: Double) -> PropSolid? {
        let C = PropSpec.cell
        for r in 0..<14 { for j in -r...r { for i in -r...r where max(abs(i), abs(j)) == r {
            let cell = world.props(Int((x / C).rounded(.down)) + i, Int((z / C).rounded(.down)) + j)
            // A level spot (a car on a slope drives into it at an angle).
            if let s = cell.solids.first(where: { s in
                guard s.kind == kind else { return false }
                let (rx, rz) = toRoad(world, s)
                return abs(world.ground(s.x + rx * 10, s.z + rz * 10).y - s.y) < 0.6
            }) { return s }
        } } }
        return nil
    }
    /// A car `back` metres off the item toward its road, facing it, on a drive course with its streamer.
    func car(_ world: FreeWorld, facing s: PropSolid, back: Double) -> (Vehicle, DriveStreamer, DriveModel) {
        let st = DriveStreamer(world: world), c = createVehicle(course: DRIVE_COURSE)
        c.world.streamer = st
        // From the road's side, across it (the way a car leaving the road meets it).
        let (rx, rz) = toRoad(world, s), nx = -rx, nz = -rz
        let px = s.x - nx * back, pz = s.z - nz * back
        c.pos.x = px; c.pos.y = world.ground(px, pz).y + SPEC.comHeight + 0.05; c.pos.z = pz
        M3.quatFromYaw(c.quat, DMath.datan2(nx, nz))
        return (c, st, DriveModel())
    }
    func speed(_ c: Vehicle) -> Double { (c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot() }
    /// Drive at it, holding `v` m/s, for `secs`; the speed just before and after it's met.
    func ram(_ c: Vehicle, _ st: DriveStreamer, _ dm: DriveModel, at v: Double, secs: Double) throws -> (before: Double, after: Double, broke: Int) {
        let inp = Input()
        // The roadside's colliders are built off the main thread (as the world near the car is): wait for them, held still.
        inp.brake = 1
        for _ in 0..<400 where st.standingCount == 0 { try driveStep(c, inp, dm); usleep(10_000) }
        inp.brake = 0
        var broke = 0, before = 0.0, after = 0.0
        for t in 0..<Int(secs * 240) {
            let sp = speed(c)
            inp.throttle = sp < v ? 0.9 : 0; inp.brake = sp > v + 1 ? 0.3 : 0
            if broke > 0 || t > Int(secs * 240) - 240 { inp.throttle = 0; inp.brake = 0 }
            try driveStep(c, inp, dm)
            let n = st.breakCheck(c.world, car: c)
            if n > 0 && broke == 0 { before = sp; after = speed(c) }
            broke += n
        }
        return (before, after, broke)
    }

    @Test func theRoadsideIsPlacedTheSameEveryTimeAndOffTheRoad() throws {
        let a = FreeWorld(seed: "roadside"), b = FreeWorld(seed: "roadside")
        var seen = [PropSolid.Kind: Int]()
        for j in 20..<40 { for i in 20..<40 {
            let x = a.props(i, j), y = b.props(i, j)
            #expect(x.solids.count == y.solids.count)
            for (s, t) in zip(x.solids, y.solids) where s.breakable {
                #expect(s.x == t.x && s.z == t.z && s.yaw == t.yaw)
                seen[s.kind, default: 0] += 1
                // never on the road or its shoulder
                #expect(a.ground(s.x, s.z).road > RoadSpec.hw + RoadSpec.shoulder - 0.01)
            }
            // each breakable solid has its instance, pointing back at it
            #expect(x.instances.filter { $0.item >= 0 }.count == x.solids.filter { $0.breakable }.count)
        } }
        #expect((seen[.fence] ?? 0) > 0 && (seen[.rail] ?? 0) > 0 && (seen[.sign] ?? 0) > 0)
    }

    @Test func aFenceBreaksLooseAndTheCarKeepsMostOfItsSpeed() throws {
        let world = FreeWorld(seed: "roadside")
        let s = try #require(find(world, .fence, near: 3000, 3000))
        let (c, st, dm) = car(world, facing: s, back: 30)
        defer { c.world.free() }
        let r = try ram(c, st, dm, at: 16, secs: 7)
        #expect(r.broke >= 1)
        #expect(st.brokenCount >= 1)
        // a 45 kg bay costs the 2.4 t car a few m/s at most
        #expect(r.after > r.before - 4)
        // and the bay is a free body now, gone on ahead
        let bay = try #require(c.world.loose.last { $0.kind == .fence })
        #expect(DMath.dhypot(bay.x - s.x, 0, bay.z - s.z) > 1)
    }

    @Test func aGuardRailHoldsANudgeAndGivesWayToAHardHit() throws {
        let world = FreeWorld(seed: "roadside")
        let s = try #require(find(world, .rail, near: 3000, 3000))
        do {
            let (c, st, dm) = car(world, facing: s, back: 6)
            defer { c.world.free() }
            let r = try ram(c, st, dm, at: 1.5, secs: 6)
            #expect(r.broke == 0)
            #expect(st.brokenCount == 0)
        }
        do {
            let (c, st, dm) = car(world, facing: s, back: 50)
            defer { c.world.free() }
            let r = try ram(c, st, dm, at: 22, secs: 7)
            #expect(r.broke >= 1)
        }
    }

    @Test func theScoredCoursesHaveNoRoadside() {
        for id in ["show", "wall", "lineup"] {
            let c = createVehicle(id)
            #expect(c.world.streamer == nil)
            #expect(!c.world.loose.contains { $0.kind == .fence || $0.kind == .rail || $0.kind == .signpost })
            c.world.free()
        }
    }
}
