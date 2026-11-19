// Free Drive's world, drawn (docs/NATIVE-FREEDRIVE.md §4.3, §9):
//   terrain  a CDLOD quadtree over the plane: roots of 16 km, leaves of 128 m (33 × 33 vertices), a node split where the
//            camera is within SPLIT × its size; leaves drawn, each vertex sliding to its parent's surface over the last
//            30 % of its range (the geomorph), skirts against cracks. A node whose children aren't built yet draws itself.
//            0310: each tile lives in a slot of the WorldCache (its vertices in one heap buffer, its surface baked once on
//            the GPU when it arrives), kept by an LRU; nothing about a tile is redone per frame.
//   roads    each link's ribbon, within ROAD_R of the camera (its buffers made on the utility queue).
//   props    WorldProps: one pool, a compute cull a frame into indirect draws, LOD per instance, the world's cached shadow.
//   grass    blades on the finest tiles round the eye (#365's), standing on the tiles' own vertices.
//   layers   WATER's and MATTER's (WorldHooks.swift), called at fixed points with the world's bindings set.
// Everything is built off the main thread (a concurrent utility queue: pure ColdGasWorld calls), handed over here a few a
// frame, nearest first. Positions reach the GPU relative to `origin` (the drive's floating origin): each piece's corner
// minus the origin, as a Float, plus the piece's own small coordinates.
import Foundation
import Metal
import simd
import ColdGasWorld
import ColdGasPhysics

final class WorldView {
    /// CDLOD keeps neighbours within one level of each other only with a split distance of at least twice the node.
    static let split = 2.2, farR = 40_000.0, roadR = 2_600.0, propR = 1_250.0, block = 512.0
    /// Within this of the eye a pooled kind draws its finest LOD (a forged tree up close).
    static let nearR = 140.0
    /// Grass: its radius (m) and the clumps' spacing; `quality` (the renderer's, by its shed) scales it.
    static let grassR = 30.0, grassSp = 0.7
    let world: FreeWorld
    private let device: MTLDevice
    private let terrainPipe, roadPipe, propPipe, loosePipe, markPipe: MTLRenderPipelineState
    private let grassPipe: MTLRenderPipelineState?
    private let dsWrite, dsTest: MTLDepthStencilState
    /// Free Drive's loose things and the rubber its tyres lay down (0223).
    private(set) var loose: LooseView?
    let marks: SkidMarks?
    let cache: WorldCache
    let props: WorldProps
    /// The surfaces' baked detail (#365's DetailTexture).
    let detail: MTLTexture?
    private let tileIndex: MTLBuffer
    private let tileIndexCount: Int
    private let gen = DispatchQueue(label: "coldgas.world", qos: .utility, attributes: .concurrent)
    private let lock = NSLock()
    /// The renderer's quality for the extras (grass): 2 full, 1 cut back, 0 off.
    var quality = 2
    private(set) var grassClumps = 0

    /// The floating origin (world metres) everything is drawn relative to; the drive sets it.
    var origin = SIMD3<Double>(0, 0, 0)

    // --- Layers (§9.4) ----------------------------------------------------------------------------------------------
    private(set) var layers: [WorldLayer] = []
    func add(_ l: WorldLayer) { if !layers.contains(where: { $0 === l }) { layers.append(l) } }
    func remove(_ l: WorldLayer) { layers.removeAll { $0 === l } }
    /// Whether the tiles are built with the seabed (a layer owns the sea).
    private(set) var seabed = false
    private var gpu = WorldGPUU()

    // --- Terrain ---------------------------------------------------------------------------------------------------
    private struct Tile { let slot: Int; let minY: Float; let maxY: Float; var used: Int }
    private var tiles: [TileKey: Tile] = [:]
    private var built: [TileData] = []
    private var builtFor = 0   // the seabed generation the built tiles are for
    private var generation = 0
    private var inflight = Set<TileKey>()
    private var want: [(TileKey, Double)] = []
    private var draws: [(TileKey, Tile)] = []
    private var frame = 0

