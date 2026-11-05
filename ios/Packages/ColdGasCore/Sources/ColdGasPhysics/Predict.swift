// src/sim/predict.js, line for line (0154): what the descent looks like from here. The numbers behind the landing
// HUD, the coach, and the one-thumb pad's sight (markOffset reads `landX`/`landZ`). Read-only on the car; the input
// vectors (Tests/Vectors/input) check every field bit for bit where the JS's careful thumb read it.
// (predict.js's steadyStatus, the HUD's band hysteresis, isn't ported yet.)
#if canImport(CRapier)
import ColdGasCore

public let SINK_SOFT = 1.5, SINK_FIRM = 3.0
public let REACTION = 0.3

public final class Prediction {
    public var h = 0.0, sink = 0.0, upY = 1.0
    public var aNow = 0.0, aEnd = 0.0, aMax = 0.0, aPlan = 0.0
    public var stopDist = 0.0, brakeBy = 0.0, margin = 0.0, marginAhead = 0.0
    public var profileSink = 0.0
    /// "green": on or under the profile · "amber": fast but stoppable · "red": not stoppable.
    public var status = "green"
    public var tGround = Double.infinity, tLand = Double.infinity
    public var landX = 0.0, landZ = 0.0
    public var gas = 0.0, gasNeed = 0.0
    public var rollOut = 0.0, pitchOut = 0.0
    public var touchSink = 0.0, brakeSink = Double.infinity
    public init() {}
}

/// vehicle.js gasToStop: the gas a stop from this sink costs.
@inline(__always) func gasToStop(_ s: Vehicle, _ m: Double, _ vy: Double) -> Double {
    let v = jsMax(0, -vy), a = jsMax(1, brakeAvail(s, m))
    return (m * (v + (G * v) / a)) / (SPEC.ispFull * 0.9 * G)
}

let pUpv = V3(), pWur = V3(), pWub = V3(), pY = V3(0, 1, 0)
let LAND_SHARE = 0.8
let ROLL_N = 10e3, ROLL_T0 = 0.3, ROLL_T1 = 0.2, ROLL_TP = 0.5, ROLL_G = 1.3, ROLL_ROOM = 5.0
let WARN = 0.6

