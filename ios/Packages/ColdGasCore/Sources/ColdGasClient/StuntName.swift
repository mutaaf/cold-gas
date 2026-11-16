// The stunt's name on a share (0252, after the web's 0260 rules): the course, then what was flown, from the score card's
// facts only. "The Show · 360 · on the mark", "The Wall · 720", "The Lineup · wrecked". Pure.
import Foundation

public enum StuntName {
    public static let COURSE_NAMES = ["show": "The Show", "wall": "The Wall", "lineup": "The Lineup"]
    /// Within this many metres of the mark is "on the mark" (the Show's pad).
    public static let ON_MARK_M = 1.0

    public struct Facts: Equatable {
        public var course: String, rotations: Double, crashed: Bool, crossedRow: Bool, padMiss: Double?
        public init(course: String, rotations: Double, crashed: Bool, crossedRow: Bool = false, padMiss: Double? = nil) {
            self.course = course; self.rotations = rotations; self.crashed = crashed; self.crossedRow = crossedRow; self.padMiss = padMiss
        }
    }

    public static func parts(_ f: Facts) -> [String] {
        var out = [COURSE_NAMES[f.course] ?? "Cold Gas"]
        let turns = abs(f.rotations)
        if turns >= 1.9 { out.append("720") } else if turns >= 0.9 { out.append("360") }
        if f.crashed { out.append("wrecked"); return out }
        if f.course == "show" && f.crossedRow {
            if let m = f.padMiss, m.isFinite, m <= ON_MARK_M { out.append("on the mark") } else { out.append("over the row") }
        }
        return out
    }
    public static func name(_ f: Facts) -> String { parts(f).joined(separator: " \u{00B7} ") }
    /// The one line a share sends with the picture and the link.
    public static func message(score: Double, _ f: Facts) -> String {
        f.crashed ? String(format: "%.1f on %@. Can you land it?", score, name(f))
                  : String(format: "Beat my %.1f on %@", score, name(f))
    }
}
