// Debug tools the scripts drive by launch argument (docs/NATIVE.md §8):
//   -bench     10 s of the turntable, then one line: BENCH frames, presentation interval avg/p95, hitches,
//              CPU and GPU ms per frame (avg/p95), pipeline compiles after launch. Read with simctl --console.
//   -selftest  the vectors on THIS device (the physical-iPhone leg of 0147): DMath against dmath.json, the
//              engine spike against engine-spike.json. Prints SELFTEST ok|FAIL and marks the readiness file.
import Foundation
import QuartzCore
import ColdGasCore
import ColdGasPhysics

final class Bench {
    private let seconds: Double
    private var t0: CFTimeInterval = 0, last: CFTimeInterval = 0
    private var intervals: [Double] = [], cpu: [Double] = [], gpus: [Double] = []
    private let lock = NSLock()
    init(seconds: Double) { self.seconds = seconds; intervals.reserveCapacity(1400); cpu.reserveCapacity(1400); gpus.reserveCapacity(1400) }
    var done: Bool { t0 > 0 && last - t0 >= seconds }
    func frame(target: CFTimeInterval, cpu c: Double) {
        if t0 == 0 { t0 = target } else { intervals.append((target - last) * 1000) }
        last = target; cpu.append(c)
    }
    func gpu(_ ms: Double) { lock.lock(); gpus.append(ms); lock.unlock() }
    func report(compiles: Int, launchMs: Double, size: CGSize) {
        func p(_ a: [Double], _ q: Double) -> Double { let s = a.sorted(); return s.isEmpty ? 0 : s[min(s.count - 1, Int(Double(s.count) * q))] }
        func avg(_ a: [Double]) -> Double { a.isEmpty ? 0 : a.reduce(0, +) / Double(a.count) }
        lock.lock(); let g = gpus; lock.unlock()
        let cadence = p(intervals, 0.1)
        let hitches = intervals.filter { $0 > cadence * 1.5 }.count
        let line = String(format: "BENCH frames %d interval avg %.2f p95 %.2f ms (cadence %.2f) hitches %d cpu avg %.2f p95 %.2f gpu avg %.2f p95 %.2f compiles-after-launch %d launch-pipelines %.0f ms drawable %dx%d",
                          cpu.count, avg(intervals), p(intervals, 0.95), cadence, hitches, avg(cpu), p(cpu, 0.95), avg(g), p(g, 0.95), compiles, launchMs, Int(size.width), Int(size.height))
        print(line)
        Ready.mark("bench")
    }
}

enum SelfTest {
    static func runInBackground() {
        DispatchQueue.global(qos: .userInitiated).async {
            let r = run()
            print(r.ok ? "SELFTEST ok \(r.detail)" : "SELFTEST FAIL \(r.detail)")
            Ready.mark(r.ok ? "selftest:ok" : "selftest:fail")
        }
    }
    static func run() -> (ok: Bool, detail: String) {
        guard let du = Bundle.main.url(forResource: "dmath", withExtension: "json"),
              let d = try? Data(contentsOf: du), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let fs = j["functions"] as? [[String: Any]] else { return (false, "no dmath.json in the bundle") }
        let fns: [String: ([Double]) -> Double] = [
            "dsin": { DMath.dsin($0[0]) }, "dcos": { DMath.dcos($0[0]) }, "dsin_wide": { DMath.dsin($0[0]) }, "dcos_wide": { DMath.dcos($0[0]) },
            "datan": { DMath.datan($0[0]) }, "datan2": { DMath.datan2($0[0], $0[1]) }, "dacos": { DMath.dacos($0[0]) },
            "dhypot2": { DMath.dhypot($0[0], $0[1]) }, "dhypot3": { DMath.dhypot($0[0], $0[1], $0[2]) },
            "dexp": { DMath.dexp($0[0]) }, "dlog": { DMath.dlog($0[0]) },
        ]
        var cases = 0, misses = 0
        for f in fs {
            guard let name = f["name"] as? String, let n = f["args"] as? Int, let cs = f["cases"] as? [[String]], let fn = fns[name] else { return (false, "unknown set") }
            for c in cs {
                let a = c.prefix(n).map { Double(bitPattern: UInt64($0, radix: 16)!) }
                let want = Double(bitPattern: UInt64(c[n], radix: 16)!), got = fn(a)
                cases += 1
                if !((got.isNaN && want.isNaN) || got.bitPattern == want.bitPattern) { misses += 1 }
            }
        }
        var engine = "engine n/a"
        var engineOK = true
        if let eu = Bundle.main.url(forResource: "engine-spike", withExtension: "json"), let ed = try? Data(contentsOf: eu),
           let ej = try? JSONSerialization.jsonObject(with: ed) as? [String: Any], let steps = ej["steps"] as? [[String: Any]] {
            engine = steps.map { s in
                let n = s["steps"] as? Int ?? 0, r = EngineSpike.run(steps: n), ok = r.hash == (s["hash"] as? String)
                engineOK = engineOK && ok
                return "\(n):\(r.hash)\(ok ? "=" : "≠")\(s["hash"] as? String ?? "?")"
            }.joined(separator: " ")
        }
        return (misses == 0 && engineOK, "dmath \(cases - misses)/\(cases) engine \(engine)")
    }
}
