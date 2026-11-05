// The stage renderer (docs/NATIVE.md §4, 0153). A frame:
//   1. shadow     the key light's depth map, a 2048² box that follows the car
//   2. main       HDR (rgba16Float), 4× MSAA in memoryless tile memory, resolved: sky, the stage, the parked row, the car,
//                 then the transparent and additive layers (paint, glass, LEDs, the plumes) in the web's draw order
//   3. film       exposure and tone into an LDR target at the render size
//   4. MetalFX    spatial upscale to the display, then a present pass into the drawable
// The render size is a scale of the display's, set by the governor: judged against the display's cadence (src/obs/
// ledger.js), pixels go first; thermal state and Low Power Mode cap it. Everything is built at launch, off the main
// thread, through the binary archive; nothing is allocated per frame (uniforms in a triple-buffered ring).
import Metal
#if canImport(MetalFX) && !targetEnvironment(simulator)
import MetalFX
#endif
import QuartzCore
import UIKit
import simd
import ColdGasCore
import ColdGasPhysics

struct FrameU {
    var viewProj = matrix_identity_float4x4, lightViewProj = matrix_identity_float4x4
    var eye = SIMD4<Float>(), keyDir = SIMD4<Float>(), keyColor = SIMD4<Float>(), fogColor = SIMD4<Float>(), fogRange = SIMD4<Float>()
}
struct LightU { var posRange = SIMD4<Float>(), colorIntensity = SIMD4<Float>(), dirCos = SIMD4<Float>(), params = SIMD4<Float>() }
struct MaterialU { var color = SIMD4<Float>(), emissive = SIMD4<Float>(), pbr = SIMD4<Float>(), uvTransform = SIMD4<Float>(1, 1, 0, 0), flags = SIMD4<UInt32>(), effect = SIMD4<Float>(), effectKind = SIMD4<UInt32>() }
struct ObjectU { var model = matrix_identity_float4x4, normal = matrix_identity_float4x4 }
struct PlumeU { var origin = SIMD4<Float>(), dir = SIMD4<Float>() }

final class Renderer {
    static let hdrFormat = MTLPixelFormat.rgba16Float, ldrFormat = MTLPixelFormat.bgra8Unorm, depthFormat = MTLPixelFormat.depth32Float
    static let drawableFormat = MTLPixelFormat.bgra8Unorm
    static let samples = 4, inFlight = 3, shadowSize = 2048

    let device: MTLDevice, queue: MTLCommandQueue
    let stage: Stage
    var replay: Replay?
    private let opaque, opaqueCullNone, blend, additive, sky, film, present, shadowPipe, plume: MTLRenderPipelineState
    private let sparkPipe, puffPipe, chipPipe, flashPipe: MTLRenderPipelineState
    let crash = Crash()
    private let sparkBufs: [MTLBuffer], puffBufs: [MTLBuffer], chipBufs: [MTLBuffer]
    /// The replay's own clock: real time scaled by the crash's slow-motion beat (crash.js timeScale).
    private var simClock = 0.0, lastT = -1.0
    private let dsWrite, dsRead, dsOff, dsShadow: MTLDepthStencilState
    private var stageMats: [[MaterialU]] = []
    private let lightsBuf: MTLBuffer
    private let frames: [MTLBuffer]
    private let plumes: [MTLBuffer]
    private var fi = 0
    private let gate = DispatchSemaphore(value: Renderer.inFlight)
    private var msaa, depth, hdr, ldr, upscaled: MTLTexture?
    private var shadowMap: MTLTexture
    #if canImport(MetalFX) && !targetEnvironment(simulator)
    private var scaler: MTLFXSpatialScaler?
    #endif
    private var renderSize = (0, 0), outSize = (0, 0)
    var hingeOpen: Float = 1
    /// A live run's draw time (s of sim time), set by the game each frame (0154).
    var liveTime = 0.0
    /// The crash's slow-motion factor, for the game's clock (a live run slows with the effects, as crash.js timeScale).
    var slowK: Double { Double(crash.slowK) }
    /// A new track (a new run, or back to the title's loop): effects and clocks start over.
    func setTrack(_ r: Replay?) { replay = r; simClock = 0; liveTime = 0; crash.reset() }
    private(set) lazy var dents = Dents(roadster: stage.roadster, parked: stage.parked)
    private var lastCarQ = simd_quatf(angle: 0, axis: [0, 1, 0]), lastDrawT = 0.0
    private func hookDents() {
        crash.onReset = { [unowned self] in self.dents.restore() }   // a new run, or a recorded run looping
        crash.dentHero = { [unowned self] probe, crush, n, salt in self.dents.hero(probe: probe, crush: crush, normal: n, carQ: self.lastCarQ, salt: salt) }
        crash.dentParked = { [unowned self] i, p, n, depth, salt in self.dents.parked(i, at: p, normal: n, model: self.parkedModel(i, t: self.lastDrawT), depth: depth, salt: salt) }
    }
    /// The governor's render scale (of the display's pixels).
    private(set) var scale: Float = Launch.value("-scale").flatMap(Float.init) ?? 0.8
    private var gpuEMA = 0.0, calm = 0
    let launchCompileMs: Double
    private(set) var compilesAfterLaunch = 0
    let nLights: Int
    private let dummy: MTLTexture
    let cam = Director()
    let passTimes = PassTimes()
    /// `-gpu-skip shadow,lights,translucent,metalfx,parked,static` (bench attribution only).
    let skip: Set<String> = Set((Launch.value("-gpu-skip") ?? "").split(separator: ",").map(String.init))

