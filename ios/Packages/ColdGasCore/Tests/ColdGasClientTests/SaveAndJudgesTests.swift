// 0154: the save survives old and damaged data (moon-club: a save that fails to decode resets the player), medals read
// as the web's, the event stream parses however its bytes arrive, and the breaker behaves as src/obs/breaker.js.
import Foundation
import Testing
@testable import ColdGasClient

@Suite struct Saves {
    func save(_ json: String) -> SaveData { SaveData.decode(Data(json.utf8)) }

    @Test func initialsAreCleanedAsPostJS() {
        #expect(cleanInitials("abc") == "ABC"); #expect(cleanInitials("a1b2c3d") == "ABC"); #expect(cleanInitials("  x") == "X")
        #expect(cleanInitials(nil) == ""); #expect(cleanInitials("é!") == ""); #expect(cleanInitials("") == "")
    }
    @Test func anEmptyOrUnreadableSaveIsFresh() {
        for bad in ["", "junk", "[1,2]", "5", "null"] { #expect(save(bad) == SaveData(), "\(bad)") }
        #expect(SaveData.decode(nil) == SaveData())
        let s = SaveData()
        #expect(s.cleanedInitials == ""); #expect(s.streak == Daily.Streak()); #expect(s.medalBook == Medals())
        let t = s.resolvedSettings
        #expect(t.hapticsOn); #expect(t.soundOn); #expect(t.controlScheme == .thumb); #expect(t.handedness == .right); #expect(!t.tiltOn); #expect(t.unitSystem == .us)
    }
    @Test func aSaveFromAnOlderBuildDecodes() {
        // Older than every field but initials; a field this build has never heard of; each present field intact.
        let s = save(#"{"initials":"mut","future":{"x":1},"medals":{"show:assist":91.3},"settings":{"haptics":false,"newThing":3}}"#)
        #expect(s.cleanedInitials == "MUT")
        #expect(s.medalBook.held(course: "show", tier: "assist").medal == .silver)
        #expect(s.resolvedSettings.hapticsOn == false); #expect(s.resolvedSettings.soundOn)
        #expect(s.daily == nil); #expect(s.judgeBreaker == nil)
    }
    @Test func oneBadFieldCostsOnlyThatField() {
        let s = save(#"{"initials":7,"medals":{"show:assist":"lots","wall:pro":88,"BAD KEY":50,"lineup:pro":400},"daily":{"last":"nope","streak":9},"settings":{"scheme":"telepathy","units":"metric","tilt":"yes"},"judgeBreaker":{"state":"open","openUntil":"soon","trips":2}}"#)
        #expect(s.initials == nil)
        #expect(s.medals == ["wall:pro": 88])
        #expect(s.daily == Daily.Streak())
        #expect(s.resolvedSettings.controlScheme == .thumb); #expect(s.resolvedSettings.unitSystem == .metric); #expect(s.resolvedSettings.tiltOn == false)
        #expect(s.judgeBreaker?.state == "open"); #expect(s.judgeBreaker?.openUntil == 0); #expect(s.judgeBreaker?.trips == 2)
        // A wrong type at the top of a field.
        let t = save(#"{"medals":5,"daily":"x","settings":[1],"judgeBreaker":false,"initials":"ABC"}"#)
        #expect(t.medals == nil); #expect(t.settings == nil); #expect(t.judgeBreaker == nil); #expect(t.cleanedInitials == "ABC")
        #expect(t.streak == Daily.Streak())
    }
    @Test func aSaveRoundTrips() throws {
        var s = SaveData()
        s.initials = "ABC"; s.medals = ["show:pro": 92.5]
        s.daily = Daily.complete(Daily.Streak(), 1793534400000)
        var set = Settings(); set.haptics = false; set.sound = false; set.scheme = .classic; set.hand = .left; set.tilt = true; set.units = .metric
        s.settings = set
        var b = Breaker(); b.failure("x", now: 1); b.failure("y", now: 2)
        s.judgeBreaker = b.s
        let data = try #require(s.encoded())
        #expect(SaveData.decode(data) == s)
    }
}

@Suite struct MedalRules {
    @Test func thresholdsAndNext() {
        #expect(Medals.thresholds(course: "wall", tier: "advanced") == [75, 93, 97.5])
        #expect(Medals.thresholds(course: "moon", tier: "nope") == [80, 90, 95])
        #expect(Medals.medalFor(course: "show", tier: "assist", total: 79.9) == nil)
        #expect(Medals.medalFor(course: "show", tier: "assist", total: 80) == .bronze)
        #expect(Medals.medalFor(course: "show", tier: "assist", total: 90 - 1e-10) == .silver)
        #expect(Medals.medalFor(course: "show", tier: "assist", total: 97) == .gold)
        #expect(Medals.medalFor(course: "show", tier: "assist", total: .nan) == nil)
        #expect(Medals.nextTargetText(course: "show", tier: "assist", best: 86.8) == "Silver at 90 \u{B7} 3.2 to go")
        #expect(Medals.nextTargetText(course: "show", tier: "pro", best: 92, from: 95) == "Gold at 96.5 \u{B7} 1.5 to go")
        #expect(Medals.nextTargetText(course: "show", tier: "assist", best: 96) == "Gold held \u{B7} beat your best")
        #expect(Medals.nextMedal(course: "show", tier: "assist", best: -1)?.medal == .bronze)
        #expect(Medals.nextMedal(course: "show", tier: "assist", best: 89.99, from: 89.99)?.toGo == 0.1)
    }
    @Test func recordingKeepsTheBest() {
        var m = Medals()
        let a = m.record(course: "show", tier: "assist", total: 81.26)
        #expect(a.isNew); #expect(a.earned == .bronze); #expect(a.after.best == 81.3)
        let b = m.record(course: "show", tier: "assist", total: 70)
        #expect(!b.isNew); #expect(b.earned == nil); #expect(b.after.best == 81.3)
        let c = m.record(course: "show", tier: "assist", total: 95.04)
        #expect(c.isNew); #expect(c.earned == .gold); #expect(c.before.medal == .bronze); #expect(c.after.medal == .gold)
        let d = m.record(course: "moon", tier: "assist", total: 99)
        #expect(!d.isNew); #expect(d.earned == nil); #expect(m.best["moon:assist"] == nil)
    }
}

@Suite struct JudgesStream {
    let wire = "event: verify\ndata: {\"ms\":3,\"card\":{\"total\":91.5,\"verdict\":\"Clean\",\"tier\":\"pro\",\"facts\":{\"sink\":0.8}},\"ticks\":3502,\"replayed\":false}\n\n"
        + "event: prompt\ndata: {\"provider\":\"edge\",\"providerLabel\":\"Cloudflare\",\"vendor\":\"Workers AI\",\"model\":\"m\",\"colo\":\"ORD\",\"where\":\"Cloudflare ORD\",\"system\":\"s\",\"user\":\"u\",\"inTokensEst\":120}\n\n"
        + "event: reasoning\ndata: {\"t\":\"hm\"}\n\n"
        + "event: token\ndata: {\"t\":\"HEADLINE: Clean é\\n\"}\n\n"
        + "event: token\ndata: {\"t\":\"ENGINEER: Sink 0.8.\\n\"}\n\n"
        + "event: note\ndata: {\"message\":\"Fell back to n.\",\"model\":\"n\"}\n\n"
        + "event: unknown\ndata: {}\n\n"
        + "event: token\ndata: not json\n\n"
        + "event: done\ndata: {\"words\":{\"headline\":\"Clean é\",\"engineer\":\"Sink 0.8.\",\"coordinator\":\"\",\"designer\":\"\",\"source\":\"ai\"},\"provider\":\"edge\",\"model\":\"n\",\"colo\":null,\"ttftMs\":90,\"totalMs\":1200,\"verifyMs\":4,\"inTokens\":120,\"outTokens\":30,\"neurons\":null,\"tokensPerSec\":12.5,\"costUsd\":null,\"billedTo\":\"COLD GAS (free allowance)\",\"raw\":\"x\"}\n\n"
    func events(chunk: Int) -> [JudgeEvent] {
        var p = SSEParser(), text = "", out: [JudgeEvent] = []
        let b = Array(wire.utf8)
        var i = 0
        while i < b.count {
            for m in p.feed(b[i..<min(i + chunk, b.count)]) { if let e = judgeEvent(m, text: &text) { out.append(e) } }
            i += chunk
        }
        return out
    }
    @Test func eventsParseHoweverTheBytesArrive() {
        let whole = events(chunk: 1 << 20)
        #expect(whole.count == 7)   // unknown and bad-JSON messages are skipped
        guard case let .verify(v) = whole[0], case let .prompt(p) = whole[1], case let .reasoning(r) = whole[2], case let .token(_, w1) = whole[3], case let .token(_, w2) = whole[4], case let .note(n) = whole[5], case let .done(d) = whole[6] else {
            Issue.record("wrong order: \(whole)"); return
        }
        #expect(v.card.total == 91.5); #expect(v.replayed == false); #expect(v.ticks == 3502)
        #expect(p.where == "Cloudflare ORD"); #expect(r == "hm")
        #expect(w1.headline == "Clean é"); #expect(w1.engineer == ""); #expect(w2.engineer == "Sink 0.8.")
        #expect(n.model == "n"); #expect(d.words.source == "ai"); #expect(d.neurons == nil); #expect(d.tokensPerSec == 12.5)
        #expect(events(chunk: 1) == whole); #expect(events(chunk: 7) == whole)
    }
    @Test func aBlockMissingALineIsSkipped() {
        var p = SSEParser()
        #expect(p.feed(Array("event: x\n\ndata: {}\n\n: comment\n\n".utf8)).isEmpty)
        #expect(p.feed(Array("event: y\ndata: 1\n".utf8)).isEmpty)   // not terminated yet
        #expect(p.feed(Array("\n".utf8)) == [SSEParser.Message(event: "y", data: "1")])
    }
    @Test func overrun() {
        #expect(judgesOverran("The judges took too long.", providerMs: 35_000))
        #expect(!judgesOverran("The judges took too long.", providerMs: 5_000))
        #expect(!judgesOverran("offline", providerMs: 35_000)); #expect(!judgesOverran(nil, providerMs: 35_000))
    }
}

@Suite struct BreakerRules {
    @Test func opensAfterTwoFailuresInAMinute() {
        var b = Breaker()
        do { let ok = b.allow(now: 0); #expect(ok) }
        b.failure("a", now: 1000); #expect(b.state == "closed")
        b.failure("b", now: 70_000); #expect(b.state == "closed")   // outside the window: counts as the first
        b.failure("c", now: 80_000); #expect(b.state == "open")
        do { let ok = b.allow(now: 80_001); #expect(!ok) }; #expect(b.retryIn(now: 100_000) == 10_000)
        #expect(b.s.lastError == "c")
    }
    @Test func aTrialClosesOrDoubles() {
        var b = Breaker()
        b.failure("a", now: 0); b.failure("b", now: 1)
        #expect(b.s.openUntil == 30_001)
        do { let ok = b.allow(now: 30_001); #expect(ok) }; #expect(b.state == "half-open")
        b.failure("c", now: 40_000); #expect(b.state == "open"); #expect(b.s.openUntil == 100_000)   // 60 s, doubled
        do { let ok = b.allow(now: 100_000); #expect(ok) }; b.success(now: 100_001)
        #expect(b.state == "closed"); #expect(b.s.trips == 1); do { let ok = b.allow(now: 100_002); #expect(ok) }
    }
    @Test func theCooldownCaps() {
        var b = Breaker()
        var now = 0.0
        for _ in 0..<12 { b.failure("x", now: now); b.failure("x", now: now); now = b.s.openUntil; do { let ok = b.allow(now: now); #expect(ok) } }
        b.failure("x", now: now)
        #expect(b.s.openUntil - now == Breaker.maxCooldownMs)
    }
    @Test func aRestedBreakerSurvivesTheSave() {
        var b = Breaker()
        b.failure("a", now: 0); b.failure("b", now: 1)
        var s = SaveData(); s.judgeBreaker = b.s
        let back = SaveData.decode(s.encoded())
        var again = Breaker(try! #require(back.judgeBreaker))
        do { let ok = again.allow(now: 10_000); #expect(!ok) }; do { let ok = again.allow(now: 30_001); #expect(ok) }
    }
}

@Suite struct Bodies {
    @Test func dryCarriesNoInitials() {
        let d = RequestBody.dry(log: [[0, 1]], t: ["course": "show"], course: "show")
        #expect(d["initials"] == nil); #expect(d["dry"] == .bool(true))
        #expect(d.json == #"{"log":[[0,1]],"t":{"course":"show"},"course":"show","dry":true}"#)
        // A real post has no dry flag at all: nothing a server could misread.
        let p = RequestBody.post(log: [[0, 1]], t: ["course": "show"], initials: "ABC", course: "show")
        #expect(p["dry"] == nil)
    }
}
