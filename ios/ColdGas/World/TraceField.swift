// The ground's memory on the GPU (0331, docs/NATIVE-MATTER.md §2): one 2D array texture, a layer per 16 m tile a tyre has
// pressed (ColdGasWorld TraceAtlas gives the layers out and takes the least recently pressed back), written by a compute pass
// of one small dispatch per stroke (World/Trace.metal) and read by the terrain (World/Trace.h) through a 32 × 32 table of
// the tiles round the camera.
//   Cost: 12 MB of texture, made once. A frame with no stroke encodes nothing and binds the same table; a frame with strokes
//   encodes ≤ 8 dispatches over a few hundred texels each (os_signpost "matter-trace"). The table is rebuilt only when a slot
//   changes or the camera crosses a tile.
//   Hook (LANDSCAPE's per-tile trace slot): `texture`, `table` and `slot(ofTile:)` are what another reader needs; the
//   grass and the near-field mesh can sample the same layers.
import Foundation
import Metal
import os
import simd
import ColdGasWorld
import ColdGasPhysics

final class TraceField {
    /// What the terrain's fragment reads (World/Trace.h WTrace), field for field.
    struct TableU {
        var head = SIMD4<Int32>(0, 0, 0, Int32(TraceSpec.window))
        var scale = SIMD4<Float>(Float(TraceSpec.tile), Float(TraceSpec.depthScale), Float(TraceSpec.bermScale), Float(TraceSpec.res))
        var table = [UInt16](repeating: 0, count: TraceSpec.window * TraceSpec.window)
    }
    /// World/Trace.metal TraceStamp.
    private struct StampU { var a: SIMD2<Float>; var b: SIMD2<Float>; var hw, depth, berm, press, cap: Float; var slot, tag: UInt32; var lo, hi: SIMD2<Int32> }

    let atlas = TraceAtlas()
    let texture: MTLTexture
    private let stampPipe, clearPipe: MTLComputePipelineState
    private var pending: [TraceStroke] = []
    private var tableBytes: [UInt8]
    private var u = TableU()
    private var tableAt = (Int.min, Int.min), tableDirty = true
    /// Strokes and dispatches this session (the stats line, the bench).
    private(set) var strokes = 0, dispatches = 0

    init?(device: MTLDevice) {
        // Read-write RGBA8 in a kernel needs tier 2 (every A13+ phone, Apple silicon Macs); without it there's no trace.
        guard device.readWriteTextureSupport == .tier2, let lib = device.makeDefaultLibrary(),
              let sf = lib.makeFunction(name: "cg_trace_stamp"), let cf = lib.makeFunction(name: "cg_trace_clear"),
              let sp = try? device.makeComputePipelineState(function: sf), let cp = try? device.makeComputePipelineState(function: cf) else { return nil }
        let d = MTLTextureDescriptor()
        d.textureType = .type2DArray; d.pixelFormat = .rgba8Unorm
        d.width = TraceSpec.res; d.height = TraceSpec.res; d.arrayLength = TraceSpec.slots
        d.usage = [.shaderRead, .shaderWrite]; d.storageMode = .private
        guard let t = device.makeTexture(descriptor: d) else { return nil }
        t.label = "trace"
        texture = t; stampPipe = sp; clearPipe = cp
        tableBytes = [UInt8](repeating: 0, count: TraceField.tableSize)
        pending.reserveCapacity(64)
    }
    static let tableSize = 32 + TraceSpec.window * TraceSpec.window * 2

    /// A wheel's stroke (world metres) on ground of `matter`, queued for the next encode.
    func stroke(from a: SIMD2<Double>, to b: SIMD2<Double>, halfWidth: Double, depth: Double, berm: Double, press: Double, cap: Double, matter: GroundMatter) {
        if pending.count > 48 { return }   // a frame's worth is ≤ 8; a stall (no draw) doesn't pile up
        if atlas.stroke(from: (a.x, a.y), to: (b.x, b.y), halfWidth: halfWidth, depth: depth, berm: berm, press: press, cap: cap, tag: matter.tag, into: &pending) > 0 {
            strokes += 1; tableDirty = true
        }
    }
    var live: Int { atlas.used }
    var busy: Bool { !pending.isEmpty || !atlas.fresh.isEmpty }

