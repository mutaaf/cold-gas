// What the classic deck's fan shows at each moment (0210): the web's rule, src/main.js syncTouchPhase and the slots in
// src/styles.css (A under the thumb, B and C either side). Pure; DeckButtonsTests pins it.

public enum DeckKey: String, Sendable { case go, brake, lift, land }
/// main.js's `tp`: landed (or done), air (flying, or let go of the Wall), ramp, ground.
public enum TouchPhase: Int, Sendable { case ground, ramp, air, landed }

public struct DeckButton: Equatable, Sendable {
    public var key: DeckKey, label: String, amber: Bool
    public init(_ key: DeckKey, _ label: String, amber: Bool = false) { self.key = key; self.label = label; self.amber = amber }
}

extension Deck {
    /// Slots A, B, C for this moment (nil: the slot is empty). Only what the moment uses:
    ///   ground / ramp  A GO, B BRAKE; C LIFT on the Lineup's run-up, RELEASE (amber) once on the Wall's ledge;
    ///   air            A LAND on Assist, LIFT on Pro and Advanced; B LIFT on Assist's Lineup; C BOOST until the row is behind;
    ///   landed         A BRAKE.
    public static func buttons(_ tp: TouchPhase, assist: Bool, course: String, ledge: Bool, rowDone: Bool) -> [DeckButton?] {
        let free = course == "lineup" || course == "drive" || course.hasPrefix("drive-")
        switch tp {
        case .ground:
            return [DeckButton(.go, "GO"), DeckButton(.brake, "BRAKE"), free ? DeckButton(.lift, "LIFT") : nil]
        case .ramp:
            return [DeckButton(.go, "GO"), DeckButton(.brake, "BRAKE"), ledge ? DeckButton(.lift, "RELEASE", amber: true) : nil]
        case .air:
            return [assist ? DeckButton(.land, "LAND") : DeckButton(.lift, "LIFT"),
                    assist && free ? DeckButton(.lift, "LIFT") : nil,
                    rowDone ? nil : DeckButton(.go, "BOOST")]
        case .landed:
            return [DeckButton(.brake, "BRAKE"), nil, nil]
        }
    }

    /// The stick's word, or nil when it's put away (landed: the car brakes, nothing to steer).
    public static func stickLabel(_ tp: TouchPhase) -> String? { tp == .landed ? nil : tp == .air ? "ROLL · PITCH" : "STEER" }

    /// The control the cue line names, for the ghost ring: the first of the deck's words in it ("go", "brake", "lift",
    /// "land" or "stick").
    public static func hint(cue: String) -> String? {
        var best: (key: String, at: String.Index)?
        for (w, k) in [("RELEASE", "lift"), ("LIFT", "lift"), ("LAND", "land"), ("BOOST", "go"), ("GO", "go"), ("Stick", "stick")] {
            guard let r = cue.range(of: w) else { continue }
            if let b = best, b.at <= r.lowerBound { continue }
            best = (k, r.lowerBound)
        }
        return best?.key
    }

    /// The flight's phase as the tabletop and iPad strip names it: DRIVE · CLIMB · HANG · AIR · LAND (the Lineup has no
    /// Wall: DRIVE · AIR · LAND).
    public static func stripNames(course: String) -> [String] {
        course == "lineup" ? ["DRIVE", "AIR", "LAND"] : ["DRIVE", "CLIMB", "HANG", "AIR", "LAND"]
    }
    public static func stripIndex(_ tp: TouchPhase, course: String, ledge: Bool) -> Int {
        let wall = course != "lineup"
        switch tp {
        case .ground: return 0
        case .ramp: return ledge ? 2 : 1
        case .air: return wall ? 3 : 1
        case .landed: return wall ? 4 : 2
        }
    }
}
