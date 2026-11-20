// Free Drive's water (0320, docs/NATIVE-FREEDRIVE.md "Water"): the sea the car drives into, drawn in Metal.
//
//   Sea        the CPU half (no Metal): the waves (ColdGasWorld Waves, the same numbers the GPU bakes), the water maps round
//              the camera (near 1 km at 4 m, mid 8 km at 32 m, far 41 km at 320 m: built on a background queue only when
//              the camera has moved far enough, kept otherwise), the land's skyline over the water (the reflection's), and
//              the level the physics floats the car on (`level`) and a river's current (`current`). Every water body comes
//              from FreeWorld.water (0310): the sea, the lakes, the rivers. No water on the maps: nothing is baked or drawn.
//   WaterView  a WorldLayer (0310's contract, docs/NATIVE-FREEDRIVE.md §9.4) that owns the sea: the tiles draw the seabed,
//              its waves bake in `encode`, its surface, wake and spray draw in `drawLate` with the world's light and air.
//              The GPU half: the cascades' compute pass at a capped rate per look (60 Hz Real, 24 Anime, 10 8-bit), one
//              draw for the whole surface, the wake ribbon and the spray. Textures are made once and reused; a map is
//              uploaded only when it was rebuilt.
//   WaterFX    cause and effect on the frame: the splash a hit on the water throws, the bow's spray and wake, the tyres'
//              sheets, the drips off a wet car; the sound and the hands for each.
// Signposts (Instruments → Points of Interest, com.mutaafaziz.coldgas): water-waves (the compute's encode), water-maps (a
// map or skyline build, off the main thread), water-draw.
import Foundation
import Metal
import simd
import os
import ColdGasCore
import ColdGasPhysics
import ColdGasWorld

extension Look {
    /// How often the water's waves are baked (Hz): Real at 60 (on a 120 Hz display, every other frame), Anime on twos as
    /// animation is drawn (24), 8-bit as stepped tiles (10). Extends the look; the shaders read the look's code.
    var waterHz: Double {
        switch self { case .real: 60; case .anime: 24; case .pixel: 10 }
    }
}

/// The water's signposts.
enum WaterSigns {
    static let poster = OSSignposter(subsystem: ReportCenter.subsystem, category: .pointsOfInterest)
}

// MARK: - The sea (CPU)

final class Sea {
    let world: FreeWorld
    let swell: [Wave], chop: [Wave]
    /// The waves' clock (s): the drive's ticks advance it; the GPU bakes at it.
    var time = 0.0
    private(set) var near: WaterMap?, mid: WaterMap?, far: WaterMap?
    private(set) var horizon: Horizon?
    /// Bumped each time a map or the skyline is replaced (the view uploads on a change).
    private(set) var generation = 0
    /// Any water within the maps' reach: the sea on the far map, a lake or a river on the finer ones.
    var wet: Bool { (far?.wet ?? false) || (mid?.wet ?? false) || (near?.wet ?? false) }
    private let queue = DispatchQueue(label: "coldgas.water", qos: .utility)
    private var building = false, horizonBuilding = false
    private var horizonAt = SIMD3<Double>(.infinity, 0, .infinity)
    static let nearCell = 4.0, midCell = 32.0, farCell = 320.0, nearN = 256, midN = 256, farN = 128

    init(world: FreeWorld) {
        self.world = world
        swell = Waves.swell(seed: world.seed)
        chop = Waves.chop(seed: world.seed)
    }

