// 0149: HapticScore against the JS sim's own flights (Tests/Vectors/haptics/*.json, `npm run vectors`).
import Foundation
import Testing
@testable import ColdGasCore

func feed(_ name: String) -> (course: String, ticks: [HapticFeed]) {
    HapticFeed.load(try! Data(contentsOf: vectorURL("haptics/\(name).json")))!
}
func score(_ name: String) -> (events: [HapticEvent], cont: [HapticContinuous], ticks: [HapticFeed]) {
    let f = feed(name)
    var s = HapticScore(course: f.course), ev: [HapticEvent] = [], cont: [HapticContinuous] = []
    for t in f.ticks { s.step(t); s.drain { ev.append($0) }; cont.append(s.continuous) }
    return (ev, cont, f.ticks)
}

@Suite("HapticScore feels the reference flights")
struct HapticScoreTests {
    @Test func theShowReleasesOnceAndLandsOnFourWheelsTogether() {
        let (ev, _, ticks) = score("ref-show")
        #expect(ev.filter { $0.kind == .release }.count == 1)
        let wheels = ev.filter { $0.kind == .wheel }
        #expect(wheels.count == 4)
        #expect(Set(wheels.map(\.channel)) == [0, 1, 2, 3])
        let span = (wheels.map(\.tick).max() ?? 0) - (wheels.map(\.tick).min() ?? 0)
        #expect(span <= 72, "a synced landing: four wheel transients within 0.3 s (got \(span) ticks)")
        // The release is where the run leaves the deck, before the touchdown.
        let rel = ev.first { $0.kind == .release }!.tick
        #expect(rel < wheels.map(\.tick).min()!)
        #expect(ticks[Int(rel)].phase >= 1)
        #expect(ev.filter { $0.kind == .settle }.count == 1, "stuck it: once, when the clean landing decides the run")
        #expect(!ev.contains { $0.kind == .hit || $0.kind == .crush }, "the reference Show hits nothing")
    }
    @Test func theJetsHissAndSoftenAsTheTanksBlowDown() {
        let (_, cont, ticks) = score("ref-show")
        let firing = cont.indices.filter { cont[$0].hiss > 0.05 }
        #expect(!firing.isEmpty)
        let early = cont[firing.first!].hissSharp, late = cont[firing.last!].hissSharp
        #expect(late < early, "sharpness follows the pressure: \(early) → \(late)")
        #expect(ticks[firing.last!].gas < ticks[firing.first!].gas)
    }
    @Test func theAirIsSilentUnderTheTyres() {
        let (ev, cont, ticks) = score("ref-show")
        let air = ticks.indices.filter { ticks[$0].contacts == 0 }
        #expect(!air.isEmpty && air.allSatisfy { cont[$0].rumble == 0 })
        #expect(ev.contains { $0.kind == .apex })
        let ground = ticks.indices.filter { ticks[$0].contacts == 15 && ticks[$0].speed > 5 }
        #expect(ground.allSatisfy { cont[$0].rumble > 0 })
    }
    @Test func aCrashIsFeltHitForHit() {
        let (ev, _, ticks) = score("crash-show-carry5")
        // Every tick with a hit ≥ 1 m/s gets an impact transient, unless the channel fired < 10 ms before.
        var last: Int32 = -99, missed = 0
        let hitsAt = Set(ev.filter { $0.kind == .hit || $0.kind == .crush }.map(\.tick))
        for (i, t) in ticks.enumerated() {
            let hit = (0..<t.impactCount).contains { k in let (kind, s) = t.impact(k); return (kind == 0 && s >= 1) || kind == 3 }
            guard hit else { continue }
            if Int32(i) - last >= HapticScore.minGapTicks { if !hitsAt.contains(Int32(i)) { missed += 1 }; last = Int32(i) }
        }
        #expect(missed == 0)
        #expect(hitsAt.count > 0)
    }
    @Test func aCrashIsNeverStuck() {
        #expect(!score("crash-show-carry5").events.contains { $0.kind == .settle })
    }
    @Test func theLineupHasNoRelease() {
        let (ev, _, _) = score("ref-lineup")
        #expect(!ev.contains { $0.kind == .release })
        #expect(ev.filter { $0.kind == .wheel }.count >= 4)
    }
    @Test func transientsAreRateLimitedPerChannel() {
        for name in ["ref-show", "ref-wall", "crash-show-carry5", "crash-lineup-rolls2"] {
            let (ev, _, _) = score(name)
            for c in UInt8(0)...5 {
                let ts = ev.filter { $0.channel == c }.map(\.tick)
                #expect(zip(ts, ts.dropFirst()).allSatisfy { $1 - $0 >= HapticScore.minGapTicks }, "\(name) channel \(c)")
            }
        }
    }
    #if canImport(Darwin)
    @Test func stepAllocatesNothing() {
        #if DEBUG
        return   // only meaningful optimised: -Onone boxes values the optimiser keeps in registers (`make alloc`)
        #endif
        let f = feed("crash-show-carry5")
        var s = HapticScore(course: f.course)
        var n = 0
        for t in f.ticks.prefix(200) { s.step(t); s.drain { _ in n += 1 } }   // warm up
        var before = malloc_statistics_t(), after = malloc_statistics_t()
        malloc_zone_statistics(nil, &before)
        for _ in 0..<5 { for t in f.ticks { s.step(t); s.drain { _ in n += 1 } } }
        malloc_zone_statistics(nil, &after)
        #expect(after.blocks_in_use <= before.blocks_in_use, "blocks \(before.blocks_in_use) → \(after.blocks_in_use)")
        #expect(n > 0)
    }
    #endif
}
