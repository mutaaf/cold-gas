// 0152: the 240 Hz tick allocates nothing on the Swift side (invariant 5 in docs/NATIVE.md §2). Measured with the malloc
// zone's live block count over 1,800 ticks of the reference Show (after its first 600: the world built, the caches warm).
// The engine's own allocations are inside this count too (Rapier grows a contact cache when a new pair first touches).
// Measured in an optimised build (`make alloc`: swift test -c release): a debug build boxes values the optimiser keeps
// in registers, hundreds of blocks that the app, built -O, never makes. The budget is a few one-off blocks per window
// (measured: 2 blocks, 336 B, over the 960 ticks of free flight), never one per tick.
#if canImport(CRapier) && canImport(Darwin)
import Foundation
import Testing
@testable import ColdGasPhysics
@testable import ColdGasCore

@Suite(.serialized) struct AllocationTests {
    // (from, to, budget in blocks): far fewer than one per tick in either window.
    @Test(arguments: [(2440, 3400, 4), (600, 2400, 8)])
    func theTickAllocatesNothing(_ w: (Int, Int, Int)) throws {
        #if DEBUG
        return   // only meaningful optimised (see above)
        #endif
        let v = RunVector("ref-show")
        var start = malloc_statistics_t(), end = malloc_statistics_t()
        var a = 0, b = 0
        try simulate(v.log, v.course) { r in
            if r.tick == w.0 { malloc_zone_statistics(nil, &start); a = Int(start.blocks_in_use) }
            if r.tick == w.1 { malloc_zone_statistics(nil, &end); b = Int(end.blocks_in_use) }
        }
        #expect(b - a <= w.2, "live blocks grew by \(b - a) over ticks \(w.0)–\(w.1) (\(Double(end.size_in_use) - Double(start.size_in_use)) bytes)")
    }

    // 0154: a live tick (the controls sampled, the fan, the log) adds nothing either, past one array per input-log entry,
    // which is the one thing it is meant to keep (as the JS's logEntry does).
    @Test(arguments: ["thumb-show-aim", "touch-show-assist"])
    func aLiveTickAllocatesNothing(_ name: String) throws {
        #if DEBUG
        return   // only meaningful optimised (see above)
        #endif
        let v = InputVector(name)
        // The touches, parsed before the run so the measured window holds only what the app does per tick.
        let events = Dictionary(grouping: v.events) { $0[0] as! Int }
        let live = LiveRun(course: v.course, tier: FlyTier(rawValue: v.tier)!, oneThumb: v.scheme == "thumb", level: DriveLevel(rawValue: v.level)!)
        var s = malloc_statistics_t(), e = malloc_statistics_t()
        var a = 0, b = 0, logA = 0, logB = 0, evs = 0
        while live.run.phase != .done && live.run.tick < 2400 {
            let t = live.run.tick
            if t == 600 { malloc_zone_statistics(nil, &s); a = Int(s.blocks_in_use); logA = live.run.inputLog.count }
            if let es = events[t] { for x in es { apply(x, live); if t >= 600 { evs += 1 } } }
            try live.tick()
        }
        malloc_zone_statistics(nil, &e); b = Int(e.blocks_in_use); logB = live.run.inputLog.count
        let extra = b - a - (logB - logA)
        #expect(extra <= 8 + evs, "\(name): live blocks grew by \(b - a) over 1,800 live ticks, \(logB - logA) of them log entries, \(evs) touches")
    }
}
#endif
