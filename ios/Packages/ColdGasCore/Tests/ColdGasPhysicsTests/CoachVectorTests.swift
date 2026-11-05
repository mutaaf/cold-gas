// 0160: the Swift coach says what the JS coach says, word for word (Tests/Vectors/coach.json, `npm run vectors`, from
// src/sim/coach.js, src/pointer.js coachWords and src/practice.js): the same items in the same order, weights by bit
// pattern, over every run vector and input vector, in a phone's words on one thumb and on classic touch. And the drills
// hand over on the JS's bits and fly on to its card, its aftermath and its coaching.
#if canImport(CRapier)
import Foundation
import Testing
import ColdGasClient
@testable import ColdGasPhysics
@testable import ColdGasCore

let coachVectors: [String: Any] = {
    let d = try! Data(contentsOf: vectorsDir.appendingPathComponent("coach.json"))
    return try! JSONSerialization.jsonObject(with: d) as! [String: Any]
}()
func coachLogOf(_ name: String) -> [[Int]] {
    for dir in ["runs", "input"] {
        if let d = try? Data(contentsOf: vectorsDir.appendingPathComponent("\(dir)/\(name).json")), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            return (j["log"] as! [[NSNumber]]).map { $0.map(\.intValue) }
        }
    }
    fatalError("no log for \(name)")
}
func flatRows(_ a: Any?) -> [(String, String, Any?)] { (a as! [[Any]]).map { ($0[0] as! String, $0[1] as! String, $0.count > 2 ? $0[2] : nil) } }
/// The first way a list of items differs from the JS's, in words. A nil weight: drillCoach's, which has none.
func itemsDiffer(_ got: [CoachItem], _ want: [[Any]], _ what: String) -> [String] {
    var bad: [String] = []
    if got.map(\.id) != want.map({ $0[0] as! String }) { bad.append("\(what) ids: JS \(want.map { $0[0] }) Swift \(got.map(\.id))") }
    for (g, w) in zip(got, want) {
        if let h = w[1] as? String, hex64(g.weight) != h { bad.append("\(what) \(g.id) weight: JS \(h) Swift \(hex64(g.weight))") }
        for (k, x) in [g.title, g.detail, g.fix].enumerated() where x != w[2 + k] as! String { bad.append("\(what) \(g.id):\n  JS    \(w[2 + k])\n  Swift \(x)") }
    }
    return bad
}
func wordsOf(_ d: [String: String]) -> CoachWords { CoachWords(land: d["land"]!, lift: d["lift"]!, release: d["release"]!, boost: d["boost"]!, roll: d["roll"]!, aim: d["aim"]!, ranOut: d["ranOut"]!) }
func logHash(_ log: [[Int]]) -> String {
    var h: (UInt32, UInt32) = (0x811c9dc5, 0x9747b28c)
    for e in log { mixState(&h, e.map(Double.init)) }
    return hex32(h.0, h.1)
}

/// scripts/vectors-lib.mjs tailInput: what a drill's tail does after the hand-over, from the row's own numbers.
func tailInput(_ inp: Input, _ run: Run, _ drill: Drill, _ k: Int, _ tail: [String: Any]) {
    func n(_ key: String) -> Int { (tail[key] as! NSNumber).intValue }
    func d(_ key: String) -> Double { (tail[key] as! NSNumber).doubleValue }
    let c = run.car
    clearInput(inp)
    inp.fan = 0; inp.assist = d("assist")
    if run.phase == .landed { inp.brake = 1; return }
    if !drill.released && k < 24 { inp.lift = 1 }
    if k < n("thrust") { inp.thrust = 1 }
    if k < n("liftHold") { inp.lift = 1 }
    if n("rollAt") >= 0 && k >= n("rollAt") && k < n("rollAt") + n("rollLen") { inp.roll = d("roll") }
    if n("pitchAt") >= 0 && k >= n("pitchAt") && k < n("pitchAt") + n("pitchLen") { inp.pitch = d("pitch") }
    if n("level") >= 0 && k >= n("level") && run.phase == .air { inp.level = 1 }
    if d("liftBelow") != 0 && run.phase == .air && c.vel.y < -1 && c.pos.y - SPEC.comHeight < d("liftBelow") { inp.lift = 1 }
}

