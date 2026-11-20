// The props, GPU-driven (0310, docs/NATIVE-FREEDRIVE.md §9.6). Before: each 512 m block drew every instance of every kind at
// the LOD its nearest point asked for (a block's far trees at their finest), in ≈ 200 draws a frame, and a CPU pass gathered
// the near pool every 10 m. Now:
//   pool     one buffer of every instance in the blocks round the eye, written once when a block arrives (a range per block,
//            first fit), its block's corner looked up in a small table written each frame (the floating origin's half)
//   cull     one compute dispatch a frame (World.metal cg_world_prop_cull): each instance against the frustum and its range,
//            its LOD by its own distance, into per-kind, per-LOD lists; the casters near the car into a shadow list
//   args     one more: the lists' counts into indirect draw arguments
//   draw     one indirect draw per kind and LOD (≤ 24), whatever the number of blocks
//   shadow   the world's own shadow map (2048², 170 m round the car): trees, rocks, the roadside and the near land, redrawn only
//            when the car has moved 24 m from where it was drawn, the sun has turned, or the origin moved
// The CPU never touches an instance per frame. Hidden roadside items (broken loose, 0227) keep the negated-scale rule.
import Metal
import simd
import ColdGasWorld

final class WorldProps {
    static let poolCap = 65_536, maxBlocks = 64, listsPerKind = 4
    struct KindMesh { let lods: [(vb: MTLBuffer, ib: MTLBuffer, count: Int, end: Double)]; let radius: Float }
    let kinds: [KindMesh]
    /// Far trees' impostors (WorldImpostors): the kinds' last LOD is then their quad.
    var impostors: WorldImpostors?
    private let device: MTLDevice
    let pool: MTLBuffer
    private let blockTables: [MTLBuffer]
    private let out: MTLBuffer, counters: MTLBuffer, args: MTLBuffer, indexCounts: MTLBuffer, caps: MTLBuffer
    private let statsBufs: [MTLBuffer]
    private let cullPipe, argsPipe: MTLComputePipelineState
    private var cull = WCullU()
    private let nLists: Int
    private var base: [Int] = [], cap: [Int] = []

    // The pool's free ranges (first fit, merged on free) and its high water.
    private var freeRanges: [(start: Int, count: Int)] = [(0, WorldProps.poolCap)]
    private(set) var highWater = 0
    struct Block { let bx: Int, bz: Int; let slot: Int; let start: Int; let count: Int }
    private(set) var blocks: [Int64: Block] = [:]
    private var blockSlots: [Int]
    /// Where each breakable roadside item sits in the pool: (cell x, cell z, item) → pool indices.
    private var items: [SIMD3<Int32>: [Int]] = [:]
    /// What the GPU drew last (from a completed frame): instances per list.
    private(set) var drawn = (instances: 0, tris: 0, shadow: 0)

    // The world's cached shadow.
    static let shadowSize = 2048, shadowHalf = 85.0, shadowDepth = 700.0, shadowMove = 24.0
    let shadowMap: MTLTexture
    private let shadowPipe: MTLRenderPipelineState, terrainShadowPipe: MTLRenderPipelineState
    private let shadowDS: MTLDepthStencilState
    private(set) var shadowVP = matrix_identity_float4x4
    private var shadowCentre = SIMD3<Double>(.infinity, 0, .infinity), shadowKey = SIMD3<Float>(9, 9, 9), shadowOrigin = SIMD3<Double>(.nan, 0, 0)
    private(set) var shadowValid = false, shadowDraws = 0
    private var shadowDue = true

