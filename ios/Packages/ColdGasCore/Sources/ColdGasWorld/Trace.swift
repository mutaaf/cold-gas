// THE GROUND'S MEMORY (0331, docs/NATIVE-MATTER.md §2): where the tyres have been, kept per tile of land. Pure: which
// slot of the GPU's trace texture a tile lives in, which tiles a wheel's stroke touches and where in each, and the small
// table the terrain's shader reads to find a tile's slot. The app (World/TraceField.swift) owns the texture and writes the
// strokes with a compute pass; the terrain shader (World/Trace.h) reads it.
//   - A tile is 16 m of land, 256 × 256 texels (6.25 cm: a 245 mm tyre is four texels across), one layer of a 2D array texture (RGBA8: rut depth, berm,
//     pressed, matter tag). Slots are given out on a tile's first stroke and kept until another tile needs the slot
//     (the least recently stroked goes first): a trace survives until its tile is evicted, whatever the car does.
//   - Positions are world metres (Double). The table is a window of 32 × 32 tiles (512 m) round the camera, each entry its tile's
//     slot + 1 (0: no trace there), with the window's corner as a tile index relative to the drawing origin (whole
//     kilometres, so a multiple of the tile), so the shader works in render space with small numbers.
// Allocation-free after init; nothing here runs unless a wheel strokes soft ground.
import Foundation

public enum TraceSpec {
    /// A tile's side (m), its texels across, slots in the atlas, the table's window (tiles across).
    public static let tile = 16.0, res = 256, slots = 48, window = 32
    public static var texel: Double { tile / Double(res) }
    /// The channels' full scale (m): depth (R), berm (G).
    public static let depthScale = 0.16, bermScale = 0.04
    /// Bytes on the GPU: slots × res² × 4 (RGBA8): 12 MB, ≈ 750 m of a single track kept.
    public static var bytes: Int { slots * res * res * 4 }
}

/// One stroke clipped to one tile: the slot, the segment's ends in that tile's texels, and the texel box it can touch.
public struct TraceStroke: Equatable, Sendable {
    public var slot: Int
    public var ax, az, bx, bz: Float      // texels, in the tile's own frame (can lie outside it: the box is clipped)
    public var halfWidth: Float           // texels
    public var x0, z0, x1, z1: Int        // the box, inclusive, inside 0..<res
    public var depth, berm, press: Float  // what one pass adds (channel units, 0…1)
    public var cap: Float                 // the deepest the rut gets here (channel units)
    public var tag: UInt8
}

public final class TraceAtlas {
    public struct Slot: Equatable, Sendable { public var tx: Int, tz: Int, used: Int }
    public private(set) var slots: [Slot?] = Array(repeating: nil, count: TraceSpec.slots)
    private var index: [Int64: Int] = [:]
    /// Slots that were (re)assigned and must be cleared before their first stroke (the app's clear pass drains it).
    public private(set) var fresh: [Int] = []
    private var clock = 0
    public init() { index.reserveCapacity(TraceSpec.slots * 2) }

