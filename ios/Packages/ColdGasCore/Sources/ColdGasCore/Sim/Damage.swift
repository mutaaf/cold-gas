// src/sim/damage.js: per-zone damage % from the impact events and the permanent crush.
public let ZONES = ["nose", "tail", "left", "right", "roof", "floor", "susp"]
let HIT_FULL = 14.0, WHEEL_SAFE = 3.0, WHEEL_FULL = 10.0, SCRAPE_PER = 0.6, CRUSH_FULL = 0.35

public final class Damage {
    public var zones = [Double](repeating: 0, count: ZONES.count)
    public var total = 0.0, seen = 0, lastTick: Double = -1, last: Double = -1
    public init() {}
}
/// Which zone a hull probe belongs to (+x is the car's left). `hullX(probe)` is the probe's x, or nil.
@inline(__always) func zoneOf(_ part: UInt8, _ probe: UInt8, _ hullX: (Int) -> Double?) -> Int {
    if part == PART.nose { return 0 }
    if part == PART.tail { return 1 }
    if part == PART.roof { return 4 }
    if part == PART.floor { return 5 }
    if part == PART.wheel { return 6 }
    if let x = hullX(Int(probe)), x > 0 { return 2 }
    return 3
}
/// Fold any new impact events into the damage. Once per tick after vehicle.step.
@discardableResult
public func updateDamage(_ d: Damage, _ m: Impacts, _ hullX: (Int) -> Double?) -> Damage {
    var i = d.seen
    while i < m.count {
        let kind = m.kind[i], z = zoneOf(m.part[i], m.probe[i], hullX), v = Double(m.speed[i])
        var add = 0.0
        if kind == ImpactKind.HIT { add = 100 * (v / HIT_FULL) * (v / HIT_FULL) }
        else if kind == ImpactKind.SCRAPE { add = SCRAPE_PER * (v / 10) }
        else if kind == ImpactKind.WHEEL { let e = jsMax(0, v - WHEEL_SAFE) / (WHEEL_FULL - WHEEL_SAFE); add = 100 * e * e }
        else if kind == ImpactKind.CRUSH { d.zones[z] = jsMax(d.zones[z], (100 * Double(m.crush[i])) / CRUSH_FULL) }
        if add > 0 { d.zones[z] = jsMin(100, d.zones[z] + add); d.lastTick = Double(m.tick[i]); d.last = Double(z) }
        i += 1
    }
    d.seen = m.count
    var worst = 0.0, sum = 0.0
    for k in 0..<d.zones.count { if d.zones[k] > 100 { d.zones[k] = 100 }; worst = jsMax(worst, d.zones[k]); sum += d.zones[k] }
    d.total = jsMin(100, 0.6 * worst + (0.4 * sum) / Double(d.zones.count))
    return d
}
/// damageFacts: rounded, for the scorecard.
public func damageFacts(_ d: Damage) -> (pct: Double, integrity: Double, zones: [(String, Double)]) {
    (jsRound(d.total), jsRound(100 - d.total), ZONES.indices.map { (ZONES[$0], jsRound(d.zones[$0])) })
}
