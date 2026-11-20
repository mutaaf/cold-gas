// The ground's memory on the GPU (0331, docs/NATIVE-MATTER.md §2): one 2D array texture, a layer per 16 m tile a tyre has
// pressed (ColdGasWorld TraceAtlas gives the layers out and takes the least recently pressed back), written by a compute pass
// of one small quad per stroke (World/Trace.metal) and read by the terrain (World/WorldMatter.h matter_ground, 0310 §9.5) through a 32 × 32 table of
// the tiles round the camera.
//   Cost: 12 MB of texture, made once. A frame with no stroke encodes nothing and binds the same table; a frame with strokes
//   encodes a pass per layer touched (one or two), a quad of a few hundred texels per stroke (os_signpost "matter-trace"). The table is rebuilt only when a slot
//   changes or the camera crosses a tile.
//   On 0310's contract (§9.4) it is the drive's MatterLayer: strokes encoded in the world's compute (the layer's `encode`),
//   the atlas bound for WorldMatter.h's `matter_ground` (`bindGround`, fragment buffer and texture 9).
import Foundation
import Metal
import os
import simd
import ColdGasWorld
import ColdGasPhysics

final class TraceField {
    /// What the terrain's fragment reads (World/WorldMatter.h WTrace), field for field.
    struct TableU {
        var head = SIMD4<Int32>(0, 0, 0, Int32(TraceSpec.window))
        var scale = SIMD4<Float>(Float(TraceSpec.tile), Float(TraceSpec.depthScale), Float(TraceSpec.bermScale), Float(TraceSpec.res))
        var table = [UInt16](repeating: 0, count: TraceSpec.window * TraceSpec.window)
    }
    /// World/Trace.metal TraceStamp.
    private struct StampU { var a: SIMD2<Float>; var b: SIMD2<Float>; var hw, depth, berm, press, cap: Float; var slot, tag: UInt32; var lo, hi: SIMD2<Int32> }

    let atlas = TraceAtlas()
    let texture: MTLTexture
    private let stampPipe: MTLRenderPipelineState
    /// The texel read in place (a phone) or a max blend (the simulator).
    private(set) var inPlace = true
    private var touched = [Bool](repeating: false, count: TraceSpec.slots), clearNow = [Bool](repeating: false, count: TraceSpec.slots)
    private var pending: [TraceStroke] = []
    private var tableBytes: [UInt8]
    private var u = TableU()
    private var tableAt = (Int.min, Int.min), tableDirty = true
    /// Strokes and dispatches this session (the stats line, the bench).
    private(set) var strokes = 0, dispatches = 0

    init?(device: MTLDevice) {
        // A render pass per touched layer, each texel's value read in place (programmable blending: every Apple GPU in a phone;
        // no read-write texture tier needed). The simulator's GPU can't read a render target: a max blend there instead.
        guard let lib = device.makeDefaultLibrary(), let vf = lib.makeFunction(name: "cg_trace_vertex"), let ff = lib.makeFunction(name: "cg_trace_fragment") else { return nil }
        let pd = MTLRenderPipelineDescriptor()
        pd.vertexFunction = vf; pd.fragmentFunction = ff
        pd.colorAttachments[0].pixelFormat = .rgba8Unorm
        pd.label = "trace"
        var made = try? device.makeRenderPipelineState(descriptor: pd)
        if made == nil, let mf = lib.makeFunction(name: "cg_trace_fragment_max"), let c = pd.colorAttachments[0] {
            pd.fragmentFunction = mf
            c.isBlendingEnabled = true; c.rgbBlendOperation = .max; c.alphaBlendOperation = .max
            c.sourceRGBBlendFactor = .one; c.destinationRGBBlendFactor = .one; c.sourceAlphaBlendFactor = .one; c.destinationAlphaBlendFactor = .one
            made = try? device.makeRenderPipelineState(descriptor: pd)
            inPlace = false
        }
        guard let sp = made else { Report.error(.world, .error, "the trace pipeline couldn't be built"); return nil }
        let d = MTLTextureDescriptor()
        d.textureType = .type2DArray; d.pixelFormat = .rgba8Unorm
        d.width = TraceSpec.res; d.height = TraceSpec.res; d.arrayLength = TraceSpec.slots
        d.usage = [.shaderRead, .renderTarget]; d.storageMode = .private
        guard let t = device.makeTexture(descriptor: d) else { return nil }
        t.label = "trace"
        texture = t; stampPipe = sp
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

    /// The frame's strokes into the texture (before the main pass reads it): one small render pass per layer touched (a fresh
    /// layer cleared by its pass's load action), one quad per stroke. Nothing encoded when there are none.
    func encode(_ cmd: MTLCommandBuffer) {
        let fresh = atlas.drainFresh()
        if pending.isEmpty && fresh.isEmpty { return }
        let n = pending.count
        let st = Signs.poster.beginInterval("matter-trace", "\(n) strokes")
        defer { Signs.poster.endInterval("matter-trace", st) }
        for i in touched.indices { touched[i] = false; clearNow[i] = false }
        for f in fresh { touched[f] = true; clearNow[f] = true }
        for s in pending { touched[s.slot] = true }
        var res = Float(TraceSpec.res)
        for slot in touched.indices where touched[slot] {
            let rp = MTLRenderPassDescriptor()
            rp.colorAttachments[0].texture = texture; rp.colorAttachments[0].slice = slot
            rp.colorAttachments[0].loadAction = clearNow[slot] ? .clear : .load
            rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
            rp.colorAttachments[0].storeAction = .store
            guard let e = cmd.makeRenderCommandEncoder(descriptor: rp) else { continue }
            e.label = "trace"
            e.setRenderPipelineState(stampPipe)
            e.setVertexBytes(&res, length: 4, index: 1)
            for s in pending where s.slot == slot {
                var p = StampU(a: SIMD2(s.ax, s.az), b: SIMD2(s.bx, s.bz), hw: s.halfWidth, depth: s.depth, berm: s.berm, press: s.press, cap: s.cap,
                               slot: UInt32(s.slot), tag: UInt32(s.tag), lo: SIMD2(Int32(s.x0), Int32(s.z0)), hi: SIMD2(Int32(s.x1), Int32(s.z1)))
                e.setVertexBytes(&p, length: MemoryLayout<StampU>.stride, index: 0)
                e.setFragmentBytes(&p, length: MemoryLayout<StampU>.stride, index: 0)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
            }
            e.endEncoding()
            dispatches += 1
        }
        pending.removeAll(keepingCapacity: true)
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
        tableBytes.withUnsafeBytes { e.setFragmentBytes($0.baseAddress!, length: TraceField.tableSize, index: WorldBind.matterTable) }
        e.setFragmentTexture(texture, index: WorldBind.matterTraces)
    }
    /// The drive's origin moved: the table is relative to it.
    func originMoved() { tableDirty = true }
    func clear() { atlas.clear(); pending.removeAll(keepingCapacity: true); tableDirty = true }
}
