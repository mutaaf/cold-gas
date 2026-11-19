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
    private var intervals: [Double] = [], cpu: [Double] = [], gpus: [Double] = [], enc: [Double] = []
    /// 0296's counters over the window: draws, triangles and passes a frame, the footprint sampled, the main thread's busy time.
    private var draws = 0, tris = 0, passes = 0, memSum = 0.0, memN = 0, busy0 = 0.0
    private let lock = NSLock()
    init(seconds: Double) {
        self.seconds = seconds
        intervals.reserveCapacity(2400); cpu.reserveCapacity(2400); gpus.reserveCapacity(2400); enc.reserveCapacity(2400)
        busy0 = PerfProbe.mainBusyMs()
    }
    var done: Bool { t0 > 0 && last - t0 >= seconds }
    func frame(target: CFTimeInterval, cpu c: Double, enc e: Double = 0) {
        if t0 == 0 { t0 = target } else { intervals.append((target - last) * 1000) }
        last = target; cpu.append(c); enc.append(e)
        draws += RenderStats.draws; tris += RenderStats.tris; passes += RenderStats.passes
        if cpu.count % 30 == 1 { memSum += Double(PerfProbe.footprint().now); memN += 1 }
    }
    func gpu(_ ms: Double) { lock.lock(); gpus.append(ms); lock.unlock() }
    private func p(_ a: [Double], _ q: Double) -> Double { let s = a.sorted(); return s.isEmpty ? 0 : s[min(s.count - 1, Int(Double(s.count) * q))] }
    private func avg(_ a: [Double]) -> Double { a.isEmpty ? 0 : a.reduce(0, +) / Double(a.count) }
    /// `-perf`'s one line (PerfProbe.swift), key=value, for scripts/perf-table.py.
    func perfLine(look: String, cadence hz: Int, scale: Float, size: CGSize, gpuBytes: Int) -> String {
        lock.lock(); let g = gpus; lock.unlock()
        let n = Double(max(1, cpu.count)), fp = PerfProbe.footprint()
        let mainMs = (PerfProbe.mainBusyMs() - busy0) / n
        return String(format: "PERF scene=%@ look=%@ frames=%d hz=%d interval=%.2f cpu50=%.2f cpu95=%.2f cpu99=%.2f enc50=%.2f enc95=%.2f main=%.2f draws=%.0f tris=%.0f passes=%.1f mem=%.0f peak=%.0f launch=%.0f gpu=%.2f scale=%.2f px=%dx%d metal=%.0f",
                      PerfProbe.scene, look, cpu.count, hz, avg(intervals), p(cpu, 0.5), p(cpu, 0.95), p(cpu, 0.99), p(enc, 0.5), p(enc, 0.95), mainMs,
                      Double(draws) / n, Double(tris) / n, Double(passes) / n, memN > 0 ? memSum / Double(memN) / 1048576 : 0, Double(fp.peak) / 1048576,
                      PerfProbe.launchMs, avg(g), scale, Int(size.width), Int(size.height), Double(gpuBytes) / 1048576)
    }
    func report(compiles: Int, launchMs: Double, size: CGSize) {
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
        // The Swift sim itself (0152): every bundled run vector, flown and scored, against the JS's final state and card.
        var runsOK = 0, runsAll = 0, firstBad = ""
        if let dir = Bundle.main.url(forResource: "runs", withExtension: nil),
           let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
            for f in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where f.pathExtension == "json" {
                runsAll += 1
                if let d = try? Data(contentsOf: f), let r = try? VectorTrace.check(d), r.ok { runsOK += 1 }
                else if firstBad.isEmpty { firstBad = f.deletingPathExtension().lastPathComponent }
            }
        }
        let runs = "runs \(runsOK)/\(runsAll)" + (firstBad.isEmpty ? "" : " (first miss: \(firstBad))")
        return (misses == 0 && engineOK && runsOK == runsAll && runsAll > 0, "dmath \(cases - misses)/\(cases) engine \(engine) \(runs)")
    }
}