    /// Once a frame (main thread): rebuild what the eye has moved too far from, one map at a time, far first.
    func update(eye: SIMD3<Double>) {
        guard eye.x.isFinite, eye.z.isFinite else { return }
        if !building {
            func off(_ m: WaterMap?, _ limit: Double) -> Bool {
                guard let m else { return true }
                return abs(eye.x - m.cx) > limit || abs(eye.z - m.cz) > limit
            }
            let w = world
            var job: (() -> WaterMap)?
            var slot = 0
            if off(far, 8_000) {
                let c = snap(eye, 2048); job = { WaterMap.build(w, cx: c.x, cz: c.y, cell: Sea.farCell, n: Sea.farN, exact: false) }; slot = 2
            } else if off(mid, 2_000) {
                // (inland too: the lakes and the rivers, 0310, aren't on the far map)
                let c = snap(eye, 512); job = { WaterMap.build(w, cx: c.x, cz: c.y, cell: Sea.midCell, n: Sea.midN, exact: true) }; slot = 1
            } else if off(near, 256) {
                let c = snap(eye, 64); job = { WaterMap.build(w, cx: c.x, cz: c.y, cell: Sea.nearCell, n: Sea.nearN, exact: true) }; slot = 0
            }
            if let job {
                building = true
                queue.async { [weak self] in
                    let st = WaterSigns.poster.beginInterval("water-maps", id: WaterSigns.poster.makeSignpostID(), "map \(slot)")
                    let m = job()
                    WaterSigns.poster.endInterval("water-maps", st)
                    DispatchQueue.main.async {
                        guard let self else { return }
                        switch slot { case 0: self.near = m; case 1: self.mid = m; default: self.far = m }
                        // No water about: no skyline to reflect.
                        if !self.wet { self.horizon = nil }
                        self.building = false
                        self.generation &+= 1
                        self.horizonAt = SIMD3(.infinity, 0, .infinity)
                    }
                }
            }
        }
        // The skyline over the water, when the eye has moved 30 m or 3 m up or down.
        if wet && !horizonBuilding {
            let d = eye - horizonAt
            if d.x * d.x + d.z * d.z > 900 || abs(d.y) > 3 {
                horizonBuilding = true; horizonAt = eye
                let maps = [near, mid, far].compactMap { $0 }
                queue.async { [weak self] in
                    let st = WaterSigns.poster.beginInterval("water-maps", id: WaterSigns.poster.makeSignpostID(), "skyline")
                    let h = Horizon.build(eyeX: eye.x, eyeY: eye.y, eyeZ: eye.z, maps: maps)
                    WaterSigns.poster.endInterval("water-maps", st)
                    DispatchQueue.main.async {
                        guard let self else { return }
                        self.horizon = h; self.horizonBuilding = false; self.generation &+= 1
                    }
                }
            }
        }
    }
    private func snap(_ p: SIMD3<Double>, _ s: Double) -> SIMD2<Double> { SIMD2((p.x / s).rounded() * s, (p.z / s).rounded() * s) }

    /// The finest map holding (x, z) (nil off them all).
    @inline(__always) func map(_ x: Double, _ z: Double) -> WaterMap? {
        if let m = near, m.at(x, z) != nil { return m }
        if let m = mid, m.at(x, z) != nil { return m }
        if let m = far, m.at(x, z) != nil { return m }
        return nil
    }
    /// The ground above its water's still level at (x, z) from the finest map holding it (nil off them all).
    @inline(__always) func bed(_ x: Double, _ z: Double) -> Double? { map(x, z)?.at(x, z) }

    /// The water's surface at (x, z) now (the physics' level): the body's still level (the sea's, a lake's, a river's sloping
    /// one) and, on the open sea, the swell calmed toward the shore. −∞ with no water about; where the maps aren't built yet
    /// (a moment at a start), the world's own answer; on land, the still level (it's under the ground there).
    func level(_ x: Double, _ z: Double) -> Double {
        guard wet else { return -.infinity }
        guard let m = map(x, z), let b = m.at(x, z), let lv = m.level(x, z) else {
            let g = world.ground(x, z)
            return g.water.isFinite ? g.water : -.infinity
        }
        if b > 2 { return lv }
        let open = m.openSea(x, z)
        guard open > 0.01 else { return lv }
        let calm = Waves.calm(depth: -b) * open
        return lv + Waves.surface(swell, x, z, time, calm: calm)
    }
    /// The water's own velocity at (x, z) (m/s): a river's current downstream, 0 on still water and off the maps.
    func current(_ x: Double, _ z: Double) -> (Double, Double) {
        guard wet, let m = map(x, z), let b = m.at(x, z), b < 0 else { return (0, 0) }
        let f = m.flow(x, z)
        return (f.0 * WaterSpec.riverSpeed, f.1 * WaterSpec.riverSpeed)
    }
}

// MARK: - The GPU half

/// Water.metal's WaterU, WaveGPU, WakeGPU, SprayGPU.
struct WaterU { var grid = SIMD4<Float>(), centre = SIMD4<Float>(), nearMap = SIMD4<Float>(), midMap = SIMD4<Float>(), farMap = SIMD4<Float>(), cascades = SIMD4<Float>(), anchor = SIMD4<Float>(), sky = SIMD4<Float>(), refs = SIMD4<Float>() }
struct WaveGPU { var k = SIMD4<Float>(), p = SIMD4<Float>() }
struct WakeGPU { var a = SIMD4<Float>(), b = SIMD4<Float>() }
struct SprayGPU { var p = SIMD4<Float>(), v = SIMD4<Float>() }

/// The water's own bindings beside the world's fixed ones (§9.4: buffers 0, 2, 3 and textures 0–2 are a layer's; 15–17 are
/// past the world's table).
enum WaterBind {
    static let uniform = 2, instances = 3
    static let disp = 0, slope = 1, near = 2, mid = 15, far = 16, horizon = 17
}