    init?(device: MTLDevice, course: String = "show", replay: Replay?) {
        let t0 = CACurrentMediaTime()
        self.device = device
        guard let q = device.makeCommandQueue(), let lib = device.makeDefaultLibrary(), let st = Stage(device: device, course: course) else { return nil }
        queue = q; stage = st; self.replay = replay
        let archive = PipelineArchive(device: device)
        let vd = MTLVertexDescriptor()
        for (i, (fmt, off)) in [(MTLVertexFormat.float3, 0), (.float3, 12), (.float2, 24), (.float3, 32)].enumerated() {
            vd.attributes[i].format = fmt; vd.attributes[i].offset = off; vd.attributes[i].bufferIndex = 0
        }
        vd.layouts[0].stride = 44
        func pipe(_ v: String, _ f: String?, color: MTLPixelFormat?, depth: Bool = true, samples: Int = Renderer.samples, vertex: MTLVertexDescriptor? = vd, blend: Int = 0) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = lib.makeFunction(name: v); d.fragmentFunction = f.flatMap { lib.makeFunction(name: $0) }
            d.vertexDescriptor = vertex
            if let color { d.colorAttachments[0].pixelFormat = color }
            if blend == 1 { d.colorAttachments[0].isBlendingEnabled = true; d.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha; d.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha }
            if blend == 2 { d.colorAttachments[0].isBlendingEnabled = true; d.colorAttachments[0].sourceRGBBlendFactor = .one; d.colorAttachments[0].destinationRGBBlendFactor = .one
                d.colorAttachments[0].sourceAlphaBlendFactor = .zero; d.colorAttachments[0].destinationAlphaBlendFactor = .one }
            if depth { d.depthAttachmentPixelFormat = Renderer.depthFormat }
            d.rasterSampleCount = samples
            return archive.pipeline(d)
        }
        guard let o = pipe("cg_stage_vertex", "cg_stage_fragment", color: Renderer.hdrFormat),
              let on = pipe("cg_stage_vertex", "cg_stage_fragment", color: Renderer.hdrFormat),
              let b = pipe("cg_stage_vertex", "cg_stage_fragment", color: Renderer.hdrFormat, blend: 1),
              let a = pipe("cg_stage_vertex", "cg_stage_fragment", color: Renderer.hdrFormat, blend: 2),
              let sk = pipe("cg_full_vertex", "cg_sky_fragment", color: Renderer.hdrFormat, vertex: nil),
              let fl = pipe("cg_full_vertex", "cg_film_fragment", color: Renderer.ldrFormat, depth: false, samples: 1, vertex: nil),
              let pr = pipe("cg_full_vertex", "cg_present_fragment", color: Renderer.drawableFormat, depth: false, samples: 1, vertex: nil),
              let sh = pipe("cg_shadow_vertex", nil, color: nil, samples: 1),
              let pl = pipe("cg_plume_vertex", "cg_plume_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2) else { return nil }
        opaque = o; opaqueCullNone = on; blend = b; additive = a; sky = sk; film = fl; present = pr; shadowPipe = sh; plume = pl
        guard let spk = pipe("cg_spark_vertex", "cg_spark_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2),
              let puf = pipe("cg_puff_vertex", "cg_puff_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 1),
              let chp = pipe("cg_chip_vertex", "cg_chip_fragment", color: Renderer.hdrFormat, vertex: nil),
              let fla = pipe("cg_puff_vertex", "cg_flash_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2) else { return nil }
        sparkPipe = spk; puffPipe = puf; chipPipe = chp; flashPipe = fla
        sparkBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<SparkGPU>.stride * Crash.NS, options: .storageModeShared)! }
        puffBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<PuffGPU>.stride * (Crash.NM + 1), options: .storageModeShared)! }
        chipBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<ChipGPU>.stride * Crash.NC, options: .storageModeShared)! }
        archive.save()
        func ds(_ w: Bool, _ c: MTLCompareFunction) -> MTLDepthStencilState { let d = MTLDepthStencilDescriptor(); d.isDepthWriteEnabled = w; d.depthCompareFunction = c; return device.makeDepthStencilState(descriptor: d)! }
        dsWrite = ds(true, .less); dsRead = ds(false, .lessEqual); dsOff = ds(false, .always); dsShadow = ds(true, .less)
        let sd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: Renderer.depthFormat, width: Renderer.shadowSize, height: Renderer.shadowSize, mipmapped: false)
        sd.usage = [.renderTarget, .shaderRead]; sd.storageMode = .private
        shadowMap = device.makeTexture(descriptor: sd)!
        let dd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
        dummy = device.makeTexture(descriptor: dd)!
        dummy.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: [UInt8](repeating: 255, count: 4), bytesPerRow: 4)
        // Lights: the course's spots and points (directional lights are the key, drawn with the shadow).
        var L: [LightU] = []
        for l in st.lights where l.kind == "SpotLight" || l.kind == "PointLight" {
            var u = LightU()
            u.posRange = SIMD4(l.position, l.distance)
            u.colorIntensity = SIMD4(l.color, l.intensity)
            if let t = l.target { u.dirCos = SIMD4(simd_normalize(t - l.position + 1e-6), 0) }
            u.params = SIMD4(l.decay, cos(l.angle), l.kind == "SpotLight" ? 1 : 0, l.penumbra)
            L.append(u)
        }
        nLights = L.count
        lightsBuf = device.makeBuffer(bytes: L.isEmpty ? [LightU()] : L, length: MemoryLayout<LightU>.stride * max(1, L.count), options: .storageModeShared)!
        frames = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<FrameU>.stride, options: .storageModeShared)! }
        plumes = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<PlumeU>.stride * 10, options: .storageModeShared)! }
        func mats(_ m: StageMesh) -> [MaterialU] { m.submeshes.map { s in
            let M = s.material; var u = MaterialU()
            u.color = SIMD4(M.color, M.transparent ? M.opacity : 1)
            u.emissive = SIMD4(M.emissive, M.unlit ? 1 : 0)
            u.pbr = SIMD4(M.metalness, M.roughness, M.clearcoat, M.clearcoatRoughness)
            if let t = M.map { let tx = st.textures[t]; u.uvTransform = SIMD4(tx.repeatUV.x, tx.repeatUV.y, tx.offset.x, tx.offset.y) }
            u.flags = SIMD4(M.map != nil ? 1 : 0, M.roughnessMap != nil ? 1 : 0, M.emissiveMap != nil ? 1 : 0, (M.vertexColors ? 1 : 0) | (M.fog ? 2 : 0))
            u.effect = SIMD4(M.effectColor, M.effectPower); u.effectKind = SIMD4(M.effect, M.alphaMap != nil ? 1 : 0, 0, 0)
            return u
        } }
        stageMats = [mats(st.staticMesh), mats(st.roadster)] + st.parked.map(mats) + st.wheels.flatMap { [mats($0.steerPart), mats($0.spinPart)] }
        launchCompileMs = (CACurrentMediaTime() - t0) * 1000
        applyThermal()
    }

    // --- The governor ------------------------------------------------------------------------------
    private var thermalCap: Float = 1
    func applyThermal() {
        let t = ProcessInfo.processInfo.thermalState, low = ProcessInfo.processInfo.isLowPowerModeEnabled
        thermalCap = t == .critical ? 0.55 : t == .serious ? 0.7 : low ? 0.75 : 1
        scale = min(scale, thermalCap)
    }
    /// After each frame's GPU time: down a step when the frame runs past the budget, up one after 2 s of headroom.
    func govern(gpuMs: Double, budgetMs: Double) {
        gpuEMA = gpuEMA == 0 ? gpuMs : gpuEMA * 0.9 + gpuMs * 0.1
        if Launch.value("-scale") != nil { return }   // a pinned scale (bench attribution)
        if gpuEMA > budgetMs * 0.85 && scale > 0.5 { scale = max(0.5, scale - 0.05); calm = 0; gpuEMA = 0 }
        else if gpuEMA < budgetMs * 0.55 { calm += 1; if calm > 240 && scale < thermalCap { scale = min(thermalCap, scale + 0.05); calm = 0 } }
        else { calm = 0 }
    }

    private func ensureTargets(outW: Int, outH: Int) {
        let rw = max(64, Int(Float(outW) * scale)), rh = max(64, Int(Float(outH) * scale))
        if renderSize == (rw, rh) && outSize == (outW, outH) { return }
        renderSize = (rw, rh); outSize = (outW, outH)
        func tex(_ f: MTLPixelFormat, _ w: Int, _ h: Int, ms: Bool, usage: MTLTextureUsage, memoryless: Bool) -> MTLTexture? {
            let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: f, width: w, height: h, mipmapped: false)
            if ms { d.textureType = .type2DMultisample; d.sampleCount = Renderer.samples }
            d.usage = usage; d.storageMode = memoryless ? .memoryless : .private
            return device.makeTexture(descriptor: d)
        }
        msaa = tex(Renderer.hdrFormat, rw, rh, ms: true, usage: .renderTarget, memoryless: true)
        depth = tex(Renderer.depthFormat, rw, rh, ms: true, usage: .renderTarget, memoryless: true)
        hdr = tex(Renderer.hdrFormat, rw, rh, ms: false, usage: [.renderTarget, .shaderRead], memoryless: false)
        ldr = tex(Renderer.ldrFormat, rw, rh, ms: false, usage: [.renderTarget, .shaderRead], memoryless: false)
        upscaled = tex(Renderer.ldrFormat, outW, outH, ms: false, usage: [.renderTarget, .shaderRead, .shaderWrite], memoryless: false)
        #if canImport(MetalFX) && !targetEnvironment(simulator)
        let sd = MTLFXSpatialScalerDescriptor()
        sd.inputWidth = rw; sd.inputHeight = rh; sd.outputWidth = outW; sd.outputHeight = outH
        sd.colorTextureFormat = Renderer.ldrFormat; sd.outputTextureFormat = Renderer.ldrFormat; sd.colorProcessingMode = .perceptual
        scaler = sd.makeSpatialScaler(device: device)
        #endif
    }

    /// One frame at time t (s) into `drawable`.
    func draw(into drawable: CAMetalDrawable, time t: Double, onGPU: ((Double) -> Void)? = nil) {
        gate.wait()
        let out = drawable.texture
        ensureTargets(outW: out.width, outH: out.height)
        guard let msaa, let depth, let hdr, let ldr, let upscaled else { gate.signal(); return }
        let fb = frames[fi], pb = plumes[fi]; fi = (fi + 1) % Renderer.inFlight

        // The car (and the run) at t, looping with a 2 s pause.
        var carM = matrix_identity_float4x4, carPos = SIMD3<Float>(0, Float(SPEC.comHeight), -6), carQ = simd_quatf(angle: 0, axis: [0, 1, 0])
        var nPlumes = 0, tick = 0
        var phase: UInt8 = 0
        let dtReal = lastT < 0 ? 0 : min(0.1, max(0, t - lastT)); lastT = t
        crash.update(Float(dtReal))
        simClock += dtReal * Double(crash.slowK)
        // A recorded run loops with a 2 s pause; a live one is drawn at the game's clock (one tick behind the sim, between
        // its last two ticks), never looped.
        var simT = simClock
        if let r = replay { simT = r.live ? liveTime : simClock.truncatingRemainder(dividingBy: r.seconds + 2) }
        if let r = replay, r.ticks > 0 {
            let tt = simT
            let c = r.car(at: tt)
            carPos = c.pos; carQ = c.quat; tick = c.tick; phase = r.phase(at: c.tick)
            lastCarQ = c.quat; lastDrawT = tt
            if crash.dentHero == nil { hookDents() }
            crash.feed(r.impacts, tick: c.tick + r.tickBase, vel: r.velocity(at: c.tick), carPos: c.pos, carQuat: c.quat)
            let p = pb.contents().bindMemory(to: PlumeU.self, capacity: 10)
            for k in 0..<10 {
                let thr = r.nozzle(k, at: tick)
                if thr < 0.04 { continue }
                let n = NOZZLE_SPEC[k]
                let o = carQ.act(SIMD3(Float(n.pos.0), Float(n.pos.1), Float(n.pos.2))) + carPos
                let d = carQ.act(-SIMD3(Float(n.dir.0), Float(n.dir.1), Float(n.dir.2)))   // the jet leaves against its thrust
                p[nPlumes] = PlumeU(origin: SIMD4(o, thr), dir: SIMD4(d, 0.6 + 2.2 * thr)); nPlumes += 1
            }
        }
        carM = translate(carPos) * simd_float4x4(carQ) * translate(SIMD3(0, -Float(SPEC.comHeight), 0))

        let aspect = Float(out.width) / Float(max(1, out.height))
        if cam.shakeHook == nil { cam.shakeHook = true; crash.shake = { [weak cam] a in cam?.shake(a) } }
        let view = cam.update(car: carPos, quat: carQ, phase: phase, time: t, aspect: aspect)
        let fx = crash.write(sparks: sparkBufs[fi].contents().bindMemory(to: SparkGPU.self, capacity: Crash.NS),
                             puffs: puffBufs[fi].contents().bindMemory(to: PuffGPU.self, capacity: Crash.NM + 1),
                             chips: chipBufs[fi].contents().bindMemory(to: ChipGPU.self, capacity: Crash.NC))
        var nPuffs = fx.1
        if let fl = crash.flash, nPuffs < Crash.NM + 1 {   // the flash rides at the end of the puff buffer
            puffBufs[fi].contents().bindMemory(to: PuffGPU.self, capacity: Crash.NM + 1)[nPuffs] = PuffGPU(pos: SIMD4(fl.pos, fl.size), color: SIMD4(1, 1, 1, fl.k)); nPuffs += 1
        }
        var camRight = SIMD4<Float>(view.view.columns.0.x, view.view.columns.1.x, view.view.columns.2.x, 0)
        var camUp = SIMD4<Float>(view.view.columns.0.y, view.view.columns.1.y, view.view.columns.2.y, 0)
        var u = FrameU()
        u.viewProj = view.proj * view.view
        let keyPos = carPos + stage.keyOffset, keyDir = simd_normalize(stage.keyOffset)
        let lv = lookAt(eye: keyPos, target: carPos, up: [0, 1, 0]), lp = ortho(-28, 28, -28, 28, 1, 140)
        u.lightViewProj = lp * lv
        u.eye = SIMD4(view.eye, Float(t))
        u.keyDir = SIMD4(keyDir, stage.keyIntensity)
        u.keyColor = SIMD4(stage.keyColor, skip.contains("lights") ? 0 : Float(nLights))
        u.fogColor = SIMD4(stage.fogColor, 1)
        u.fogRange = SIMD4(stage.fogNear, stage.fogFar, stage.exposure, 1 / Float(Renderer.shadowSize))
        fb.contents().storeBytes(of: u, as: FrameU.self)

        // -bench: each pass in its own command buffer, timed (passTimes), so one run attributes the GPU's frame.
        let split = Launch.bench
        guard var cmd = queue.makeCommandBuffer() else { gate.signal(); return }
        func cut(_ name: String) {
            guard split, let next = queue.makeCommandBuffer() else { return }
            let pt = passTimes
            cmd.addCompletedHandler { cb in pt.add(name, (cb.gpuEndTime - cb.gpuStartTime) * 1000) }
            cmd.commit(); cmd = next
        }
        // 1. shadow
        let sp = MTLRenderPassDescriptor()
        sp.depthAttachment.texture = shadowMap; sp.depthAttachment.loadAction = .clear; sp.depthAttachment.clearDepth = 1; sp.depthAttachment.storeAction = .store
        if !skip.contains("shadow"), let e = cmd.makeRenderCommandEncoder(descriptor: sp) {
            e.setRenderPipelineState(shadowPipe); e.setDepthStencilState(dsShadow); e.setDepthBias(1.5, slopeScale: 2.5, clamp: 0.01)
            e.setVertexBuffer(fb, offset: 0, index: 1)
            drawMesh(e, stage.staticMesh, matsIndex: 0, model: matrix_identity_float4x4, opaqueOnly: true, shadow: true)
            parkedDraw(e, t: simT, shadow: true)
            drawMesh(e, stage.roadster, matsIndex: 1, model: carM, opaqueOnly: true, shadow: true)
            wheelsDraw(e, carM: carM, t: simT, opaqueOnly: true, shadow: true)
            e.endEncoding()
        }
        cut("shadow")
        // 2. main (HDR, MSAA, resolved)
        let mp = MTLRenderPassDescriptor()
        mp.colorAttachments[0].texture = msaa; mp.colorAttachments[0].resolveTexture = hdr
        mp.colorAttachments[0].loadAction = .dontCare; mp.colorAttachments[0].storeAction = .multisampleResolve
        mp.depthAttachment.texture = depth; mp.depthAttachment.loadAction = .clear; mp.depthAttachment.clearDepth = 1; mp.depthAttachment.storeAction = .dontCare
        if let e = cmd.makeRenderCommandEncoder(descriptor: mp) {
            e.setDepthStencilState(dsOff); e.setRenderPipelineState(sky); e.setFragmentBuffer(fb, offset: 0, index: 1)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
            e.setVertexBuffer(fb, offset: 0, index: 1); e.setFragmentBuffer(fb, offset: 0, index: 1)
            e.setFragmentBuffer(lightsBuf, offset: 0, index: 3)
            e.setFragmentTexture(shadowMap, index: 3)
            if !skip.contains("static") { drawMesh(e, stage.staticMesh, matsIndex: 0, model: matrix_identity_float4x4, opaqueOnly: true) }
            if !skip.contains("parked") { parkedDraw(e, t: simT, shadow: false) }
            drawMesh(e, stage.roadster, matsIndex: 1, model: carM, opaqueOnly: true)
            wheelsDraw(e, carM: carM, t: simT, opaqueOnly: true, shadow: false)
            if !skip.contains("translucent") {
                drawMesh(e, stage.staticMesh, matsIndex: 0, model: matrix_identity_float4x4, opaqueOnly: false)
                drawMesh(e, stage.roadster, matsIndex: 1, model: carM, opaqueOnly: false)
            }
            if nPlumes > 0 {
                e.setRenderPipelineState(plume); e.setDepthStencilState(dsRead); e.setCullMode(.none)
                e.setVertexBuffer(pb, offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 12 * 3, instanceCount: nPlumes)
            }
            // crash.js's effects: chips (lit-ish solids), dust and smoke (blended), sparks and the flash (additive).
            if fx.2 > 0 { e.setRenderPipelineState(chipPipe); e.setDepthStencilState(dsWrite); e.setCullMode(.none); e.setVertexBuffer(chipBufs[fi], offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 36, instanceCount: fx.2) }
            let hasFlash = crash.flash != nil
            let nDust = hasFlash ? nPuffs - 1 : nPuffs
            if nDust > 0 { e.setRenderPipelineState(puffPipe); e.setDepthStencilState(dsRead); e.setVertexBuffer(puffBufs[fi], offset: 0, index: 2)
                e.setVertexBytes(&camRight, length: 16, index: 3); e.setVertexBytes(&camUp, length: 16, index: 4)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nDust) }
            if fx.0 > 0 { e.setRenderPipelineState(sparkPipe); e.setDepthStencilState(dsRead); e.setVertexBuffer(sparkBufs[fi], offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: fx.0) }
            if hasFlash { e.setRenderPipelineState(flashPipe); e.setDepthStencilState(dsOff); e.setVertexBuffer(puffBufs[fi], offset: MemoryLayout<PuffGPU>.stride * nDust, index: 2)
                e.setVertexBytes(&camRight, length: 16, index: 3); e.setVertexBytes(&camUp, length: 16, index: 4)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: 1) }
            e.endEncoding()
        }
        cut("main")
        // 3. film
        let fp = MTLRenderPassDescriptor()
        fp.colorAttachments[0].texture = ldr; fp.colorAttachments[0].loadAction = .dontCare; fp.colorAttachments[0].storeAction = .store
        if let e = cmd.makeRenderCommandEncoder(descriptor: fp) {
            e.setRenderPipelineState(film); e.setFragmentTexture(hdr, index: 0); e.setFragmentBuffer(fb, offset: 0, index: 1)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
        }
        cut("film")
        // 4. MetalFX, then present
        var shown: MTLTexture = ldr   // (the simulator has no MetalFX: the present pass upsamples bilinearly)
        #if canImport(MetalFX) && !targetEnvironment(simulator)
        if !skip.contains("metalfx"), let sc = scaler { sc.colorTexture = ldr; sc.outputTexture = upscaled; sc.encode(commandBuffer: cmd); shown = upscaled }
        #endif
        cut("metalfx")
        let pp = MTLRenderPassDescriptor()
        pp.colorAttachments[0].texture = out; pp.colorAttachments[0].loadAction = .dontCare; pp.colorAttachments[0].storeAction = .store
        if let e = cmd.makeRenderCommandEncoder(descriptor: pp) {
            e.setRenderPipelineState(present); e.setFragmentTexture(shown, index: 0)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
        }
        cmd.present(drawable)
        if split { let pt = passTimes; cmd.addCompletedHandler { cb in pt.add("present", (cb.gpuEndTime - cb.gpuStartTime) * 1000) } }
        let g = gate
        cmd.addCompletedHandler { [weak self] cb in
            let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
            onGPU?(ms)
            DispatchQueue.main.async { self?.govern(gpuMs: ms, budgetMs: 1000.0 / 120.0) }
            g.signal()
        }
        cmd.commit()
    }

    /// The wheels, as main.js syncCar places them: pivot y = wheelCenterY(compression) (ANCHOR_Y − restLen + c), the fronts
    /// turned by the steer, the spinning part turned about its axle by the wheel's spin.
    private func wheelsDraw(_ e: MTLRenderCommandEncoder, carM: simd_float4x4, t: Double, opaqueOnly: Bool, shadow: Bool) {
        let anchors = wheelAnchors()
        for w in stage.wheels {
            var comp: Float = Float(CAR.restLen - CAR.mountToCentre), spin: Float = 0, steer: Float = 0
            if let r = replay, r.ticks > 0 { let ws = r.wheel(w.index, at: t); comp = ws.comp; spin = ws.spin; steer = w.steers ? ws.steer : 0 }
            let anchorY = Float(anchors[w.index].1 + SPEC.comHeight)
            let y = anchorY - Float(CAR.restLen) + comp
            let pivot = carM * translate(SIMD3(w.x, y, w.z)) * simd_float4x4(simd_quatf(angle: steer, axis: [0, 1, 0]))
            let spinM = pivot * simd_float4x4(simd_quatf(angle: spin, axis: [1, 0, 0]))
            let base = 2 + stage.parked.count + w.index * 2
            drawMesh(e, w.steerPart, matsIndex: base, model: pivot, opaqueOnly: opaqueOnly, shadow: shadow)
            drawMesh(e, w.spinPart, matsIndex: base + 1, model: spinM, opaqueOnly: opaqueOnly, shadow: shadow)
        }
    }

    /// A parked vehicle's model matrix at t: its body's pose, the mesh turned a quarter (built along x, parked along z).
    private func parkedModel(_ i: Int, t: Double) -> simd_float4x4 {
        let quarter = simd_float4x4(simd_quatf(angle: .pi / 2, axis: [0, 1, 0]))
        if let r = replay, r.ticks > 0, i < r.bodyCount {
            let b = r.body(i, at: t)
            return translate(b.pos) * simd_float4x4(b.quat) * quarter
        }
        return translate(SIMD3(0, 0, Float(SHOW_BOXES[min(i, SHOW_BOXES.count - 1)].cz))) * quarter
    }

    private func parkedDraw(_ e: MTLRenderCommandEncoder, t: Double, shadow: Bool) {
        for (i, m) in stage.parked.enumerated() {
            let model = parkedModel(i, t: t)
            drawMesh(e, m, matsIndex: 2 + i, model: model, opaqueOnly: true, shadow: shadow)
            if !shadow { drawMesh(e, m, matsIndex: 2 + i, model: model, opaqueOnly: false) }
        }
    }

    private func drawMesh(_ e: MTLRenderCommandEncoder, _ m: StageMesh, matsIndex: Int, model: simd_float4x4, opaqueOnly: Bool, shadow: Bool = false) {
        var o = ObjectU(model: model, normal: model.inverse.transpose)
        e.setVertexBytes(&o, length: MemoryLayout<ObjectU>.stride, index: 2)
        e.setVertexBuffer(m.vertices, offset: 0, index: 0)
        let mats = stageMats[matsIndex]
        for (k, s) in m.submeshes.enumerated() {
            let M = s.material
            let translucent = M.transparent || M.additive
            if opaqueOnly == translucent { continue }
            if shadow && (M.unlit || translucent) { continue }
            if M.effect == 9 { continue }   // the web's sky dome: the native sky pass draws it
            if !shadow {
                e.setRenderPipelineState(M.additive ? additive : translucent ? blend : (M.doubleSided ? opaqueCullNone : opaque))
                e.setDepthStencilState(translucent || !M.depthWrite ? dsRead : dsWrite)
                e.setCullMode(M.doubleSided ? .none : .back)
                e.setFrontFacing(.counterClockwise)
                if let po = M.polygonOffset { e.setDepthBias(po.1 * 1e-5, slopeScale: po.0, clamp: 0) } else { e.setDepthBias(0, slopeScale: 0, clamp: 0) }
                var mu = mats[k]
                e.setFragmentBytes(&mu, length: MemoryLayout<MaterialU>.stride, index: 2)
                e.setFragmentTexture(M.map.flatMap { stage.textures[$0].texture } ?? dummy, index: 0)
                e.setFragmentTexture(M.roughnessMap.flatMap { stage.textures[$0].texture } ?? dummy, index: 1)
                e.setFragmentTexture(M.emissiveMap.flatMap { stage.textures[$0].texture } ?? dummy, index: 2)
                e.setFragmentTexture(M.alphaMap.flatMap { stage.textures[$0].texture } ?? dummy, index: 4)
            } else {
                e.setCullMode(.none)
            }
            e.drawIndexedPrimitives(type: .triangle, indexCount: s.indexCount, indexType: .uint32, indexBuffer: m.indices,
                                    indexBufferOffset: s.indexStart * 4, instanceCount: 1, baseVertex: s.vertexStart, baseInstance: 0)
        }
    }
}

