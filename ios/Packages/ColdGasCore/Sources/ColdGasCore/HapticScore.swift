// What the run feels like in the hand (docs/NATIVE.md §6, 0149). Pure and allocation-free: it reads the sim's
// state once a tick (a `HapticFeed`), keeps three continuous channels (the rumble of the tyres, the hiss of the
// jets, the grind of a slide), and writes transient events into a fixed ring the player drains each frame.
// It never writes the sim; a replay fed the same ticks feels the same.
//
// The moments (§6's table): rolling rumble (speed, surface, load in the climb) · the release · the ten jets' hiss
// (flow × the nitrogen left: it softens as the tanks blow down) · apex (the rumble is gone: weightlessness is
// felt as silence, plus one feather tick) · ONE TRANSIENT PER WHEEL at the tick that wheel touches, scaled by the
// sink (a synced landing is one thump, a sloppy one four) · hits and crushes from the impact events, a slide's
// grind · the settle ("stuck it") when a clean landing decides the run.

public struct HapticFeed: Sendable {
    public var phase: UInt8          // 0 drive, 1 ramp, 2 air, 3 landed, 4 done (run.js PHASES)
    public var speed: Double         // m/s
    public var vy: Double            // m/s, up +
    public var onWall: Bool          // on the Wall's steel deck (sharper rumble)
    public var contacts: UInt8       // wheel i on the ground = bit i
    public var load: Double          // total tyre load ÷ static (≈1 parked, >1 in the curl)
    public var flow: Double          // Σ of the ten valve throttles (0…10)
    public var gas: Double           // nitrogen left, 0…1
    public var lift: Bool            // the player's LIFT/RELEASE input this tick
    public var impactCount: Int      // impact events this tick (up to 4 read)
    public var impactKind: (UInt8, UInt8, UInt8, UInt8)
    public var impactSpeed: (Double, Double, Double, Double)
    public init(phase: UInt8 = 0, speed: Double = 0, vy: Double = 0, onWall: Bool = false, contacts: UInt8 = 15, load: Double = 1,
                flow: Double = 0, gas: Double = 1, lift: Bool = false) {
        self.phase = phase; self.speed = speed; self.vy = vy; self.onWall = onWall; self.contacts = contacts; self.load = load
        self.flow = flow; self.gas = gas; self.lift = lift
        impactCount = 0; impactKind = (0, 0, 0, 0); impactSpeed = (0, 0, 0, 0)
    }
    public mutating func addImpact(kind: UInt8, speed: Double) {
        switch impactCount {
        case 0: impactKind.0 = kind; impactSpeed.0 = speed
        case 1: impactKind.1 = kind; impactSpeed.1 = speed
        case 2: impactKind.2 = kind; impactSpeed.2 = speed
        case 3: impactKind.3 = kind; impactSpeed.3 = speed
        default: return
        }
        impactCount += 1
    }
    func impact(_ i: Int) -> (UInt8, Double) {
        switch i { case 0: (impactKind.0, impactSpeed.0); case 1: (impactKind.1, impactSpeed.1); case 2: (impactKind.2, impactSpeed.2); default: (impactKind.3, impactSpeed.3) }
    }
}

public enum HapticKind: UInt8, Sendable { case release, apex, wheel, hit, crush, settle, detent, tap }

public struct HapticEvent: Sendable, Equatable {
    public var kind: HapticKind
    public var tick: Int32
    public var channel: UInt8        // wheels 0–3, impacts 4, moments 5
    public var intensity: Float      // 0…1
    public var sharpness: Float      // 0…1
    public init(kind: HapticKind, tick: Int32, channel: UInt8, intensity: Float, sharpness: Float) {
        self.kind = kind; self.tick = tick; self.channel = channel; self.intensity = intensity; self.sharpness = sharpness
    }
}