final class WaterView: WorldLayer {
    static let size = 256, rings = 112, segments = 96
    /// Ring i at scale·(growthⁱ − 1): 0.4 m apart underfoot, ≈ 9 m at 100 m, the last at ≈ 40 km.
    static let growth: Float = 1.085, scale: Float = 4.3
    static let wakeCap = 256, sprayCap = 2048
    /// `-fd-skip water`: debug, the water left out (the A/B for its cost).
    static let off = WorldView.skip.contains("water")
    let sea: Sea
    private let device: MTLDevice
    private let wavesPipe: MTLComputePipelineState
    private let surfacePipe, wakePipe, sprayPipe: MTLRenderPipelineState
    private let dsWrite, dsRead: MTLDepthStencilState
    private let disp, slope: MTLTexture
    private let waveBuf: MTLBuffer
    private var nearTex, midTex, farTex, horizonTex: MTLTexture
    private let dummyMap: MTLTexture
    private var gen = -1
    private var nearMap: WaterMap?, midMap: WaterMap?, farMap: WaterMap?
    private var lastBake = -1.0, baked = false
    private var wakeBufs: [MTLBuffer] = [], sprayBufs: [MTLBuffer] = [], slot = 0
    let fx = WaterFX()
    /// The bench's counters: bakes this second, the last frame's segments and drops.
    private(set) var stats = (bakes: 0, wake: 0, drops: 0)