/// Per-pass GPU milliseconds over a bench (thread-safe: completion handlers run off the main thread).
final class PassTimes {
    private var sum: [String: Double] = [:], n: [String: Int] = [:]
    private let lock = NSLock()
    func add(_ k: String, _ ms: Double) { lock.lock(); sum[k, default: 0] += ms; n[k, default: 0] += 1; lock.unlock() }
    func report() -> String {
        lock.lock(); defer { lock.unlock() }
        return ["shadow", "main", "film", "metalfx", "present"].compactMap { k in n[k].map { String(format: "%@ %.2f", k, sum[k, default: 0] / Double($0)) } }.joined(separator: " · ")
    }
}

/// Pipelines through an MTLBinaryArchive in Caches (device only: the simulator can't build archives).
final class PipelineArchive {
    private let device: MTLDevice
    private var archive: MTLBinaryArchive?
    private let url: URL
    private var dirty = false
    init(device: MTLDevice) {
        self.device = device
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pipelines-v2-\(build).metallib")
        #if targetEnvironment(simulator)
        archive = nil
        #else
        let d = MTLBinaryArchiveDescriptor()
        if FileManager.default.fileExists(atPath: url.path) { d.url = url }
        archive = (try? device.makeBinaryArchive(descriptor: d)) ?? (try? device.makeBinaryArchive(descriptor: MTLBinaryArchiveDescriptor()))
        #endif
    }
    func pipeline(_ d: MTLRenderPipelineDescriptor) -> MTLRenderPipelineState? {
        if let a = archive { d.binaryArchives = [a]; if (try? a.addRenderPipelineFunctions(descriptor: d)) != nil { dirty = true } }
        return try? device.makeRenderPipelineState(descriptor: d)
    }
    func save() { if dirty, let a = archive { try? a.serialize(to: url) } }
}

