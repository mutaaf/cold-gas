// 0252: the stunt's name on a share comes from the card's facts alone. Once the web's 0260 writes its names into the
// vectors (Tests/Vectors/stunt-names.json), they must match.
import XCTest
import Foundation
@testable import ColdGasClient

final class StuntNameTests: XCTestCase {
    func testNames() {
        XCTAssertEqual(StuntName.name(.init(course: "show", rotations: 1.02, crashed: false, crossedRow: true, padMiss: 0.4)), "The Show \u{00B7} 360 \u{00B7} on the mark")
        XCTAssertEqual(StuntName.name(.init(course: "show", rotations: 1.0, crashed: false, crossedRow: true, padMiss: 3.2)), "The Show \u{00B7} 360 \u{00B7} over the row")
        XCTAssertEqual(StuntName.name(.init(course: "wall", rotations: -2.01, crashed: false)), "The Wall \u{00B7} 720")
        XCTAssertEqual(StuntName.name(.init(course: "lineup", rotations: 0.2, crashed: true)), "The Lineup \u{00B7} wrecked")
        XCTAssertEqual(StuntName.name(.init(course: "moon", rotations: 0, crashed: false)), "Cold Gas")
        XCTAssertEqual(StuntName.message(score: 82.44, .init(course: "wall", rotations: 1, crashed: false)), "Beat my 82.4 on The Wall \u{00B7} 360")
        XCTAssertTrue(StuntName.message(score: 12, .init(course: "show", rotations: 0, crashed: true)).hasSuffix("Can you land it?"))
    }

    func testParityWithTheWebsNames() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Vectors/stunt-names.json")
        guard let d = try? Data(contentsOf: url) else { throw XCTSkip("Vectors/stunt-names.json not generated yet (0260)") }
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: d) as? [[String: Any]])
        for r in rows {
            guard let name = r["name"] as? String, let course = r["course"] as? String else { continue }
            let f = StuntName.Facts(course: course, rotations: r["rotations"] as? Double ?? 0, crashed: r["crashed"] as? Bool ?? false,
                                    crossedRow: r["crossedRow"] as? Bool ?? false, padMiss: r["padMiss"] as? Double)
            XCTAssertEqual(StuntName.name(f), name)
        }
    }
}
