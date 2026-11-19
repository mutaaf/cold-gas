// The perf harness (0296, docs/PERF-2026-11-18.md). `-perf <seconds>` measures the real game, UI and all (not the bench's
// tool panel), once `-perf-wait <seconds>` have passed after the first frame, then prints one PERF line and quits:
//   PERF scene=<-perf-scene> look=<look> frames … cpu50/95/99 (the main thread's CPU time in the display link's whole callback: the game's frame, the
//   sim's ticks, the encode) enc50/95 (the renderer's encode alone) main (the main thread's busy ms per frame, SwiftUI's
//   layout and commits included) draws tris passes (per frame, averaged) mem (phys_footprint, MB: average over the window
//   and the process's peak) launch (ms from the process's start to the first frame drawn) gpu (avg; the simulator's says
//   nothing about a phone's).
// scripts/perf.sh runs the matrix (looks × scenes) on the simulator (`make perf`), scripts/device-perf.sh on a phone
// (`make device-bench-all`), and scripts/perf-table.py prints the table from either.
import Foundation
import QuartzCore
import Metal

enum Perf {
    static let seconds: Double? = Launch.value("-perf").flatMap(Double.init)
    static var on: Bool { seconds != nil }
    static let wait = Launch.value("-perf-wait").flatMap(Double.init) ?? 3
    static let scene = Launch.value("-perf-scene") ?? "-"

    /// The app's physical footprint (what jetsam counts) and its peak, in bytes.
    static func footprint() -> (now: UInt64, peak: UInt64) {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) { p in
            p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        guard kr == KERN_SUCCESS else { return (0, 0) }
        return (info.phys_footprint, UInt64(info.ledger_phys_footprint_peak))
    }
    /// Milliseconds since the process started (the kernel's start time), for launch → first frame.
    static func sinceProcessStart() -> Double {
        var kp = kinfo_proc(), size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &kp, &size, nil, 0) == 0 else { return 0 }
        let st = kp.kp_proc.p_un.__p_starttime
        let start = Double(st.tv_sec) + Double(st.tv_usec) / 1e6
        return (Date().timeIntervalSince1970 - start) * 1000
    }
    /// `-perf-cycle N` (scene `cycle`): into Free Drive and back to the title N times, 7 s each, so the title measured after
    /// shows what leaving the drive keeps.
    @MainActor static func cycleDrive(_ n: Int) {
        guard n > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            Game.shared.startDrive()
            DispatchQueue.main.asyncAfter(deadline: .now() + 7) { Game.shared.endDrive(); cycleDrive(n - 1) }
        }
    }
    /// This thread's CPU time (ms): what the main thread spent, not the wall clock a busy machine stretches.
    static func threadMs() -> Double { Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1e6 }
    /// Launch → first frame, set once by the stage view.
    nonisolated(unsafe) static var launchMs = 0.0

    /// The main thread's busy time: a run-loop observer adds each stretch between waking and sleeping (main thread only).
    nonisolated(unsafe) private static var busy = 0.0, wokeAt = 0.0
    nonisolated(unsafe) private static var observer: CFRunLoopObserver?
    static func watchMainThread() {
        guard observer == nil else { return }
        let o = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue, true, 0) { _, act in
            let now = threadMs()   // (thread CPU time: the main thread's own work, SwiftUI's included)
            if act == .afterWaiting { wokeAt = now } else if wokeAt > 0 { busy += now - wokeAt; wokeAt = 0 }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), o, .commonModes)
        observer = o
    }
    static func mainBusyMs() -> Double { busy }
}

/// What the renderer encodes in a frame: draw calls, triangles (instances counted) and passes. Main thread only (the frame is
/// encoded there); `-perf` reads it, nothing else does, and counting is a few adds.
enum RenderStats {
    nonisolated(unsafe) static var draws = 0, tris = 0, passes = 0
    static func reset() { draws = 0; tris = 0; passes = 0 }
    @inline(__always) static func draw(indices: Int, instances: Int = 1) { draws += 1; tris += indices / 3 * instances }
}

extension MTLRenderCommandEncoder {
    /// A counted non-indexed triangle draw from vertex 0.
    @inline(__always) func tris(_ vertexCount: Int, instances: Int = 1) {
        RenderStats.draw(indices: vertexCount, instances: instances)
        if instances == 1 { drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: vertexCount) }
        else { drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: vertexCount, instanceCount: instances) }
    }
}
extension MTLCommandBuffer {
    /// A counted render pass.
    @inline(__always) func pass(_ d: MTLRenderPassDescriptor) -> MTLRenderCommandEncoder? {
        RenderStats.passes += 1
        return makeRenderCommandEncoder(descriptor: d)
    }
}
