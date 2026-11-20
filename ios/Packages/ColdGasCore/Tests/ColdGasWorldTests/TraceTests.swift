// 0331: the ground's memory (ColdGasWorld Trace.swift). Slots are kept per tile until evicted (least recently stroked first),
// a stroke is cut into the tiles it touches with its texel box clipped to each, the shader's table points at the right slots
// relative to the drawing origin, and nothing that isn't a number writes anything.
import Testing
@testable import ColdGasWorld

@Suite("The ground's memory (trace atlas)")
struct TraceTests {
    @Test func aStrokeInsideOneTileIsOneStrokeInItsTexels() {
        let a = TraceAtlas()
        var out: [TraceStroke] = []
        let n = a.stroke(from: (10, 10), to: (11, 10), halfWidth: 0.12, depth: 0.3, berm: 0.1, press: 0, cap: 0.6, tag: 4, into: &out)
        #expect(n == 1 && out.count == 1 && a.used == 1)
        let s = out[0]
        #expect(s.ax == 160 && s.bx == 176 && s.az == 160)   // 16 texels a metre
        #expect(abs(s.halfWidth - 1.92) < 1e-5)
        #expect(s.x0 <= 156 && s.x1 >= 180 && s.z0 <= 156 && s.z1 >= 164 && s.z1 < 180)
        #expect(a.drainFresh() == [s.slot] && a.drainFresh().isEmpty)
    }

    @Test func aStrokeAcrossACornerTouchesEachTileItReaches() {
        let a = TraceAtlas()
        var out: [TraceStroke] = []
        // Across the corner at (16, 16), diagonally: four tiles, each box clipped inside 0..<256.
        let n = a.stroke(from: (15.5, 15.5), to: (16.5, 16.5), halfWidth: 0.12, depth: 0.3, berm: 0, press: 0, cap: 1, tag: 1, into: &out)
        #expect(n == 4 && Set(out.map(\.slot)).count == 4)
        for s in out { #expect(s.x0 >= 0 && s.z0 >= 0 && s.x1 < TraceSpec.res && s.z1 < TraceSpec.res && s.x0 <= s.x1 && s.z0 <= s.z1) }
        // Negative coordinates: the tile is floor(x / 16).
        #expect(TraceAtlas.tile(-0.01, -16) == (-1, -1) && TraceAtlas.tile(15.99, 16) == (0, 1))
    }

    @Test func aTraceLastsUntilItsTileIsEvictedLeastRecentFirst() {
        let a = TraceAtlas()
        var out: [TraceStroke] = []
        for i in 0..<TraceSpec.slots { a.stroke(from: (Double(i) * 32 + 5, 5), to: (Double(i) * 32 + 6, 5), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out) }
        #expect(a.used == TraceSpec.slots)
        // Tile 0 is stroked again: it's now the most recent. A new tile takes tile 1's slot, not tile 0's.
        let s0 = a.slot(of: 0, 0), s1 = a.slot(of: 2, 0)   // (x = 32 i + 5: tile 2 i)
        a.stroke(from: (5, 6), to: (6, 6), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out)
        _ = a.drainFresh()
        a.stroke(from: (5, 1000), to: (6, 1000), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out)
        let far = TraceAtlas.tile(5, 1000)
        #expect(a.slot(of: 0, 0) == s0 && a.slot(of: 2, 0) == nil && a.slot(of: far.0, far.1) == s1)
        #expect(a.drainFresh() == [s1!])   // the evicted slot is cleared before it's written
        #expect(a.used == TraceSpec.slots)
    }

    @Test func theTableFindsEachSlotRelativeToTheOrigin() {
        let a = TraceAtlas()
        var out: [TraceStroke] = []
        // A trace 5 km out, the drawing origin at (5120, 0) (whole kilometres).
        a.stroke(from: (5130, 40), to: (5131, 40), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out)
        var t: [UInt16] = []
        let base = a.table(centerX: 5135, z: 45, origin: (5120, 0), into: &t)
        #expect(t.count == TraceSpec.window * TraceSpec.window)
        // The trace's tile (320, 2) is (0, 2) from the origin's tile (320, 0); the window's corner is half a window left and down.
        let W = TraceSpec.window
        #expect(base == (-W / 2, 2 - W / 2))
        let u = 0 - base.0, v = 2 - base.1
        #expect(t[v * TraceSpec.window + u] == UInt16(out[0].slot + 1))
        #expect(t.filter { $0 != 0 }.count == 1)
        // A window elsewhere sees none of it.
        _ = a.table(centerX: 0, z: 0, origin: (0, 0), into: &t)
        #expect(t.allSatisfy { $0 == 0 })
    }

    @Test func nonNumbersAndJumpsWriteNothing() {
        let a = TraceAtlas()
        var out: [TraceStroke] = []
        #expect(a.stroke(from: (.nan, 0), to: (1, 1), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out) == 0)
        #expect(a.stroke(from: (0, 0), to: (1, .infinity), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out) == 0)
        #expect(a.stroke(from: (0, 0), to: (1, 1), halfWidth: .nan, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out) == 0)
        #expect(a.stroke(from: (0, 0), to: (100, 0), halfWidth: 0.1, depth: 0.1, berm: 0, press: 0, cap: 1, tag: 0, into: &out) == 0)
        #expect(out.isEmpty && a.used == 0)
        var t: [UInt16] = []
        #expect(a.table(centerX: .nan, z: 0, origin: (0, 0), into: &t) == (0, 0) && t.allSatisfy { $0 == 0 })
    }
}
