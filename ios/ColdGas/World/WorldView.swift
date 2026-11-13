// Free Drive's world, drawn (docs/NATIVE-FREEDRIVE.md §4.3):
//   terrain  a CDLOD quadtree over the plane: roots of 16 km, leaves of 128 m (33 × 33 vertices), a node split where the
//            camera is within SPLIT × its size; leaves drawn, each vertex sliding to its parent's surface over the last
//            30 % of its range (the geomorph), skirts against cracks. A node whose children aren't built yet draws itself.
//   roads    each link's ribbon, within ROAD_R of the camera.
//   props    instanced per 512 m block and kind, within PROP_R, grown in at the range's edge.
// Everything is built off the main thread (a concurrent utility queue: pure ColdGasWorld calls), uploaded here a few a
// frame, nearest first. Tile slabs are reused (a free list, retired three frames after their last draw). Positions
// reach the GPU relative to `origin` (a floating origin the drive moves in whole kilometres): each piece's corner minus
// the origin, as a Float, plus the piece's own small coordinates.
import Foundation
import Metal
import simd
import ColdGasWorld
import ColdGasPhysics

final class WorldView {
    /// CDLOD keeps neighbours within one level of each other only with a split distance of at least twice the node.
    static let split = 2.2, farR = 40_000.0, roadR = 2_600.0, propR = 1_250.0, block = 512.0
    let world: FreeWorld
    private let device: MTLDevice
    private let terrainPipe, roadPipe, propPipe, loosePipe, markPipe: MTLRenderPipelineState
    /// The props into the key light's shadow map (0228).
    private let propShadowPipe: MTLRenderPipelineState?
    /// The grass near the eye (0228): its radius (m) and the clumps' spacing; `quality` (the renderer's, by its shed) scales it.
    private let grassPipe: MTLRenderPipelineState?
    static let grassR = 36.0, grassSp = 0.6
    var quality = 2
    private(set) var grassClumps = 0
    private let dsWrite, dsTest: MTLDepthStencilState
    /// Free Drive's loose things and the rubber its tyres lay down (0223).
    private(set) var loose: LooseView?
    let marks: SkidMarks?
    private let tileIndex: MTLBuffer
    private let tileIndexCount: Int
    private let gen = DispatchQueue(label: "coldgas.world", qos: .utility, attributes: .concurrent)
    private let lock = NSLock()

    /// The floating origin (world metres) everything is drawn relative to; the drive sets it.
    var origin = SIMD3<Double>(0, 0, 0)

    // --- Terrain ---------------------------------------------------------------------------------------------------
    private struct Tile { let buf: MTLBuffer; let minY: Float; let maxY: Float; var used: Int }
    private var tiles: [TileKey: Tile] = [:]
    private var built: [TileData] = []
    private var inflight = Set<TileKey>()
    private var free: [MTLBuffer] = []
    private var retired: [(MTLBuffer, Int)] = []
    private var want: [(TileKey, Double)] = []
    private var draws: [(TileKey, Tile)] = []
    private var frame = 0

    // --- Roads ----------------------------------------------------------------------------------------------------
    private struct Road { let vb: MTLBuffer; let ib: MTLBuffer; let count: Int; let ox, oz: Double; let box: (Double, Double, Double, Double) }
    private var roads: [ObjectIdentifier: [Road]] = [:]
    private var roadDone: [(ObjectIdentifier, [RoadPiece])] = []
    private var roadAsked = Set<ObjectIdentifier>()
    private var roadScan = SIMD2<Double>(.infinity, .infinity), roadScanning = false

    // --- Props ----------------------------------------------------------------------------------------------------
    private struct Kind { let lods: [(vb: MTLBuffer, ib: MTLBuffer, count: Int, end: Double)] }
    private var kinds: [Kind] = []
    private struct Block { let bx, bz: Int; let inst: [MTLBuffer?]; let counts: [Int] }
    private var blocks: [Int64: Block] = [:]
    private var blockDone: [(Int64, Int, Int, [[Float]])] = []
    private var blockAsked = Set<Int64>()
    /// Roadside items broken loose (0227): their drawn instance hidden (its scale negated) until they stand again.
    private var hidden = Set<SIMD3<Int32>>()
    // The near pool (0226): within NEAR_R of the camera each instance is drawn with its kind's finest LOD (a forged tree up
    // close), gathered from the blocks every few metres into per-kind buffers (triple-buffered, preallocated); the blocks'
    // own draws leave those instances out in the vertex shader, so each instance is drawn exactly once a frame.
    static let nearR = 140.0, nearCap = 3072
    private var nearBufs: [[MTLBuffer]] = []
    private var nearCounts: [Int] = [], nearSlot = 0, nearAt = SIMD3<Double>(.infinity, 0, .infinity), nearCorner = SIMD2<Double>(0, 0), nearDirty = true

