// 0237, 0239: the Wreck score. The pure scorer (combos need each step inside the window, repeats never raise a chain, a
// toppled car counts once), and the tracker over the recorded runs: a clean landing scores nothing, a recorded crash scores,
// the same log always gives the same card, and reading the run never changes it (the vectors stay bit-exact).
import Testing
import Foundation
@testable import ColdGasPhysics
import ColdGasCore
import ColdGasClient

private func ev(_ t: Int, _ k: WreckKind, _ p: Double = 10) -> WreckEvent { WreckEvent(tick: t, kind: k, points: p) }

@Suite struct WreckFelt {
    /// One pattern per combo call: the step's signature, then as many rising ticks as the multiplier.
    @Test func eachCallPlaysItsStepThenTheMultiplier() throws {
        let card = wreckCard([ev(100, .roof, 3), ev(300, .topple), ev(550, .rollover), ev(800, .crush)])
        #expect(card.calls.count == 3)
        for c in card.calls {
            let p = comboPattern(c)
            let ticks = p.filter { $0.sharpness == 0.75 }
            #expect(ticks.count == c.multiplier)
            #expect(zip(ticks, ticks.dropFirst()).allSatisfy { $0.intensity < $1.intensity && $0.ms < $1.ms })
            #expect(p.allSatisfy { $0.intensity > 0 && $0.intensity <= 1 })
        }
    }
    @Test func theBriefCarriesTheWreckOnlyWhenThereIsOne() {
        let card = ScoreCard(total: 5, verdict: "Wrecked", tier: "assist", course: "lineup", multiplier: 1, judges: [], categories: [:],
                             facts: .object([("course", .string("lineup"))]))
        #expect(!judgePrompt(card).contains("Wreck score"))
        let p = judgePrompt(card, wreck: CrewWreck(total: 78.4, bestCombo: 4, chain: ["Roof", "Topple", "Rollover", "Crush"], toppled: 1))
        #expect(p.hasSuffix("Wreck score (a separate score for how spectacularly it came apart) 78.4/100; best combo x4: roof, topple, rollover, crush; toppled 1 parked car."))
    }
}

@Suite struct WreckScorer {
    @Test func nothingScoresNothing() {
        let c = wreckCard([])
        #expect(c.total == 0 && c.isEmpty && c.best == nil && c.calls.isEmpty)
    }
    @Test func aComboNeedsEachStepInsideTheWindow() {
        let chained = wreckCard([ev(100, .roof, 3), ev(300, .topple), ev(550, .rollover), ev(800, .crush)])
        #expect(chained.bestMultiplier == 4)
        #expect(chained.best?.kinds == [.roof, .topple, .rollover, .crush])
        #expect(chained.calls.map(\.multiplier) == [2, 3, 4])
        #expect(chained.calls.map(\.tick) == [300, 550, 800])
        // The same events with one gap past the window: two chains, the best ×2.
        let broken = wreckCard([ev(100, .roof, 3), ev(300, .topple), ev(300 + COMBO_WINDOW + 1, .rollover), ev(900, .crush)])
        #expect(broken.bestMultiplier == 2)
        #expect(broken.total < chained.total)
    }
    @Test func repeatingOneThingNeverRaisesTheChain() {
        let mash = wreckCard((0..<20).map { ev($0 * 50, .slam, 9) })
        #expect(mash.bestMultiplier == 1 && mash.calls.isEmpty)
    }
    @Test func moreCarnageScoresMoreAndTheTotalStaysUnder100() {
        let small = wreckCard([ev(10, .slam, WreckPoints.slam(5))]), big = wreckCard((0..<6).flatMap { i in WreckKind.allCases.map { ev(i * 40 + Int($0.rawValue), $0, 30) } })
        #expect(small.total > 0 && small.total < 10)
        #expect(big.total > 80 && big.total < 100)
        #expect(big.bestMultiplier == COMBO_MAX)
        #expect(big.categories.map(\.0) == ["impact", "carnage", "tumble", "combo"])
        #expect(big.categories.allSatisfy { $0.1 >= 0 && $0.1 <= 10 })
        #expect(big.crew.bestCombo == COMBO_MAX && big.crew.chain.first == "Slam")
    }
    @Test func aHitIsCappedSoOneSlamIsntTheScore() {
        #expect(WreckPoints.slam(40) == 60 && WreckPoints.roofHit(40) == 45)
        #expect(WreckPoints.slam(4) == 4 && WreckPoints.scrape(30) == 2)
    }
}

/// A recorded run flown again with the tracker reading every tick.
private func tracked(_ name: String) throws -> (run: Run, card: WreckCard) {
    let v = RunVector(name)
    return try wreckOf(v.log, v.course)
}

@Suite("The Wreck tracker over the recorded runs", .serialized)
struct WreckTrackerTests {
    @Test(arguments: ["ref-show", "ref-wall", "ref-lineup", "ref-show-advanced", "ref-wall-advanced"])
    func aCleanLandingScoresNoWreck(_ name: String) throws {
        let (run, card) = try tracked(name)
        #expect(run.t.settledUpright && !run.t.flipped)
        #expect(card.total < 3, "\(name): \(card.total) from \(card.hits) hits")
        #expect(card.toppled == 0 && card.rollovers == 0)
    }
    @Test(arguments: ["crash-lineup-rolls2", "crash-show-carry5", "pro-fuzz-0", "pro-fuzz-3"])
    func aRecordedCrashScoresWreck(_ name: String) throws {
        let (_, card) = try tracked(name)
        #expect(card.total > 0, "\(name)")
        print("WRECK \(name): \(card.total) raw \(card.raw) best ×\(card.bestMultiplier) \((card.best?.kinds ?? []).map(\.name)) events \(card.calls.count) calls, hits \(card.hits) topple \(card.toppled) shove \(card.shoved) roll \(card.rollovers)")
    }
    @Test func theSameLogGivesTheSameCardAndTheRunIsUntouched() throws {
        let v = RunVector("crash-show-carry5")
        let (a, ca) = try tracked("crash-show-carry5")
        let (_, cb) = try tracked("crash-show-carry5")
        #expect(ca == cb)
        let plain = try simulate(v.log, v.course)
        #expect(plain.t.endTick == a.t.endTick && plain.t.flat().count == a.t.flat().count)
        #expect(zip(plain.t.flat(), a.t.flat()).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 })
    }
    /// The naive players (hold GO, mash, nothing) can't score near the top of the Wreck range.
    @Test func naivePlayersStayOffTheTop() throws {
        var worst = 0.0
        for name in runNames() where name.hasPrefix("naive-") {
            let (_, card) = try tracked(name)
            worst = max(worst, card.total)
        }
        print("WRECK naive max \(worst)")
        #expect(worst < 75)
    }
}
