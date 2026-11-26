// 0340: the scored sets' water and mud. The physics is held to the JS's bits by the surface run vectors
// (runs/splash-*, mud-*, ref-show-dry-wet); this is the identity around it: which runs are which version, which set
// they fly on, and which challenge links still replay.
#if canImport(CRapier)
import Foundation
import Testing
@testable import ColdGasPhysics
@testable import ColdGasCore
import ColdGasClient

@Suite("The sets' water and mud")
struct SurfaceTests {
    @Test func onlyTheShowAndTheLineupCarryThem() {
        #expect(SHOW.surfaces != nil && LINEUP.surfaces != nil && WALL_COURSE.surfaces == nil)
        #expect(simVersionOf("show") == MARK_VERSION && simVersionOf("lineup") == RUNUP_VERSION && simVersionOf("wall") == MARK_VERSION)
        #expect(courseAt("show", SIM_VERSION).surfaces == nil && courseAt("show").surfaces != nil)
        #expect(replayable("lineup", 32) && replayable("lineup", 33) && replayable("show", MARK_VERSION))
        // 0360: an older Show or Wall card reads the old mark curve, so those runs are stale.
        #expect(!replayable("show", 31) && !replayable("show", 32) && !replayable("show", 33) && !replayable("wall", 32) && !replayable("wall", 33))
    }
    @Test func aRunFromBeforeFliesTheDrySet() {
        let old = createRun("show", simVersion: SIM_VERSION), now = createRun("show")
        defer { old.car.world.free(); now.car.world.free() }
        #expect(old.t.splash == nil && now.t.splash == false)
        #expect(old.car.course.surfaces == nil && now.car.course.surfaces != nil)
    }
    @Test func theQueriesAreTheJs() {
        let s = SHOW_SURFACES, k = s.tanks[0], m = s.mud[0]
        #expect(waterLevel(s, (k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2) == k.level)
        #expect(waterLevel(s, 0, (k.z0 + k.z1) / 2) == NO_WATER)   // off the line the car flies and rolls out along
        #expect(waterLevel(s, 0, SHOW.pad!.z) == NO_WATER)
        #expect(mudSink(s, m.x, m.z) == m.sink)
        #expect(mudSink(s, m.x + m.rx * 1.01, m.z) == -1)
    }
    @Test func aChallengeFromBeforeStillReplaysOnAWetSet() throws {
        let log = [[0] + [Int](repeating: 0, count: 23)]
        func route(_ course: String, _ v: Int) throws -> ChallengeLink.Route {
            let p = try Challenge.encode(log: log, course: course, score: 50, simVersion: v, compress: false)
            return ChallengeLink.route(URL(string: "https://mutaafaziz.com/coldgas/?play=jump&course=\(course)#vs=\(p)")!, replayable: replayable)
        }
        if case .challenge = try route("lineup", 32) {} else { Issue.record("a v32 Lineup challenge should still replay") }
        if case .challenge = try route("lineup", 33) {} else { Issue.record("a v33 Lineup challenge should replay") }
        if case .challenge = try route("show", MARK_VERSION) {} else { Issue.record("a v34 Show challenge should replay") }
        #expect(try route("show", 33) == .stale(course: "show"))
        #expect(try route("wall", 33) == .stale(course: "wall"))
    }
}
#endif