/// The continuous channels, 0…1, as of the last tick.
public struct HapticContinuous: Sendable, Equatable {
    public var rumble: Float = 0, rumbleSharp: Float = 0.25
    public var hiss: Float = 0, hissSharp: Float = 0.6
    public var grind: Float = 0
    public init(rumble: Float = 0, rumbleSharp: Float = 0.25, hiss: Float = 0, hissSharp: Float = 0.6, grind: Float = 0) {
        self.rumble = rumble; self.rumbleSharp = rumbleSharp; self.hiss = hiss; self.hissSharp = hissSharp; self.grind = grind
    }
}

public struct HapticScore {
    public static let ringCapacity = 64
    /// The actuator renders at most one transient per 10 ms per channel: 3 ticks at 240 Hz.
    public static let minGapTicks: Int32 = 3
    static let IMPACT_HIT: UInt8 = 0, IMPACT_SCRAPE: UInt8 = 1, IMPACT_WHEEL: UInt8 = 2, IMPACT_CRUSH: UInt8 = 3

    public private(set) var continuous = HapticContinuous()
    private var ring: [HapticEvent]
    private var head = 0, count = 0
    private var lastOnChannel: (Int32, Int32, Int32, Int32, Int32, Int32) = (-99, -99, -99, -99, -99, -99)
    private var tick: Int32 = -1
    private var prevContacts: UInt8 = 15, prevVy = 0.0, prevPhase: UInt8 = 0
    private var released = false, airborne = false, landedAt: Int32 = -1, settled = false, struck = false, grindUntil: Int32 = -1, grindLevel: Float = 0
    private let course: String

    public init(course: String) {
        self.course = course
        ring = [HapticEvent](repeating: HapticEvent(kind: .tap, tick: 0, channel: 5, intensity: 0, sharpness: 0), count: HapticScore.ringCapacity)
    }

    /// One sim tick.
    public mutating func step(_ f: HapticFeed) {
        tick &+= 1
        let t = tick
        // Rumble: tyres on the ground, by speed; sharper on the deck steel; heavier in the curl's load.
        let onGround = f.contacts != 0
        if onGround && f.phase != 4 {
            let s = Float(min(1, f.speed / 30)), l = Float(min(1, max(0, (f.load - 1) / 2)))
            continuous.rumble = min(1, 0.12 + 0.5 * s + 0.3 * l)
            continuous.rumbleSharp = f.onWall ? 0.5 : 0.25
        } else {
            continuous.rumble = 0
        }
        if f.phase == 4 { continuous.rumble = 0 }
        // Hiss: the jets' total flow; sharpness falls with the pressure (the tanks blowing down).
        continuous.hiss = Float(min(1, f.flow / 4))
        continuous.hissSharp = Float(0.2 + 0.6 * max(0, min(1, f.gas)))
        // The release: LIFT on the ramp, or the first tick in the air (the web's noteRelease); never on the Lineup.
        if !released && course != "lineup" && ((f.phase == 1 && f.lift) || f.phase == 2) {
            released = true
            emit(.release, t, channel: 5, intensity: 0.9, sharpness: 0.8)
        }
        if f.contacts == 0 { airborne = true }
        // Apex: vertical speed crossing zero in the air.
        if f.phase == 2 && prevVy > 0 && f.vy <= 0 { emit(.apex, t, channel: 5, intensity: 0.15, sharpness: 0.1) }
        // Touchdown: one transient per wheel at the tick it touches, scaled by the sink.
        if airborne {
            let rising = f.contacts & ~prevContacts
            if rising != 0 {
                let sink = max(0, -f.vy)
                let k = Float(min(1, max(0.25, sink / 4)))
                for i in 0..<4 where rising & (1 << i) != 0 { emit(.wheel, t, channel: UInt8(i), intensity: k, sharpness: 0.35 + 0.4 * k) }
                if f.contacts == 15 { airborne = false; landedAt = t }
            }
        }
        // Impacts: hits and crushes are transients; a scrape feeds the grind for a quarter second.
        for i in 0..<min(4, f.impactCount) {
            let (kind, speed) = f.impact(i)
            switch kind {
            case HapticScore.IMPACT_HIT: struck = true; emit(.hit, t, channel: 4, intensity: Float(min(1, max(0.3, speed / 8))), sharpness: 0.75)
            case HapticScore.IMPACT_CRUSH: struck = true; emit(.crush, t, channel: 4, intensity: 1, sharpness: 0.4)
            case HapticScore.IMPACT_SCRAPE: grindUntil = t + 60; grindLevel = max(grindLevel, Float(min(1, speed / 10)))
            default: break   // WHEEL slams are the touchdown's own transients
            }
        }
        if t < grindUntil { continuous.grind = grindLevel } else { continuous.grind = 0; grindLevel = 0 }
        // The settle ("stuck it"): the run decided after a clean landing on four wheels. The scored run ends while
        // the car still rolls (the browser's aftermath brakes it to rest, unscored), so it's felt at the decision.
        if !settled && landedAt >= 0 && !struck && f.phase == 4 && prevPhase != 4 && f.contacts == 15 {
            settled = true
            emit(.settle, t, channel: 5, intensity: 0.3, sharpness: 0.2)
        }
        prevContacts = f.contacts; prevVy = f.vy; prevPhase = f.phase
    }

