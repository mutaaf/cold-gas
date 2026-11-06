// 0154: the app's pure half against the web's own modules (Tests/Vectors/challenge.json and client.json, written by
// `npm run vectors` from src/challenge.js, src/units.js, src/panel.js and src/daily.js). Every miss names the case.
import Foundation
import Testing
@testable import ColdGasClient
import ColdGasCore

let vectorsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Vectors")
func vector(_ name: String) -> JSValue {
    let d = try! Data(contentsOf: vectorsDir.appendingPathComponent(name))
    return JSValue.parse(d)!
}
let challenge = vector("challenge.json"), client = vector("client.json")
func arr(_ v: JSValue, _ k: String) -> [JSValue] { v[k]?.arrayValue ?? [] }
func unhex(_ h: String) -> Double { Double(bitPattern: UInt64(h, radix: 16)!) }
func ints(_ v: JSValue?) -> [[Int]] { (v?.arrayValue ?? []).map { ($0.arrayValue ?? []).map { Int($0.numberValue ?? 0) } } }

@Suite struct ChallengeVectors {
    @Test func casesPackAndUnpackToTheJSBytes() throws {
        let sim = Int(challenge["simVersion"]!.numberValue!)
        #expect(arr(challenge, "cases").count >= 13)
        for c in arr(challenge, "cases") {
            let name = c["name"]!.stringValue!, log = ints(c["log"])
            let payload = try Challenge.encode(log: log, course: c["course"]!.stringValue!, score: c["score"]!.numberValue!, tier: c["tier"]!.stringValue!,
                                               initials: c["initials"]!.stringValue!, simVersion: Int(c["simVersion"]!.numberValue!), compress: false)
            #expect(payload == c["payload"]!.stringValue!, "\(name): the bytes differ")
            let d = try #require(Challenge.decode(payload, simVersion: sim), "\(name) did not decode")
            let want = c["decoded"]!
            #expect(d.simVersion == Int(want["simVersion"]!.numberValue!), "\(name)")
            #expect(d.stale == (d.simVersion != sim), "\(name)")
            #expect(d.course == want["course"]!.stringValue!, "\(name)")
            #expect(d.score == want["score"]!.numberValue!, "\(name)")
            #expect(d.tier == want["tier"]!.stringValue!, "\(name)")
            #expect(d.initials == want["initials"]!.stringValue!, "\(name)")
            let wantLog = want["log"].flatMap { $0 == .null ? nil : ints($0) } ?? log
            #expect(d.log == wantLog, "\(name): the log differs")
        }
    }
    @Test func coarsenedLogsPackAlike() throws {
        // The golden's logs come from the same runs as the cases: only ref-show's and pro-fuzz-0's.
        let all = Dictionary(arr(challenge, "cases").map { ($0["name"]!.stringValue!, $0) }, uniquingKeysWith: { a, _ in a })
        for c in arr(challenge, "coarse") {
            let name = c["name"]!.stringValue!
            guard let src = all[name] else { Issue.record("no case \(name)"); continue }
            let log = Challenge.coarsen(ints(src["log"]), step: Int(c["step"]!.numberValue!))
            #expect(log.count == Int(c["entries"]!.numberValue!), "\(name) entries")
            let payload = try Challenge.encode(log: log, course: src["course"]!.stringValue!, score: 80, tier: "assist", simVersion: Int(src["simVersion"]!.numberValue!), compress: false)
            #expect(payload == c["payload"]!.stringValue!, "\(name) step \(c["step"]!.numberValue!)")
        }
    }
    @Test func rejectsAreNil() {
        #expect(arr(challenge, "rejects").count >= 20)
        for r in arr(challenge, "rejects") {
            #expect(Challenge.decode(r["payload"]!.stringValue!, simVersion: 29) == nil, "\(r["name"]!.stringValue!) decoded")
        }
        for a in arr(challenge, "accept") { #expect(Challenge.decode(a["payload"]!.stringValue!, simVersion: 29) != nil) }
    }
    @Test func fragmentsUrlsAndComparisons() {
        for h in arr(challenge, "hashes") {
            let a = h.arrayValue!
            #expect(Challenge.vsFromHash(a[0].stringValue!) == a[1].stringValue, "\(a[0].stringValue!.prefix(40))")
        }
        for u in arr(challenge, "urls") {
            let a = u.arrayValue!
            #expect(Challenge.url(base: a[0].stringValue!, course: a[1].stringValue!, payload: a[2].stringValue!) == a[3].stringValue!)
        }
        for c in arr(challenge, "compares") {
            let a = c.arrayValue!, w = a[3]
            let s = Challenge.compare(mine: a[0].numberValue!, theirs: a[1].numberValue!, initials: a[2].stringValue!)
            #expect(s.won == w["won"]!.boolValue!); #expect(s.tie == w["tie"]!.boolValue!)
            #expect(s.diff == w["diff"]!.numberValue!); #expect(s.text == w["text"]!.stringValue!)
        }
    }
    @Test func deflateRoundTripsAndRefusesABomb() throws {
        #if canImport(Compression)
        let c = arr(challenge, "cases")[0]
        let log = ints(c["log"]), sim = Int(c["simVersion"]!.numberValue!)
        let z = try Challenge.encode(log: log, course: c["course"]!.stringValue!, score: c["score"]!.numberValue!, tier: c["tier"]!.stringValue!, initials: c["initials"]!.stringValue!, simVersion: sim)
        #expect(z.first == "z")
        #expect(z.utf8.count < c["payload"]!.stringValue!.utf8.count, "deflate should be smaller")
        let d = try #require(Challenge.decode(z, simVersion: sim))
        #expect(d.log == log)
        // A bomb past MAX_RAW (zeros deflate 1000:1) and junk are refused.
        let bomb = try #require(Challenge.deflateRaw([UInt8](repeating: 0, count: Challenge.MAX_RAW + 10)))
        #expect(Challenge.inflateRaw(bomb) == nil)
        #expect(Challenge.decode("z" + Challenge.toB64url([1, 2, 3, 4, 5]), simVersion: sim) == nil)
        #endif
    }
}

@Suite struct NumberVectors {
    @Test func numberToStringMatchesJS() {
        #expect(arr(client, "numbers").count > 500)
        for x in arr(client, "numbers") {
            let a = x.arrayValue!, v = unhex(a[0].stringValue!)
            #expect(jsNumberString(v) == a[1].stringValue!, "\(a[0].stringValue!)")
            #expect(JSValue.number(v).json == a[2].stringValue!, "json \(a[0].stringValue!)")
        }
    }
    @Test func toFixedMatchesJS() {
        for x in arr(client, "fixed") {
            let a = x.arrayValue!, v = unhex(a[0].stringValue!), d = Int(a[1].numberValue!)
            #expect(jsToFixed(v, d) == a[2].stringValue!, "\(jsNumberString(v)).toFixed(\(d))")
        }
    }
    @Test func theParserAndWriterRoundTripOrderAndEscapes() {
        let s = "{\"b\":[1,2.5,null,true],\"a\":{\"x\":\"q\\\"\\n\\u0001\\ud83d\\ude00é\"},\"c\":1e21}"
        let v = JSValue.parse(s)!
        #expect(v.json == "{\"b\":[1,2.5,null,true],\"a\":{\"x\":\"q\\\"\\n\\u0001😀é\"},\"c\":1e+21}")
        #expect(JSValue.number(.infinity).json == "null"); #expect(JSValue.number(.nan).json == "null")
        #expect(JSValue.parse("[1,") == nil); #expect(JSValue.parse("{} x") == nil)
    }
    @Test func unflatten() {
        let v = JSValue.unflatten([("facts.damageZones.nose", 3), ("judges[1].id", "b"), ("judges[0].id", "a"), ("total", 90.5)])
        #expect(v["facts"]?["damageZones"]?["nose"] == .number(3))
        #expect(v["judges"]?.arrayValue?.count == 2)
        #expect(v["judges"]?.arrayValue?[0]["id"] == .string("a"))
        #expect(v["total"] == .number(90.5))
    }
}

@Suite struct UnitVectors {
    @Test func readouts() {
        #expect(arr(client, "units").count > 500)
        for x in arr(client, "units") {
            let a = x.arrayValue!, q = Units.Quantity(rawValue: a[0].stringValue!)!, si = unhex(a[1].stringValue!), d = Int(a[2].numberValue!), s = UnitSystem(rawValue: a[3].stringValue!)!
            #expect(Units.one(q, si, Units.Decimals(d), s) == a[4].stringValue!, "\(a[0].stringValue!) \(si) d\(d) \(s)")
        }
        for x in arr(client, "readouts") {
            let a = x.arrayValue!, u = Units(UnitSystem(rawValue: a[0].stringValue!)!), m = unhex(a[1].stringValue!)
            #expect(u.fmtRoad(m) == a[2].stringValue!, "road \(m)")
            #expect(u.fmtSmall(m) == a[3].stringValue!, "small \(m)")
            #expect(u.fmtLen(m) == a[4].stringValue!, "len \(m)")
            #expect(u.fmtSpeed(m) == a[5].stringValue!, "speed \(m)")
        }
    }
    @Test func prose() {
        #expect(arr(client, "prose").count > 100)
        for x in arr(client, "prose") {
            let a = x.arrayValue!, u = Units(UnitSystem(rawValue: a[0].stringValue!)!), t = a[1].stringValue!
            #expect(Units.toUS(t) == a[2].stringValue!, "toUS: \(t)")
            #expect(u.localize(t) == a[3].stringValue!, "localize \(u.system): \(t)")
        }
    }
}

@Suite struct PanelVectors {
    @Test func localWordsMatch() {
        #expect(arr(client, "words").count >= 100)
        for x in arr(client, "words") {
            let a = x.arrayValue!, name = a[0].stringValue!
            guard let card = ScoreCard(json: a[2]) else { Issue.record("\(name): no card"); continue }
            let w = localWords(card), want = a[3]
            #expect(w.headline == want["headline"]?.stringValue, "\(name) headline")
            #expect(w.engineer == want["engineer"]?.stringValue, "\(name) engineer")
            #expect(w.coordinator == want["coordinator"]?.stringValue, "\(name) coordinator")
            #expect(w.designer == want["designer"]?.stringValue, "\(name) designer")
            #expect(w.source == "local")
        }
    }
    @Test func theReceiptsReasons() {
        let why = arr(client, "localWhy")[0]
        for (k, v) in LOCAL_WHY { #expect(why[k]?.stringValue == v, "\(k)") }
        #expect(JudgeMeta.localMeta(.breaker).error == LOCAL_WHY["breaker"])
        #expect(JudgeMeta.localMeta(.breaker).ok == false)
    }
    @Test func boardRows() {
        for x in arr(client, "rows") {
            let a = x.arrayValue!, got = boardRow(a[0] == .null ? nil : a[0]), want = a[1]
            if want == .null { #expect(got == nil, "\(a[0].json)"); continue }
            guard let got else { Issue.record("\(a[0].json): no row"); continue }
            #expect(got.initials == want["initials"]?.stringValue, "\(a[0].json) initials")
            #expect(got.verdict == want["verdict"]?.stringValue, "\(a[0].json) verdict")
            #expect(got.total == want["total"]?.numberValue, "\(a[0].json) total")
            #expect(got.rollDeg == want["facts"]?["rollDeg"]?.numberValue, "\(a[0].json) rollDeg")
            #expect(got.sink == want["facts"]?["sink"]?.numberValue, "\(a[0].json) sink")
            #expect(got.tier == want["tier"]?.stringValue, "\(a[0].json) tier")
            #expect(got.course == want["course"]?.stringValue, "\(a[0].json) course")
        }
    }
    @Test func postMessages() {
        for x in arr(client, "posts") {
            let a = x.arrayValue!, r = a[0]
            let res = PostResult(ok: r["ok"]?.boolValue ?? false, status: Int(r["status"]?.numberValue ?? 0), timeout: r["timeout"]?.boolValue ?? false, response: r.decode(ScoresResponse.self) ?? ScoresResponse())
            #expect(postMessage(res) == a[1].stringValue!, "\(r.json)")
        }
        for x in arr(client, "ranks") {
            let a = x.arrayValue!
            // rankLabel takes a checked Int: what the web's Number.isInteger lets through. 1.5, null and "3" have no Int.
            let r: Int? = a[0].numberValue.flatMap { $0 == $0.rounded() ? Int($0) : nil }
            #expect(rankLabel(r) == a[1].stringValue!, "\(a[0].json)")
        }
    }
    @Test func parseWordsIsTolerant() {
        let w = parseWords("**HEADLINE:** \u{201C}Big air\u{201D}\r\n- engineer - Sink 0.8 m/s.\n\nCOORDINATOR: That is the shot\nDesigner\u{2013} \"Quiet.\"\nnoise")
        #expect(w.headline == "Big air"); #expect(w.engineer == "Sink 0.8 m/s."); #expect(w.coordinator == "That is the shot"); #expect(w.designer == "Quiet.")
        #expect(parseWords("nothing here") == JudgeWords())
        #expect(parseWords("HEADLINE: " + String(repeating: "x", count: 90)).headline.count == 60)
    }
}

@Suite struct DailyVectors {
    @Test func theWalkAndTheDates() {
        #expect(Daily.EPOCH == Int(client["epoch"]!.numberValue!))
        let want = arr(client, "objectives")
        #expect(Daily.OBJECTIVES.count == want.count)
        for (o, w) in zip(Daily.OBJECTIVES, want) {
            let a = w.arrayValue!
            #expect(o.id == a[0].stringValue!); #expect(o.course == a[1].stringValue!); #expect(o.tier == a[2].stringValue)
        }
        #expect(arr(client, "days").count > 1500)
        for x in arr(client, "days") {
            let a = x.arrayValue!, d = Int(a[0].numberValue!)
            #expect(Daily.objectiveIndex(d) == Int(a[1].numberValue!), "day \(d)")
        }
        for x in arr(client, "dayKeys") {
            let a = x.arrayValue!, ms = a[0].numberValue!
            #expect(Daily.dayNumber(ms) == Int(a[1].numberValue!), "\(ms)")
            #expect(Daily.dayKey(ms) == a[2].stringValue!, "\(ms)")
        }
    }
    @Test func goalsChecksAndHints() {
        let cards = Dictionary(arr(client, "words").map { ($0.arrayValue![0].stringValue!, ($0.arrayValue![1].stringValue!, ScoreCard(json: $0.arrayValue![2])!)) }, uniquingKeysWith: { a, _ in a })
        let byId = Dictionary(uniqueKeysWithValues: Daily.OBJECTIVES.map { ($0.id, $0) })
        for x in arr(client, "goals") {
            let a = x.arrayValue!, u = Units(UnitSystem(rawValue: a[0].stringValue!)!)
            #expect(byId[a[1].stringValue!]!.goal(u) == a[2].stringValue!, "\(a[1].stringValue!) \(u.system)")
        }
        let pilots: [Daily.Pilot] = [.init(device: .touch, scheme: .thumb, tier: "assist"), .init(device: .touch, scheme: .classic, tier: "assist"), .init(device: .touch, scheme: .classic, tier: "pro"),
                                     .init(device: .touch, scheme: .classic, tier: "advanced"), .init(device: .pad, scheme: .classic, tier: "assist"), .init(device: .key, scheme: .classic, tier: "pro")]
        #expect(arr(client, "daily").count > 300)
        for x in arr(client, "daily") {
            let a = x.arrayValue!, u = Units(UnitSystem(rawValue: a[0].stringValue!)!), o = byId[a[1].stringValue!]!, name = a[2].stringValue!
            let (course, card) = cards[name]!
            guard let r = Daily.evaluate(o, card, course: course, units: u) else { Issue.record("\(o.id) \(name): nil"); continue }
            #expect(r.ok == a[3].boolValue!, "\(o.id) \(name)")
            #expect(r.miss == a[4].stringValue!, "\(o.id) \(name) \(u.system)")
            #expect(r.fix == a[5].boolValue!, "\(o.id) \(name)")
            if !r.ok { for (i, p) in pilots.enumerated() { #expect(Daily.missLine(o, r, p) == a[6 + i].stringValue!, "\(o.id) \(name) \(p)") } }
        }
        // A run on another course doesn't count.
        #expect(Daily.evaluate(byId["mark-show"]!, cards["ref-wall"]!.1, course: "wall", units: Units()) == nil)
        for x in arr(client, "titles") {
            let a = x.arrayValue!, c = a[1]
            let p = Daily.Pilot(device: .init(rawValue: c["device"]!.stringValue!)!, scheme: .init(rawValue: c["scheme"]!.stringValue!)!, tier: c["tier"]!.stringValue!)
            #expect(Daily.titleHint(byId[a[0].stringValue!]!, p) == a[2].stringValue!)
            #expect(Daily.titleHint(byId[a[0].stringValue!]!, p, whole: true) == a[3].stringValue!)
        }
    }
    @Test func theStreak() {
        func same(_ s: Daily.StreakNow, _ w: JSValue, _ c: String) {
            #expect(s.streak == Int(w["streak"]!.numberValue!), "\(c)"); #expect(s.doneToday == w["doneToday"]!.boolValue!, "\(c)"); #expect(s.best == Int(w["best"]!.numberValue!), "\(c)")
        }
        var st = Daily.readStreak(nil as JSValue?)
        for x in arr(client, "streak") {
            let a = x.arrayValue!, day = a[0].stringValue!, ms = a[1].numberValue!
            same(Daily.streakNow(st, ms), a[2], "\(day) before")
            st = Daily.complete(st, ms)
            #expect(st.last == a[3]["last"]!.stringValue!, "\(day)"); #expect(st.streak == Int(a[3]["streak"]!.numberValue!), "\(day)"); #expect(st.best == Int(a[3]["best"]!.numberValue!), "\(day)")
            same(Daily.streakNow(st, ms), a[4], "\(day) after")
            same(Daily.streakNow(st, ms + 86_400_000), a[5], "\(day) +1")
            same(Daily.streakNow(st, ms + 2 * 86_400_000), a[6], "\(day) +2")
        }
        for x in arr(client, "streakReads") {
            let a = x.arrayValue!, s = Daily.readStreak(json: a[0].stringValue), w = a[1]
            #expect(s.last == w["last"]!.stringValue!, "\(a[0].json)"); #expect(s.streak == Int(w["streak"]!.numberValue!), "\(a[0].json)"); #expect(s.best == Int(w["best"]!.numberValue!), "\(a[0].json)")
        }
    }
}
