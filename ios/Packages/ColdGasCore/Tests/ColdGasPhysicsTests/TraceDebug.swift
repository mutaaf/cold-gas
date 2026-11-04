// Debug aid (runs only with CG_TRACE="<run> <from> <to>"): the per-tick state, as scripts/_trace.mjs prints it.
#if canImport(CRapier)
import Foundation
import Testing
@testable import ColdGasPhysics
@testable import ColdGasCore

@Suite(.serialized) struct TraceDebug {
    @Test func trace() throws {
        guard let spec = ProcessInfo.processInfo.environment["CG_TRACE"] else { return }
        let p = spec.split(separator: " ").map(String.init), a = Int(p[1])!, b = Int(p[2])!
        let v = RunVector(p[0])
        var out = ""
        let hx: (Float) -> String = { let s = String($0.bitPattern, radix: 16); return String(repeating: "0", count: 8 - s.count) + s }
        engineTrace = { t, what, vals in if t >= a && t <= b { out += "\(t) \(what) \(vals.map(hx).joined(separator: " "))\n" } }
        defer { engineTrace = nil }
        _ = try? simulate(v.log, v.course) { r in
            guard r.tick >= a && r.tick <= b else { return }
            let c = r.car
            let vals = [c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y, c.vel.z, c.angVel.x, c.angVel.y, c.angVel.z, c.air].map(hex64).joined(separator: " ")
            out += "\(r.tick) \(vals) g\(c.grounded) touch\(c.world.carTouching) held\(c.engineHeld ? 1 : 0) hc\(c.hullContact ? 1 : 0) curl\(c.world.curlOn ? 1 : 0) thr\n"
        }
        try out.write(toFile: ProcessInfo.processInfo.environment["CG_TRACE_OUT"] ?? "/tmp/swift-trace.txt", atomically: true, encoding: .utf8)
    }
}
#endif
