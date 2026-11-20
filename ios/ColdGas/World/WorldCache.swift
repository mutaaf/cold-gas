// What the land keeps between frames (0310, docs/NATIVE-FREEDRIVE.md §9.3): made once when the drive's view is built, never
// resized, never allocated from in a frame.
//   slabs     one fixed shared buffer: `slots` CDLOD tiles' vertices, each written once when its tile arrives
//   surface   a texture array (a private heap): each tile's 64 × 64 surface (R rock, G snow, B wetness, A water depth), baked
//             by one compute dispatch when the tile arrives (World.metal cg_world_surface_bake), never again while it's cached
//   traces    MATTER's per-leaf marks (512² RGBA8 a slice), only once something calls `enableTraces()`
//   leafIndex the finest tiles round the eye → their surface and trace slots, rewritten when a leaf comes or goes
// The heaps' resources sit in one MTLResidencySet the renderer adds to its queue: resident once, not re-checked per draw.
// Slots are handed out by WorldView (its LRU); a freed slot waits three frames (the frames in flight) before reuse.
import Metal
import simd
import ColdGasWorld

final class WorldCache {
    /// Tiles cached (slabs and surfaces). WorldView's LRU keeps under it; ≈ 22 MB of slabs and 8 MB of surfaces.
    static let slots = 512
    static let surfaceSize = 64
    static let slabBytes = TileSpec.verts * TileSpec.stride * 4
    /// MATTER's traces: slices, texels a side, how far round the eye a leaf gets one (m).
    static let traceSlots = 16, traceSize = 512, traceR = 260.0
    /// The leafIndex's cells a side (32 leaves of 128 m: 4 km).
    static let leafGrid = 32

    let device: MTLDevice
    let privateHeap: MTLHeap
    let slab: MTLBuffer
    let surface: MTLTexture
    private(set) var traces: MTLTexture?
    private let dummyTraces: MTLTexture
    let leafIndex: MTLTexture
    private let bakePipe: MTLComputePipelineState
    private let clearPipe: MTLComputePipelineState?
    private(set) var residency: MTLResidencySet?

    private var freeSlots: [Int]
    private var retired: [(slot: Int, frame: Int)] = []
    private var bakes: [WBakeU] = []
    private var clears: [Int] = []
    /// Bakes encoded so far (the bench's line).
    private(set) var baked = 0

    // Traces: which leaf holds which slice.
    private var traceOf: [TileKey: Int] = [:]
    private var traceFree: [Int] = []
    /// Called before a trace slice is reused for another leaf (MATTER may copy it out first).
    var onTraceEvict: ((TileKey, Int) -> Void)?

    /// The leafIndex's corner (leaf coordinates) and whether it must be rewritten.
    private(set) var leafCorner = SIMD2<Int>(Int.min, Int.min)
    private var leafDirty = true
    private var leafScratch = [Int32](repeating: -1, count: WorldCache.leafGrid * WorldCache.leafGrid)