func translate(_ t: SIMD3<Float>) -> simd_float4x4 { var m = matrix_identity_float4x4; m.columns.3 = SIMD4(t, 1); return m }
func perspective(fovy: Float, aspect: Float, near: Float, far: Float) -> simd_float4x4 {
    let y = 1 / tan(fovy / 2), x = y / aspect, z = far / (near - far)
    return simd_float4x4(columns: (SIMD4(x, 0, 0, 0), SIMD4(0, y, 0, 0), SIMD4(0, 0, z, -1), SIMD4(0, 0, z * near, 0)))
}
func ortho(_ l: Float, _ r: Float, _ b: Float, _ t: Float, _ n: Float, _ f: Float) -> simd_float4x4 {
    simd_float4x4(columns: (SIMD4(2 / (r - l), 0, 0, 0), SIMD4(0, 2 / (t - b), 0, 0), SIMD4(0, 0, 1 / (n - f), 0),
                            SIMD4((l + r) / (l - r), (t + b) / (b - t), n / (n - f), 1)))
}
func lookAt(eye: SIMD3<Float>, target: SIMD3<Float>, up: SIMD3<Float>) -> simd_float4x4 {
    let f = simd_normalize(target - eye), s = simd_normalize(simd_cross(f, up)), u = simd_cross(s, f)
    return simd_float4x4(columns: (SIMD4(s.x, u.x, -f.x, 0), SIMD4(s.y, u.y, -f.y, 0), SIMD4(s.z, u.z, -f.z, 0),
                                   SIMD4(-simd_dot(s, eye), -simd_dot(u, eye), simd_dot(f, eye), 1)))
}