    init?(device: MTLDevice, sea: Sea) {
        self.device = device; self.sea = sea
        guard let lib = device.makeDefaultLibrary(), let k = lib.makeFunction(name: "cg_water_waves"),
              let cp = try? device.makeComputePipelineState(function: k) else { return nil }
        wavesPipe = cp
        func pipe(_ v: String, _ f: String) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = lib.makeFunction(name: v); d.fragmentFunction = lib.makeFunction(name: f)
            d.colorAttachments[0].pixelFormat = Renderer.hdrFormat
            if let c = d.colorAttachments[0] {   // premultiplied
                c.isBlendingEnabled = true
                c.sourceRGBBlendFactor = .one; c.destinationRGBBlendFactor = .oneMinusSourceAlpha
                c.sourceAlphaBlendFactor = .zero; c.destinationAlphaBlendFactor = .one
            }
            d.depthAttachmentPixelFormat = Renderer.depthFormat
            d.rasterSampleCount = Renderer.samples
            return try? device.makeRenderPipelineState(descriptor: d)
        }
        guard let s = pipe("cg_water_vertex", "cg_water_fragment"), let w = pipe("cg_wake_vertex", "cg_wake_fragment"),
              let p = pipe("cg_spray_vertex", "cg_spray_fragment") else { return nil }
        surfacePipe = s; wakePipe = w; sprayPipe = p
        let dw = MTLDepthStencilDescriptor(); dw.isDepthWriteEnabled = true; dw.depthCompareFunction = .less
        let dr = MTLDepthStencilDescriptor(); dr.isDepthWriteEnabled = false; dr.depthCompareFunction = .lessEqual
        guard let a = device.makeDepthStencilState(descriptor: dw), let b = device.makeDepthStencilState(descriptor: dr) else { return nil }
        dsWrite = a; dsRead = b
        func cascades() -> MTLTexture? {
            let d = MTLTextureDescriptor()
            d.textureType = .type2DArray; d.pixelFormat = .rgba16Float; d.width = WaterView.size; d.height = WaterView.size; d.arrayLength = 2
            d.mipmapLevelCount = Int(log2(Double(WaterView.size))) + 1
            d.usage = [.shaderRead, .shaderWrite]; d.storageMode = .private
            return device.makeTexture(descriptor: d)
        }
        guard let dt = cascades(), let st = cascades() else { return nil }
        disp = dt; slope = st
        dt.label = "water displacement"; st.label = "water slopes"
        var gpu: [WaveGPU] = []
        for (c, set) in [sea.swell, sea.chop].enumerated() {
            for w in set { gpu.append(WaveGPU(k: SIMD4(Float(w.kx), Float(w.kz), Float(w.amp), Float(w.omega)), p: SIMD4(Float(w.phase), Float(w.q), Float(c), 0))) }
        }
        guard let wb = device.makeBuffer(bytes: gpu, length: MemoryLayout<WaveGPU>.stride * gpu.count, options: .storageModeShared) else { return nil }
        waveBuf = wb
        let md = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float, width: 1, height: 1, mipmapped: false)
        let hd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rg16Float, width: 1, height: 1, mipmapped: false)
        guard let dm = device.makeTexture(descriptor: md), let hz = device.makeTexture(descriptor: hd) else { return nil }
        var deep: [Float16] = [-60, 0, 1, 0]   // deep open sea at the map's reference level
        dm.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &deep, bytesPerRow: 8)
        var none: [Float16] = [Float16(Horizon.none), 0]
        hz.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &none, bytesPerRow: 4)
        dummyMap = dm; nearTex = dm; midTex = dm; farTex = dm; horizonTex = hz
        for _ in 0..<Renderer.inFlight {
            if let b = device.makeBuffer(length: MemoryLayout<WakeGPU>.stride * WaterView.wakeCap, options: .storageModeShared) { wakeBufs.append(b) }
            if let b = device.makeBuffer(length: MemoryLayout<SprayGPU>.stride * WaterView.sprayCap, options: .storageModeShared) { sprayBufs.append(b) }
        }
        guard wakeBufs.count == Renderer.inFlight, sprayBufs.count == Renderer.inFlight else { return nil }
    }

    /// Anything to do this frame: water about, and not left out.
    var active: Bool { !WaterView.off && sea.wet }

    // MARK: WorldLayer (0310, §9.4)

    /// The water draws every body's surface itself, so the tiles carry the seabed under it (unless it's left out).
    var ownsSea: Bool { !WaterView.off }
    /// The waves' bake goes in the world's compute, before the frame's passes.
    func encode(_ w: WorldView, cmd: MTLCommandBuffer) { encode(cmd, look: Look.current) }
    /// The surface, the wake and the spray after the sky, with the world's bindings set (frame 1, look 4, drive 5, sky 8).
    func drawLate(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext) {
        let m = 4096.0
        let anchor = SIMD2<Float>(Float(c.origin.x - (c.origin.x / m).rounded(.down) * m), Float(c.origin.z - (c.origin.z / m).rounded(.down) * m))
        draw(e, anchor: anchor, eye: c.eye, origin: c.origin, style: c.look)
    }

    /// The cascades' bake, before the frame's passes, at the look's capped rate (the GPU's only per-frame water work
    /// besides the draw; nothing when there's no sea about).
    func encode(_ cmd: MTLCommandBuffer, look: Look) {
        guard active else { return }
        let t = sea.time
        if baked && t - lastBake < 1 / look.waterHz && t >= lastBake { return }
        let st = WaterSigns.poster.beginInterval("water-waves", id: WaterSigns.poster.makeSignpostID())
        defer { WaterSigns.poster.endInterval("water-waves", st) }
        // 8-bit's tiles step: its waves are baked at whole steps of the clock, so they jump as a sprite's frames do.
        let bakeT = look == .pixel ? (t * look.waterHz).rounded(.down) / look.waterHz : t
        lastBake = t; baked = true; stats.bakes += 1
        guard let e = cmd.makeComputeCommandEncoder() else { return }
        e.label = "water waves"
        e.setComputePipelineState(wavesPipe)
        e.setTexture(disp, index: 0); e.setTexture(slope, index: 1)
        e.setBuffer(waveBuf, offset: 0, index: 0)
        var u = SIMD4<Float>(Float(bakeT.truncatingRemainder(dividingBy: 4096 * 2 * .pi)), Float(WaterSpec.swellL), Float(WaterSpec.chopL), Float(WaterSpec.perCascade))
        e.setBytes(&u, length: 16, index: 1)
        let tg = MTLSize(width: 8, height: 8, depth: 1)
        e.dispatchThreadgroups(MTLSize(width: WaterView.size / 8, height: WaterView.size / 8, depth: 2), threadsPerThreadgroup: tg)
        e.endEncoding()
        if let b = cmd.makeBlitCommandEncoder() {
            b.label = "water mips"
            b.generateMipmaps(for: disp); b.generateMipmaps(for: slope)
            b.endEncoding()
        }
    }

    /// The maps and the skyline onto the GPU when the sea has rebuilt one (main thread, rare).
    private func upload() {
        guard gen != sea.generation else { return }
        gen = sea.generation
        func tex(_ m: WaterMap?, _ old: MTLTexture) -> MTLTexture {
            guard let m else { return dummyMap }
            let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float, width: m.n, height: m.n, mipmapped: false)
            d.usage = .shaderRead
            guard let t = device.makeTexture(descriptor: d) else { return dummyMap }
            // r: the ground above its water's level (− depth); g: that level against the map's reference (a half float holds
            // the offsets to ≈ 6 cm); b: the open sea (the swell) or a lake / river; a: spare.
            let ref = Float(m.ref)
            var px = [Float16](repeating: 0, count: m.n * m.n * 4)
            for i in 0..<(m.n * m.n) { px[i * 4] = Float16(m.h[i]); px[i * 4 + 1] = Float16(m.lv[i] - ref); px[i * 4 + 2] = Float16(m.open[i]) }
            px.withUnsafeBytes { t.replace(region: MTLRegionMake2D(0, 0, m.n, m.n), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: m.n * 8) }
            return t
        }
        // Only the maps that changed are made again (a map is kept by identity of its centre and size).
        func same(_ a: WaterMap?, _ b: WaterMap?) -> Bool { a?.cx == b?.cx && a?.cz == b?.cz && a?.n == b?.n && a?.cell == b?.cell && (a == nil) == (b == nil) }
        if !same(nearMap, sea.near) { nearMap = sea.near; nearTex = tex(sea.near, nearTex) }
        if !same(midMap, sea.mid) { midMap = sea.mid; midTex = tex(sea.mid, midTex) }
        if !same(farMap, sea.far) { farMap = sea.far; farTex = tex(sea.far, farTex) }
        if let h = sea.horizon {
            let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rg16Float, width: h.n, height: 1, mipmapped: false)
            d.usage = .shaderRead
            if let t = device.makeTexture(descriptor: d) {
                var px = [Float16](repeating: 0, count: h.n * 2)
                for i in 0..<h.n { px[i * 2] = Float16(h.tan[i]); px[i * 2 + 1] = Float16(min(h.dist[i], 60_000)) }
                px.withUnsafeBytes { t.replace(region: MTLRegionMake2D(0, 0, h.n, 1), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: h.n * 4) }
                horizonTex = t
            }
        }
    }

    /// The surface, the wake and the spray, in the main pass after the sky (WorldView.drawLate; the world's frame, look and
    /// drive are bound at 1, 4 and 5 for both stages).
    func draw(_ e: MTLRenderCommandEncoder, anchor: SIMD2<Float>, eye: SIMD3<Double>, origin: SIMD3<Double>, style: Look) {
        guard active else { return }
        let st = WaterSigns.poster.beginInterval("water-draw", id: WaterSigns.poster.makeSignpostID())
        defer { WaterSigns.poster.endInterval("water-draw", st) }
        upload()
        slot = (slot + 1) % Renderer.inFlight
        var u = WaterU()
        u.grid = SIMD4(Float(WaterView.rings), Float(WaterView.segments), WaterView.growth, WaterView.scale)
        u.centre = SIMD4(Float(eye.x - origin.x), Float(WaterSpec.level - origin.y), Float(eye.z - origin.z), Float(sea.time))
        func m(_ map: WaterMap?) -> SIMD4<Float> {
            guard let map else { return .zero }
            return SIMD4(Float(map.x0 - origin.x), Float(map.z0 - origin.z), Float(1 / map.span), 1)
        }
        u.nearMap = m(nearMap); u.midMap = m(midMap); u.farMap = m(farMap)
        u.cascades = SIMD4(Float(1 / WaterSpec.swellL), Float(1 / WaterSpec.chopL), 40_000, Float(WaterSpec.calmDepth))
        u.anchor = SIMD4(anchor.x, anchor.y, style.code, 1)
        u.sky = SIMD4(Float(sea.horizon?.n ?? 0), Float(WaterSpec.windDir), 0, 0)
        func ref(_ map: WaterMap?) -> Float { Float((map?.ref ?? WaterSpec.level) - origin.y) }
        u.refs = SIMD4(ref(nearMap), ref(midMap), ref(farMap), 0)
        e.setVertexBytes(&u, length: MemoryLayout<WaterU>.stride, index: WaterBind.uniform); e.setFragmentBytes(&u, length: MemoryLayout<WaterU>.stride, index: WaterBind.uniform)
        e.setVertexTexture(disp, index: WaterBind.disp); e.setFragmentTexture(slope, index: WaterBind.slope)
        e.setVertexTexture(nearTex, index: WaterBind.near); e.setVertexTexture(midTex, index: WaterBind.mid); e.setVertexTexture(farTex, index: WaterBind.far)
        e.setFragmentTexture(nearTex, index: WaterBind.near); e.setFragmentTexture(midTex, index: WaterBind.mid); e.setFragmentTexture(farTex, index: WaterBind.far)
        e.setFragmentTexture(horizonTex, index: WaterBind.horizon)
        // The surface: one draw.
        e.setRenderPipelineState(surfacePipe); e.setDepthStencilState(dsWrite); e.setCullMode(.none); e.setDepthBias(0, slopeScale: 0, clamp: 0)
        let verts = WaterView.rings * WaterView.segments * 6
        RenderStats.draw(indices: verts)
        e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: verts)
        // The wake, over it.
        let nw = fx.writeWake(into: wakeBufs[slot], cap: WaterView.wakeCap, origin: origin, time: sea.time)
        stats.wake = nw
        if nw > 0 {
            e.setRenderPipelineState(wakePipe); e.setDepthStencilState(dsRead); e.setDepthBias(-4, slopeScale: -1, clamp: 0)
            e.setVertexBuffer(wakeBufs[slot], offset: 0, index: WaterBind.instances)
            RenderStats.draw(indices: 6, instances: nw)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nw)
            e.setDepthBias(0, slopeScale: 0, clamp: 0)
        }
        // The spray, last.
        let nd = fx.writeSpray(into: sprayBufs[slot], cap: WaterView.sprayCap, origin: origin)
        stats.drops = nd
        if nd > 0 {
            e.setRenderPipelineState(sprayPipe); e.setDepthStencilState(dsRead)
            e.setVertexBuffer(sprayBufs[slot], offset: 0, index: WaterBind.instances)
            RenderStats.draw(indices: 6, instances: nd)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nd)
        }
    }
}