    /// A moment from outside the sim: a hinge detent, a UI tap.
    public mutating func moment(_ kind: HapticKind, intensity: Float, sharpness: Float) {
        emit(kind, max(0, tick), channel: 5, intensity: intensity, sharpness: sharpness, force: true)
    }

    /// Hands the pending events to `body` in order and empties the ring.
    public mutating func drain(_ body: (HapticEvent) -> Void) {
        var i = (head - count + HapticScore.ringCapacity) % HapticScore.ringCapacity
        for _ in 0..<count { body(ring[i]); i = (i + 1) % HapticScore.ringCapacity }
        count = 0
    }

    private mutating func emit(_ kind: HapticKind, _ t: Int32, channel: UInt8, intensity: Float, sharpness: Float, force: Bool = false) {
        let last = lastTick(channel)
        if !force && t - last < HapticScore.minGapTicks { return }
        setLast(channel, t)
        ring[head] = HapticEvent(kind: kind, tick: t, channel: channel, intensity: intensity, sharpness: sharpness)
        head = (head + 1) % HapticScore.ringCapacity
        count = min(count + 1, HapticScore.ringCapacity)
    }
    private func lastTick(_ c: UInt8) -> Int32 {
        switch c { case 0: lastOnChannel.0; case 1: lastOnChannel.1; case 2: lastOnChannel.2; case 3: lastOnChannel.3; case 4: lastOnChannel.4; default: lastOnChannel.5 }
    }
    private mutating func setLast(_ c: UInt8, _ t: Int32) {
        switch c { case 0: lastOnChannel.0 = t; case 1: lastOnChannel.1 = t; case 2: lastOnChannel.2 = t; case 3: lastOnChannel.3 = t; case 4: lastOnChannel.4 = t; default: lastOnChannel.5 = t }
    }
}

extension HapticFeed {
    /// One row of a Tests/Vectors/haptics/*.json feed (scripts/vectors-lib.mjs hapticFeed).
    public init(row: [Double]) {
        self.init(phase: UInt8(row[0]), speed: row[1], vy: row[2], onWall: row[3] != 0, contacts: UInt8(row[4]), load: row[5],
                  flow: row[6], gas: row[7], lift: row[8] != 0)
        var i = 9
        while i < row.count { addImpact(kind: UInt8(row[i]), speed: row[i + 1]); i += 2 }
    }
}

import Foundation

extension HapticFeed {
    /// A whole feed file: rows of [9 numbers, [kind, speed]…].
    public static func load(_ data: Data) -> (course: String, ticks: [HapticFeed])? {
        guard let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let course = j["course"] as? String, let rows = j["ticks"] as? [[Any]] else { return nil }
        let ticks = rows.map { r -> HapticFeed in
            var flat: [Double] = []
            for v in r {
                if let n = v as? NSNumber { flat.append(n.doubleValue) }
                else if let pair = v as? [NSNumber] { flat.append(contentsOf: pair.map(\.doubleValue)) }
            }
            return HapticFeed(row: flat)
        }
        return (course, ticks)
    }
}
