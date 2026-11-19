// What the app does, timed and counted (0300; docs/AUDIT-2026-11-18.md "Instrumented"). Two halves, both light:
//
//   Signs     os_signpost intervals on the Points of Interest lane (Instruments → the os_signpost or Points of Interest
//             instrument, subsystem com.mutaafaziz.coldgas): launch, stage build, run (start → result), replay, roam, free
//             drive, board fetch, board post. Local only: nothing here leaves the phone. A signpost costs well under a µs
//             when Instruments isn't recording.
//   Perf      the session's performance summary and the features it touched (ColdGasClient's Perf, pure and tested): fed
//             once a frame from the display link (no allocation), cut when the app goes to the background (or on the title
//             or the results after ten minutes), and handed to the health queue, which sends it in the existing /obs batch
//             from a quiet screen, never during a countdown, a run or a replay, behind Settings → Privacy (Report.swift).
import Foundation
import os
import UIKit
import ColdGasClient

/// The app's signpost intervals. One open interval per flow at a time; a second `begin` closes the first.
enum Signs {
    enum Flow: String, CaseIterable {
        case launch, stage, run, replay, roam, drive, boardFetch = "board-fetch", boardPost = "board-post"
        var name: StaticString {
            switch self {
            case .launch: "launch"; case .stage: "stage"; case .run: "run"; case .replay: "replay"; case .roam: "roam"
            case .drive: "drive"; case .boardFetch: "board-fetch"; case .boardPost: "board-post"
            }
        }
    }
    static let poster = OSSignposter(subsystem: ReportCenter.subsystem, category: .pointsOfInterest)
    nonisolated(unsafe) private static var open: [Flow: OSSignpostIntervalState] = [:]
    private static let lock = NSLock()

    /// Opens `flow` (closing one already open, so a missed `end` can't leak an interval).
    static func begin(_ flow: Flow, _ detail: String = "") {
        let st = poster.beginInterval(flow.name, id: poster.makeSignpostID(), "\(detail, privacy: .public)")
        lock.lock(); let old = open.updateValue(st, forKey: flow); lock.unlock()
        if let old { poster.endInterval(flow.name, old, "superseded") }
    }
    /// Closes `flow` if it's open (a no-op otherwise: ends can come from several exits).
    static func end(_ flow: Flow, _ detail: String = "") {
        lock.lock(); let st = open.removeValue(forKey: flow); lock.unlock()
        if let st { poster.endInterval(flow.name, st, "\(detail, privacy: .public)") }
    }
    static func isOpen(_ flow: Flow) -> Bool { lock.lock(); defer { lock.unlock() }; return open[flow] != nil }
    /// An interval around async work that may overlap itself (two board fetches): its own id, not the flow's slot.
    static func around<T>(_ flow: Flow, _ detail: String = "", _ work: () async throws -> T) async rethrows -> T {
        let st = poster.beginInterval(flow.name, id: poster.makeSignpostID(), "\(detail, privacy: .public)")
        defer { poster.endInterval(flow.name, st) }
        return try await work()
    }
    /// A moment (a memory warning, a fold, an interruption) on the same lane.
    static func event(_ what: StaticString, _ detail: String = "") { poster.emitEvent(what, "\(detail, privacy: .public)") }
}

/// The session's meter and feature flags, and the cut that hands them to the health queue.
@MainActor
final class PerfCenter {
    static let shared = PerfCenter()
    private(set) var meter = Perf.Meter()
    private(set) var use = Perf.Use()
    private var lastPresent: CFTimeInterval = 0
    private var memEvery = 0
    /// A session that never goes to the background is still summarised every ten minutes, from a quiet screen.
    static let LONG_FRAMES = 120 * 60 * 10
    private let log = Logger(subsystem: ReportCenter.subsystem, category: "perf")

    private init() {
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { PerfCenter.shared.meter.thermal(ProcessInfo.processInfo.thermalState.rawValue) }
        }
        meter.thermal(ProcessInfo.processInfo.thermalState.rawValue)
    }

    /// Once a presented frame (StageView's display link): the interval between presentation times, as FrameStats reads them.
    func frame(present: CFTimeInterval, cadence: Int, scale: Float) {
        let first = lastPresent == 0
        let ms = first ? 0 : (present - lastPresent) * 1000
        lastPresent = present
        if first {
            meter.launch(ms: PerfCenter.sinceProcessStart() * 1000)
            Signs.end(.launch)
            return
        }
        meter.frame(ms: ms, cadence: cadence, scale: Double(scale), look: Look.allCases.firstIndex(of: Look.current) ?? 0)
        memEvery += 1
        if memEvery >= 240 { memEvery = 0; if let b = PerfCenter.footprint() { meter.memory(bytes: b) } }
    }
    /// The display link paused (background): the next interval isn't a frame.
    func paused() { lastPresent = 0 }
    func noteRun() { meter.run() }
    func note(_ f: Perf.Feature) { use.note(f) }

    /// Hand the session to the health queue: on going to the background, or from a quiet screen after a long session.
    func cut(force: Bool) {
        guard force || meter.frames >= PerfCenter.LONG_FRAMES else { return }
        let s = meter.summary(build: ReportCenter.build)
        #if DEBUG
        if s == nil { print("PERF too short to summarise: \(meter.frames) frames") }
        #endif
        if let s {
            log.notice("\(s.message, privacy: .public) frames \(s.frames) p95 \(s.p95, format: .fixed(precision: 1)) ms runs \(s.runs)")
            #if DEBUG
            print("PERF \(s.message) · frames \(s.frames) · p50 \(s.p50) ms p95 \(s.p95) ms · hitches \(s.hitches) · runs \(s.runs)")
            #endif
        }
        if let u = use.message { log.notice("\(u, privacy: .public)") }
        ReportCenter.shared.add(session: Obs.Session(build: ReportCenter.build, perf: s, use: use))
        if s != nil { meter.reset() }
        use = Perf.Use()
    }

    /// The process's age (sysctl's start time for this pid): launch is measured from the kernel's exec, not from main().
    static func sinceProcessStart() -> Double {
        var kinfo = kinfo_proc(), size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &kinfo, &size, nil, 0) == 0 else { return .nan }
        let tv = kinfo.kp_proc.p_un.__p_starttime
        let start = Double(tv.tv_sec) + Double(tv.tv_usec) / 1e6
        return Date().timeIntervalSince1970 - start
    }
    /// The memory iOS counts against the app (phys_footprint, what jetsam reads).
    static func footprint() -> UInt64? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return kr == KERN_SUCCESS ? info.phys_footprint : nil
    }
}