// MARK: - Cause and effect

/// The water's particles and trail (CPU, preallocated, no per-frame allocation): spray drops with gravity and the air's
/// drag that die in the water they fall back into, and the wake's points, which spread and fade.
final class WaterFX {
    private struct Drop { var p = SIMD3<Double>(), v = SIMD3<Double>(), size = 0.0, life = 0.0, age = 0.0, alpha = 0.0 }
    private struct Wake { var x = 0.0, z = 0.0, w = 0.0, born = -1e9, chain = 0 }
    private var drops = [Drop](repeating: Drop(), count: WaterView.sprayCap)
    private var dropHead = 0
    private var wake = [Wake](repeating: Wake(), count: WaterView.wakeCap)
    private var wakeHead = 0, chain = 0, lastWake = SIMD2<Double>(.infinity, .infinity)
    private var seed: UInt32 = 0x2545f491
    private(set) var live = 0
    /// The frame's state for FreeDrive.waterFrame: the wading rumble (0…1), emission accumulators, what was said.
    var rumble = 0.0, bowAcc = 0.0, dripAcc = 0.0, tyreAcc = [Double](repeating: 0, count: 4)
    var wasStalled = false, wasFloating = false, drownT = 0.0, adriftT = 0.0
    private func rnd() -> Double { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return Double(seed) / Double(UInt32.max) }
    private func sg() -> Double { rnd() * 2 - 1 }

