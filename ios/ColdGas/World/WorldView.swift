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

final class WorldView {
    /// CDLOD keeps neighbours within one level of each other only with a split distance of at least twice the node.
    static let split = 2.2, farR = 40_000.0, roadR = 2_600.0, propR = 1_250.0, block = 512.0
    let world: FreeWorld
    private let device: MTLDevice
    private let terrainPipe, roadPipe, propPipe, loosePipe, markPipe: MTLRenderPipelineState
    private let dsWrite, dsTest: MTLDepthStencilState
    /// Free Drive's loose things and the rubber its tyres lay down (0223).
    let loose: LooseView?
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
        for i in 0..<3 { rv.attributes[i].bufferIndex = 0 }
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
        let dd = MTLDepthStencilDescriptor(); dd.isDepthWriteEnabled = true; dd.depthCompareFunction = .less
        let dt = MTLDepthStencilDescriptor(); dt.isDepthWriteEnabled = false; dt.depthCompareFunction = .lessEqual
        guard let ds = device.makeDepthStencilState(descriptor: dd), let dts = device.makeDepthStencilState(descriptor: dt) else { return nil }
        dsWrite = ds; dsTest = dts
        loose = LooseView(device: device); marks = SkidMarks(device: device)
        let idx = TileSpec.indices
        guard let ib = device.makeBuffer(bytes: idx, length: idx.count * 2, options: .storageModeShared) else { return nil }
        tileIndex = ib; tileIndexCount = idx.count
        for k in PropKind.allCases {
            let geo = props.lazy.compactMap { $0.lods(for: k.id) }.first ?? []
            kinds.append(Kind(lods: geo.compactMap { g in
                guard !g.vertices.isEmpty, !g.indices.isEmpty,
                      let vb = device.makeBuffer(bytes: g.vertices, length: g.vertices.count * 4, options: .storageModeShared),
                      let ib = device.makeBuffer(bytes: g.indices, length: g.indices.count * 4, options: .storageModeShared) else { return nil }
                return (vb, ib, g.indices.count, g.end)
            }))
        }
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
        for (key, bx, bz, per) in b {
            blocks[key] = Block(bx: bx, bz: bz, inst: per.map { a in a.isEmpty ? nil : device.makeBuffer(bytes: a, length: a.count * 4, options: .storageModeShared) },
                                counts: per.map { $0.count / 8 })
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
    /// A 512 m block's props, per kind, as instance floats relative to the block's corner: x y z yaw, scale tint 0 0.
    private static func buildBlock(_ w: FreeWorld, _ bi: Int, _ bj: Int) -> [[Float]] {
        var per = [[Float]](repeating: [], count: PropKind.allCases.count)
        let n = Int(WorldView.block / PropSpec.cell)
        for cj in 0..<n { for ci in 0..<n {
            let cx = bi * n + ci, cz = bj * n + cj
            let cell = w.props(cx, cz)
            let ox = Float(Double(ci) * PropSpec.cell), oz = Float(Double(cj) * PropSpec.cell)
            for p in cell.instances { per[p.kind.rawValue] += [p.x + ox, p.y, p.z + oz, p.yaw, p.scale, p.tint, 0, 0] }
        } }
        return per
    }

    // MARK: - The draw (inside the main pass, after the stage's opaque draws)

    /// `frame` (buffer 1) and `look` are the renderer's; `drive` is the world's own uniform (lamps, the props' range).
    func draw(_ e: MTLRenderCommandEncoder, frame fb: MTLBuffer, look: inout LookU, drive: inout WDriveU, shadow: MTLTexture, viewProj: simd_float4x4, eye: SIMD3<Double>) {
        e.setVertexBuffer(fb, offset: 0, index: 1); e.setFragmentBuffer(fb, offset: 0, index: 1)
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
                guard let ib = b.inst[ki], b.counts[ki] > 0, let lod = kind.lods.first(where: { $0.end > d }) ?? kind.lods.last, d < (kind.lods.last?.end ?? 0) else { continue }
                e.setVertexBuffer(ib, offset: 0, index: 3)
                e.setVertexBuffer(lod.vb, offset: 0, index: 0)
                e.drawIndexedPrimitives(type: .triangle, indexCount: lod.count, indexType: .uint32, indexBuffer: lod.ib, indexBufferOffset: 0, instanceCount: b.counts[ki])
                ni += b.counts[ki]
            }
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
struct WDriveU { var lampPos = SIMD4<Float>(), lampDir = SIMD4<Float>(), params = SIMD4<Float>() }
