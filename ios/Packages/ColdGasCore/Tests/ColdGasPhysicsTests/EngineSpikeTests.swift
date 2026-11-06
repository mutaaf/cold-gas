// 0147: native Rapier (ios/Vendor/Rapier through CRapier) gives the WASM build's bits on the engine spike.
// The reference hashes are in Tests/Vectors/engine-spike.json (from the JS, `npm run vectors`); they are
// read from the source tree because this target has no resources of its own.
#if canImport(CRapier)
import Foundation
import Testing
@testable import ColdGasPhysics

@Suite("Native Rapier is bit-exact with the web's WASM build")
struct EngineSpikeTests {
    static let reference: [[String: Any]] = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Vectors/engine-spike.json")
        if let data = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return j["steps"] as! [[String: Any]]
        }
        // On a device the source tree isn't there: the values engine-spike.json held when this was written.
        return [["steps": 240, "hash": "ce2812cc", "car": "0.4260,0.9346,-8.1230"], ["steps": 2400, "hash": "0ddfc5d3", "car": "7.5795,0.9346,20.6098"]]
    }()

    @Test("the spike's hash at 240 and 2400 steps", arguments: [0, 1])
    func spike(_ i: Int) {
        let ref = Self.reference[i]
        let r = EngineSpike.run(steps: ref["steps"] as! Int)
        #expect(r.hash == ref["hash"] as! String)
        #expect(r.car == ref["car"] as! String)
    }
}
#endif