    // --- Roads ----------------------------------------------------------------------------------------------------
    private struct Road { let vb: MTLBuffer; let ib: MTLBuffer; let count: Int; let ox, oz: Double; let box: (Double, Double, Double, Double) }
    private var roads: [ObjectIdentifier: [Road]] = [:]
    private var roadDone: [(ObjectIdentifier, [Road])] = []
    private var roadAsked = Set<ObjectIdentifier>()
    private var roadScan = SIMD2<Double>(.infinity, .infinity), roadScanning = false

    // --- Props: the blocks asked for and arrived (their instances go into WorldProps' pool) ----------------------------
    private var blockDone: [(Int64, Int, Int, [[Float]])] = []
    private var blockAsked = Set<Int64>()
    private var hidden = Set<SIMD3<Int32>>()

    // --- Counters (the bench, the debug line) ---------------------------------------------------------------------
    /// `-fd-nocull`: debug, every selected tile drawn (frustum culling off).
    static let noCull = Launch.args.contains("-fd-nocull")
    /// `-fd-skip terrain,roads,props,grass,wshadow,marks`: debug, leave those out.
    static let skip = Set((Launch.value("-fd-skip") ?? "").split(separator: ",").map(String.init))
    /// Tiles drawn per level (debug).
    private(set) var levels: [Int] = []
    private(set) var stats = (tiles: 0, tris: 0, instances: 0, roads: 0, uploads: 0, missing: 0, mb: 0.0)
    /// The props' kinds in the pool's order (the loose view's broken pieces use the finest).
    private let kindMeshes: [WorldProps.KindMesh]