@Suite("The Swift coach says what the JS coach says", .serialized)
struct CoachVectorTests {
    @Test func theVectorsAreThisSim() { #expect(coachVectors["simVersion"] as! Int == SIM_VERSION) }

    @Test func theWordsForEveryDeviceSchemeAndTier() {
        for r in coachVectors["words"] as! [[Any]] {
            let device = r[0] as! String, want = wordsOf(r[3] as! [String: String])
            if device == "KEY_WORDS" { #expect(COACH_KEY_WORDS == want); continue }
            let ctx = Daily.Pilot(device: .init(rawValue: device)!, scheme: .init(rawValue: r[1] as! String)!, tier: r[2] as! String)
            #expect(coachWords(ctx) == want, "\(r[0]) \(r[1]) \(r[2])")
        }
    }
    @Test func thumbOnlyWhereTheWebOffersIt() {
        for r in coachVectors["ctxs"] as! [[String]] {
            let ctx = pointerCtx(course: r[2], tier: r[3], device: .init(rawValue: r[0])!, touchScheme: .init(rawValue: r[1])!)
            #expect(ctx.scheme.rawValue == r[4], "\(r)")
        }
    }
    @Test func whichWayTheMarkWasMissed() {
        for r in coachVectors["misses"] as! [[Any]] {
            let m = r[3] as! [String: Any], show = r[2] as! Bool
            let touch = r[0] as! String == "null" ? nil : CoachTouch(sink: 0, tilt: 0, x: unhex(r[1]), z: 0, padMiss: 0, along: unhex(r[0]))
            let got = markMiss(touch, show: show)
            #expect(got.title == m["title"] as! String && got.where == m["where"] as! String && got.side == m["side"] as? String, "\(r): \(got)")
        }
    }
    @Test func whatGetsNamed() {
        for r in coachVectors["names"] as! [[Any]] {
            let a = unhex(r[1]), cost = unhex(r[2]), show = r[3] as! Bool, drill = r[4] as! Bool
            let got = r[0] as! String == "mark" ? namesMark(a, cost, show: show, drill: drill) : namesBraking(a, cost, show: show, drill: drill)
            #expect(got == r[5] as! Bool, "\(r)")
        }
    }

    /// Every log the sim's vectors fly: the flight read, what the mark and the sink cost, and each row's items. `coach`
    /// itself flies the log once per row, as the JS generator's does.
    @Test("a log's coaching", arguments: (coachVectors["flights"] as! [[Any]]).map { $0[0] as! String })
    func oneLog(_ name: String) throws {
        let row = (coachVectors["flights"] as! [[Any]]).first { $0[0] as! String == name }!
        let course = row[1] as! String, fromTick = row[2] as! Int, log = coachLogOf(name)
        let (run, flight) = try readFlight(log, course, fromTick: fromTick)
        var bad = compare(flatRows(row[5]), flight.flat, "flight")
        if hex64(markCost(run.t)) != row[3] as! String { bad.append("markCost JS \(row[3]) Swift \(hex64(markCost(run.t)))") }
        if hex64(sinkCost(run.t)) != row[4] as! String { bad.append("sinkCost JS \(row[4]) Swift \(hex64(sinkCost(run.t)))") }
        let card = scoreRun(run.t)
        let words: [String: CoachWords] = [
            "thumb": coachWords(Daily.Pilot(device: .touch, scheme: .thumb, tier: "assist")),
            "classic": coachWords(Daily.Pilot(device: .touch, scheme: .classic, tier: card.tier)),
            "key": COACH_KEY_WORDS,
        ]
        for r in (coachVectors["rows"] as! [[Any]]) where r[0] as! String == name {
            let say = r[1] as! String, withCard = r[2] as! Bool
            let got = try coach(log, course, card: withCard ? card : nil, fromTick: withCard ? fromTick : 0, say: words[say]!)
            bad += itemsDiffer(got.items, r[3] as! [[Any]], "\(say)\(withCard ? "" : " no card")")
        }
        #expect(bad.isEmpty, "\(name): \(bad.prefix(6).joined(separator: "\n"))")
    }

    /// The drills: the hand-over, the tail flown on, the drill's card and coaching, the coach, the aftermath.
    @Test("a drill", arguments: (coachVectors["drills"] as! [[String: Any]]).indices)
    func oneDrill(_ i: Int) throws {
        let v = (coachVectors["drills"] as! [[String: Any]])[i]
        let tail = v["tail"] as! [String: Any], course = v["course"] as! String
        let drill = drillById(v["drill"] as! String)!
        let name = "\(drill.id) \(course) \(tail["name"]!)"
        let built = try buildDrill(drill, course), run = built.run
        var bad: [String] = []
        if built.released != v["released"] as! Bool { bad.append("released") }
        if built.startTick != v["startTick"] as! Int { bad.append("start tick: JS \(v["startTick"]!) Swift \(built.startTick)") }
        let prefix = v["prefix"] as! [String: Any]
        if run.inputLog.count != prefix["entries"] as! Int || logHash(run.inputLog) != prefix["hash"] as! String { bad.append("the log to the hand-over: \(run.inputLog.count) entries, JS \(prefix)") }
        let hand = v["handover"] as! [String]
        for (k, x) in stateOf(run).map(hex64).enumerated() where x != hand[k] { bad.append("hand-over \(k): JS \(hand[k]) Swift \(x)") }
        #expect(bad.isEmpty, "\(name): \(bad.prefix(6).joined(separator: "; "))")
        if !bad.isEmpty { return }

        armAftermath(run)
        let inp = Input()
        var beat = 0
        while run.phase != .done && beat < 120 {
            if let done = drill.done, done(run) { beat += 1 }
            tailInput(inp, run, drill, run.tick - built.startTick, tail)
            try stepRun(run, inp)
        }
        let card = scoreRun(run.t), result = drillResult(drill, run, card), own = drillCoach(drill, run)
        if run.tick != v["ticks"] as! Int { bad.append("ticks: JS \(v["ticks"]!) Swift \(run.tick)") }
        if stateOf(run).map(hex64) != v["state"] as! [String] { bad.append("the state where it ended") }
        bad += compare(flatRows(v["telemetry"]), run.t.flat(), "telemetry")
        bad += compare(flatRows(v["card"]), card.flat, "card")
        let lg = v["log"] as! [String: Any], log = run.inputLog
        if log.count != lg["entries"] as! Int || logHash(log) != lg["hash"] as! String { bad.append("the log: \(log.count) entries, JS \(lg)") }

        let r = v["result"] as! [String: Any], stats = r["stats"] as! [[Any]]
        if result.pass != r["pass"] as! Bool || result.headline != r["headline"] as! String { bad.append("result: JS \(r) Swift \(result)") }
        if result.stats.map(\.text) != stats.map({ $0[0] as! String }) || result.stats.map(\.flagged) != stats.map({ $0[1] as! Bool }) { bad.append("stats: JS \(stats) Swift \(result.stats)") }
        if let w = v["own"] as? [[Any]] { bad += itemsDiffer(own ?? [], w, "own") } else if own != nil { bad.append("own coaching where the JS has none") }

        try aftermath(run)
        let a = v["after"] as! [String: Any]
        if run.after!.ticks != a["ticks"] as! Int { bad.append("aftermath ticks: JS \(a["ticks"]!) Swift \(run.after!.ticks)") }
        if stateOf(run).map(hex64) != a["state"] as! [String] { bad.append("the car at rest") }

        let thumb = coachWords(Daily.Pilot(device: .touch, scheme: .thumb, tier: "assist")), classic = coachWords(Daily.Pilot(device: .touch, scheme: .classic, tier: "assist"))
        bad += itemsDiffer(try coach(log, course, card: card, fromTick: built.startTick, say: thumb).items, v["thumb"] as! [[Any]], "thumb")
        bad += itemsDiffer(try coach(log, course, card: card, fromTick: built.startTick, say: classic).items, v["classic"] as! [[Any]], "classic")
        #expect(bad.isEmpty, "\(name): \(bad.prefix(6).joined(separator: "\n"))")
    }

    /// LiveRun on a drill, the app's path, past what the input vectors reach: the carry drill's moment ends a run in the
    /// air, its card and its own coaching decided there, then the aftermath.
    @Test func theCarryDrillEndsAtItsMoment() throws {
        let live = LiveRun(drill: try buildDrill(drillById("carry")!, "show"), tier: .assist, oneThumb: true)
        #expect(live.released && live.releaseTick == live.drillStartTick - 240)
        live.thumb.down()
        while !live.drillMoment { try live.tick() }
        #expect(live.run.phase != .done && live.card == nil && live.drillSnap == nil)
        let log = live.run.inputLog, tick = live.run.tick
        live.endDrillMoment()
        #expect(live.card != nil && live.drillSnap?.coach != nil)
        var r = try live.tick()
        while r != .rest { r = try live.tick() }
        #expect(live.run.inputLog == log, "the aftermath logs nothing")
        #expect(live.run.tick > tick && live.run.car.world.freed)
        let got = try live.coachResult(say: COACH_KEY_WORDS)
        #expect(got.flight == nil && got.items == live.drillSnap!.coach!)
    }
    /// And on a whole drill: the results read the coach over the log, from the hand-over.
    @Test func aDrillsResultsReadTheCoachFromTheHandOver() throws {
        let built = try buildDrill(drillById("land")!, "wall"), start = built.startTick
        let live = LiveRun(drill: built, tier: .assist, oneThumb: true)
        live.thumb.down()
        var r = try live.tick()
        while r != .rest { r = try live.tick() }
        let got = try live.coachResult(say: coachWords(Daily.Pilot()))
        let direct = try coach(live.run.inputLog, "wall", card: live.card, fromTick: start, say: coachWords(Daily.Pilot()))
        #expect(got.flight != nil && got.items == direct.items)
    }
    /// Pricing a miss patches the telemetry for one call: it has to come back as it was.
    @Test func costsLeaveTheTelemetryAlone() throws {
        let run = try simulate(coachLogOf("thumb-show-aim"), "show")
        let before = run.t.flat().map(\.0), bits = run.t.flat().map { "\($0.1)" }
        _ = markCost(run.t); _ = sinkCost(run.t)
        #expect(run.t.flat().map(\.0) == before && run.t.flat().map { "\($0.1)" } == bits)
    }
}
#endif
