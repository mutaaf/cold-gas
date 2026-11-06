// The run's telemetry as JSON, for the board and the judges (0154): the same keys, order and numbers as JSON.stringify of
// the web's `run.t` (src/sim/run.js newTelemetry, then `mass` when the book closes), so Infinity (minClearance with no
// roof under the car) goes as null. Pinned against the JS for every run vector by TelemetryJSONTests. And the sim's card as
// the Worker's card shape, for the code ported from the web (the local lines, the Daily).
#if canImport(CRapier)
import ColdGasCore
import ColdGasClient

extension Telemetry {
    public var json: JSValue {
        var kv: [(String, JSValue)] = []
        func n(_ k: String, _ v: Double) { kv.append((k, .number(v))) }
        func b(_ k: String, _ v: Bool) { kv.append((k, .bool(v))) }
        kv.append(("course", .string(course))); b("crossedRow", crossedRow); b("deckScrape", deckScrape)
        n("launchSpeed", launchSpeed); n("launchTick", launchTick); n("airStartTick", airStartTick); n("touchTick", touchTick); n("endTick", endTick)
        n("apex", apex); n("apexZ", apexZ); n("rollAccum", rollAccum); n("pitchAccum", pitchAccum); n("yawAccum", yawAccum); n("offAxis", offAxis)
        n("minClearance", minClearance); b("contact", contact); n("contactSpeed", contactSpeed); n("contactTick", contactTick)
        n("airAtLaunch", airAtLaunch); n("airAtTouch", airAtTouch); n("airEnd", airEnd)
        n("sink", sink); n("tiltDeg", tiltDeg); n("headingDeg", headingDeg); n("lateral", lateral); n("landZ", landZ); n("landSpeed", landSpeed)
        kv.append(("wheelTouch", .array(wheelTouch.map { .number($0) }))); n("wheelSpreadMs", wheelSpreadMs); n("maxCompression", maxCompression); b("bottomOut", bottomOut)
        b("bodyStrike", bodyStrike); b("flipped", flipped); b("settledUpright", settledUpright); n("maxSpeed", maxSpeed)
        n("thrustChanges", thrustChanges); kv.append(("endReason", .string(endReason)))
        b("usedAssist", usedAssist); b("usedPro", usedPro); b("usedManual", usedManual); kv.append(("tier", .string(tier)))
        kv.append(("zeroToSixty", zeroToSixty.map { .number($0) } ?? .null))
        n("rampEntrySpeed", rampEntrySpeed); n("rampTick", rampTick); n("maxRampHeight", maxRampHeight); n("progress", progress); n("invertedTime", invertedTime); n("maxG", maxG)
        n("brakePeakG", brakePeakG); n("brakePeakH", brakePeakH)
        n("launchHeight", launchHeight); n("launchUpY", launchUpY); n("launchProgress", launchProgress); b("fellOff", fellOff); b("landedOnRamp", landedOnRamp)
        if let d = damage {
            let zones: [(String, JSValue)] = d.zones.map { ($0.0, .number($0.1)) }
            kv.append(("damage", .object([("pct", .number(d.pct)), ("integrity", .number(d.integrity)), ("zones", .object(zones))])))
        } else { kv.append(("damage", .null)) }
        if let m = mass { n("mass", m) }
        return .object(kv)
    }
}

extension Telemetry.Value {
    var js: JSValue {
        switch self {
        case let .n(x): return .number(x)
        case let .b(x): return .bool(x)
        case let .s(x): return .string(x)
        case .z: return .null
        }
    }
}

extension Card {
    /// This card in the Worker's JSON shape.
    public var scoreCard: ScoreCard? { ScoreCard(flat: flat.map { ($0.0, $0.1.js) }) }
}
#endif