    // --- Counters (the bench, the debug line) ---------------------------------------------------------------------
    /// `-fd-nocull`: debug, every selected tile drawn (frustum culling off).
    static let noCull = Launch.args.contains("-fd-nocull")
    /// `-fd-skip terrain,roads,props`: debug, leave those out of the draw.
    static let skip = Set((Launch.value("-fd-skip") ?? "").split(separator: ",").map(String.init))
    /// Tiles drawn per level (debug).
    private(set) var levels: [Int] = []
    private(set) var stats = (tiles: 0, tris: 0, instances: 0, roads: 0, uploads: 0, missing: 0, mb: 0.0)

    init?(device: MTLDevice, world: FreeWorld, props: [PropSource] = [ForgeProps(), ProceduralProps()]) {
        self.device = device; self.world = world
        guard let lib = device.makeDefaultLibrary() else { return nil }
        func pipe(_ v: String, _ f: String, _ vd: MTLVertexDescriptor, blend: Bool = false) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = lib.makeFunction(name: v); d.fragmentFunction = lib.makeFunction(name: f)
            d.vertexDescriptor = vd
            d.colorAttachments[0].pixelFormat = Renderer.hdrFormat
            if blend, let c = d.colorAttachments[0] {
                c.isBlendingEnabled = true
                c.sourceRGBBlendFactor = .sourceAlpha; c.destinationRGBBlendFactor = .oneMinusSourceAlpha
                c.sourceAlphaBlendFactor = .zero; c.destinationAlphaBlendFactor = .one
            }
            d.depthAttachmentPixelFormat = Renderer.depthFormat
            d.rasterSampleCount = Renderer.samples
            return try? device.makeRenderPipelineState(descriptor: d)
        }
        let tv = MTLVertexDescriptor()
        tv.attributes[0].format = .float4; tv.attributes[0].offset = 0
        tv.attributes[1].format = .float3; tv.attributes[1].offset = 16
        tv.attributes[2].format = .uchar4Normalized; tv.attributes[2].offset = 28
        for i in 0..<3 { tv.attributes[i].bufferIndex = 0 }
        tv.layouts[0].stride = TileSpec.stride * 4
        let rv = MTLVertexDescriptor()
        rv.attributes[0].format = .float3; rv.attributes[0].offset = 0
        rv.attributes[1].format = .float2; rv.attributes[1].offset = 12
        rv.attributes[2].format = .float3; rv.attributes[2].offset = 20
        rv.attributes[3].format = .uchar4Normalized; rv.attributes[3].offset = 32
        for i in 0..<4 { rv.attributes[i].bufferIndex = 0 }
        rv.layouts[0].stride = RoadPiece.stride * 4
        let pv = MTLVertexDescriptor()
        for (i, (fmt, off)) in [(MTLVertexFormat.float3, 0), (.float3, 12), (.float2, 24), (.float3, 32)].enumerated() {
            pv.attributes[i].format = fmt; pv.attributes[i].offset = off; pv.attributes[i].bufferIndex = 0
        }
        pv.layouts[0].stride = 44
        let mv = MTLVertexDescriptor()
        mv.attributes[0].format = .float4; mv.attributes[0].offset = 0; mv.attributes[0].bufferIndex = 0
        mv.layouts[0].stride = 16
        guard let t = pipe("cg_world_terrain_vertex", "cg_world_terrain_fragment", tv), let r = pipe("cg_world_road_vertex", "cg_world_road_fragment", rv),
              let p = pipe("cg_world_prop_vertex", "cg_world_prop_fragment", pv), let lp = pipe("cg_world_loose_vertex", "cg_world_prop_fragment", pv),
              let mp = pipe("cg_world_mark_vertex", "cg_world_mark_fragment", mv, blend: true) else { return nil }
        terrainPipe = t; roadPipe = r; propPipe = p; loosePipe = lp; markPipe = mp
        let sd = MTLRenderPipelineDescriptor()
        sd.vertexFunction = lib.makeFunction(name: "cg_world_prop_shadow_vertex"); sd.vertexDescriptor = pv
        sd.depthAttachmentPixelFormat = Renderer.depthFormat; sd.rasterSampleCount = 1
        propShadowPipe = try? device.makeRenderPipelineState(descriptor: sd)
        let gd = MTLRenderPipelineDescriptor()
        gd.vertexFunction = lib.makeFunction(name: "cg_world_grass_vertex"); gd.fragmentFunction = lib.makeFunction(name: "cg_world_grass_fragment")
        gd.colorAttachments[0].pixelFormat = Renderer.hdrFormat; gd.depthAttachmentPixelFormat = Renderer.depthFormat; gd.rasterSampleCount = Renderer.samples
        grassPipe = try? device.makeRenderPipelineState(descriptor: gd)
        let dd = MTLDepthStencilDescriptor(); dd.isDepthWriteEnabled = true; dd.depthCompareFunction = .less
        let dt = MTLDepthStencilDescriptor(); dt.isDepthWriteEnabled = false; dt.depthCompareFunction = .lessEqual
        guard let ds = device.makeDepthStencilState(descriptor: dd), let dts = device.makeDepthStencilState(descriptor: dt) else { return nil }
        dsWrite = ds; dsTest = dts
        marks = SkidMarks(device: device)
        for _ in PropKind.allCases {
            var ring: [MTLBuffer] = []
            for _ in 0..<Renderer.inFlight { if let b = device.makeBuffer(length: WorldView.nearCap * 32, options: .storageModeShared) { ring.append(b) } }
            nearBufs.append(ring)
        }
        nearCounts = Array(repeating: 0, count: PropKind.allCases.count)
        let idx = TileSpec.indices
        guard let ib = device.makeBuffer(bytes: idx, length: idx.count * 2, options: .storageModeShared) else { return nil }
        tileIndex = ib; tileIndexCount = idx.count
        for k in PropKind.allCases {
            // The first source that has the kind; a forged chain hands over, past its last LOD, to the procedural kit's
            // farthest (a few triangles a tree, out to the horizon).
            var geo = props.lazy.compactMap { $0.lods(for: k.id) }.first ?? []
            if let far = props.last?.lods(for: k.id)?.last, let mine = geo.last, far.end > mine.end, far.indices.count < mine.indices.count { geo.append(far) }
            kinds.append(Kind(lods: geo.compactMap { g in
                guard !g.vertices.isEmpty, !g.indices.isEmpty,
                      let vb = device.makeBuffer(bytes: g.vertices, length: g.vertices.count * 4, options: .storageModeShared),
                      let ib = device.makeBuffer(bytes: g.indices, length: g.indices.count * 4, options: .storageModeShared) else { return nil }
                return (vb, ib, g.indices.count, g.end)
            }))
        }
        // The loose things, with the roadside's forged meshes for its broken pieces (0227).
        var forged: [LooseKind: (MTLBuffer, MTLBuffer, Int)] = [:]
        for (lk, pk) in [(LooseKind.fence, PropKind.fence), (.signpost, .signpost), (.rail, .guardrail)] { if let g = geometry(pk) { forged[lk] = (g.vb, g.ib, g.count) } }
        loose = LooseView(device: device, forged: forged)
    }

    // MARK: - Per frame (main thread, before the draw)

    /// Choose what to draw from `eye` (world metres) under `viewProj` (the render-space lens), ask for what's missing,
    /// upload what's been built.
    func update(eye: SIMD3<Double>, viewProj: simd_float4x4) {
        frame += 1
        upload()
        select(eye: eye, viewProj: viewProj)
        requestTiles()
        scanRoads(eye)
        if frame % 8 == 0 { scanProps(eye) }
        gatherNear(eye)
        // Slabs drawn last more than three frames ago, and over the budget: back to the free list.
        if tiles.count > 900 {
            let old = tiles.filter { frame - $0.value.used > 120 }.sorted { $0.value.used < $1.value.used }.prefix(tiles.count - 760)
            for (k, t) in old { tiles[k] = nil; retired.append((t.buf, frame)) }
        }
        while let r = retired.first, frame - r.1 > 3 { free.append(r.0); retired.removeFirst() }
        stats.mb = Double(tiles.count * TileSpec.verts * TileSpec.stride * 4 + free.count * TileSpec.verts * TileSpec.stride * 4) / 1e6
    }

    /// Everything near `eye` is built (the drive waits on this before it shows the world).
    var settled: Bool { stats.missing == 0 && inflight.isEmpty }

    private func upload() {
        lock.lock()
        let t = built.prefix(8); built.removeFirst(t.count)
        let r = roadDone; roadDone.removeAll()
        let b = blockDone; blockDone.removeAll()
        lock.unlock()
        stats.uploads = t.count
        let bytes = TileSpec.verts * TileSpec.stride * 4
        for d in t {
            inflight.remove(d.key)
            guard let buf = free.popLast() ?? device.makeBuffer(length: bytes, options: .storageModeShared) else { continue }
            d.vertices.withUnsafeBytes { memcpy(buf.contents(), $0.baseAddress!, min(bytes, $0.count)) }
            tiles[d.key] = Tile(buf: buf, minY: Float(d.minY), maxY: Float(d.maxY), used: frame)
        }
        for (id, pieces) in r {
            roads[id] = pieces.compactMap { p in
                guard let vb = device.makeBuffer(bytes: p.vertices, length: p.vertices.count * 4, options: .storageModeShared),
                      let ib = device.makeBuffer(bytes: p.indices, length: p.indices.count * 4, options: .storageModeShared) else { return nil }
                return Road(vb: vb, ib: ib, count: p.indices.count, ox: p.ox, oz: p.oz, box: (p.minX, p.maxX, p.minZ, p.maxZ))
            }
        }
        if !b.isEmpty { nearDirty = true }
        for (key, bx, bz, per) in b {
            let blk = Block(bx: bx, bz: bz, inst: per.map { a in a.isEmpty ? nil : device.makeBuffer(bytes: a, length: a.count * 4, options: .storageModeShared) },
                            counts: per.map { $0.count / 8 })
            blocks[key] = blk
            for h in hidden where WorldView.blockOf(h) == (bx, bz) { mark(blk, h, hide: true) }
        }
    }

    // MARK: - The quadtree

    private func select(eye: SIMD3<Double>, viewProj: simd_float4x4) {
        draws.removeAll(keepingCapacity: true)
        want.removeAll(keepingCapacity: true)
        let top = TileSpec.levels - 1, S = TileSpec.leaf * Double(1 << top)
        let i0 = Int(((eye.x - WorldView.farR) / S).rounded(.down)), i1 = Int(((eye.x + WorldView.farR) / S).rounded(.down))
        let j0 = Int(((eye.z - WorldView.farR) / S).rounded(.down)), j1 = Int(((eye.z + WorldView.farR) / S).rounded(.down))
        for j in j0...j1 { for i in i0...i1 { visit(TileKey(top, i, j), eye, viewProj) } }
        stats.missing = want.count
        stats.tiles = draws.count
        if frame % 60 == 0 { levels = (0..<TileSpec.levels).map { l in draws.filter { $0.0.level == l }.count } }
        stats.tris = draws.count * TileSpec.indices.count / 3
    }
    @inline(__always) private func dist(_ k: TileKey, _ eye: SIMD3<Double>) -> Double {
        let S = k.size, x0 = k.x0, z0 = k.z0
        let dx = max(0, max(x0 - eye.x, eye.x - (x0 + S))), dz = max(0, max(z0 - eye.z, eye.z - (z0 + S)))
        return (dx * dx + dz * dz).squareRoot()
    }
    private func visit(_ k: TileKey, _ eye: SIMD3<Double>, _ vp: simd_float4x4) {
        let d = dist(k, eye)
        if d > WorldView.farR { return }
        guard var t = tiles[k] else { want.append((k, d)); return }
        t.used = frame; tiles[k] = t
        if k.level > 0 && d < WorldView.split * k.size {
            var ready = true
            for c in 0..<4 { let ck = k.child(c); if tiles[ck] == nil { ready = false; want.append((ck, dist(ck, eye))) } }
            if ready { for c in 0..<4 { visit(k.child(c), eye, vp) }; return }
        }
        if WorldView.noCull || visible(k, t, vp) { draws.append((k, t)) }
    }
    /// The tile's box against the lens's clip planes (render space).
    private func visible(_ k: TileKey, _ t: Tile, _ vp: simd_float4x4) -> Bool {
        let S = Float(k.size), x0 = Float(k.x0 - origin.x), z0 = Float(k.z0 - origin.z), y0 = t.minY - Float(origin.y), y1 = t.maxY - Float(origin.y)
        return WorldView.inFrustum(x0, x0 + S, y0, y1, z0, z0 + S, vp)
    }
    private func requestTiles() {
        // Nearest first; a few in flight at a time, so a new nearest one never waits behind a queue of far ones.
        let room = max(0, 2 * ProcessInfo.processInfo.activeProcessorCount - inflight.count)
        if room == 0 || want.isEmpty { return }
        want.sort { $0.1 < $1.1 }
        var n = 0
        for (k, _) in want where n < room && !inflight.contains(k) && tiles[k] == nil {
            inflight.insert(k); n += 1
            let w = world
            gen.async { [weak self] in
                let d = w.tile(k)
                guard let self else { return }
                self.lock.lock(); self.built.append(d); self.lock.unlock()
            }
        }
    }

    // MARK: - Roads and props

    private func scanRoads(_ eye: SIMD3<Double>) {
        let p = SIMD2(eye.x, eye.z)
        // Out of range: dropped.
        for (id, list) in roads {
            guard let b = list.first?.box else { continue }
            let dx = max(0, max(b.0 - eye.x, eye.x - b.1)), dz = max(0, max(b.2 - eye.z, eye.z - b.3))
            if dx * dx + dz * dz > (WorldView.roadR + 900) * (WorldView.roadR + 900) { roads[id] = nil; roadAsked.remove(id) }
        }
        if roadScanning || simd_distance(p, roadScan) < 150 { return }
        roadScanning = true; roadScan = p
        let w = world, R = WorldView.roadR
        let asked = roadAsked
        gen.async { [weak self] in
            let ls = w.roads.links(minX: eye.x - R, minZ: eye.z - R, maxX: eye.x + R, maxZ: eye.z + R, margin: 0)
            var out: [(ObjectIdentifier, [RoadPiece])] = []
            for l in ls where !asked.contains(ObjectIdentifier(l)) { out.append((ObjectIdentifier(l), w.ribbon(l, run: 1 << 20))) }
            DispatchQueue.main.async {
                guard let self else { return }
                for (id, _) in out { self.roadAsked.insert(id) }
                self.lock.lock(); self.roadDone += out; self.lock.unlock()
                self.roadScanning = false
            }
        }
    }

    @inline(__always) private static func bkey(_ i: Int, _ j: Int) -> Int64 { (Int64(Int32(truncatingIfNeeded: i)) << 32) | Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j))) }
    private func scanProps(_ eye: SIMD3<Double>) {
        let B = WorldView.block, R = WorldView.propR
        let i0 = Int(((eye.x - R) / B).rounded(.down)), i1 = Int(((eye.x + R) / B).rounded(.down))
        let j0 = Int(((eye.z - R) / B).rounded(.down)), j1 = Int(((eye.z + R) / B).rounded(.down))
        for (k, b) in blocks {
            if b.bx < i0 - 1 || b.bx > i1 + 1 || b.bz < j0 - 1 || b.bz > j1 + 1 { blocks[k] = nil; blockAsked.remove(k) }
        }
        var asks: [(Int, Int, Double)] = []
        for j in j0...j1 { for i in i0...i1 {
            let k = WorldView.bkey(i, j)
            if blockAsked.contains(k) { continue }
            let cx = (Double(i) + 0.5) * B - eye.x, cz = (Double(j) + 0.5) * B - eye.z
            asks.append((i, j, cx * cx + cz * cz))
        } }
        asks.sort { $0.2 < $1.2 }
        let w = world
        for (i, j, _) in asks.prefix(2) {
            let k = WorldView.bkey(i, j)
            blockAsked.insert(k)
            gen.async { [weak self] in
                let per = WorldView.buildBlock(w, i, j)
                guard let self else { return }
                self.lock.lock(); self.blockDone.append((k, i, j, per)); self.lock.unlock()
            }
        }
    }
    /// The near pool: every 10 m the camera moves (or when blocks arrive), the instances within NEAR_R + 25 m of it, per kind
    /// that has more than one LOD, relative to a corner near the camera.
    private func gatherNear(_ eye: SIMD3<Double>) {
        let moved = (eye.x - nearAt.x) * (eye.x - nearAt.x) + (eye.z - nearAt.z) * (eye.z - nearAt.z)
        guard nearDirty || moved > 100 else { return }
        nearDirty = false; nearAt = eye
        nearSlot = (nearSlot + 1) % Renderer.inFlight
        let R = WorldView.nearR + 25, B = WorldView.block
        let corner = SIMD2((eye.x / 64).rounded(.down) * 64, (eye.z / 64).rounded(.down) * 64)
        nearCorner = corner
        for k in nearCounts.indices { nearCounts[k] = 0 }
        for b in blocks.values {
            let x0 = Double(b.bx) * B, z0 = Double(b.bz) * B
            let dx = max(0, max(x0 - eye.x, eye.x - (x0 + B))), dz = max(0, max(z0 - eye.z, eye.z - (z0 + B)))
            if dx * dx + dz * dz > R * R { continue }
            let ox = Float(x0 - corner.x), oz = Float(z0 - corner.y)
            let ex = Float(eye.x - x0), ez = Float(eye.z - z0), RR = Float(R * R)
            for k in kinds.indices where kinds[k].lods.count > 1 && nearBufs[k].count == Renderer.inFlight {
                guard let src = b.inst[k], b.counts[k] > 0 else { continue }
                let f = src.contents().bindMemory(to: Float.self, capacity: b.counts[k] * 8)
                let out = nearBufs[k][nearSlot].contents().bindMemory(to: Float.self, capacity: WorldView.nearCap * 8)
                for i in 0..<b.counts[k] {
                    let x = f[i * 8], z = f[i * 8 + 2]
                    if (x - ex) * (x - ex) + (z - ez) * (z - ez) > RR { continue }
                    let n = nearCounts[k]
                    if n >= WorldView.nearCap { break }
                    for j in 0..<8 { out[n * 8 + j] = f[i * 8 + j] }
                    out[n * 8] = x + ox; out[n * 8 + 2] = z + oz
                    nearCounts[k] = n + 1
                }
            }
        }
    }
    /// A roadside item broken loose (hide) or standing again (show): prop cell (cx, cz), its index there.
    func setBroken(cx: Int, cz: Int, item: Int, _ broken: Bool) {
        let h = SIMD3(Int32(truncatingIfNeeded: cx), Int32(truncatingIfNeeded: cz), Int32(truncatingIfNeeded: item))
        if broken { hidden.insert(h) } else { hidden.remove(h) }
        let (bx, bz) = WorldView.blockOf(h)
        if let blk = blocks[WorldView.bkey(bx, bz)] { mark(blk, h, hide: broken) }
        nearDirty = true
    }
    private static func blockOf(_ h: SIMD3<Int32>) -> (Int, Int) {
        let n = Int(WorldView.block / PropSpec.cell)
        return (Int((Double(h.x) / Double(n)).rounded(.down)), Int((Double(h.y) / Double(n)).rounded(.down)))
    }
    /// The item's instance in its block: its scale's sign is whether it's drawn.
    private func mark(_ blk: Block, _ h: SIMD3<Int32>, hide: Bool) {
        let n = Int(WorldView.block / PropSpec.cell)
        let local = Float((Int(h.x) - blk.bx * n) + (Int(h.y) - blk.bz * n) * n), tag = Float(h.z + 1)
        for k in [PropKind.fence, .signpost, .guardrail] {
            guard let buf = blk.inst[k.rawValue], blk.counts[k.rawValue] > 0 else { continue }
            let f = buf.contents().bindMemory(to: Float.self, capacity: blk.counts[k.rawValue] * 8)
            for i in 0..<blk.counts[k.rawValue] where f[i * 8 + 6] == tag && f[i * 8 + 7] == local {
                f[i * 8 + 4] = hide ? -abs(f[i * 8 + 4]) : abs(f[i * 8 + 4])
            }
        }
    }
    /// A kind's finest geometry (the loose view draws a broken roadside piece with it).
    func geometry(_ k: PropKind) -> (vb: MTLBuffer, ib: MTLBuffer, count: Int)? {
        guard k.rawValue < kinds.count, let l = kinds[k.rawValue].lods.first else { return nil }
        return (l.vb, l.ib, l.count)
    }

    /// Instances drawn from the near pool this frame (the bench's line).
    var nearDrawn: Int { nearCounts.reduce(0, +) }

    /// A 512 m block's props, per kind, as instance floats relative to the block's corner: x y z yaw, scale tint 0 0.
    private static func buildBlock(_ w: FreeWorld, _ bi: Int, _ bj: Int) -> [[Float]] {
        var per = [[Float]](repeating: [], count: PropKind.allCases.count)
        let n = Int(WorldView.block / PropSpec.cell)
        for cj in 0..<n { for ci in 0..<n {
            let cx = bi * n + ci, cz = bj * n + cj
            let cell = w.props(cx, cz)
            let ox = Float(Double(ci) * PropSpec.cell), oz = Float(Double(cj) * PropSpec.cell)
            // slots 6 and 7: a roadside item's index + 1 in its cell (0: none), and the cell within the block (0227)
            for p in cell.instances { per[p.kind.rawValue] += [p.x + ox, p.y, p.z + oz, p.yaw, p.scale, p.tint, Float(p.item + 1), Float(ci + cj * n)] }
        } }
        return per
    }

    // MARK: - The draw (inside the main pass, after the stage's opaque draws)

    /// `frame` (buffer 1) and `look` are the renderer's; `drive` is the world's own uniform (lamps, the props' range).
    func draw(_ e: MTLRenderCommandEncoder, frame fb: MTLBuffer, look: inout LookU, drive: inout WDriveU, shadow: MTLTexture, sky: MTLTexture, viewProj: simd_float4x4, eye: SIMD3<Double>) {
        e.setVertexBuffer(fb, offset: 0, index: 1); e.setFragmentBuffer(fb, offset: 0, index: 1)
        e.setFragmentTexture(sky, index: 8)
        e.setFragmentBytes(&look, length: MemoryLayout<LookU>.stride, index: 4)
        e.setFragmentBytes(&drive, length: MemoryLayout<WDriveU>.stride, index: 5)
        e.setVertexBytes(&drive, length: MemoryLayout<WDriveU>.stride, index: 5)
        e.setFragmentTexture(shadow, index: 3)
        e.setDepthStencilState(dsWrite); e.setDepthBias(0, slopeScale: 0, clamp: 0); e.setFrontFacing(.counterClockwise)
        // Terrain.
        e.setRenderPipelineState(terrainPipe); e.setCullMode(.back)
        for (k, t) in draws where !WorldView.skip.contains("terrain") {
            let S = k.size, end = 2 * WorldView.split * S
            var u = WTileU(offset: SIMD4(Float(k.x0 - origin.x), Float(-origin.y), Float(k.z0 - origin.z), Float(k.level)),
                           morph: k.level < TileSpec.levels - 1 ? SIMD4(Float(0.7 * end), Float(1 / (0.3 * end)), 0, 0) : SIMD4(1e9, 0, 0, 0))
            e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
            e.setVertexBuffer(t.buf, offset: 0, index: 0)
            e.drawIndexedPrimitives(type: .triangle, indexCount: tileIndexCount, indexType: .uint16, indexBuffer: tileIndex, indexBufferOffset: 0)
        }
        // Grass on the finest tiles round the eye (0228): quality 2 the full radius, 1 two thirds of it, 0 none.
        grassClumps = 0
        if let gp = grassPipe, quality > 0, !WorldView.skip.contains("grass") {
            e.setRenderPipelineState(gp); e.setCullMode(.none)
            let R = WorldView.grassR * (quality >= 2 ? 1 : 0.66), sp = WorldView.grassSp
            for (k, t) in draws where k.level == 0 {
                let x0 = k.x0, z0 = k.z0
                let lx0 = max(0, eye.x - R - x0), lx1 = min(TileSpec.leaf, eye.x + R - x0)
                let lz0 = max(0, eye.z - R - z0), lz1 = min(TileSpec.leaf, eye.z + R - z0)
                if lx1 <= lx0 || lz1 <= lz0 { continue }
                let i0 = Int((lx0 / sp).rounded(.down)), i1 = Int((lx1 / sp).rounded(.up)), j0 = Int((lz0 / sp).rounded(.down)), j1 = Int((lz1 / sp).rounded(.up))
                var u = WGrassU(offset: SIMD4(Float(x0 - origin.x), Float(-origin.y), Float(z0 - origin.z), 0), cells: SIMD4(Int32(i0), Int32(j0), Int32(i1 - i0), 0),
                                params: SIMD4(Float(sp), Float(R), 1, 0))
                e.setVertexBytes(&u, length: MemoryLayout<WGrassU>.stride, index: 2)
                e.setVertexBuffer(t.buf, offset: 0, index: 0)
                let n = (i1 - i0) * (j1 - j0)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 15, instanceCount: n)
                grassClumps += n
            }
        }
        // Roads: a few depth steps toward the camera, so the ribbon always wins over the land it's carved into.
        e.setRenderPipelineState(roadPipe); e.setCullMode(.none); e.setDepthBias(-8, slopeScale: -2, clamp: 0)
        var nr = 0
        for list in roads.values where !WorldView.skip.contains("roads") { for r in list {
            let dx = max(0, max(r.box.0 - eye.x, eye.x - r.box.1)), dz = max(0, max(r.box.2 - eye.z, eye.z - r.box.3))
            if dx * dx + dz * dz > WorldView.roadR * WorldView.roadR { continue }
            var u = WTileU(offset: SIMD4(Float(r.ox - origin.x), Float(-origin.y), Float(r.oz - origin.z), 0), morph: .zero)
            e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
            e.setVertexBuffer(r.vb, offset: 0, index: 0)
            e.drawIndexedPrimitives(type: .triangle, indexCount: r.count, indexType: .uint32, indexBuffer: r.ib, indexBufferOffset: 0)
            nr += 1
        } }
        stats.roads = nr
        e.setDepthBias(0, slopeScale: 0, clamp: 0)
        // Props: per block and kind, the LOD its nearest point asks for.
        e.setRenderPipelineState(propPipe); e.setCullMode(.none)
        var ni = 0
        let B = WorldView.block
        for b in blocks.values {
            let x0 = Double(b.bx) * B, z0 = Double(b.bz) * B
            let dx = max(0, max(x0 - eye.x, eye.x - (x0 + B))), dz = max(0, max(z0 - eye.z, eye.z - (z0 + B))), d = (dx * dx + dz * dz).squareRoot()
            if d > WorldView.propR { continue }
            if !boxVisible(x0, z0, B, viewProj) { continue }
            var u = WTileU(offset: SIMD4(Float(x0 - origin.x), Float(-origin.y), Float(z0 - origin.z), 0), morph: .zero)
            e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
            for (ki, kind) in kinds.enumerated() where !WorldView.skip.contains("props") {
                // A kind with a near pool: its finest LOD is the pool's, the blocks draw the rest (and skip what the pool has).
                let pooled = kind.lods.count > 1
                let chain = pooled ? kind.lods.dropFirst() : kind.lods[...]
                guard let ib = b.inst[ki], b.counts[ki] > 0, let lod = chain.first(where: { $0.end > d }) ?? chain.last, d < (kind.lods.last?.end ?? 0) else { continue }
                u.morph.x = pooled ? 1 : 0
                e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
                e.setVertexBuffer(ib, offset: 0, index: 3)
                e.setVertexBuffer(lod.vb, offset: 0, index: 0)
                e.drawIndexedPrimitives(type: .triangle, indexCount: lod.count, indexType: .uint32, indexBuffer: lod.ib, indexBufferOffset: 0, instanceCount: b.counts[ki])
                ni += b.counts[ki]
            }
        }
        // The near pool: each pooled kind's finest LOD, every instance within NEAR_R.
        var nu = WTileU(offset: SIMD4(Float(nearCorner.x - origin.x), Float(-origin.y), Float(nearCorner.y - origin.z), 0), morph: SIMD4(2, 0, 0, 0))
        e.setVertexBytes(&nu, length: MemoryLayout<WTileU>.stride, index: 2)
        for (ki, kind) in kinds.enumerated() where nearCounts[ki] > 0 && !WorldView.skip.contains("props") {
            guard let lod = kind.lods.first, nearBufs[ki].count == Renderer.inFlight else { continue }
            e.setVertexBuffer(nearBufs[ki][nearSlot], offset: 0, index: 3)
            e.setVertexBuffer(lod.vb, offset: 0, index: 0)
            e.drawIndexedPrimitives(type: .triangle, indexCount: lod.count, indexType: .uint32, indexBuffer: lod.ib, indexBufferOffset: 0, instanceCount: nearCounts[ki])
            ni += nearCounts[ki]
        }
        stats.instances = ni
        // The loose things (posed by the engine), then the rubber on the ground over everything opaque.
        if let l = loose, l.drawn > 0 { e.setRenderPipelineState(loosePipe); e.setCullMode(.back); l.draw(e) }
        if let m = marks, m.count > 0, !WorldView.skip.contains("marks") {
            m.prepare(origin: origin)
            e.setRenderPipelineState(markPipe); e.setCullMode(.none); e.setDepthStencilState(dsTest); e.setDepthBias(-24, slopeScale: -3, clamp: 0)
            e.setVertexBuffer(m.buf, offset: 0, index: 0)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: m.count * 6)
            e.setDepthBias(0, slopeScale: 0, clamp: 0); e.setDepthStencilState(dsWrite)
        }
    }
    /// The props near `center` (render space) into the key light's shadow map (0228): the near pool's instances at their
    /// coarser LOD (a shadow doesn't need the finest crown), the blocks' within the box at theirs. In the shadow pass, after
    /// the stage's casters; `frame` carries the light's view-projection.
    func drawShadow(_ e: MTLRenderCommandEncoder, frame fb: MTLBuffer, drive: inout WDriveU, center: SIMD3<Float>, radius: Double) {
        guard let pipe = propShadowPipe, !WorldView.skip.contains("props") else { return }
        e.setRenderPipelineState(pipe); e.setCullMode(.none)
        e.setVertexBuffer(fb, offset: 0, index: 1)
        e.setVertexBytes(&drive, length: MemoryLayout<WDriveU>.stride, index: 5)
        var nu = WTileU(offset: SIMD4(Float(nearCorner.x - origin.x), Float(-origin.y), Float(nearCorner.y - origin.z), 0), morph: SIMD4(2, 0, 0, 0))
        e.setVertexBytes(&nu, length: MemoryLayout<WTileU>.stride, index: 2)
        for (ki, kind) in kinds.enumerated() where nearCounts[ki] > 0 {
            guard let lod = kind.lods.dropFirst().first ?? kind.lods.first, nearBufs[ki].count == Renderer.inFlight else { continue }
            e.setVertexBuffer(nearBufs[ki][nearSlot], offset: 0, index: 3)
            e.setVertexBuffer(lod.vb, offset: 0, index: 0)
            e.drawIndexedPrimitives(type: .triangle, indexCount: lod.count, indexType: .uint32, indexBuffer: lod.ib, indexBufferOffset: 0, instanceCount: nearCounts[ki])
        }
    }
    private func boxVisible(_ x0: Double, _ z0: Double, _ S: Double, _ vp: simd_float4x4) -> Bool {
        let a = Float(x0 - origin.x), c = Float(z0 - origin.z), s = Float(S)
        return WorldView.inFrustum(a, a + s, -100 - Float(origin.y), 1600 - Float(origin.y), c, c + s, vp)
    }
    /// An axis-aligned box (render space) against the clip planes: false only when all eight corners are past one plane.
    @inline(__always) static func inFrustum(_ x0: Float, _ x1: Float, _ y0: Float, _ y1: Float, _ z0: Float, _ z1: Float, _ vp: simd_float4x4) -> Bool {
        var l = 0, r = 0, b = 0, t = 0, n = 0, f = 0
        for c in 0..<8 {
            let q = vp * SIMD4<Float>((c & 1) != 0 ? x1 : x0, (c & 2) != 0 ? y1 : y0, (c & 4) != 0 ? z1 : z0, 1)
            if q.x < -q.w { l += 1 }; if q.x > q.w { r += 1 }
            if q.y < -q.w { b += 1 }; if q.y > q.w { t += 1 }
            if q.z < 0 { n += 1 }; if q.z > q.w { f += 1 }
        }
        return l < 8 && r < 8 && b < 8 && t < 8 && n < 8 && f < 8
    }
}

/// World.metal's WTile and WDrive.
struct WTileU { var offset = SIMD4<Float>(), morph = SIMD4<Float>() }
/// World.metal's WGrass: the tile's corner − origin; the first cell, the columns; the spacing, the radius, the density.
struct WGrassU { var offset = SIMD4<Float>(), cells = SIMD4<Int32>(), params = SIMD4<Float>() }
/// `anchor`: the floating origin modulo 4,096 m (x, z), so world-anchored detail (the land's grain) doesn't jump when the
/// origin moves; zw spare.
/// `carPos` / `carFwd` (0228): the car on the ground (render space; w 1 on its wheels) and its heading, half length, half
/// width, for the ground's ambient occlusion under it.
struct WDriveU { var lampPos = SIMD4<Float>(), lampDir = SIMD4<Float>(), params = SIMD4<Float>(), anchor = SIMD4<Float>(), carPos = SIMD4<Float>(), carFwd = SIMD4<Float>() }