    /// One drop (world metres): thrown at `v`, `size` m across, living up to `life` s.
    func drop(_ p: SIMD3<Double>, _ v: SIMD3<Double>, size: Double, life: Double, alpha: Double) {
        guard p.x.isFinite, p.y.isFinite, p.z.isFinite, v.x.isFinite, v.y.isFinite, v.z.isFinite else { return }
        drops[dropHead] = Drop(p: p, v: v, size: size, life: life, age: 0, alpha: alpha)
        dropHead = (dropHead + 1) % drops.count
    }
    /// A splash of strength k (0…1) at p, the car going `carV`: a crown of drops up and out, a sheet thrown ahead, mist.
    func splash(_ p: SIMD3<Double>, k: Double, carV: SIMD3<Double>) {
        let n = Int(30 + 220 * k)
        for _ in 0..<n {
            let a = rnd() * 2 * .pi, r = 0.5 + rnd() * 1.6 * (0.5 + k)
            let up = (2 + rnd() * 7) * (0.4 + k)
            let out = SIMD3(cos(a), 0, sin(a)) * (1 + rnd() * 4) * (0.5 + k)
            let v = carV * (0.25 + 0.35 * rnd()) + out + SIMD3(0, up, 0)
            drop(p + SIMD3(cos(a) * r, 0.05, sin(a) * r), v, size: 0.04 + rnd() * 0.07, life: 2.5, alpha: 0.75)
        }
        for _ in 0..<Int(k > 0.3 ? 6 + 24 * k : 0) {   // the mist off a big one: large, faint, slow
            let v = carV * 0.2 + SIMD3(sg() * 2, 1 + rnd() * 3 * k, sg() * 2)
            drop(p + SIMD3(sg() * 1.5, 0.3, sg() * 1.5), v, size: 0.3 + rnd() * 0.5 * k, life: 1.2, alpha: 0.06)
        }
    }
    /// A sheet off a tyre or the bow: `n` drops from p, thrown along `v` with spread.
    func sheet(_ p: SIMD3<Double>, _ v: SIMD3<Double>, n: Int, spread: Double, size: Double = 0.05) {
        for _ in 0..<n {
            drop(p + SIMD3(sg() * 0.15, sg() * 0.05, sg() * 0.15), v + SIMD3(sg(), rnd() * 0.6, sg()) * spread, size: size * (0.6 + rnd() * 0.8), life: 1.8, alpha: 0.6)
        }
    }
    /// The wake's next point under the car (world xz), `w` its half-width at birth; a gap starts a new trail.
    func wakePoint(x: Double, z: Double, w: Double, time: Double) {
        let d = SIMD2(x, z) - lastWake
        let gap = simd_length(d)
        if gap < 1.5 { return }
        if gap > 8 || !gap.isFinite { chain &+= 1 }
        lastWake = SIMD2(x, z)
        wake[wakeHead] = Wake(x: x, z: z, w: w, born: time, chain: chain)
        wakeHead = (wakeHead + 1) % wake.count
    }
    /// The trail breaks (the car left the water or was moved).
    func breakWake() { chain &+= 1; lastWake = SIMD2(.infinity, .infinity) }

