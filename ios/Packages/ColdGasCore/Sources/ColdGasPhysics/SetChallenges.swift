// Roam's small challenges on a set (0274): unscored things to try between scored runs, read from the drive's car as it
// moves. No score, no board, no streak, no timer; each is done once it happens and stays done on this device, with the
// best number kept beside it. Pure: the app feeds it the car's state once a frame and shows what it says.
import ColdGasCore

public enum SetChallengeKind: String, CaseIterable, Sendable {
    /// Leave the curl's deck at its lip, airborne (the Show's and the Wall's): the best speed off it.
    case lip
    /// Fly the parked row end to end without touching down (the Show's and the Lineup's): the best clearance over it.
    case row
    /// Touch down within 2 m of the pad's centre after at least 0.6 s in the air: the best distance.
    case mark
    /// Knock six of the set's tyres off their stacks (or shove them a metre): the most at once.
    case tyres
    /// The Lineup's coned lane end to end, inside it, touching no cone, out at 30 mph or more: the best exit speed.
    case lane
}

public struct SetChallengeState: Codable, Equatable, Sendable {
    public var done = false
    /// The best number so far (m/s for lip and lane, metres for row and mark, a count for tyres), or nil.
    public var best: Double?
    public init(done: Bool = false, best: Double? = nil) { self.done = done; self.best = best }
}

/// One thing that just happened, for the app's line and its haptic.
public struct SetChallengeEvent: Equatable, Sendable {
    public let kind: SetChallengeKind
    /// Done for the first time (else a new best on one already done).
    public let first: Bool
    public let value: Double
}

public final class SetChallenges {
    public let stage: String
    public let kinds: [SetChallengeKind]
    public private(set) var states: [SetChallengeKind: SetChallengeState] = [:]
    /// The lip's speed threshold is none: leaving it is the thing. The lane wants 30 mph (13.41 m/s) at its exit.
    public static let laneExit = 13.41, markRadius = 2.0, tyresNeeded = 6, minAir = 0.6

    // Where the set's things are (the course's own numbers).
    private let pad: (x: Double, z: Double)?
    private let row: (z0: Double, z1: Double, halfX: Double, top: Double)?
    // What the car's been doing.
    private var air = false, airT = 0.0, airMinZ = 0.0, airMaxZ = 0.0, airInRow = true, airTop = -1e9, lastY = 0.0
    private var onDeck = false
    private var lane: (inside: Bool, clean: Bool) = (false, true)

    public init(stage: String, saved: [SetChallengeKind: SetChallengeState] = [:]) {
        self.stage = stage
        let course = COURSES[stage] ?? SHOW
        pad = course.pad.map { ($0.x, $0.z) }
        let boxes = course.boxes
        if let lo = boxes.map({ $0.minZ }).min(), let hi = boxes.map({ $0.maxZ }).max() {
            row = (lo, hi, (boxes.map { $0.maxX }.max() ?? 3) + 0.3, boxes.map { $0.maxY }.max() ?? 2)
        } else { row = nil }
        switch stage {
        case "lineup": kinds = [.row, .mark, .lane, .tyres]
        case "wall": kinds = [.lip, .mark, .tyres]
        default: kinds = [.lip, .row, .mark, .tyres]
        }
        for k in kinds { states[k] = saved[k] ?? SetChallengeState() }
    }

    /// Once a frame: where the car is (world metres), its speed, whether it's off the ground (no wheel and no hull touching),
    /// how many of the set's tyres are down, and whether any cone of the lane has moved. Returns what just happened.
    public func update(dt: Double, x: Double, y: Double, z: Double, speed: Double, airborne: Bool, tyresDown: Int, conesMoved: Bool) -> [SetChallengeEvent] {
        var out: [SetChallengeEvent] = []
        func record(_ k: SetChallengeKind, _ v: Double, better: (Double, Double) -> Bool) {
            guard var s = states[k] else { return }
            let first = !s.done
            if first || s.best.map({ better(v, $0) }) ?? true {
                s.done = true; s.best = v; states[k] = s
                out.append(SetChallengeEvent(kind: k, first: first, value: v))
            }
        }
        // The curl's deck: on it above 2.5 m near the curl's line; leaving it into the air near its lip.
        if kinds.contains(.lip) {
            let nearCurl = abs(x) < WALL.width / 2 + 0.6 && z > -4 && z < 16
            if !airborne { onDeck = nearCurl && y > 2.5 }
            else if onDeck {
                onDeck = false
                if y > WALL.lipY - 2.5 { record(.lip, speed, better: >) }
            }
        }
        if airborne {
            if !air { air = true; airT = 0; airMinZ = z; airMaxZ = z; airInRow = true; airTop = -1e9 }
            airT += dt
            airMinZ = Swift.min(airMinZ, z); airMaxZ = Swift.max(airMaxZ, z)
            if let r = row, z >= r.z0 && z <= r.z1 {
                if abs(x) > r.halfX + 1.5 { airInRow = false }
                airTop = Swift.max(airTop, y)
            }
        } else if air {
            air = false
            // The row: crossed end to end in one flight, over it (not beside it).
            if let r = row, airInRow, airMinZ <= r.z0, airMaxZ >= r.z1, airTop > -1e8 {
                record(.row, Swift.max(0, airTop - SPEC.comHeight - r.top), better: >)
            }
            if let p = pad, airT >= SetChallenges.minAir {
                let d = ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)).squareRoot()
                if d <= SetChallenges.markRadius { record(.mark, d, better: <) }
            }
        }
        lastY = y
        if kinds.contains(.tyres), tyresDown >= SetChallenges.tyresNeeded { record(.tyres, Double(tyresDown), better: >) }
        // The Lineup's lane: cones at x ±3.6 from z −64 to −4.
        if kinds.contains(.lane) {
            let inLane = abs(x) < 3.3 && !airborne
            if z < -64 { lane = (inLane, !conesMoved) }
            else if lane.inside {
                if !inLane || conesMoved { lane.clean = false }
                if z > -4 {
                    if lane.clean && speed >= SetChallenges.laneExit { record(.lane, speed, better: >) }
                    lane.inside = false
                }
            }
        }
        return out
    }

    /// How many are done.
    public var doneCount: Int { kinds.filter { states[$0]?.done == true }.count }
}
