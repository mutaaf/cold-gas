// 0154: the live input layer flies the JS's touches to the same input log, bit for bit. Each vector in
// Tests/Vectors/input/*.json (`npm run vectors`, scripts/vectors-lib.mjs inputVector) is a scripted finger on the
// page's own controls (src/input.js, src/onethumb.js, through src/main.js liveStep's wallAssist): its per-tick events,
// the input log the run wrote, a state hash every 24 ticks, the telemetry, the card, the pad's sight where the
// careful thumb read it (src/sim/predict.js + markOffset), and the aftermath to rest. LiveRun replays the events and
// must match all of it.
#if canImport(CRapier)
import Foundation
import Testing
@testable import ColdGasPhysics
@testable import ColdGasCore

func inputNames() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: vectorsDir.appendingPathComponent("input").path)) ?? []).filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
}
@inline(__always) func unhex(_ s: Any) -> Double { Double(bitPattern: UInt64(s as! String, radix: 16)!) }

struct InputVector {
    let j: [String: Any]
    let course, scheme, tier, level: String
    let events: [[Any]], sights: [[Any]], log: [[Int]], checks: [(Int, String)]
    let telemetry: [(String, String, Any?)], card: [(String, String, Any?)]
    let predFields: [String]
    init(_ name: String) {
        let d = try! Data(contentsOf: vectorsDir.appendingPathComponent("input/\(name).json"))
        j = try! JSONSerialization.jsonObject(with: d) as! [String: Any]
        course = j["course"] as! String; scheme = j["scheme"] as! String; tier = j["tier"] as! String; level = j["level"] as! String
        events = j["events"] as! [[Any]]; sights = j["sights"] as! [[Any]]
        log = (j["log"] as! [[NSNumber]]).map { $0.map(\.intValue) }
        checks = (j["checks"] as! [[Any]]).map { ($0[0] as! Int, $0[1] as! String) }
        telemetry = (j["telemetry"] as! [[Any]]).map { ($0[0] as! String, $0[1] as! String, $0.count > 2 ? $0[2] : nil) }
        card = (j["card"] as! [[Any]]).map { ($0[0] as! String, $0[1] as! String, $0.count > 2 ? $0[2] : nil) }
        predFields = ["h", "sink", "upY", "aNow", "aEnd", "aMax", "aPlan", "stopDist", "brakeBy", "margin", "marginAhead",
                      "profileSink", "tGround", "tLand", "landX", "landZ", "gas", "gasNeed", "rollOut", "pitchOut", "touchSink", "brakeSink"]
    }
}
func predValues(_ p: Prediction) -> [Double] {
    [p.h, p.sink, p.upY, p.aNow, p.aEnd, p.aMax, p.aPlan, p.stopDist, p.brakeBy, p.margin, p.marginAhead,
     p.profileSink, p.tGround, p.tLand, p.landX, p.landZ, p.gas, p.gasNeed, p.rollOut, p.pitchOut, p.touchSink, p.brakeSink]
}
func button(_ s: Any) -> TouchControls.Button {
    switch s as! String { case "go": return .go; case "brk": return .brk; case "lift": return .lift; default: return .land }
}
/// A finger's event, as the app would deliver it.
func apply(_ e: [Any], _ live: LiveRun) {
    switch e[1] as! String {
    case "down": live.thumb.down()
    case "up": live.thumb.up()
    case "move": live.thumb.move(unhex(e[2]), unhex(e[3]))
    case "stick":
        live.touch.stick(unhex(e[2]), unhex(e[3]))
        // The helper the app gets the knob from (input.js move), within the ring: the same bits.
        let k = TouchControls.stickXY(dx: unhex(e[4]), dy: unhex(e[5]))
        #expect(hex64(k.x) == e[2] as! String && hex64(k.y) == e[3] as! String, "stickXY \(e)")
    case "stickUp": live.touch.stickUp()
    case "press":
        let b = button(e[2])
        live.touch.press(b, amount: unhex(e[3]))
        if b == .go || b == .brk { #expect(hex64(TouchControls.pedalAmount(unhex(e[4]))) == e[3] as! String, "pedalAmount \(e)") }
    case "release": live.touch.release(button(e[2]))
    case "tilt":
        live.sampler.tilt = unhex(e[2])
        #expect(hex64(TouchControls.tiltSteer(roll: unhex(e[3]), zero: 0)) == e[2] as! String, "tiltSteer \(e)")
    case "valves": for k in 0..<10 { live.sampler.nozzleValves[k] = unhex(e[2 + k]) }
    default: Issue.record("unknown event \(e)")
    }
}

@Suite("The Swift input layer logs the JS's touches bit for bit", .serialized)
struct LiveInputTests {
    @Test("input vector", arguments: inputNames())
    func inputVector(_ name: String) throws {
        let v = InputVector(name)
        #expect(v.j["simVersion"] as! Int == SIM_VERSION)
        // A drill vector (0160) starts from the hand-over: buildDrill, then the same fingers.
        let live: LiveRun
        if let d = v.j["drill"] as? String {
            let built = try buildDrill(drillById(d)!, v.course)
            #expect(built.startTick == v.j["drillStartTick"] as! Int)
            live = LiveRun(drill: built, tier: FlyTier(rawValue: v.tier)!, oneThumb: v.scheme == "thumb", level: DriveLevel(rawValue: v.level)!)
        } else { live = LiveRun(course: v.course, tier: FlyTier(rawValue: v.tier)!, oneThumb: v.scheme == "thumb", level: DriveLevel(rawValue: v.level)!) }
        var h: (UInt32, UInt32) = (0x811c9dc5, 0x9747b28c)
        var checks: [Int: String] = [:]
        var ei = 0, si = 0, sightBad: [String] = []
        let pr = Prediction()
        while live.run.phase != .done {
            let t = live.run.tick
            while si < v.sights.count && v.sights[si][0] as! Int == t {
                let s = v.sights[si], c = live.run.car
                predict(c, jsMax(0, c.pos.y - SPEC.comHeight), pr, land: s[1] as! Int == 1)
                let o = markOffset(c, pr, v.course, live.thumb.ref)
                for (k, x) in predValues(pr).enumerated() where hex64(x) != s[2 + k] as! String { sightBad.append("tick \(t) \(v.predFields[k]) JS \(s[2 + k]) Swift \(hex64(x))") }
                let n = 2 + v.predFields.count
                if pr.status != s[n] as! String { sightBad.append("tick \(t) status JS \(s[n]) Swift \(pr.status)") }
                for (k, x) in [o.x, o.y, o.m].enumerated() where hex64(x) != s[n + 1 + k] as! String { sightBad.append("tick \(t) mark[\(k)] JS \(s[n + 1 + k]) Swift \(hex64(x))") }
                si += 1
            }
            while ei < v.events.count && v.events[ei][0] as! Int == t { apply(v.events[ei], live); ei += 1 }
            try live.tick()
            mixState(&h, stateOf(live.run))
            if live.run.tick % 24 == 0 { checks[live.run.tick] = hex32(h.0, h.1) }
        }
        #expect(sightBad.isEmpty, "\(name) sight: \(sightBad.prefix(4).joined(separator: "; "))")
        #expect(ei == v.events.count && si == v.sights.count, "\(name): \(v.events.count - ei) events, \(v.sights.count - si) sights unread")
        // The log first: it is what the Worker re-simulates.
        if live.run.inputLog != v.log {
            let i = zip(live.run.inputLog, v.log).enumerated().first { $0.element.0 != $0.element.1 }?.offset ?? min(live.run.inputLog.count, v.log.count)
            Issue.record("\(name): input log differs at entry \(i) of \(v.log.count) (JS \(i < v.log.count ? v.log[i] : []), Swift \(i < live.run.inputLog.count ? live.run.inputLog[i] : []))")
            return
        }
        if let (tick, want) = v.checks.first(where: { checks[$0.0] != $0.1 }) { Issue.record("\(name): state hash at tick \(tick) JS \(want) Swift \(checks[tick] ?? "none")"); return }
        #expect(live.run.tick == v.j["ticks"] as! Int)
        #expect(hex32(h.0, h.1) == v.j["final"] as! String)
        #expect(live.releaseTick == v.j["releaseTick"] as! Int)
        #expect(live.run.t.endReason == v.j["endReason"] as! String)
        var bad = compare(v.telemetry, live.run.t.flat(), "telemetry")
        bad += compare(v.card, scoreRun(live.run.t).flat, "card")
        if let card = live.card { bad += compare(v.card, card.flat, "live card") } else { bad.append("no live card") }
        #expect(bad.isEmpty, "\(name): \(bad.prefix(6).joined(separator: "; "))")

        // The aftermath: the wreck (or the stalled car) stepped to rest on the same world.
        let a = v.j["after"] as! [String: Any]
        var ah: (UInt32, UInt32) = (0x811c9dc5, 0x9747b28c)
        var r: LiveRun.Tick
        repeat {
            let t0 = live.run.tick
            r = try live.tick()
            if live.run.tick != t0 { mixState(&ah, stateOf(live.run)) }
        } while r != .rest
        let af = live.run.after!
        #expect(af.done)
        #expect(af.startTick == a["startTick"] as! Int && af.ticks == a["ticks"] as! Int && af.still == a["still"] as! Int, "\(name) aftermath: start \(af.startTick) ticks \(af.ticks) still \(af.still), JS \(a)")
        #expect(live.run.tick == a["endTick"] as! Int)
        #expect(hex32(ah.0, ah.1) == a["final"] as! String, "\(name): aftermath hash")
        #expect(stateOf(live.run).map(hex64) == a["state"] as! [String], "\(name): the car at rest")
        #expect(live.run.car.world.freed)
        // The log is untouched by the aftermath, and replays (the server's simulate) to the same card.
        #expect(live.run.inputLog == v.log)
        let replayed = try simulate(live.run.inputLog, v.course)
        #expect(compare(v.card, scoreRun(replayed.t).flat, "replayed card").isEmpty)
    }

    @Test func oneThumbIsOfferedWhereTheWebOffersIt() {
        // main.js syncScheme: the Show and the Wall, on Assist.
        let show = LiveRun(course: "show", tier: .assist, oneThumb: true), wall = LiveRun(course: "wall", tier: .assist, oneThumb: true)
        let line = LiveRun(course: "lineup", tier: .assist, oneThumb: true), pro = LiveRun(course: "show", tier: .pro, oneThumb: true)
        #expect(show.oneThumb && wall.oneThumb && !line.oneThumb && !pro.oneThumb)
        show.oneThumb = false
        #expect(!show.oneThumb)
        for l in [show, wall, line, pro] { l.run.car.world.free() }
    }

    @Test func quantisationIsJSRounding() {
        // qi: Math.round(clamp(v) * 100): halves toward +∞, NaN → 0, clamped to ±1.
        let i = Input(), o = Input()
        for (x, want) in [(0.005, 0.01), (-0.005, 0), (0.125, 0.13), (-0.125, -0.12), (0.994999, 0.99), (2, 1), (-7, -1), (.nan, 0), (0.3, 0.3)] as [(Double, Double)] {
            i.steer = x
            quantise(i, o)
            #expect(o.steer == want, "qi(\(x)) = \(o.steer)")
        }
    }
}
#endif