    /// The drops' flight this frame: gravity, the air's drag, gone in the water (`level`) or when spent.
    func update(dt: Double, level: (Double, Double) -> Double) {
        guard dt > 0 else { return }
        let drag = exp(-dt * 0.9)
        var n = 0
        for i in drops.indices where drops[i].life > 0 {
            drops[i].age += dt
            if drops[i].age >= drops[i].life { drops[i].life = 0; continue }
            drops[i].v.y -= 9.81 * dt * (drops[i].size > 0.3 ? 0.15 : 1)   // mist hangs
            drops[i].v *= drag
            drops[i].p += drops[i].v * dt
            if drops[i].v.y < 0 && drops[i].p.y < level(drops[i].p.x, drops[i].p.z) { drops[i].life = 0; continue }
            n += 1
        }
        live = n
    }
    func clear() { for i in drops.indices { drops[i].life = 0 }; for i in wake.indices { wake[i].born = -1e9 }; breakWake() }

    func writeSpray(into buf: MTLBuffer, cap: Int, origin: SIMD3<Double>) -> Int {
        let out = buf.contents().bindMemory(to: SprayGPU.self, capacity: cap)
        var n = 0
        for d in drops where d.life > 0 && n < cap {
            let fade = (1 - d.age / d.life), a = d.alpha * fade * min(1, d.age * 20)
            out[n] = SprayGPU(p: SIMD4(Float(d.p.x - origin.x), Float(d.p.y - origin.y), Float(d.p.z - origin.z), Float(d.size * (1 + d.age * (d.size > 0.3 ? 1.5 : 0.2)))),
                              v: SIMD4(Float(d.v.x), Float(d.v.y), Float(d.v.z), Float(a)))
            n += 1
        }
        return n
    }
    /// The trail's segments: each point to the next one of its chain, both alive (≤ 10 s), as WakeGPU.
    func writeWake(into buf: MTLBuffer, cap: Int, origin: SIMD3<Double>, time: Double) -> Int {
        let out = buf.contents().bindMemory(to: WakeGPU.self, capacity: cap)
        var n = 0
        let N = wake.count
        for k in 0..<(N - 1) {
            let i = (wakeHead + k) % N, j = (i + 1) % N
            let a = wake[i], b = wake[j]
            guard a.chain == b.chain, time - a.born < 10, time - b.born < 10, a.born > -1e8, b.born > -1e8 else { continue }
            func pt(_ p: Wake) -> SIMD4<Float> {
                let age = time - p.born
                return SIMD4(Float(p.x - origin.x), Float(p.z - origin.z), Float(p.w + age * 0.9), Float(age))
            }
            out[n] = WakeGPU(a: pt(a), b: pt(b)); n += 1
            if n >= cap { break }
        }
        return n
    }
}

// MARK: - The drive's side