    init?(device: MTLDevice, world: FreeWorld, props sources: [PropSource] = [ForgeProps(), ProceduralProps()]) {
        self.device = device; self.world = world
        guard let lib = device.makeDefaultLibrary() else { return nil }
        let archive = PipelineArchive(device: device, name: "world")
        func pipe(_ v: String, _ f: String, _ vd: MTLVertexDescriptor?, blend: Bool = false) -> MTLRenderPipelineState? {
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
            return archive.pipeline(d, name: v)
        }
        let tv = MTLVertexDescriptor()
        tv.attributes[0].format = .float4; tv.attributes[0].offset = 0
        tv.attributes[1].format = .float3; tv.attributes[1].offset = 16
        tv.attributes[2].format = .uchar4Normalized; tv.attributes[2].offset = 28
        tv.attributes[3].format = .uchar4Normalized; tv.attributes[3].offset = 32
        for i in 0..<4 { tv.attributes[i].bufferIndex = 0 }
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
              let mp = pipe("cg_world_mark_vertex", "cg_world_mark_fragment", mv, blend: true) else {
            Report.error(.shader, .shader, "world: a pipeline failed"); return nil
        }
        terrainPipe = t; roadPipe = r; propPipe = p; loosePipe = lp; markPipe = mp
        grassPipe = pipe("cg_world_grass_vertex", "cg_world_grass_fragment", nil)
        let dd = MTLDepthStencilDescriptor(); dd.isDepthWriteEnabled = true; dd.depthCompareFunction = .less
        let dt = MTLDepthStencilDescriptor(); dt.isDepthWriteEnabled = false; dt.depthCompareFunction = .lessEqual
        guard let ds = device.makeDepthStencilState(descriptor: dd), let dts = device.makeDepthStencilState(descriptor: dt) else { return nil }
        dsWrite = ds; dsTest = dts
        marks = SkidMarks(device: device)
        let idx = TileSpec.indices
        guard let ib = device.makeBuffer(bytes: idx, length: idx.count * 2, options: .storageModeShared),
              let c = WorldCache(device: device, library: lib) else { Report.error(.world, .error, "world: the cache couldn't be made"); return nil }
        tileIndex = ib; tileIndexCount = idx.count; cache = c
        detail = DetailTexture.shared(device)
        // Each kind's LOD chain: the first source that has it; a forged chain hands over, past its last LOD, to the procedural
        // kit's farthest (a few triangles a tree, out to the horizon). At most three LODs a kind.
        var km: [WorldProps.KindMesh] = []
        for k in PropKind.allCases {
            var geo = sources.lazy.compactMap { $0.lods(for: k.id) }.first ?? []
            if let far = sources.last?.lods(for: k.id)?.last, let mine = geo.last, far.end > mine.end, far.indices.count < mine.indices.count { geo.append(far) }
            if geo.count > 3 { geo = Array(geo.prefix(2)) + [geo[geo.count - 1]] }
            var radius: Float = 0.5
            if let g0 = geo.first {
                for v in stride(from: 0, to: g0.vertices.count, by: 11) {
                    let x = g0.vertices[v], y = g0.vertices[v + 1], z = g0.vertices[v + 2]
                    radius = max(radius, (x * x + y * y * 0.25 + z * z).squareRoot())
                }
            }
            km.append(WorldProps.KindMesh(lods: geo.compactMap { g in
                guard !g.vertices.isEmpty, !g.indices.isEmpty,
                      let vb = device.makeBuffer(bytes: g.vertices, length: g.vertices.count * 4, options: .storageModeShared),
                      let ib = device.makeBuffer(bytes: g.indices, length: g.indices.count * 4, options: .storageModeShared) else { return nil }
                return (vb, ib, g.indices.count, g.end)
            }, radius: radius))
        }
        // Far trees as impostors (0310): photographed once from eight sides, then a quad each to the horizon.
        var imp: WorldImpostors?
        if !WorldView.skip.contains("impostors"), let q = device.makeCommandQueue(),
           let i = WorldImpostors(device: device, library: lib, queue: q, kinds: km, archive: archive) {
            imp = i
            for k in WorldImpostors.kinds where k < km.count && km[k].lods.count >= 2 {
                guard let last = km[k].lods.last else { continue }
                var l = km[k].lods; l[l.count - 1] = (i.quadVB, i.quadIB, 6, last.end)
                km[k] = WorldProps.KindMesh(lods: l, radius: km[k].radius)
            }
        }
        kindMeshes = km
        guard let pr = WorldProps(device: device, library: lib, kinds: km, terrainVD: tv, propVD: pv, archive: archive) else {
            Report.error(.world, .error, "world: the props' cull couldn't be made"); return nil
        }
        props = pr
        props.impostors = imp
        archive.save()
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
        // A layer that owns the sea: the tiles again, with the seabed.
        let wantSeabed = layers.contains { $0.ownsSea }
        if wantSeabed != seabed { seabed = wantSeabed; flushTiles() }
        Signs.world("upload") { upload(eye) }
        select(eye: eye, viewProj: viewProj)
        requestTiles()
        scanRoads(eye)
        if frame % 8 == 0 { scanProps(eye) }
        evict()
        cache.recycle(frame: frame)
        cache.assignTraces(leaves: draws.compactMap { $0.0.level == 0 ? $0.0 : nil }, eye: eye)
        cache.updateLeaves(eye: eye) { [tiles] k in tiles[k]?.slot }
        let L = TileSpec.leaf
        gpu.leafOrigin = SIMD4(Float(Double(cache.leafCorner.x) * L - origin.x), Float(Double(cache.leafCorner.y) * L - origin.z), Float(L), Float(WorldCache.leafGrid))
        gpu.sea = SIMD4(Float(SEA - origin.y), 0, 0, 0)
        gpu.flags = SIMD4(seabed ? 1 : 0, cache.tracesTexture.arrayLength > 1 ? 1 : 0, Float(WorldCache.traceSize), 0)
        for l in layers { l.update(self, eye: eye, dt: 1.0 / 120) }
        stats.mb = Double(cache.bytes + props.bytes) / 1e6
    }

    /// Why the world isn't settled yet (`-fd-stats`).
    var waitLine: String { "WORLD wait missing \(stats.missing) inflight \(inflight.count) tiles \(tiles.count) free \(cache.freeCount) built \(built.count) drawn \(stats.tiles)" }
    /// Everything near `eye` is built (the drive waits on this before it shows the world).
    var settled: Bool { stats.missing == 0 && inflight.isEmpty }

    private func flushTiles() {
        for (_, t) in tiles { cache.release(t.slot, frame: frame) }
        tiles.removeAll(); generation += 1
        lock.lock(); built.removeAll(); lock.unlock()
        inflight.removeAll()
        cache.leafChanged()
    }
    /// The LRU: when the free slots run low, the tiles the quadtree hasn't visited for longest go (never one it visited this
    /// frame or the last: the drawn tiles and their ancestors).
    private func evict() {
        guard cache.freeCount < 96 else { return }
        let old = tiles.filter { frame - $0.value.used > 1 }.sorted { $0.value.used < $1.value.used }.prefix(160 - cache.freeCount)
        for (k, t) in old { tiles[k] = nil; cache.release(t.slot, frame: frame); if k.level == 0 { cache.leafChanged() } }
    }