    /// The frame's strokes into the texture (before the main pass reads it). Nothing encoded when there are none.
    func encode(_ cmd: MTLCommandBuffer) {
        let fresh = atlas.drainFresh()
        if pending.isEmpty && fresh.isEmpty { return }
        let n = pending.count
        let st = Signs.poster.beginInterval("matter-trace", "\(n) strokes")
        defer { Signs.poster.endInterval("matter-trace", st) }
        guard let e = cmd.makeComputeCommandEncoder() else { pending.removeAll(keepingCapacity: true); return }
        e.label = "trace"
        e.setTexture(texture, index: 0)
        let tg = MTLSize(width: 8, height: 8, depth: 1)
        if !fresh.isEmpty {
            e.setComputePipelineState(clearPipe)
            for s in fresh {
                var slot = UInt32(s)
                e.setBytes(&slot, length: 4, index: 0)
                e.dispatchThreads(MTLSize(width: TraceSpec.res, height: TraceSpec.res, depth: 1), threadsPerThreadgroup: tg)
                dispatches += 1
            }
        }
        if !pending.isEmpty {
            e.setComputePipelineState(stampPipe)
            for s in pending {
                var p = StampU(a: SIMD2(s.ax, s.az), b: SIMD2(s.bx, s.bz), hw: s.halfWidth, depth: s.depth, berm: s.berm, press: s.press, cap: s.cap,
                               slot: UInt32(s.slot), tag: UInt32(s.tag), lo: SIMD2(Int32(s.x0), Int32(s.z0)), hi: SIMD2(Int32(s.x1), Int32(s.z1)))
                e.setBytes(&p, length: MemoryLayout<StampU>.stride, index: 0)
                e.dispatchThreads(MTLSize(width: s.x1 - s.x0 + 1, height: s.z1 - s.z0 + 1, depth: 1), threadsPerThreadgroup: tg)
                dispatches += 1
            }
            pending.removeAll(keepingCapacity: true)
        }
        e.endEncoding()
    }

    /// The terrain's bindings: the texture and the table round the camera (rebuilt only when it changed).
    func bind(_ e: MTLRenderCommandEncoder, eye: SIMD3<Double>, origin: SIMD3<Double>) {
        let tile = TraceAtlas.tile(eye.x, eye.z)
        if tableDirty || tile != tableAt {
            tableDirty = false; tableAt = tile
            let base = atlas.table(centerX: eye.x, z: eye.z, origin: (origin.x, origin.z), into: &u.table)
            u.head = SIMD4(Int32(base.0), Int32(base.1), Int32(u.table.contains { $0 != 0 } ? atlas.used : 0), Int32(TraceSpec.window))
            tableBytes.withUnsafeMutableBytes { raw in
                raw.storeBytes(of: u.head, toByteOffset: 0, as: SIMD4<Int32>.self)
                raw.storeBytes(of: u.scale, toByteOffset: 16, as: SIMD4<Float>.self)
                u.table.withUnsafeBytes { t in raw.baseAddress!.advanced(by: 32).copyMemory(from: t.baseAddress!, byteCount: t.count) }
            }
        }
        tableBytes.withUnsafeBytes { e.setFragmentBytes($0.baseAddress!, length: TraceField.tableSize, index: 6) }
        e.setFragmentTexture(texture, index: 6)
    }
    /// The drive's origin moved: the table is relative to it.
    func originMoved() { tableDirty = true }
    func clear() { atlas.clear(); pending.removeAll(keepingCapacity: true); tableDirty = true }
}
