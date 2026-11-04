// The run vectors' trace (scripts/vectors-lib.mjs), for the app's -selftest on a device, and HapticScore's feed from the
// Swift sim (0149 + 0152: the haptics read the native physics, not a recording).
#if canImport(CRapier)
import Foundation
import ColdGasCore

public enum VectorTrace {
    /// scripts/vectors-lib.mjs stateOf.
    public static func state(_ run: Run) -> [Double] {
        let c = run.car, w = c.wheels
        return [c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.vel.x, c.vel.y, c.vel.z,
                c.angVel.x, c.angVel.y, c.angVel.z, c.angMom.x, c.angMom.y, c.angMom.z, c.air,
                Double(run.phase.rawValue), w[0].contact ? 1 : 0, w[1].contact ? 1 : 0, w[2].contact ? 1 : 0, w[3].contact ? 1 : 0]
    }
    /// mixState: two 32-bit lanes over each double's big-endian words (NaN canonical).
    public static func mix(_ h: inout (UInt32, UInt32), _ vals: [Double]) {
        var (a, b) = h
        for v in vals {
            let bits = v.isNaN ? 0x7ff8000000000000 : v.bitPattern
            for wd in [UInt32(truncatingIfNeeded: bits >> 32), UInt32(truncatingIfNeeded: bits)] {
                a = (a ^ wd) &* 16777619
                b = (b ^ wd) &* 0x5bd1e995; b = b ^ (b >> 15)
            }
        }
        h = (a, b)
    }
    public static func hex(_ h: (UInt32, UInt32)) -> String {
        func p(_ v: UInt32) -> String { let s = String(v, radix: 16); return String(repeating: "0", count: 8 - s.count) + s }
        return p(h.0) + p(h.1)
    }
    /// Replays a run vector file: (matches, final hash, the vector's final hash, the Swift card's total, the vector's total).
    public static func check(_ data: Data) throws -> (ok: Bool, final: String, want: String, total: Double, wantTotal: Double) {
        guard let j = try JSONSerialization.jsonObject(with: data) as? [String: Any], let course = j["course"] as? String,
              let log = j["log"] as? [[NSNumber]], let want = j["final"] as? String, let card = j["card"] as? [[Any]] else {
            throw SimUnsupported(description: "not a run vector")
        }
        var h: (UInt32, UInt32) = (0x811c9dc5, 0x9747b28c)
        let run = try simulate(log.map { $0.map(\.intValue) }, course) { r in mix(&h, state(r)) }
        let total = scoreRun(run.t).total
        let wantTotalHex = card.first { ($0.first as? String) == "total" }?[2] as? String ?? "0"
        let wantTotal = Double(bitPattern: UInt64(wantTotalHex, radix: 16) ?? 0)
        let final = hex(h)
        return (final == want && total.bitPattern == wantTotal.bitPattern, final, want, total, wantTotal)
    }
}

extension HapticFeed {
    /// The feed HapticScore reads, from the Swift sim's run as it stands after a tick (vectors-lib.mjs hapticFeed).
    /// `seen`: how many impact events were read already (advanced past this tick's).
    public init(run: Run, input: Input, seen: inout Int) {
        let c = run.car, w = c.wheels
        var flow = 0.0
        for v in c.throttles { flow += v }
        var contacts: UInt8 = 0, load = 0.0
        for i in 0..<4 { if w[i].contact { contacts |= UInt8(1 << i) }; load += w[i].load }
        let w0 = w[0].load
        self.init(phase: UInt8(run.phase.rawValue), speed: DMath.dhypot(c.vel.x, c.vel.y, c.vel.z), vy: c.vel.y, onWall: c.onWall,
                  contacts: contacts, load: jsOr(load / jsOr(4 * w0, 1), 0), flow: flow, gas: jsMax(0, c.air) / CAR.airMass, lift: input.lift > 0)
        let im = c.impacts
        while seen < im.count && Int(im.tick[seen]) <= run.tick { addImpact(kind: im.kind[seen], speed: Double(im.speed[seen])); seen += 1 }
    }
}

/// simulate() with the haptic feed recorded every tick (the app's -haptics demo, flown by the Swift sim).
public func simulateWithFeed(_ log: [[Int]], _ course: String) throws -> (run: Run, feed: [HapticFeed]) {
    var feed: [HapticFeed] = []
    feed.reserveCapacity(log.last.map { $0[0] + 2000 } ?? 4000)
    var seen = 0
    let inp = Input()
    var li = 0
    let run = createRun(course)
    while run.phase != .done && run.tick < MAX_TICKS {
        while li < log.count && log[li][0] <= run.tick { unpack(log[li], inp); li += 1 }
        try advance(run, inp)
        feed.append(HapticFeed(run: run, input: inp, seen: &seen))
    }
    if run.phase != .done { finish(run, "timeout") }
    return (run, feed)
}
#endif