    private func upload(_ eye: SIMD3<Double>) {
        lock.lock()
        let t = built.prefix(8); built.removeFirst(t.count)
        let r = roadDone; roadDone.removeAll()
        let b = blockDone; blockDone.removeAll()
        lock.unlock()
        stats.uploads = t.count
        for d in t {
            inflight.remove(d.key)
            guard tiles[d.key] == nil else { continue }
            guard let slot = cache.allocSlot() else { continue }   // full this frame: asked again when it's still wanted
            let m = 4096.0
            let corner = SIMD2(Float(d.key.x0 - (d.key.x0 / m).rounded(.down) * m), Float(d.key.z0 - (d.key.z0 / m).rounded(.down) * m))
            cache.upload(d, slot: slot, anchorCorner: corner)
            tiles[d.key] = Tile(slot: slot, minY: Float(d.minY), maxY: Float(d.maxY), used: frame)
        }
        for (id, pieces) in r { roads[id] = pieces }
        // Blocks into the pool; a full pool drops the farthest block first.
        var later: [(Int64, Int, Int, [[Float]])] = []
        for (key, bx, bz, per) in b {
            if props.add(key: key, bx: bx, bz: bz, per: per) {
                for h in hidden { props.setHidden(h, true) }
            } else {
                let B = WorldView.block
                if let far = props.blocks.max(by: { blockD2($0.value, eye) < blockD2($1.value, eye) }), blockD2(far.value, eye) > (Double(bx) * B + B / 2 - eye.x) * (Double(bx) * B + B / 2 - eye.x) + (Double(bz) * B + B / 2 - eye.z) * (Double(bz) * B + B / 2 - eye.z) {
                    props.remove(key: far.key); blockAsked.remove(far.key)
                }
                later.append((key, bx, bz, per))
            }
        }
        if !later.isEmpty { lock.lock(); blockDone += later; lock.unlock() }
    }
    private func blockD2(_ b: WorldProps.Block, _ eye: SIMD3<Double>) -> Double {
        let B = WorldView.block, cx = Double(b.bx) * B + B / 2 - eye.x, cz = Double(b.bz) * B + B / 2 - eye.z
        return cx * cx + cz * cz
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
        // 0310: a node out of the lens is neither drawn nor refined (its subtree stays in the LRU while slots allow, so a
        // turn of the camera finds most of it cached); the working set is what's in view, ≈ a third of the old one.
        if !WorldView.noCull && !visible(k, t, vp) { return }
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
        let sb = seabed, gen0 = generation
        for (k, _) in want where n < room && !inflight.contains(k) && tiles[k] == nil {
            inflight.insert(k); n += 1
            let w = world
            gen.async { [weak self] in
                let d = Signs.world("tile") { w.tile(k, seabed: sb) }
                guard let self else { return }
                self.lock.lock(); if gen0 == self.generation { self.built.append(d) }; self.lock.unlock()
            }
        }
    }

    // MARK: - Roads and props

    private func scanRoads(_ eye: SIMD3<Double>) {
        let p = SIMD2(eye.x, eye.z)
        for (id, list) in roads {
            guard let b = list.first?.box else { continue }
            let dx = max(0, max(b.0 - eye.x, eye.x - b.1)), dz = max(0, max(b.2 - eye.z, eye.z - b.3))
            if dx * dx + dz * dz > (WorldView.roadR + 900) * (WorldView.roadR + 900) { roads[id] = nil; roadAsked.remove(id) }
        }
        if roadScanning || simd_distance(p, roadScan) < 150 { return }
        roadScanning = true; roadScan = p
        let w = world, R = WorldView.roadR, dev = device
        let asked = roadAsked
        gen.async { [weak self] in
            let ls = w.roads.links(minX: eye.x - R, minZ: eye.z - R, maxX: eye.x + R, maxZ: eye.z + R, margin: 0)
            var out: [(ObjectIdentifier, [Road])] = []
            // The ribbons' buffers made here, off the main thread (0310: no allocation in the frame).
            for l in ls where !asked.contains(ObjectIdentifier(l)) {
                let pieces = w.ribbon(l, run: 1 << 20).compactMap { p -> Road? in
                    guard let vb = dev.makeBuffer(bytes: p.vertices, length: p.vertices.count * 4, options: .storageModeShared),
                          let ib = dev.makeBuffer(bytes: p.indices, length: p.indices.count * 4, options: .storageModeShared) else { return nil }
                    return Road(vb: vb, ib: ib, count: p.indices.count, ox: p.ox, oz: p.oz, box: (p.minX, p.maxX, p.minZ, p.maxZ))
                }
                out.append((ObjectIdentifier(l), pieces))
            }
            DispatchQueue.main.async {
                guard let self else { return }
                for (id, _) in out { self.roadAsked.insert(id) }
                self.lock.lock(); self.roadDone += out; self.lock.unlock()
                self.roadScanning = false
            }
        }
    }

