// 0242: Wreck Club. Feats from finished runs, each earned once; ranks from feats; paints unlocked by rank; the book
// survives a save round trip and an old or damaged save; every feat is reachable by some run.
import Foundation
import Testing
@testable import ColdGasClient

private func land(_ course: String, _ verdict: String = "Clean", rotations: Double = 1, miss: Double = 3) -> WreckClub.RunFacts {
    WreckClub.RunFacts(course: course, landed: true, verdict: verdict, rotations: rotations, padMiss: miss, crashed: false)
}
private func wreck(_ total: Double, combo: Int = 0, rollovers: Int = 0, toppled: Int = 0) -> WreckClub.RunFacts {
    WreckClub.RunFacts(course: "lineup", landed: false, verdict: "Wrecked", crashed: true, wreckTotal: total, bestCombo: combo, rollovers: rollovers, toppled: toppled)
}

@Suite struct WreckClubFeats {
    @Test func aFeatIsEarnedOnceAndRaisesTheRank() {
        var b = WreckClub.Book()
        #expect(b.rank.name == "Rookie" && b.count == 0)
        let r1 = WreckClub.record(wreck(52, combo: 3), into: &b, now: 1)
        #expect(r1.new.map(\.id) == ["first-wreck", "combo3", "wreck50"])
        #expect(r1.rankUp?.name == "Stand-in")
        let r2 = WreckClub.record(wreck(60, combo: 3), into: &b, now: 2)
        #expect(r2.new.isEmpty && r2.rankUp == nil)
        #expect(b.feats["combo3"] == 1)
    }
    @Test func everyFeatIsReachable() {
        var b = WreckClub.Book()
        let runs = [wreck(80, combo: 5, rollovers: 2, toppled: 1), land("show", "Perfect 10", rotations: 2, miss: 0.5), land("wall"), land("lineup")]
        for r in runs { WreckClub.record(r, into: &b, now: 1) }
        #expect(b.count == WreckClub.feats.count)
        #expect(b.rank.name == "Legend of the lot" && b.next == nil)
        #expect(WreckClub.paints.allSatisfy { b.unlocked($0) })
    }
    @Test func landingsCountTheSetsOnlyWhenLanded() {
        var b = WreckClub.Book()
        WreckClub.record(land("show"), into: &b, now: 1)
        WreckClub.record(wreck(20), into: &b, now: 1)
        #expect(b.landed == ["show"])
        #expect(b.feats["three-sets"] == nil)
    }
    @Test func aLockedPaintIsNeverWorn() {
        var b = WreckClub.Book()
        b.paint = "chrome"
        #expect(b.currentPaint.isFactory)
        for f in WreckClub.feats { b.feats[f.id] = 1 }
        #expect(b.currentPaint.id == "chrome")
    }
    @Test func theBookSurvivesTheSaveAndADamagedOne() throws {
        var s = SaveData()
        var b = WreckClub.Book(); WreckClub.record(wreck(52, combo: 3), into: &b, now: 7); b.paint = "dust"
        s.club = b
        let back = SaveData.decode(s.encoded())
        #expect(back.club == b)
        let old = SaveData.decode(Data(#"{"settings":{"haptics":false}}"#.utf8))
        #expect(old.club == nil)
        let junk = SaveData.decode(Data(#"{"club":{"feats":{"combo3":"x","wreck50":3},"landed":["show","mars"],"paint":7}}"#.utf8))
        #expect(junk.club?.feats == ["wreck50": 3] && junk.club?.landed == ["show"] && junk.club?.paint == nil)
    }
}