    init?(device: MTLDevice, library: MTLLibrary) {
        self.device = device
        let slabLen = WorldCache.slots * WorldCache.slabBytes
        let sd = MTLTextureDescriptor()
        sd.textureType = .type2DArray; sd.pixelFormat = .rgba8Unorm
        sd.width = WorldCache.surfaceSize; sd.height = WorldCache.surfaceSize; sd.arrayLength = WorldCache.slots
        sd.usage = [.shaderRead, .shaderWrite]; sd.storageMode = .private
        // The GPU-written textures in one private heap, tracked (Metal orders the bake's writes before the draws' reads); the
        // slabs, which the CPU writes, one fixed shared buffer beside it (a heap must be private on the simulator).
        let hp = MTLHeapDescriptor(); hp.storageMode = .private; hp.hazardTrackingMode = .tracked
        hp.size = device.heapTextureSizeAndAlign(descriptor: sd).size
        guard let ph = device.makeHeap(descriptor: hp), let sl = device.makeBuffer(length: slabLen, options: .storageModeShared),
              let su = ph.makeTexture(descriptor: sd) else { return nil }
        privateHeap = ph; slab = sl; surface = su
        ph.label = "world.private"; sl.label = "world.slabs"; su.label = "world.surface"
        let td = MTLTextureDescriptor()
        td.textureType = .type2DArray; td.pixelFormat = .rgba8Unorm; td.width = 1; td.height = 1; td.arrayLength = 1
        td.usage = .shaderRead; td.storageMode = .private
        let ld = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r32Sint, width: WorldCache.leafGrid, height: WorldCache.leafGrid, mipmapped: false)
        ld.usage = .shaderRead; ld.storageMode = .shared
        guard let dt = device.makeTexture(descriptor: td), let li = device.makeTexture(descriptor: ld),
              let bf = library.makeFunction(name: "cg_world_surface_bake"), let bp = try? device.makeComputePipelineState(function: bf) else { return nil }
        dummyTraces = dt; leafIndex = li; bakePipe = bp
        clearPipe = library.makeFunction(name: "cg_world_trace_clear").flatMap { try? device.makeComputePipelineState(function: $0) }
        freeSlots = Array((0..<WorldCache.slots).reversed())
        // Resident once (Metal 3 on iOS 18: a residency set on the renderer's queue).
        let rd = MTLResidencySetDescriptor(); rd.label = "world"; rd.initialCapacity = 4
        if let rs = try? device.makeResidencySet(descriptor: rd) {
            rs.addAllocation(sl); rs.addAllocation(ph); rs.commit(); rs.requestResidency()
            residency = rs
        }
    }

    // MARK: - Slots

    func allocSlot() -> Int? { freeSlots.popLast() }
    /// A slot no longer drawn: reusable once the frames in flight are done with it.
    func release(_ slot: Int, frame: Int) { retired.append((slot, frame)) }
    func recycle(frame: Int) {
        while let r = retired.first, frame - r.frame > Renderer.inFlight { freeSlots.append(r.slot); retired.removeFirst() }
    }
    var freeCount: Int { freeSlots.count + retired.count }

    /// A tile's vertices into its slot, and its surface queued for this frame's bake.
    func upload(_ d: TileData, slot: Int, anchorCorner: SIMD2<Float>) {
        let off = slot * WorldCache.slabBytes
        d.vertices.withUnsafeBytes { memcpy(slab.contents() + off, $0.baseAddress!, min(WorldCache.slabBytes, $0.count)) }
        bakes.append(WBakeU(slot: UInt32(slot), vertexBase: UInt32(slot * TileSpec.verts * TileSpec.stride), size: Float(d.key.size), level: Float(d.key.level),
                            corner: anchorCorner, pad: .zero))
        if d.key.level == 0 { leafDirty = true }
    }
    func leafChanged() { leafDirty = true }

    /// This frame's compute: the surfaces of the tiles that arrived, and any trace slices to clear. Before the frame's passes.
    func encode(_ cmd: MTLCommandBuffer) {
        guard !bakes.isEmpty || !clears.isEmpty, let e = cmd.makeComputeCommandEncoder() else { return }
        e.label = "world.bake"
        if !bakes.isEmpty {
            e.setComputePipelineState(bakePipe)
            e.setBuffer(slab, offset: 0, index: 1)
            e.setTexture(surface, index: 0)
            for var b in bakes {
                e.setBytes(&b, length: MemoryLayout<WBakeU>.stride, index: 0)
                e.dispatchThreadgroups(MTLSize(width: 8, height: 8, depth: 1), threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 1))
            }
            baked += bakes.count
            bakes.removeAll(keepingCapacity: true)
        }
        if !clears.isEmpty, let cp = clearPipe, let tr = traces {
            e.setComputePipelineState(cp)
            e.setTexture(tr, index: 0)
            for c in clears {
                var s = UInt32(c)
                e.setBytes(&s, length: 4, index: 0)
                let n = WorldCache.traceSize / 16
                e.dispatchThreadgroups(MTLSize(width: n, height: n, depth: 1), threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
            }
            clears.removeAll(keepingCapacity: true)
        }
        e.endEncoding()
    }

    // MARK: - Traces (MATTER, §9.3)

    /// Allocates the trace slices (≈ 16 MB) the first time; a no-op after.
    @discardableResult func enableTraces() -> MTLTexture? {
        if let t = traces { return t }
        let d = MTLTextureDescriptor()
        d.textureType = .type2DArray; d.pixelFormat = .rgba8Unorm
        d.width = WorldCache.traceSize; d.height = WorldCache.traceSize; d.arrayLength = WorldCache.traceSlots
        d.usage = [.shaderRead, .shaderWrite]; d.storageMode = .private
        guard let t = device.makeTexture(descriptor: d) else { return nil }
        t.label = "world.traces"
        traces = t
        traceFree = Array((0..<WorldCache.traceSlots).reversed())
        if let rs = residency { rs.addAllocation(t); rs.commit() }
        leafDirty = true
        return t
    }
    var tracesTexture: MTLTexture { traces ?? dummyTraces }
    /// The trace slice a leaf holds (nil: none).
    func traceSlot(_ k: TileKey) -> Int? { traceOf[k] }
    /// Gives the leaves within `traceR` of the eye a slice each (nearest first), taking it from the farthest leaf holding one.
    func assignTraces(leaves: [TileKey], eye: SIMD3<Double>) {
        guard traces != nil else { return }
        func d2(_ k: TileKey) -> Double { let cx = k.x0 + 64 - eye.x, cz = k.z0 + 64 - eye.z; return cx * cx + cz * cz }
        let R2 = (WorldCache.traceR + 91) * (WorldCache.traceR + 91)
        for k in leaves.filter({ traceOf[$0] == nil && d2($0) < R2 }).sorted(by: { d2($0) < d2($1) }) {
            var s = traceFree.popLast()
            if s == nil, let far = traceOf.keys.max(by: { d2($0) < d2($1) }), d2(far) > d2(k) {
                s = traceOf[far]; onTraceEvict?(far, s ?? 0); traceOf[far] = nil
            }
            guard let slot = s else { break }
            traceOf[k] = slot; clears.append(slot); leafDirty = true
        }
    }

    // MARK: - The leaf index

    /// Rewrites the leafIndex round the eye when a leaf came or went, or the eye crossed into another leaf.
    func updateLeaves(eye: SIMD3<Double>, slotOf: (TileKey) -> Int?) {
        let L = TileSpec.leaf, G = WorldCache.leafGrid
        let c = SIMD2(Int((eye.x / L).rounded(.down)) - G / 2, Int((eye.z / L).rounded(.down)) - G / 2)
        guard leafDirty || c != leafCorner else { return }
        leafDirty = false; leafCorner = c
        for j in 0..<G { for i in 0..<G {
            let k = TileKey(0, c.x + i, c.y + j)
            var v: Int32 = -1
            if let s = slotOf(k) { v = Int32(s) | (Int32((traceOf[k] ?? -1) + 1) << 16) }
            leafScratch[j * G + i] = v
        } }
        leafScratch.withUnsafeBytes { leafIndex.replace(region: MTLRegionMake2D(0, 0, G, G), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: G * 4) }
    }

    /// What the cache holds on the GPU (bytes).
    var bytes: Int { slab.length + privateHeap.size + (traces?.allocatedSize ?? 0) + leafIndex.allocatedSize }
}

/// World.metal's WBake.
struct WBakeU { var slot: UInt32; var vertexBase: UInt32; var size: Float; var level: Float; var corner: SIMD2<Float>; var pad: SIMD2<Float> }
