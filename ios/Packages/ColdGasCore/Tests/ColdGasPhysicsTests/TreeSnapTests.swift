// 0334: a tree out in Free Drive's world stands until the car's blow passes what its trunk takes, then snaps at its foot and
// comes down as a free body (its trunk and crown, 640 kg) toppling away from the car, which keeps what went past the trunk's
// strength. Thin trunks go at a road speed, old ones only to a very fast car; a slow car is stopped by any of them.
import Testing
import Foundation
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasWorld

@Suite("Trees snap", .serialized)
struct TreeSnapTests {
    @Test func theSnapSpeedGrowsWithTheTrunk() {
        #expect(abs(DriveStreamer.snapSpeed(radius: 0.15) - 12.5) < 1e-9)
        #expect(DriveStreamer.snapSpeed(radius: 0.22) > 20 && DriveStreamer.snapSpeed(radius: 0.31) > 35)
        #expect(DriveStreamer.snapSpeed(radius: .nan) == .infinity && DriveStreamer.snapSpeed(radius: -1) == .infinity)
        let t = PropSolid(kind: .trunk, x: 0, y: 0, z: 0, r: 0.15, h: 5)
        #expect(DriveStreamer.strength(t) > 25_000 && DriveStreamer.strength(PropSolid.Kind.fence) == 6_000)
        #expect(DriveStreamer.looseKind(.trunk) == .log && LooseKind.log.mass == 640)
    }

    /// A trunk of radius in `r` near (x, z) with a clear, level run-in of `back` metres from the nearest road's side.
    func find(_ w: FreeWorld, r: ClosedRange<Double>, near x: Double, _ z: Double, back: Double) -> (PropSolid, Double, Double)? {
        let C = PropSpec.cell
        for rr in 0..<12 { for j in -rr...rr { for i in -rr...rr where max(abs(i), abs(j)) == rr {
            let cx = Int((x / C).rounded(.down)) + i, cz = Int((z / C).rounded(.down)) + j
            let cell = w.props(cx, cz)
            for s in cell.solids where s.kind == .trunk && r.contains(s.r) {
                guard let road = w.nearestRoad(s.x, s.z, maxD: 60) else { continue }
                var dx = s.x - road.x, dz = s.z - road.z
                let l = (dx * dx + dz * dz).squareRoot(); if l < 1 { continue }
                dx /= l; dz /= l
                let px = s.x - dx * back, pz = s.z - dz * back
                // Level, and nothing else solid within 2.5 m of the line in.
                if abs(w.ground(px, pz).y - s.y) > 0.8 { continue }
                var clear = true
                for b in -1...1 { for a in -1...1 { for o in w.props(cx + a, cz + b).solids where o.kind == .trunk || o.kind == .boulder {
                    if o.x == s.x && o.z == s.z { continue }
                    let t = ((o.x - px) * dx + (o.z - pz) * dz), ox = o.x - (px + dx * t), oz = o.z - (pz + dz * t)
                    if t > -3 && t < back + 3 && (ox * ox + oz * oz).squareRoot() < 2.5 + o.r { clear = false }
                } } }
                if clear { return (s, dx, dz) }
            }
        } } }
        return nil
    }
    func run(_ w: FreeWorld, _ s: PropSolid, _ dx: Double, _ dz: Double, back: Double, v: Double) throws -> (broke: Int, before: Double, after: Double, log: LooseBody?, finite: Bool) {
        let st = DriveStreamer(world: w), c = createVehicle(course: DRIVE_COURSE)
        defer { c.world.free() }
        c.world.streamer = st
        let px = s.x - dx * back, pz = s.z - dz * back
        c.pos.x = px; c.pos.y = w.ground(px, pz).y + SPEC.comHeight + 0.05; c.pos.z = pz
        M3.quatFromYaw(c.quat, DMath.datan2(dx, dz))
        let dm = DriveModel(), inp = Input()
        inp.brake = 1
        // The prop cells round the car are built off the main thread: wait until they've all come in (the count holds).
        var last = -1, still = 0
        for _ in 0..<600 where still < 40 { try driveStep(c, inp, dm); usleep(5_000); let n = st.standingCount; still = n == last && n > 0 ? still + 1 : 0; last = n }
        inp.brake = 0
        // Up to speed fast (as a test can: the car set going at v, on the line), then the pedal held to keep it.
        c.vel.x = dx * v; c.vel.z = dz * v
        var broke = 0, before = 0.0, after = 0.0, finite = true
        for _ in 0..<(240 * 4) {
            let sp = (c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot()
            inp.throttle = broke == 0 && sp < v ? 0.6 : 0
            try driveStep(c, inp, dm)
            readLoose(c.world)
            let n = st.breakCheck(c.world, car: c)
            if n > 0 && broke == 0 { before = sp; after = (c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot() }
            broke += n
            finite = finite && c.pos.x.isFinite && c.vel.x.isFinite
        }
        return (broke, before, after, c.world.loose.last { $0.kind == .log }, finite)
    }

    @Test func aThinTreeSnapsAtARoadSpeedAndFallsAway() throws {
        let w = FreeWorld(seed: "trees")
        let (s, dx, dz) = try #require(find(w, r: 0.15...0.17, near: 2600, 2600, back: 30))
        let r = try run(w, s, dx, dz, back: 30, v: 24)
        #expect(r.finite && r.broke >= 1)
        // The car loses what snapping it cost, and keeps going.
        #expect(r.after > 4 && r.after < r.before)
        let log = try #require(r.log)
        // Toppled: no longer standing, and on past where it stood (away from the car).
        let up = 1 - 2 * (log.qx * log.qx + log.qz * log.qz)
        #expect(up < 0.6)
        #expect((log.x - s.x) * dx + (log.z - s.z) * dz > 0.5)
    }

    @Test func aSlowCarIsStoppedByAnyTree() throws {
        let w = FreeWorld(seed: "trees")
        let (s, dx, dz) = try #require(find(w, r: 0.15...0.17, near: 2600, 2600, back: 20))
        let r = try run(w, s, dx, dz, back: 20, v: 7)
        #expect(r.finite && r.broke == 0 && r.log == nil)
    }
}