    init?(device: MTLDevice, library: MTLLibrary, kinds: [KindMesh], terrainVD: MTLVertexDescriptor, propVD: MTLVertexDescriptor, archive: PipelineArchive) {
        self.device = device; self.kinds = kinds
        nLists = kinds.count * WorldProps.listsPerKind
        var b = 0
        for (k, _) in kinds.enumerated() {
            let big = k <= PropKind.rock.rawValue
            let c = big ? [1536, 6144, 16384, 2048] : [512, 2048, 4096, 1024]
            for x in c { base.append(b); cap.append(x); b += x }
        }
        func buf(_ n: Int, _ o: MTLResourceOptions) -> MTLBuffer? { device.makeBuffer(length: max(16, n), options: o) }
        guard let p = buf(WorldProps.poolCap * 32, .storageModeShared),
              let o = buf(b * 32, .storageModePrivate), let c = buf(nLists * 4, .storageModeShared), let a = buf(nLists * 20, .storageModePrivate),
              let ic = buf(nLists * 4, .storageModeShared), let cp = buf(nLists * 4, .storageModeShared),
              let cf = library.makeFunction(name: "cg_world_prop_cull"), let cu = try? device.makeComputePipelineState(function: cf),
              let af = library.makeFunction(name: "cg_world_prop_args"), let ar = try? device.makeComputePipelineState(function: af) else { return nil }
        pool = p; out = o; counters = c; args = a; indexCounts = ic; caps = cp; cullPipe = cu; argsPipe = ar
        pool.label = "world.props.pool"; out.label = "world.props.visible"
        memset(counters.contents(), 0, nLists * 4)
        // Every slot free (kindItem = all ones).
        let pi = pool.contents().bindMemory(to: UInt32.self, capacity: WorldProps.poolCap * 8)
        for i in 0..<WorldProps.poolCap { pi[i * 8 + 6] = 0xffff_ffff }
        let icp = ic.contents().bindMemory(to: UInt32.self, capacity: nLists), cpp = cp.contents().bindMemory(to: UInt32.self, capacity: nLists)
        for (k, km) in kinds.enumerated() {
            for l in 0..<4 {
                let li = k * 4 + l
                let lod = l < 3 ? (l < km.lods.count ? l : -1) : min(1, km.lods.count - 1)
                icp[li] = lod >= 0 ? UInt32(km.lods[lod].count) : 0
                cpp[li] = UInt32(cap[li])
            }
        }
        blockTables = (0..<Renderer.inFlight).compactMap { _ in device.makeBuffer(length: WorldProps.maxBlocks * 16, options: .storageModeShared) }
        let nl = nLists
        statsBufs = (0..<Renderer.inFlight).compactMap { _ in device.makeBuffer(length: max(16, nl * 4), options: .storageModeShared) }
        guard blockTables.count == Renderer.inFlight, statsBufs.count == Renderer.inFlight else { return nil }
        blockSlots = Array((0..<WorldProps.maxBlocks).reversed())
        // The world's shadow map, and its depth-only pipelines (props and the near land).
        let sd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: Renderer.shadowFormat, width: WorldProps.shadowSize, height: WorldProps.shadowSize, mipmapped: false)
        sd.usage = [.renderTarget, .shaderRead]; sd.storageMode = .private
        func depthPipe(_ v: String, _ vd: MTLVertexDescriptor) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = library.makeFunction(name: v); d.vertexDescriptor = vd
            d.depthAttachmentPixelFormat = Renderer.shadowFormat; d.rasterSampleCount = 1
            return archive.pipeline(d, name: v)
        }
        let dsd = MTLDepthStencilDescriptor(); dsd.isDepthWriteEnabled = true; dsd.depthCompareFunction = .less
        guard let sm = device.makeTexture(descriptor: sd), let sp = depthPipe("cg_world_prop_shadow_vertex", propVD),
              let tp = depthPipe("cg_world_terrain_shadow_vertex", terrainVD), let ds = device.makeDepthStencilState(descriptor: dsd) else { return nil }
        shadowMap = sm; shadowPipe = sp; terrainShadowPipe = tp; shadowDS = ds
        sm.label = "world.shadow"
        // The cull's fixed part.
        for (k, km) in kinds.enumerated() where k < 8 {
            let ends = km.lods.map { Float($0.end) }
            let near = km.lods.count > 1 ? Float(WorldView.nearR) : (ends.first ?? 0)
            let e1 = ends.count > 1 ? ends[1] : near, e2 = ends.count > 2 ? ends[2] : e1
            cull.set(WCullU.kinds + k * 2, SIMD4(near, e1, e2, ends.last ?? 0))
            cull.set(WCullU.kinds + k * 2 + 1, SIMD4(Float(min(3, km.lods.count)), 1, WorldProps.casts(k) ? 1 : 0, km.radius))
            cull.rows[WCullU.cap + k] = SIMD4(UInt32(cap[k * 4]), UInt32(cap[k * 4 + 1]), UInt32(cap[k * 4 + 2]), UInt32(cap[k * 4 + 3]))
            cull.rows[WCullU.base + k] = SIMD4(UInt32(base[k * 4]), UInt32(base[k * 4 + 1]), UInt32(base[k * 4 + 2]), UInt32(base[k * 4 + 3]))
        }
    }
    /// Which kinds cast into the world's shadow: trees, shrubs, rocks, the rails and fences (not the little posts).
    static func casts(_ k: Int) -> Bool { k != PropKind.post.rawValue }

    // MARK: - Blocks into the pool

    /// A block's instances (per kind, 8 floats each: x y z yaw scale tint item+1 cell, relative to the block's corner) into
    /// a range of the pool. False when the pool or the table is full (the caller drops a far block and retries later).
    func add(key: Int64, bx: Int, bz: Int, per: [[Float]]) -> Bool {
        if blocks[key] != nil { return true }
        let n = per.reduce(0) { $0 + $1.count / 8 }
        guard let slot = blockSlots.last, let start = take(n) else { return false }
        blockSlots.removeLast()
        let f = pool.contents().bindMemory(to: Float.self, capacity: WorldProps.poolCap * 8)
        let u = pool.contents().bindMemory(to: UInt32.self, capacity: WorldProps.poolCap * 8)
        var i = start
        let cellsA = Int(WorldView.block / PropSpec.cell)
        for (k, a) in per.enumerated() {
            for j in 0..<(a.count / 8) {
                let s = j * 8, o = i * 8
                f[o] = a[s]; f[o + 1] = a[s + 1]; f[o + 2] = a[s + 2]; f[o + 3] = a[s + 3]
                f[o + 4] = a[s + 4]; f[o + 5] = a[s + 5]
                let item = Int(a[s + 6]), cell = Int(a[s + 7])
                u[o + 6] = UInt32(k) | (UInt32(item) << 8)
                u[o + 7] = UInt32(slot) | (UInt32(cell) << 16)
                if item > 0 {
                    let cx = bx * cellsA + cell % cellsA, cz = bz * cellsA + cell / cellsA
                    items[SIMD3(Int32(truncatingIfNeeded: cx), Int32(truncatingIfNeeded: cz), Int32(item - 1)), default: []].append(i)
                }
                i += 1
            }
        }
        blocks[key] = Block(bx: bx, bz: bz, slot: slot, start: start, count: n)
        highWater = max(highWater, start + n)
        // The world's shadow again only if the block reaches its box.
        let B = WorldView.block, cx = (Double(bx) + 0.5) * B - shadowCentre.x, cz = (Double(bz) + 0.5) * B - shadowCentre.z
        if !(cx.isFinite && cz.isFinite) || abs(cx) < B / 2 + WorldProps.shadowHalf && abs(cz) < B / 2 + WorldProps.shadowHalf { shadowDue = true }
        return true
    }
    func remove(key: Int64) {
        guard let b = blocks.removeValue(forKey: key) else { return }
        let u = pool.contents().bindMemory(to: UInt32.self, capacity: WorldProps.poolCap * 8)
        for i in b.start..<(b.start + b.count) { u[i * 8 + 6] = 0xffff_ffff }
        let cellsA = Int(WorldView.block / PropSpec.cell)
        items = items.filter { k, _ in !(Int(k.x) >= b.bx * cellsA && Int(k.x) < (b.bx + 1) * cellsA && Int(k.y) >= b.bz * cellsA && Int(k.y) < (b.bz + 1) * cellsA) }
        give(b.start, b.count)
        blockSlots.append(b.slot)
        while highWater > 0, !freeRanges.isEmpty, let last = freeRanges.last, last.start + last.count == WorldProps.poolCap, last.start < highWater { highWater = last.start }
    }
    private func take(_ n: Int) -> Int? {
        guard n > 0 else { return freeRanges.isEmpty ? nil : freeRanges[0].start }
        guard let i = freeRanges.firstIndex(where: { $0.count >= n }) else { return nil }
        let r = freeRanges[i]
        if r.count == n { freeRanges.remove(at: i) } else { freeRanges[i] = (r.start + n, r.count - n) }
        return r.start
    }
    private func give(_ start: Int, _ n: Int) {
        guard n > 0 else { return }
        let i = freeRanges.firstIndex(where: { $0.start > start }) ?? freeRanges.count
        freeRanges.insert((start, n), at: i)
        // Merge with the neighbours.
        if i + 1 < freeRanges.count, freeRanges[i].start + freeRanges[i].count == freeRanges[i + 1].start {
            freeRanges[i].count += freeRanges[i + 1].count; freeRanges.remove(at: i + 1)
        }
        if i > 0, freeRanges[i - 1].start + freeRanges[i - 1].count == freeRanges[i].start {
            freeRanges[i - 1].count += freeRanges[i].count; freeRanges.remove(at: i)
        }
    }
    /// A roadside item broken loose (hidden: its scale negated) or standing again.
    func setHidden(_ h: SIMD3<Int32>, _ hidden: Bool) {
        guard let list = items[h] else { return }
        let f = pool.contents().bindMemory(to: Float.self, capacity: WorldProps.poolCap * 8)
        for i in list { f[i * 8 + 4] = hidden ? -abs(f[i * 8 + 4]) : abs(f[i * 8 + 4]) }
        shadowDue = true
    }

    /// 0334: a tree felled (hidden: its scale negated, as a broken roadside item is) or stood again, found by where its trunk
    /// stood (world metres) among its block's spruces and broadleaves.
    func setFelled(x: Double, z: Double, _ felled: Bool) {
        let B = WorldView.block
        let bx = Int((x / B).rounded(.down)), bz = Int((z / B).rounded(.down))
        guard let b = blocks.values.first(where: { $0.bx == bx && $0.bz == bz }) else { return }
        let f = pool.contents().bindMemory(to: Float.self, capacity: WorldProps.poolCap * 8)
        let u = pool.contents().bindMemory(to: UInt32.self, capacity: WorldProps.poolCap * 8)
        let lx = Float(x - Double(bx) * B), lz = Float(z - Double(bz) * B)
        let trees: Set<UInt32> = [UInt32(PropKind.spruce.rawValue), UInt32(PropKind.broadleaf.rawValue)]
        for i in b.start..<(b.start + b.count) where trees.contains(u[i * 8 + 6] & 0xff) && abs(f[i * 8] - lx) < 0.05 && abs(f[i * 8 + 2] - lz) < 0.05 {
            f[i * 8 + 4] = felled ? -abs(f[i * 8 + 4]) : abs(f[i * 8 + 4])
        }
        shadowDue = true
    }

    // MARK: - The frame

    /// The cull's compute (and the world's shadow when it's due), before the frame's passes.
    func encode(_ cmd: MTLCommandBuffer, ring: Int, origin: SIMD3<Double>, eye: SIMD3<Double>, viewProj: simd_float4x4, far: Double,
                car: SIMD3<Double>, keyDir: SIMD3<Float>, terrain: (MTLRenderCommandEncoder) -> Void, layers: (MTLRenderCommandEncoder, simd_float4x4) -> Void, drive: inout WDriveU) {
        // What a completed frame drew (this ring slot's last use is done: the renderer's gate holds three in flight).
        let st = statsBufs[ring].contents().bindMemory(to: UInt32.self, capacity: nLists)
        var inst = 0, tris = 0, sh = 0
        for (k, km) in kinds.enumerated() { for l in 0..<4 {
            let c = min(Int(st[k * 4 + l]), cap[k * 4 + l])
            if l == 3 { sh += c; continue }
            inst += c
            if l < km.lods.count { tris += c * km.lods[l].count / 3 }
        } }
        drawn = (inst, tris, sh)
        // The block table: each block's corner, render space.
        let t = blockTables[ring].contents().bindMemory(to: SIMD4<Float>.self, capacity: WorldProps.maxBlocks)
        for i in 0..<WorldProps.maxBlocks { t[i].w = 0 }
        for b in blocks.values {
            t[b.slot] = SIMD4(Float(Double(b.bx) * WorldView.block - origin.x), Float(-origin.y), Float(Double(b.bz) * WorldView.block - origin.z), 1)
        }
        // The world's shadow: due when the car has left the box's middle, the sun has turned, the origin moved, or blocks came.
        let flat = SIMD3(car.x, 0, car.z)
        let moved = simd_distance(flat, SIMD3(shadowCentre.x, 0, shadowCentre.z)) > WorldProps.shadowMove
        let turned = simd_distance(keyDir, shadowKey) > 0.004
        if moved || turned || origin != shadowOrigin { shadowDue = true }
        let redraw = shadowDue && !WorldView.skip.contains("wshadow")
        if redraw { placeShadow(car: car, keyDir: keyDir, origin: origin) }
        // The cull.
        for (i, pl) in WorldView.planes(viewProj).enumerated() { cull.set(i, pl) }
        cull.set(WCullU.eye, SIMD4(Float(eye.x - origin.x), Float(eye.y - origin.y), Float(eye.z - origin.z), Float(far)))
        cull.set(WCullU.shadow, redraw ? SIMD4(Float(shadowCentre.x - origin.x), 0, Float(shadowCentre.z - origin.z), Float(WorldProps.shadowHalf * 1.15)) : .zero)
        cull.rows[WCullU.counts] = SIMD4(UInt32(highWater), UInt32(min(8, kinds.count)), 4, 0)
        Signs.world("cull") {
            guard let e = cmd.makeComputeCommandEncoder() else { return }
            e.label = "world.cull"
            e.setComputePipelineState(cullPipe)
            cull.rows.withUnsafeBytes { e.setBytes($0.baseAddress!, length: $0.count, index: 0) }
            e.setBuffer(pool, offset: 0, index: 1); e.setBuffer(blockTables[ring], offset: 0, index: 2)
            e.setBuffer(out, offset: 0, index: 3); e.setBuffer(counters, offset: 0, index: 4)
            let n = max(1, highWater)
            e.dispatchThreads(MTLSize(width: n, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: min(256, cullPipe.maxTotalThreadsPerThreadgroup), height: 1, depth: 1))
            e.memoryBarrier(scope: .buffers)
            e.setComputePipelineState(argsPipe)
            var nn = SIMD4<UInt32>(UInt32(nLists), 0, 0, 0)
            e.setBytes(&nn, length: 16, index: 0)
            e.setBuffer(counters, offset: 0, index: 1); e.setBuffer(indexCounts, offset: 0, index: 2); e.setBuffer(caps, offset: 0, index: 3)
            e.setBuffer(args, offset: 0, index: 4); e.setBuffer(statsBufs[ring], offset: 0, index: 5)
            e.dispatchThreads(MTLSize(width: nLists, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: nLists, height: 1, depth: 1))
            e.endEncoding()
        }
        guard redraw else { return }
        // The world's shadow, redrawn.
        Signs.world("shadow") {
            let rp = MTLRenderPassDescriptor()
            rp.depthAttachment.texture = shadowMap; rp.depthAttachment.loadAction = .clear; rp.depthAttachment.clearDepth = 1; rp.depthAttachment.storeAction = .store
            guard let e = cmd.pass(rp) else { return }
            e.label = "world.shadow"
            e.setDepthStencilState(shadowDS); e.setDepthBias(1.5, slopeScale: 2.5, clamp: 0.01); e.setCullMode(.none)
            var vp = shadowVP
            e.setVertexBytes(&vp, length: 64, index: 1)
            e.setVertexBytes(&drive, length: MemoryLayout<WDriveU>.stride, index: 5)
            e.setRenderPipelineState(terrainShadowPipe)
            terrain(e)
            e.setRenderPipelineState(shadowPipe)
            drawLists(e, shadow: true)
            layers(e, shadowVP)
            e.endEncoding()
            shadowDue = false; shadowValid = true; shadowDraws += 1
        }
    }
    /// The world's shadow box: centred on the car, snapped to whole texels in the light's frame (no swimming between redraws).
    private func placeShadow(car: SIMD3<Double>, keyDir: SIMD3<Float>, origin: SIMD3<Double>) {
        let l = simd_normalize(SIMD3<Double>(keyDir))
        let upRef = abs(l.y) > 0.98 ? SIMD3<Double>(0, 0, 1) : SIMD3<Double>(0, 1, 0)
        let r = simd_normalize(simd_cross(upRef, l)), u = simd_cross(l, r)
        let texel = 2 * WorldProps.shadowHalf / Double(WorldProps.shadowSize)
        let a = (simd_dot(car, r) / texel).rounded() * texel, b = (simd_dot(car, u) / texel).rounded() * texel, c = simd_dot(car, l)
        let centre = r * a + u * b + l * c
        shadowCentre = centre; shadowKey = keyDir; shadowOrigin = origin
        let cr = SIMD3<Float>(centre - origin)
        let eye = cr + SIMD3<Float>(l) * Float(WorldProps.shadowDepth * 0.5)
        let view = lookAt(eye: eye, target: cr, up: SIMD3<Float>(upRef))
        let H = Float(WorldProps.shadowHalf)
        shadowVP = ortho(-H, H, -H, H, 1, Float(WorldProps.shadowDepth)) * view
    }

    /// The visible lists, one indirect draw per kind and LOD (the main pass), or the shadow lists (the shadow pass).
    func drawLists(_ e: MTLRenderCommandEncoder, shadow: Bool, pipe: MTLRenderPipelineState? = nil) {
        for (k, km) in kinds.enumerated() {
            let imp = impostors.flatMap { i in i.bounds[k].map { (i, $0) } }
            for l in (shadow ? [3] : [0, 1, 2]) {
                var lod = l == 3 ? min(1, km.lods.count - 1) : l
                // An impostor never casts (its quad isn't the tree): the shadow takes the mesh before it.
                if l == 3, imp != nil, lod == km.lods.count - 1 { lod = max(0, lod - 1) }
                guard lod >= 0, lod < km.lods.count else { continue }
                let li = k * 4 + l, m = km.lods[lod]
                let isImp = !shadow && imp != nil && lod == km.lods.count - 1
                if isImp, let (i, b) = imp {
                    var bb = b
                    e.setRenderPipelineState(i.pipe)
                    e.setVertexBytes(&bb, length: 16, index: 7)
                    e.setFragmentTexture(i.albedo, index: 0); e.setFragmentTexture(i.normal, index: 1)
                }
                e.setVertexBuffer(out, offset: base[li] * 32, index: 3)
                e.setVertexBuffer(m.vb, offset: 0, index: 0)
                e.drawIndexedPrimitives(type: .triangle, indexType: .uint32, indexBuffer: m.ib, indexBufferOffset: 0, indirectBuffer: args, indirectBufferOffset: li * 20)
                RenderStats.draws += 1
                if isImp, let pipe { e.setRenderPipelineState(pipe) }
            }
        }
        if !shadow { RenderStats.tris += drawn.tris }
    }
    /// The world's shadow for the frame's uniform: its view-projection and whether it's drawn.
    var shadowU: (vp: simd_float4x4, on: Bool) { (shadowVP, shadowValid && !WorldView.skip.contains("wshadow")) }
    /// Held on the GPU (bytes).
    var bytes: Int { pool.length + out.length + shadowMap.allocatedSize + blockTables.reduce(0) { $0 + $1.length } }
}

/// World.metal's WCull as 16-byte rows: the planes (0–5), the eye (6), the shadow box (7), the counts (8), the kinds (9–24, two
/// rows each), the lists' capacities (25–32) and first instances (33–40).
struct WCullU {
    static let eye = 6, shadow = 7, counts = 8, kinds = 9, cap = 25, base = 33, count = 41
    var rows = [SIMD4<UInt32>](repeating: .zero, count: WCullU.count)
    mutating func set(_ r: Int, _ v: SIMD4<Float>) { rows[r] = SIMD4(v.x.bitPattern, v.y.bitPattern, v.z.bitPattern, v.w.bitPattern) }
}