    @inline(__always) static func bkey(_ i: Int, _ j: Int) -> Int64 { (Int64(Int32(truncatingIfNeeded: i)) << 32) | Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j))) }
    private func scanProps(_ eye: SIMD3<Double>) {
        let B = WorldView.block, R = WorldView.propR
        let i0 = Int(((eye.x - R) / B).rounded(.down)), i1 = Int(((eye.x + R) / B).rounded(.down))
        let j0 = Int(((eye.z - R) / B).rounded(.down)), j1 = Int(((eye.z + R) / B).rounded(.down))
        for (k, b) in props.blocks where b.bx < i0 - 1 || b.bx > i1 + 1 || b.bz < j0 - 1 || b.bz > j1 + 1 { props.remove(key: k); blockAsked.remove(k) }
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
                let per = Signs.world("blocks") { WorldView.buildBlock(w, i, j) }
                guard let self else { return }
                self.lock.lock(); self.blockDone.append((k, i, j, per)); self.lock.unlock()
            }
        }
    }
    /// A roadside item broken loose (hide) or standing again (show): prop cell (cx, cz), its index there.
    func setBroken(cx: Int, cz: Int, item: Int, _ broken: Bool) {
        let h = SIMD3(Int32(truncatingIfNeeded: cx), Int32(truncatingIfNeeded: cz), Int32(truncatingIfNeeded: item))
        if broken { hidden.insert(h) } else { hidden.remove(h) }
        props.setHidden(h, broken)
    }
    /// A kind's finest geometry (the loose view draws a broken roadside piece with it).
    func geometry(_ k: PropKind) -> (vb: MTLBuffer, ib: MTLBuffer, count: Int)? {
        guard k.rawValue < kindMeshes.count, let l = kindMeshes[k.rawValue].lods.first else { return nil }
        return (l.vb, l.ib, l.count)
    }
    /// Instances drawn at their finest LOD last frame (the bench's line; 0226's "near pool").
    var nearDrawn: Int { props.drawn.instances }

    /// A 512 m block's props, per kind, as instance floats relative to the block's corner: x y z yaw, scale tint item+1 cell.
    private static func buildBlock(_ w: FreeWorld, _ bi: Int, _ bj: Int) -> [[Float]] {
        var per = [[Float]](repeating: [], count: PropKind.allCases.count)
        let n = Int(WorldView.block / PropSpec.cell)
        for cj in 0..<n { for ci in 0..<n {
            let cx = bi * n + ci, cz = bj * n + cj
            let cell = w.props(cx, cz)
            let ox = Float(Double(ci) * PropSpec.cell), oz = Float(Double(cj) * PropSpec.cell)
            for p in cell.instances { per[p.kind.rawValue] += [p.x + ox, p.y, p.z + oz, p.yaw, p.scale, p.tint, Float(p.item + 1), Float(ci + cj * n)] }
        } }
        return per
    }

    // MARK: - The frame's compute (before the passes)

    /// The tiles' surfaces baked, the props culled, the world's shadow redrawn when it's due, the layers' compute.
    func encode(_ cmd: MTLCommandBuffer, ring: Int, eye: SIMD3<Double>, viewProj: simd_float4x4, car: SIMD3<Double>, keyDir: SIMD3<Float>, drive: inout WDriveU, look: Look, time: Double) {
        cache.encode(cmd)
        for l in layers { l.encode(self, cmd: cmd) }
        let ctxOrigin = origin
        props.encode(cmd, ring: ring, origin: origin, eye: eye, viewProj: viewProj, far: WorldView.skip.contains("props") ? 0 : WorldView.propR, car: car, keyDir: keyDir,
                     terrain: { [self] e in
                        // The land within the box: the drawn tiles of the two finest levels.
                        for (k, t) in draws where k.level <= 1 && !WorldView.skip.contains("terrain") {
                            var u = WTileU(offset: SIMD4(Float(k.x0 - origin.x), Float(-origin.y), Float(k.z0 - origin.z), Float(k.level)), morph: .zero)
                            e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
                            e.setVertexBuffer(cache.slab, offset: t.slot * WorldCache.slabBytes, index: 0)
                            e.drawIndexedPrimitives(type: .triangle, indexCount: tileIndexCount, indexType: .uint16, indexBuffer: tileIndex, indexBufferOffset: 0)
                        }
                     },
                     layers: { [self] e, vp in
                        let c = WorldDrawContext(origin: ctxOrigin, eye: eye, viewProj: vp, look: look, time: time)
                        for l in layers { l.drawShadow(self, e, c) }
                     }, drive: &drive)
    }
    /// The world's cached shadow for the frame uniform (texture 14).
    var worldShadow: (map: MTLTexture, vp: simd_float4x4, on: Bool) { (props.shadowMap, props.shadowU.vp, props.shadowU.on) }
    /// The heaps' residency set (the renderer adds it to its queue once).
    var residency: MTLResidencySet? { cache.residency }

    // MARK: - The draw (inside the main pass, after the stage's opaque draws)

    private func bind(_ e: MTLRenderCommandEncoder, frame fb: MTLBuffer, look: inout LookU, drive: inout WDriveU, shadow: MTLTexture, sky: MTLTexture) {
        e.setVertexBuffer(fb, offset: 0, index: WorldBind.frame); e.setFragmentBuffer(fb, offset: 0, index: WorldBind.frame)
        e.setVertexBytes(&look, length: MemoryLayout<LookU>.stride, index: WorldBind.look); e.setFragmentBytes(&look, length: MemoryLayout<LookU>.stride, index: WorldBind.look)
        e.setVertexBytes(&drive, length: MemoryLayout<WDriveU>.stride, index: WorldBind.drive); e.setFragmentBytes(&drive, length: MemoryLayout<WDriveU>.stride, index: WorldBind.drive)
        e.setVertexBytes(&gpu, length: MemoryLayout<WorldGPUU>.stride, index: WorldBind.gpu); e.setFragmentBytes(&gpu, length: MemoryLayout<WorldGPUU>.stride, index: WorldBind.gpu)
        e.setFragmentTexture(shadow, index: WorldBind.shadow)
        e.setVertexTexture(sky, index: WorldBind.skyView); e.setFragmentTexture(sky, index: WorldBind.skyView)
        if let det = detail { e.setVertexTexture(det, index: WorldBind.detail); e.setFragmentTexture(det, index: WorldBind.detail) }
        e.setVertexTexture(cache.surface, index: WorldBind.surface); e.setFragmentTexture(cache.surface, index: WorldBind.surface)
        e.setVertexTexture(cache.tracesTexture, index: WorldBind.traces); e.setFragmentTexture(cache.tracesTexture, index: WorldBind.traces)
        e.setVertexTexture(cache.leafIndex, index: WorldBind.leafIndex); e.setFragmentTexture(cache.leafIndex, index: WorldBind.leafIndex)
        e.setFragmentTexture(props.shadowMap, index: WorldBind.worldShadow)
    }

    /// `frame` (buffer 1) and `look` are the renderer's; `drive` is the world's own uniform (lamps, the props' range).
    func draw(_ e: MTLRenderCommandEncoder, frame fb: MTLBuffer, look: inout LookU, drive: inout WDriveU, shadow: MTLTexture, sky: MTLTexture,
              viewProj: simd_float4x4, eye: SIMD3<Double>, lookMode: Look, time: Double) {
        bind(e, frame: fb, look: &look, drive: &drive, shadow: shadow, sky: sky)
        e.setDepthStencilState(dsWrite); e.setDepthBias(0, slopeScale: 0, clamp: 0); e.setFrontFacing(.counterClockwise)
        // Terrain.
        e.setRenderPipelineState(terrainPipe); e.setCullMode(.back)
        e.setVertexBuffer(cache.slab, offset: 0, index: 0)
        for (k, t) in draws where !WorldView.skip.contains("terrain") {
            let S = k.size, end = 2 * WorldView.split * S
            var u = WTileU(offset: SIMD4(Float(k.x0 - origin.x), Float(-origin.y), Float(k.z0 - origin.z), Float(k.level)),
                           morph: SIMD4(k.level < TileSpec.levels - 1 ? Float(0.7 * end) : 1e9, k.level < TileSpec.levels - 1 ? Float(1 / (0.3 * end)) : 0, Float(t.slot), Float(S)))
            e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
            e.setFragmentBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
            e.setVertexBufferOffset(t.slot * WorldCache.slabBytes, index: 0)
            RenderStats.draw(indices: tileIndexCount)
            e.drawIndexedPrimitives(type: .triangle, indexCount: tileIndexCount, indexType: .uint16, indexBuffer: tileIndex, indexBufferOffset: 0)
        }
        // Grass on the finest tiles round the eye: quality 2 the full radius, 1 two thirds of it, 0 none.
        grassClumps = 0
        if let gp = grassPipe, quality > 0, !WorldView.skip.contains("grass") {
            e.setRenderPipelineState(gp); e.setCullMode(.none)
            let R = WorldView.grassR * (quality >= 2 ? 1 : 0.6), sp = WorldView.grassSp, blades = quality >= 2 ? 4 : 3
            for (k, t) in draws where k.level == 0 {
                let x0 = k.x0, z0 = k.z0
                let lx0 = max(0, eye.x - R - x0), lx1 = min(TileSpec.leaf, eye.x + R - x0)
                let lz0 = max(0, eye.z - R - z0), lz1 = min(TileSpec.leaf, eye.z + R - z0)
                if lx1 <= lx0 || lz1 <= lz0 { continue }
                let i0 = Int((lx0 / sp).rounded(.down)), i1 = Int((lx1 / sp).rounded(.up)), j0 = Int((lz0 / sp).rounded(.down)), j1 = Int((lz1 / sp).rounded(.up))
                var u = WGrassU(offset: SIMD4(Float(x0 - origin.x), Float(-origin.y), Float(z0 - origin.z), Float(t.slot)), cells: SIMD4(Int32(i0), Int32(j0), Int32(i1 - i0), 0),
                                params: SIMD4(Float(sp), Float(R), 1, Float(blades)))
                e.setVertexBytes(&u, length: MemoryLayout<WGrassU>.stride, index: 2)
                e.setVertexBuffer(cache.slab, offset: t.slot * WorldCache.slabBytes, index: 0)
                let n = (i1 - i0) * (j1 - j0)
                RenderStats.draw(indices: blades * 3, instances: n)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: blades * 3, instanceCount: n)
                grassClumps += n
            }
        }
        // Roads: a few depth steps toward the camera, so the ribbon always wins over the land it's carved into.
        e.setRenderPipelineState(roadPipe); e.setCullMode(.none); e.setDepthBias(-8, slopeScale: -2, clamp: 0)
        var nr = 0
        for list in roads.values where !WorldView.skip.contains("roads") { for r in list {
            let dx = max(0, max(r.box.0 - eye.x, eye.x - r.box.1)), dz = max(0, max(r.box.2 - eye.z, eye.z - r.box.3))
            if dx * dx + dz * dz > WorldView.roadR * WorldView.roadR { continue }
            if !WorldView.inFrustum(Float(r.box.0 - origin.x), Float(r.box.1 - origin.x), -200 - Float(origin.y), 2000 - Float(origin.y), Float(r.box.2 - origin.z), Float(r.box.3 - origin.z), viewProj) { continue }
            var u = WTileU(offset: SIMD4(Float(r.ox - origin.x), Float(-origin.y), Float(r.oz - origin.z), 0), morph: .zero)
            e.setVertexBytes(&u, length: MemoryLayout<WTileU>.stride, index: 2)
            e.setVertexBuffer(r.vb, offset: 0, index: 0)
            RenderStats.draw(indices: r.count)
            e.drawIndexedPrimitives(type: .triangle, indexCount: r.count, indexType: .uint32, indexBuffer: r.ib, indexBufferOffset: 0)
            nr += 1
        } }
        stats.roads = nr
        e.setDepthBias(0, slopeScale: 0, clamp: 0)
        // Props: the cull's lists, one indirect draw each.
        if !WorldView.skip.contains("props") {
            e.setRenderPipelineState(propPipe); e.setCullMode(.none)
            props.drawLists(e, shadow: false, pipe: propPipe)
        }
        stats.instances = props.drawn.instances
        let ctx = WorldDrawContext(origin: origin, eye: eye, viewProj: viewProj, look: lookMode, time: time)
        for l in layers { l.drawOpaque(self, e, ctx); bind(e, frame: fb, look: &look, drive: &drive, shadow: shadow, sky: sky) }
        // The loose things (posed by the engine), then the rubber on the ground over everything opaque.
        if let l = loose, l.drawn > 0 { e.setRenderPipelineState(loosePipe); e.setCullMode(.back); e.setDepthStencilState(dsWrite); l.draw(e) }
        if let m = marks, m.count > 0, !WorldView.skip.contains("marks") {
            m.prepare(origin: origin)
            e.setRenderPipelineState(markPipe); e.setCullMode(.none); e.setDepthStencilState(dsTest); e.setDepthBias(-24, slopeScale: -3, clamp: 0)
            e.setVertexBuffer(m.buf, offset: 0, index: 0)
            e.tris(m.count * 6)
            e.setDepthBias(0, slopeScale: 0, clamp: 0); e.setDepthStencilState(dsWrite)
        }
    }
    /// After the sky (the main pass): the layers' blended draws (water, spray).
    func drawLate(_ e: MTLRenderCommandEncoder, frame fb: MTLBuffer, look: inout LookU, drive: inout WDriveU, shadow: MTLTexture, sky: MTLTexture,
                  viewProj: simd_float4x4, eye: SIMD3<Double>, lookMode: Look, time: Double) {
        guard !layers.isEmpty else { return }
        let ctx = WorldDrawContext(origin: origin, eye: eye, viewProj: viewProj, look: lookMode, time: time)
        for l in layers { bind(e, frame: fb, look: &look, drive: &drive, shadow: shadow, sky: sky); l.drawLate(self, e, ctx) }
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
    /// The lens's six planes (render space, Metal's 0 … w depth), normalised: inside when dot(n, p) + d ≥ 0.
    static func planes(_ m: simd_float4x4) -> [SIMD4<Float>] {
        let r0 = SIMD4(m.columns.0.x, m.columns.1.x, m.columns.2.x, m.columns.3.x)
        let r1 = SIMD4(m.columns.0.y, m.columns.1.y, m.columns.2.y, m.columns.3.y)
        let r2 = SIMD4(m.columns.0.z, m.columns.1.z, m.columns.2.z, m.columns.3.z)
        let r3 = SIMD4(m.columns.0.w, m.columns.1.w, m.columns.2.w, m.columns.3.w)
        return [r3 + r0, r3 - r0, r3 + r1, r3 - r1, r2, r3 - r2].map { p in p / max(1e-6, simd_length(SIMD3(p.x, p.y, p.z))) }
    }
}

/// World.metal's WTile.
struct WTileU { var offset = SIMD4<Float>(), morph = SIMD4<Float>() }
/// World.metal's WGrass: the tile's corner − origin and its slot; the first cell, the columns; the spacing, the radius, the density, the blades.
struct WGrassU { var offset = SIMD4<Float>(), cells = SIMD4<Int32>(), params = SIMD4<Float>() }
/// World.metal's WDrive. `anchor`: the floating origin mod 4,096 m (x, z), so world-anchored detail doesn't jump when the origin
/// moves; z the finest props' radius; w the quality. `carPos` / `carFwd` (#365): the car on the ground, for the ground's
/// occlusion under it.
struct WDriveU { var lampPos = SIMD4<Float>(), lampDir = SIMD4<Float>(), params = SIMD4<Float>(), anchor = SIMD4<Float>(), carPos = SIMD4<Float>(), carFwd = SIMD4<Float>() }