    @inline(__always) static func key(_ i: Int, _ j: Int) -> Int64 { (Int64(Int32(truncatingIfNeeded: i)) << 32) | Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j))) }
    public static func tile(_ x: Double, _ z: Double) -> (Int, Int) {
        (Int((x / TraceSpec.tile).rounded(.down)), Int((z / TraceSpec.tile).rounded(.down)))
    }
    /// Live slots (the HUD, tests).
    public var used: Int { slots.reduce(0) { $0 + ($1 == nil ? 0 : 1) } }
    public func slot(of tx: Int, _ tz: Int) -> Int? { index[TraceAtlas.key(tx, tz)] }

    /// The tile's slot, given out now if it has none (taking the least recently stroked one's when all are in use).
    public func acquire(_ tx: Int, _ tz: Int) -> Int {
        clock += 1
        let k = TraceAtlas.key(tx, tz)
        if let s = index[k] { slots[s]?.used = clock; return s }
        var pick = 0, oldest = Int.max
        for (i, s) in slots.enumerated() {
            guard let s else { pick = i; oldest = Int.min; break }
            if s.used < oldest { oldest = s.used; pick = i }
        }
        if let old = slots[pick] { index[TraceAtlas.key(old.tx, old.tz)] = nil }
        slots[pick] = Slot(tx: tx, tz: tz, used: clock)
        index[k] = pick
        fresh.append(pick)
        return pick
    }
    public func drainFresh() -> [Int] { defer { fresh.removeAll(keepingCapacity: true) }; return fresh }
    /// Every trace gone (a new drive).
    public func clear() { for i in slots.indices { slots[i] = nil }; index.removeAll(keepingCapacity: true); fresh.removeAll(keepingCapacity: true) }

    /// A wheel's stroke from `a` to `b` (world metres, x z), its contact patch `halfWidth` m across, into `out` as one
    /// stroke per tile it touches (at most four: a stroke is short). Returns how many were written. Non-numbers and a
    /// stroke longer than a tile (a reset's jump) write nothing.
    @discardableResult
    public func stroke(from a: (Double, Double), to b: (Double, Double), halfWidth hw: Double, depth: Double, berm: Double, press: Double,
                       cap: Double, tag: UInt8, into out: inout [TraceStroke]) -> Int {
        guard a.0.isFinite, a.1.isFinite, b.0.isFinite, b.1.isFinite, hw.isFinite, hw > 0, depth.isFinite, berm.isFinite, press.isFinite, cap.isFinite else { return 0 }
        let dx = b.0 - a.0, dz = b.1 - a.1
        if dx * dx + dz * dz > TraceSpec.tile * TraceSpec.tile { return 0 }
        // The reach of a stroke: the patch plus the berm beside it (1.8 × the half width).
        let r = hw * 1.8 + TraceSpec.texel
        let (t0x, t0z) = TraceAtlas.tile(min(a.0, b.0) - r, min(a.1, b.1) - r)
        let (t1x, t1z) = TraceAtlas.tile(max(a.0, b.0) + r, max(a.1, b.1) + r)
        var n = 0
        let T = TraceSpec.tile, px = Double(TraceSpec.res) / T, last = TraceSpec.res - 1
        for tz in t0z...t1z { for tx in t0x...t1x {
            let ox = Double(tx) * T, oz = Double(tz) * T
            let ax = (a.0 - ox) * px, az = (a.1 - oz) * px, bx = (b.0 - ox) * px, bz = (b.1 - oz) * px, rr = r * px
            let x0 = max(0, Int((min(ax, bx) - rr).rounded(.down))), x1 = min(last, Int((max(ax, bx) + rr).rounded(.up)))
            let z0 = max(0, Int((min(az, bz) - rr).rounded(.down))), z1 = min(last, Int((max(az, bz) + rr).rounded(.up)))
            if x0 > x1 || z0 > z1 { continue }
            let s = acquire(tx, tz)
            out.append(TraceStroke(slot: s, ax: Float(ax), az: Float(az), bx: Float(bx), bz: Float(bz), halfWidth: Float(hw * px),
                                   x0: x0, z0: z0, x1: x1, z1: z1, depth: Float(depth), berm: Float(berm), press: Float(press), cap: Float(cap), tag: tag))
            n += 1
        } }
        return n
    }

    /// The shader's table: the window's corner (tile index relative to `origin`'s tile) and each entry's slot + 1, for a
    /// window centred on (cx, cz) world metres. `origin` must be a multiple of the tile (the drive's is whole kilometres).
    public func table(centerX cx: Double, z cz: Double, origin: (Double, Double), into t: inout [UInt16]) -> (Int, Int) {
        let W = TraceSpec.window
        if t.count != W * W { t = Array(repeating: 0, count: W * W) }
        for i in t.indices { t[i] = 0 }
        guard cx.isFinite, cz.isFinite, origin.0.isFinite, origin.1.isFinite else { return (0, 0) }
        let (ctx, ctz) = TraceAtlas.tile(cx, cz)
        let bx = ctx - W / 2, bz = ctz - W / 2
        for (i, s) in slots.enumerated() {
            guard let s else { continue }
            let u = s.tx - bx, v = s.tz - bz
            if u >= 0 && u < W && v >= 0 && v < W { t[v * W + u] = UInt16(i + 1) }
        }
        let (otx, otz) = TraceAtlas.tile(origin.0, origin.1)
        return (bx - otx, bz - otz)
    }
}
