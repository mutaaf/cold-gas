// The soak (0302; ios/scripts/soak.sh): DEBUG `-soak <minutes>` (with `-autopilot`) loops the app's whole surface for that
// long with no hands: a scored run on each course in turn (the reference flown live), its replay watched back, Home, a roam
// on that course's set, Free Drive, and the next look each time round. Every step prints one line:
//
//   SOAK step 12 cycle 2 roam-wall mem 412 faults 0
//
// (the footprint iOS counts against the app, in MB, and the faults this launch has reported, memory warnings left out), and
// at the end `SOAK done …` and the Ready token `soak-done`. The script reads the lines and fails on memory that keeps
// growing or on any fault. Nothing here is in a Release build.
#if DEBUG
import Foundation
import UIKit

@MainActor
final class Soak {
    static var running: Soak?
    static func startIfAsked() {
        guard let m = Launch.value("-soak").flatMap(Double.init), m > 0 else { return }
        let s = Soak(minutes: m)
        running = s
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { s.timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in MainActor.assumeIsolated { s.tick() } } }
    }

    private enum Phase { case idle, flying(since: Date), watching(until: Date), driving(until: Date), resting(until: Date) }
    private let end: Date
    private var timer: Timer?
    private var phase = Phase.idle
    private var step = 0, cycle = 0, plan = 0
    private var peak = 0, first: Int?
    private static let courses = ["show", "wall", "lineup"]
    private static let DRIVE_S = 15.0, WATCH_S = 4.0, RUN_TIMEOUT_S = 180.0

    init(minutes: Double) { end = Date().addingTimeInterval(minutes * 60) }

    /// The plan, one cycle: run, watch and home on each course, then a roam on one set and Free Drive.
    private var what: String {
        switch plan {
        case 0, 1, 2: return "run-\(Soak.courses[plan])"
        case 3: return "roam-\(Soak.courses[cycle % 3])"
        default: return "drive"
        }
    }

    private func tick() {
        let g = Game.shared, now = Date()
        switch phase {
        case .idle:
            if now >= end { finish(); return }
            guard g.screen == .title else { g.home(); return }
            if plan == 0 { nextLook() }
            switch plan {
            case 0, 1, 2:
                let c = Soak.courses[plan]
                if g.course != c { g.course = c }
                g.play()
                phase = .flying(since: now)
            case 3:
                g.startDrive(roam: Soak.courses[cycle % 3]); phase = .driving(until: now + Soak.DRIVE_S)
            default:
                g.startDrive(); phase = .driving(until: now + Soak.DRIVE_S)
            }
        case .flying(let since):
            if g.screen == .results && !g.encore { g.watch(); phase = .watching(until: now + Soak.WATCH_S) }
            else if g.encore { g.skipEncore() }
            else if now.timeIntervalSince(since) > Soak.RUN_TIMEOUT_S { print("SOAK run timed out"); g.home(); done() }
        case .watching(let until):
            if now >= until { if g.replaying { g.stopWatching() }; g.home(); done() }
        case .driving(let until):
            if now >= until { g.endDrive(); done() }
        case .resting(let until):
            if now >= until { phase = .idle }
        }
    }
    private func done() {
        step += 1
        let mb = Int((Soak.footprint() ?? 0) / 1_048_576)
        if first == nil && step >= 5 { first = mb }   // after the first cycle's stages are built: the baseline
        peak = max(peak, mb)
        print("SOAK step \(step) cycle \(cycle) \(what) mem \(mb) faults \(ReportCenter.shared.faultsSeen.count)")
        plan += 1
        if plan > 4 { plan = 0; cycle += 1 }
        phase = .resting(until: Date() + 1)
    }
    private func nextLook() {
        let l = Look.allCases[cycle % Look.allCases.count]
        Look.set(l)
    }
    private func finish() {
        timer?.invalidate(); timer = nil
        let mb = Int((Soak.footprint() ?? 0) / 1_048_576)
        let f = ReportCenter.shared.faultsSeen
        print("SOAK done cycles \(cycle) steps \(step) mem first \(first ?? mb) last \(mb) peak \(peak) faults \(f.count)\(f.isEmpty ? "" : " · " + f.prefix(6).joined(separator: " | "))")
        Ready.mark("soak-done")
        Soak.running = nil
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
#endif