/// `h`: the floor's height above whatever is below. `land`: LAND is flying the descent (Assist, held or auto-land).
@discardableResult
public func predict(_ c: Vehicle, _ h: Double, _ out: Prediction, land: Bool = false) -> Prediction {
    let m = massOf(c)
    M3.rotate(pUpv, c.quat, M3.set(pUpv, 0, 1, 0))
    let vy = c.vel.y, sink = jsMax(0, -vy)
    out.h = h; out.sink = sink; out.upY = pUpv.y
    out.aNow = (LIFT_MAX * feedPressure(c)) / m - G
    let used = gasToStop(c, m, vy)
    out.aEnd = (LIFT_MAX * pressureOf(c.air - used)) / jsMax(1, m - used) - G
    out.aMax = 0.5 * (out.aNow + jsMin(out.aNow, out.aEnd))
    out.aPlan = brakePlan(c, m)
    let tilt = DMath.datan2(DMath.dhypot(pUpv.x, pUpv.z), pUpv.y)
    let tLevel = tilt > 1.05 ? 0.15 + (tilt - 0.7) / 3.5 : 0
    out.stopDist = stopFrom(sink, tLevel, out.aMax)
    out.brakeBy = out.stopDist + sink * REACTION + 1
    out.margin = h - out.brakeBy
    var lift = 0.0
    for i in 0..<NOZZLES.count { lift += NOZZLES[i].max * c.throttles[i] * NOZZLES[i].dir.y }
    let aUp = (lift * feedPressure(c) * pUpv.y) / m - G
    let sinkAhead = jsMax(0, sink - aUp * WARN), hAhead = h - sink * WARN + 0.5 * aUp * WARN * WARN
    out.marginAhead = hAhead - (stopFrom(sinkAhead, tLevel, out.aMax) + sinkAhead * REACTION + 1)
    let levelDrop = sink * tLevel + 0.5 * G * tLevel * tLevel, sinkLevel = sink + G * tLevel
    let top = setdownTop(c)
    out.profileSink = h > top ? maxSink(h - top, tLevel, jsMax(0.6, 0.7 * out.aMax)) : -profileVy(h, out.aPlan, top)
    let v2 = sinkLevel * sinkLevel - 2 * jsMax(0, out.aMax) * jsMax(0, h - levelDrop - 0.3)
    out.touchSink = v2 > 0 ? jsSqrt(v2) : 0
    let liftFlown = land ? jsMax(lift, LIFT_MAX * LAND_SHARE) : lift
    var bs = Double.infinity
    if land && tLevel > 0 && rollsOut(c) {
        let tR = ROLL_T0 + ROLL_T1 * tilt + ROLL_TP * abs(pWur.z), aR = ROLL_G * G
        let burnt = (ROLL_N * tR) / (SPEC.ispFull * G)
        bs = flownSink(c.air - burnt, m - burnt, sink + aR * tR, h - sink * tR - 0.5 * aR * tR * tR - ROLL_ROOM, liftFlown)
    } else if (land || aUp > 0.05) && liftFlown > 0 {
        bs = flownSink(c.air, m, sinkLevel, h - levelDrop - 0.3, liftFlown * jsMax(0, pUpv.y))
    }
    out.brakeSink = bs
    out.status = out.touchSink > SINK_FIRM ? "red"
        : out.brakeSink <= SINK_SOFT && out.touchSink <= SINK_SOFT ? "green"
        : out.marginAhead < 0 || out.touchSink > SINK_SOFT || sink > out.profileSink + 0.5 ? "amber" : "green"
    out.tGround = (vy + jsSqrt(vy * vy + 2 * G * jsMax(0, h))) / G
    out.tLand = profileTime(h, vy, out.aPlan, top)
    out.landX = c.pos.x + c.vel.x * out.tLand
    out.landZ = c.pos.z + c.vel.z * out.tLand
    out.gas = jsMax(0, c.air)
    out.gasNeed = jsMin(CAR.airMass, used + (m * G * 1.0) / (SPEC.ispFull * 0.6 * G))
    M3.rotateInv(pWub, c.quat, pY)
    out.rollOut = -DMath.datan2(pWub.x, pWub.y)
    out.pitchOut = DMath.datan2(pWub.z, pWub.y > 0 ? pWub.y : -pWub.y)
    return out
}

func flownSink(_ air0: Double, _ m0: Double, _ sink: Double, _ room: Double, _ lift: Double) -> Double {
    let dt = 1.0 / 30
    var air = air0, m = m0, v = sink, y = jsMax(0, room)
    var i = 0
    while i < 240 && y > 0 {
        let pr = pressureOf(air), F = air > 0.5 ? lift * pr : 0
        v -= (F / m - G) * dt
        if v <= 0 { return 0 }
        y -= v * dt
        let used = (F / (SPEC.ispFull * (0.7 + 0.3 * pr) * G)) * dt
        air -= used; m -= used
        i += 1
    }
    return jsMax(0, v)
}

func rollsOut(_ c: Vehicle) -> Bool {
    M3.rotateInv(pWur, c.quat, pY)
    return (pWur.y < -0.2 && abs(pWur.z) < 0.7) || (pWur.y < 0.94 && abs(pWur.x) > abs(pWur.z))
}

@inline(__always) func stopFrom(_ sink: Double, _ tLevel: Double, _ a: Double) -> Double {
    let drop = sink * tLevel + 0.5 * G * tLevel * tLevel, v = sink + G * tLevel
    return drop + (v > 0 ? (a > 0.05 ? (v * v) / (2 * a) : .infinity) : 0)
}

func maxSink(_ room: Double, _ tLevel: Double, _ a: Double) -> Double {
    var lo = 0.0, hi = 40.0
    for _ in 0..<18 {
        let v = (lo + hi) / 2
        if stopFrom(v, tLevel, a) + v * REACTION <= room { lo = v } else { hi = v }
    }
    return lo
}

func profileTime(_ h: Double, _ vy: Double, _ aPlan: Double, _ top: Double) -> Double {
    var y = jsMax(0, h), v = vy, t = 0.0
    let dt = 1.0 / 30
    while y > 0.05 && t < 20 {
        let want = profileVy(y, aPlan, top)
        v = v < want ? jsMin(want, v + aPlan * 2 * dt) : v - G * dt
        if v > -0.3 { v = -0.3 }
        y += v * dt; t += dt
    }
    return t
}
#endif