extension FreeDrive {
    /// Once a frame (from `effects`): what the water does that's seen, heard and felt. A splash where the car met the water
    /// (drops, a thud in the hands, the sound, a shake if it was big); the bow's spray off the nose and its wake while the
    /// car pushes through; rooster tails off wet tyres; drips off a wet car; a rumble while wading; the drive unit's cues.
    func waterFrame(_ dt: Double) {
        guard let fx = water?.fx else { return }
        let s = sea
        fx.update(dt: dt, level: { s.level($0, $1) })
        let wd = chassis.water
        guard sea.wet, cruise == nil, dt > 0 else { fx.rumble = 0; return }
        let q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w)
        let p = SIMD3(car.pos.x, car.pos.y, car.pos.z), v = SIMD3(car.vel.x, car.vel.y, car.vel.z)
        let fwd = q.act(SIMD3(0, 0, 1)), right = q.act(SIMD3(1, 0, 0)), up = SIMD3<Double>(0, 1, 0)
        let speed = simd_length(v)
        let splash = wd.drainSplash()
        if splash.k > 0.05 {
            fx.splash(SIMD3(splash.x, splash.y, splash.z), k: splash.k, carV: v)
            Sound.shared.splash(min(1, 0.25 + splash.k), seed: Int(truncatingIfNeeded: Int64(splash.x * 13 + splash.z * 7)) & 0xffff)
            HapticPlayer.shared.play(HapticEvent(kind: .hit, tick: 0, channel: 4, intensity: Float(0.3 + 0.65 * splash.k), sharpness: 0.15))
            if splash.k > 0.3 { camera.shake(Float(0.25 + 0.9 * splash.k)) }
        }
        // The bow: two sheets off the nose's corners, wider and higher with speed, and the wake behind.
        if wd.submerged > 0.02 && speed > 1.2 && !wd.floating {
            fx.bowAcc += dt * min(220, 8 + wd.bow * 0.05)
            let lvl = s.level(p.x, p.z)
            while fx.bowAcc >= 1 {
                fx.bowAcc -= 1
                for side in [-1.0, 1.0] {
                    var nose = p + q.act(SIMD3(side * 0.9, 0, WaterCar.z1 - 0.2))
                    nose.y = lvl + 0.05
                    let throwV = v * 0.55 + right * side * (1.5 + speed * 0.3) + up * (0.8 + speed * 0.28)
                    fx.sheet(nose, throwV, n: 1, spread: 0.6 + speed * 0.05)
                }
            }
            fx.wakePoint(x: p.x, z: p.z, w: 1.1, time: s.time)
        } else if wd.floating && speed > 0.5 {
            fx.wakePoint(x: p.x, z: p.z, w: 1.0, time: s.time)
        } else if !(wd.wheelDepth.contains { $0 > 0.02 }) {
            fx.breakWake()
        }
        // The tyres: a rooster tail off each wheel in the water (or still wet from it), more with depth and speed.
        for (i, w) in car.wheels.enumerated() where w.contact {
            let dep = wd.wheelDepth[i]
            let wetTyre = dep > 0.01 ? min(1, dep / 0.15) : wd.wet > 0.6 ? (wd.wet - 0.6) * 0.5 : 0
            let along = abs(w.omega) * wheelRadiusOf(i)
            guard wetTyre > 0, along > 3 else { fx.tyreAcc[i] = 0; continue }
            fx.tyreAcc[i] += dt * min(90, along * 4 * wetTyre)
            let a = WHEELS[i], hub = p + q.act(SIMD3(a.x, a.y - 0.3, a.z))
            while fx.tyreAcc[i] >= 1 {
                fx.tyreAcc[i] -= 1
                let tail = -fwd * (along * 0.25) + up * (1.5 + along * 0.18) + v * 0.4 + right * (a.x > 0 ? 1 : -1) * 0.8
                fx.sheet(hub, tail, n: 1, spread: 0.5 + along * 0.04, size: 0.035)
            }
            if dep > 0.02 { fx.wakePoint(x: p.x, z: p.z, w: 0.9, time: s.time) }
        }
        // Drips off a wet car out of the water: off the sills and the bumpers, fewer as it dries.
        if wd.wet > 0.15 && wd.submerged == 0 {
            fx.dripAcc += dt * 40 * wd.wet * (0.5 + wd.wetLine)
            while fx.dripAcc >= 1 {
                fx.dripAcc -= 1
                let r = Double.random(in: 0..<1), side = Double.random(in: -1...1)
                let local = r < 0.6 ? SIMD3(side > 0 ? 0.97 : -0.97, WaterCar.y0, WaterCar.z0 + Double.random(in: 0..<1) * (WaterCar.z1 - WaterCar.z0))
                                    : SIMD3(side * 0.9, WaterCar.y0 + 0.1, r < 0.8 ? WaterCar.z1 : WaterCar.z0)
                fx.drop(p + q.act(local), v + SIMD3(0, -0.3, 0), size: 0.02, life: 1.2, alpha: 0.5)
            }
        }
        // Felt and heard: the water's drag as a rumble in the hands.
        fx.rumble = min(0.8, wd.drag / 40_000 + (wd.floating ? 0.12 : 0))
        if wd.stalled != fx.wasStalled {
            fx.wasStalled = wd.stalled
            announce(wd.stalled ? "Drive unit flooded" : "Drive unit back")
            HapticPlayer.shared.play(HapticEvent(kind: .detent, tick: 0, channel: 5, intensity: 0.6, sharpness: wd.stalled ? 0.2 : 0.8))
        }
        if wd.floating && !fx.wasFloating { announce("Afloat") }
        fx.wasFloating = wd.floating
    }

    /// The tyres' wet for the sound (0…1): in the water, or still shedding it.
    var tyresWet: Double {
        let wd = chassis.water
        return wd.wheelDepth.contains { $0 > 0.003 } ? 1 : wd.wet * 0.6
    }

    /// The watchdog's water rules: drowned (all under, the drive unit dead) for 6 s, adrift and going nowhere for 25 s, or
    /// fallen deep: tow it out. A car afloat and moving (the jets work in the water) is left alone.
    func waterWatch(_ dt: Double) -> Bool {
        guard let fx = water?.fx else { return false }
        let wd = chassis.water
        fx.drownT = wd.submerged > 0.95 && wd.stalled ? fx.drownT + dt : 0
        let flat = (car.vel.x * car.vel.x + car.vel.z * car.vel.z).squareRoot()
        fx.adriftT = (wd.floating || wd.submerged > 0.3) && flat < 1 ? fx.adriftT + dt : 0
        let deep = car.pos.y < WaterSpec.level - 40
        if fx.drownT > 6 || fx.adriftT > 25 || deep { fx.drownT = 0; fx.adriftT = 0; return true }
        return false
    }
}
