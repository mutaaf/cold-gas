// The stage renderer (docs/NATIVE.md §4, 0153). A frame:
//   1. shadow     the key light's depth map, a 2048² box that follows the car
//   2. mirror     wet courses: the row, the car, the complex and what stands on the stage again, mirrored in y, at quarter size with
//                 no MSAA, then smeared; only the slab's material reads it (film.js's reflection, without its full pass, 0163)
//   3. main       HDR (rgba16Float), 4× MSAA in memoryless tile memory, resolved: the stage, the parked row, the car, the complex,
//                 the sky where it shows, then the transparent and additive layers (paint, glass, LEDs, the plumes) in the web's draw order
//   4. bloom      UnrealBloomPass's look: a high pass into a quarter-size chain, five halvings, one pass adds the levels
//   5. film       bloom, exposure and tone into an LDR target at the render size
//   6. MetalFX    spatial upscale to the display, then a present pass into the drawable
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
    var invViewProj = matrix_identity_float4x4
    var proj = SIMD4<Float>(), misc = SIMD4<Float>()
}
struct LookU {
    var hemiSky = SIMD4<Float>(), hemiGround = SIMD4<Float>(), hazeCol = SIMD4<Float>(), sunCol = SIMD4<Float>(), sunDir = SIMD4<Float>(), fogExp = SIMD4<Float>()
    var skyZenith = SIMD4<Float>(), skyMid = SIMD4<Float>(), skyHorizon = SIMD4<Float>(), skySun = SIMD4<Float>(), bloom = SIMD4<Float>()
    /// Free Drive's physical sky (0231): x on, y haze, z the eye's height (km), w night; the sun's illuminance (rgb) and the time.
    var atmo = SIMD4<Float>(), sunE = SIMD4<Float>()
}
struct GlintGPU { var pos = SIMD4<Float>(), color = SIMD4<Float>() }
struct GlintGroup { var size: Float = 0, minPx: Float = 0, tint: Float = 1, pad: Float = 0 }
struct LightU { var posRange = SIMD4<Float>(), colorIntensity = SIMD4<Float>(), dirCos = SIMD4<Float>(), params = SIMD4<Float>() }
struct MaterialU { var color = SIMD4<Float>(), emissive = SIMD4<Float>(), pbr = SIMD4<Float>(), uvTransform = SIMD4<Float>(1, 1, 0, 0), flags = SIMD4<UInt32>(), effect = SIMD4<Float>(), effectKind = SIMD4<UInt32>() }
struct ObjectU { var model = matrix_identity_float4x4, normal = matrix_identity_float4x4 }
struct PlumeU { var origin = SIMD4<Float>(), dir = SIMD4<Float>(), extra = SIMD4<Float>() }

final class Renderer {
    static let hdrFormat = MTLPixelFormat.rgba16Float, ldrFormat = MTLPixelFormat.bgra8Unorm, depthFormat = MTLPixelFormat.depth32Float
    static let drawableFormat = MTLPixelFormat.bgra8Unorm
    static let samples = 4, inFlight = 3, shadowSize = 2048
    /// The mist's fragments a frame (Plumes.updateBudget), in screens of overdraw: 2.8 M at the floor's 660×1434.
    static let mistScreens: Float = 3

    let device: MTLDevice, queue: MTLCommandQueue
    let stage: Stage
    /// The course this renderer was built for ("drive" for Free Drive, on the Show's stage).
    let courseKey: String
    var replay: Replay?
    private let opaque, opaqueCullNone, blend, additive, sky, film, present, shadowPipe, plume: MTLRenderPipelineState
    private let sparkPipe, puffPipe, chipPipe, flashPipe, mistPipe: MTLRenderPipelineState
    private let glintPipe, glowPipe, mirrorPipe, mirrorGlintPipe, smearPipe, bloomBright, bloomDown, bloomCompose: MTLRenderPipelineState
    private var lookU = LookU(), stageLook = LookU()
    /// Free Drive (docs/NATIVE-FREEDRIVE.md): the lens, the floating origin, the look and the world's draw come from the drive.
    var drive: DriveScene?
    private var driveRepairs = 0
    private let lampBuf, beaconBuf, glowBuf: MTLBuffer
    private let nLamps, nBeacons, nGlows: Int
    private let dsMirror: MTLDepthStencilState
    private var mirrorDepth, mirrorRaw, mirrorTex: MTLTexture?
    private var bloomChain: [MTLTexture] = [], bloomOut: MTLTexture?
    private var frontFace = MTLWinding.counterClockwise
    /// What's been shed to hold the frame once the resolution has nothing left to give (0 nothing; 1 the mirror; 2 and the lit air, half the
    /// mist's budget). Thermal state and Low Power Mode hold it up too; a debug line says so, Settings' cadence never moves. Pixels first, effects last.
    private(set) var shed = 0
    /// The drive's extras' quality (0231: the grass; the props' shadows): 2 full, 1 cut back, 0 off. Tied to the shed (heat,
    /// Low Power Mode, a frame still over budget at the resolution floor) and `-fd-quality <n>`.
    var quality: Int { min(Launch.value("-fd-quality").flatMap(Int.init) ?? 2, 2 - shed) }
    private var shedThermal = 0, overFrames = 0, underFrames = 0
    let crash = Crash()
    let mist = Plumes()
    private let sparkBufs: [MTLBuffer], puffBufs: [MTLBuffer], chipBufs: [MTLBuffer], mistBufs: [MTLBuffer]
    /// The valves this frame, and whether this run's touchdown has shown yet (main.js touchdown).
    private var thr = [Float](repeating: 0, count: 10), touched = false
    private let anchors = wheelAnchors()
    private let plumeLocal: [(pos: SIMD3<Float>, jet: SIMD3<Float>)] = NOZZLE_SPEC.map { n in
        (SIMD3(Float(n.pos.0), Float(n.pos.1), Float(n.pos.2)), -SIMD3(Float(n.dir.0), Float(n.dir.1), Float(n.dir.2)))
    }
    // Where the car's own materials sit in stageMats (their colours change per frame: applyCarMaterials).
    private let partBase, sweepBase, complexMats, blobSplit: Int
    private let subAmber, subMarker, subPlate, subAmbient, subGlass: Int
    private let glassMat: MaterialU?, crazedMat: MaterialU?
    private var sweepM: [simd_float4x4]
    /// A drive's wheels (0225): each spinning part with the aero disc's flat face cut out (the barrel kept), so the rotor and
    /// caliper show between the spokes; the rotor's submesh in each steer part, for its glow.
    private var openSpin: [StageMesh] = []
    private var rotorSub = -1
    let fxLog = Launch.args.contains("-fx-log")
    private var fxFrames = 0
    /// The replay's own clock: real time scaled by the crash's slow-motion beat (crash.js timeScale).
    private var simClock = 0.0, lastT = -1.0
    private let dsWrite, dsRead, dsOff, dsShadow: MTLDepthStencilState
    private var stageMats: [[MaterialU]] = []
    private let lightsBuf: MTLBuffer
    private let frames: [MTLBuffer], mirrorFrames: [MTLBuffer]
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
    func setTrack(_ r: Replay?) { replay = r; simClock = 0; liveTime = 0; crash.reset(); mist.clear(); touched = false; crash.car.placed(); cam.restart() }
    private(set) lazy var dents = Dents(roadster: driveCar?.body ?? stage.roadster, parked: stage.parked)
    /// The drive's own car (0232, DriveCarModel): its body and wheels in place of the stage roadster's, in Free Drive and the
    /// roams; its materials' places in stageMats, and each submesh the lamps and the crash drive by name.
    private var driveCar: DriveCarModel?
    private var carMats = 1, carFarMats = 1, driveWheelBase = -1
    private var dGlass = -1, dGlassFar = -1, dLamps: [(sub: Int, far: Int, kind: Int)] = []
    private var dGlassMat: MaterialU?, dCrazedMat: MaterialU?, dGlassFarMat: MaterialU?
    /// Road grime on the drive car (0 clean … 1), the drive's odometer since its last wash.
    var grime: Float = 0
    private var lastCarQ = simd_quatf(angle: 0, axis: [0, 1, 0]), lastDrawT = 0.0
    private func hookDents() {
        crash.onReset = { [unowned self] in self.dents.restore(); self.mist.clear(); self.touched = false; self.crash.car.placed() }   // a new run, or a recorded run looping
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
    /// Free Drive's physical sky (0231): its LUTs, drawn on first use.
    private var skyLUT: SkyLUT?
    private let library: MTLLibrary
    /// `-holds 12.1,12.5`: debug, for shots on a loaded machine: the replay's clock stops at each of these sim times, marks
    /// `hold:<t>` in the ready file and waits for Caches/coldgas.go to appear (scratch tooling removes it and shoots).
    private var holds: [Double] = (Launch.value("-holds") ?? "").split(separator: ",").compactMap { Double($0) }
    private func holdFrozen() -> Bool {
        guard let h = holds.first, simClock >= h else { return false }
        let go = Ready.url.deletingLastPathComponent().appendingPathComponent("coldgas.go")
        if !holdMarked { holdMarked = true; Ready.mark("hold:\(h)") }
        if FileManager.default.fileExists(atPath: go.path) { try? FileManager.default.removeItem(at: go); holds.removeFirst(); holdMarked = false; return false }
        return true
    }
    private var holdMarked = false
    /// `-fx-cam rear|front|top`: debug, a camera fixed to the car, for what `-cam close` can't see (the tail bar, the DRL, the canopy).
    private let fxCam = Launch.value("-fx-cam")
    private var heroClock = 0.0
    /// `-gpu-skip shadow,lights,translucent,metalfx,parked,static,plumes,mist,beams` and 0163's `env,stars,haze,wet,mirror,complex,lattice,floodbeams,glints,glows,bloom` (bench attribution only).
    let skip: Set<String> = Set((Launch.value("-gpu-skip") ?? "").split(separator: ",").map(String.init))

    init?(device: MTLDevice, course: String = "show", replay: Replay?) {
        let t0 = CACurrentMediaTime()
        self.device = device
        // Free Drive ("drive") stands on the Show's stage, a roam ("drive-wall", "drive-lineup") on its course's, at the centre.
        guard let q = device.makeCommandQueue(), let lib = device.makeDefaultLibrary(), let st = Stage(device: device, course: stageOf(course)) else { return nil }
        queue = q; stage = st; self.replay = replay; courseKey = course; library = lib
        if Launch.args.contains("-crash-log") || Launch.args.contains("-fx-log") { setvbuf(stdout, nil, _IOLBF, 0) }
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
              let sk = pipe("cg_sky_vertex", "cg_sky_fragment", color: Renderer.hdrFormat, vertex: nil),
              let fl = pipe("cg_full_vertex", "cg_film_fragment", color: Renderer.ldrFormat, depth: false, samples: 1, vertex: nil),
              let pr = pipe("cg_full_vertex", "cg_present_fragment", color: Renderer.drawableFormat, depth: false, samples: 1, vertex: nil),
              let sh = pipe("cg_shadow_vertex", nil, color: nil, samples: 1),
              let pl = pipe("cg_plume_vertex", "cg_plume_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2) else { return nil }
        opaque = o; opaqueCullNone = on; blend = b; additive = a; sky = sk; film = fl; present = pr; shadowPipe = sh; plume = pl
        guard let spk = pipe("cg_spark_vertex", "cg_spark_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2),
              let puf = pipe("cg_soft_vertex", "cg_puff_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 1),
              let mst = pipe("cg_mist_vertex", "cg_mist_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 1),
              let chp = pipe("cg_chip_vertex", "cg_chip_fragment", color: Renderer.hdrFormat, vertex: nil),
              let fla = pipe("cg_puff_vertex", "cg_flash_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2) else { return nil }
        sparkPipe = spk; puffPipe = puf; chipPipe = chp; flashPipe = fla; mistPipe = mst
        let lowHDR = MTLPixelFormat.rg11b10Float
        guard let gl = pipe("cg_glint_vertex", "cg_glint_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2),
              let gw = pipe("cg_glow_vertex", "cg_glow_fragment", color: Renderer.hdrFormat, vertex: nil, blend: 2),
              let mi = pipe("cg_stage_vertex", "cg_stage_fragment", color: lowHDR, samples: 1),
              let mg = pipe("cg_glint_vertex", "cg_glint_fragment", color: lowHDR, samples: 1, vertex: nil, blend: 2),
              let sm = pipe("cg_full_vertex", "cg_smear_fragment", color: lowHDR, depth: false, samples: 1, vertex: nil),
              let bb = pipe("cg_full_vertex", "cg_bloom_bright_fragment", color: lowHDR, depth: false, samples: 1, vertex: nil),
              let bd = pipe("cg_full_vertex", "cg_bloom_down_fragment", color: lowHDR, depth: false, samples: 1, vertex: nil),
              let bc = pipe("cg_full_vertex", "cg_bloom_compose_fragment", color: lowHDR, depth: false, samples: 1, vertex: nil) else { return nil }
        glintPipe = gl; glowPipe = gw; mirrorPipe = mi; mirrorGlintPipe = mg; smearPipe = sm; bloomBright = bb; bloomDown = bd; bloomCompose = bc
        sparkBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<SparkGPU>.stride * Crash.NS, options: .storageModeShared)! }
        puffBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<PuffGPU>.stride * (Crash.NM + 1), options: .storageModeShared)! }
        chipBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<ChipGPU>.stride * Crash.NC, options: .storageModeShared)! }
        mistBufs = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<PuffGPU>.stride * Plumes.maxMist, options: .storageModeShared)! }
        archive.save()
        func ds(_ w: Bool, _ c: MTLCompareFunction) -> MTLDepthStencilState { let d = MTLDepthStencilDescriptor(); d.isDepthWriteEnabled = w; d.depthCompareFunction = c; return device.makeDepthStencilState(descriptor: d)! }
        dsWrite = ds(true, .less); dsRead = ds(false, .lessEqual); dsOff = ds(false, .always); dsShadow = ds(true, .less); dsMirror = ds(true, .less)
        let sd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: Renderer.depthFormat, width: Renderer.shadowSize, height: Renderer.shadowSize, mipmapped: false)
        sd.usage = [.renderTarget, .shaderRead]; sd.storageMode = .private
        shadowMap = device.makeTexture(descriptor: sd)!
        let dd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
        dummy = device.makeTexture(descriptor: dd)!
        dummy.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: [UInt8](repeating: 255, count: 4), bytesPerRow: 4)
        // Lights: the course's spots and points (directional lights are the key, drawn with the shadow).
        var L: [LightU] = []
        for l in st.lights where l.kind == "SpotLight" || l.kind == "PointLight" || l.kind == "DirectionalLight" {
            var u = LightU()
            u.posRange = SIMD4(l.position, l.distance)
            u.colorIntensity = SIMD4(l.color, l.intensity)
            if l.kind == "DirectionalLight" { u.dirCos = SIMD4(simd_normalize(l.position - (l.target ?? .zero) + 1e-6), 0) }
            else if let t = l.target { u.dirCos = SIMD4(simd_normalize(t - l.position + 1e-6), cos(l.angle * (1 - l.penumbra))) }
            u.params = SIMD4(l.decay, cos(l.angle), l.kind == "SpotLight" ? 1 : l.kind == "DirectionalLight" ? 2 : 0, l.penumbra)
            L.append(u)
        }
        // A roam (0225): the Show's and the Wall's red is a run's signal; on a drive round the set it washed the frame (the
        // floor read red end to end). As the web's deck look (0187, 0193) does on the run-up: the red lights and the red
        // air at 30 %, the LED strips dimmed to a red their core keeps (Renderer.toneRoam below, for the materials).
        let roam = isDrive(course)
        if roam { for i in L.indices where L[i].colorIntensity.x > 0.9 && L[i].colorIntensity.y < 0.1 { L[i].colorIntensity.w *= 0.3 } }
        nLights = L.count
        lightsBuf = device.makeBuffer(bytes: L.isEmpty ? [LightU()] : L, length: MemoryLayout<LightU>.stride * max(1, L.count), options: .storageModeShared)!
        frames = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<FrameU>.stride, options: .storageModeShared)! }
        mirrorFrames = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<FrameU>.stride, options: .storageModeShared)! }
        plumes = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<PlumeU>.stride * 10, options: .storageModeShared)! }
        func mats(_ m: StageMesh) -> [MaterialU] { m.submeshes.map { s in
            let M = s.material; var u = MaterialU()
            u.color = SIMD4(M.color, M.transparent ? M.opacity : 1)
            u.emissive = SIMD4(M.emissive, M.unlit ? 1 : 0)
            u.pbr = SIMD4(M.metalness, M.roughness, M.clearcoat, M.clearcoatRoughness)
            if let t = M.map { let tx = st.textures[t]; u.uvTransform = SIMD4(tx.repeatUV.x, tx.repeatUV.y, tx.offset.x, tx.offset.y) }
            u.flags = SIMD4(M.map != nil ? 1 : 0, M.roughnessMap != nil ? 1 : 0, M.emissiveMap != nil ? 1 : 0, (M.vertexColors ? 1 : 0) | (M.fog ? 2 : 0))
            u.effect = SIMD4(M.effectColor, M.effectPower); u.effectKind = SIMD4(M.effect, M.alphaMap != nil ? 1 : 0, M.wet ? 1 : 0, M.additive ? 1 : 0)
            return u
        } }
        func toneRoam(_ list: [MaterialU]) -> [MaterialU] {
            guard roam else { return list }
            return list.map { u in
                var u = u
                let c = u.color, red = c.x > 0.8 && c.y < c.x * 0.2 && c.z < c.x * 0.3
                if u.emissive.w > 0.5 && red { u.color = SIMD4(SIMD3(c.x, c.y, c.z) * 0.35, c.w) }
                let e = u.effect, redFx = e.x > 0.8 && e.y < 0.2
                if (u.effectKind.x == 2 || u.effectKind.x == 3) && redFx { u.effect.w *= 0.3 }
                return u
            }
        }
        stageMats = [toneRoam(mats(st.staticMesh)), mats(st.roadster)] + st.parked.map(mats) + st.wheels.flatMap { [mats($0.steerPart), mats($0.spinPart)] }
        partBase = stageMats.count
        stageMats += st.parts.map(mats)
        sweepBase = stageMats.count
        if let sw = st.sweep { stageMats += [mats(sw.beam), mats(sw.head), mats(sw.lens)] }
        complexMats = stageMats.count
        if let c = st.complex { stageMats.append(mats(c.mesh)) }
        // The sets' surfaces get their own procedural detail (0233, Shaders.metal effect 13): concrete's aggregate, stains and
        // tyre marks, metal's brushing and scratches, roughness that varies. Only lit, opaque, plain materials (the slab's
        // wet look, the beams, glows and lamps keep theirs). `-flat-sets` turns it off for comparison.
        if !Launch.args.contains("-flat-sets") {
            for i in [0, complexMats] where i < stageMats.count {
                let mesh = i == 0 ? st.staticMesh : st.complex?.mesh
                for (k, sm) in (mesh?.submeshes ?? []).enumerated() where k < stageMats[i].count {
                    let M = sm.material
                    if M.unlit || M.transparent || M.additive || M.effect != 0 || M.roughness < 0.2 { continue }
                    stageMats[i][k].effectKind.x = 13
                }
            }
        }
        sweepM = [simd_float4x4](repeating: matrix_identity_float4x4, count: st.sweep?.pivots.count ?? 0)
        // scene.js BLOB_ORDER: the hero's contact shadow over the paint (order -3), under the glows and LEDs (-2 and up).
        blobSplit = st.staticMesh.submeshes.firstIndex { $0.renderOrder > -3 } ?? st.staticMesh.submeshes.count
        func sub(_ name: String) -> Int { st.roadster.submeshes.firstIndex { $0.material.name == name } ?? -1 }
        subAmber = sub("roadster-amber"); subMarker = sub("roadster-marker"); subPlate = sub("roadster-plateLamp"); subAmbient = sub("roadster-ambient"); subGlass = sub("roadster-glass")
        if subGlass >= 0 {
            glassMat = stageMats[1][subGlass]
            var cz = stageMats[1][subGlass]   // crash.js `crazed`: the glass gone milky
            cz.color = SIMD4(srgbHexToLinear(0x9a8a74), 0.9); cz.pbr = SIMD4(0.15, 0.55, 0, 0)
            crazedMat = cz
        } else { glassMat = nil; crazedMat = nil }
        // The look's constants. A skipped feature zeroes its switch, and the shader's branch takes its fetches out too.
        let off = Set((Launch.value("-gpu-skip") ?? "").split(separator: ",").map(String.init))
        var lk = LookU()
        lk.hemiSky = SIMD4(st.hemiSky, off.contains("env") || st.env == nil ? 0 : st.envIntensity)
        lk.hemiGround = SIMD4(st.hemiGround, st.dusk ? 1 : 0)
        lk.hazeCol = SIMD4(st.hazeColor, off.contains("haze") ? 0 : st.hazeA)
        lk.sunCol = SIMD4(st.sunColor, st.hazeB); lk.sunDir = SIMD4(simd_normalize(st.sunDir + SIMD3(0, 1e-6, 0)), st.vignette)
        lk.fogExp = SIMD4(st.fogDensity, off.contains("wet") || st.wetMask == nil ? 0 : 1, off.contains("stars") ? 0 : 1, off.contains("bloom") || st.bloomStrength <= 0 ? 0 : 1)
        lk.skyZenith = SIMD4(st.skyZenith, 0); lk.skyMid = SIMD4(st.skyMid, 0); lk.skyHorizon = SIMD4(st.skyHorizon, 0); lk.skySun = SIMD4(st.skySun, 0)
        // UnrealBloomPass composite: strength × lerp(factor, 1.2 − factor, radius) per mip.
        func factor(_ f: Float) -> Float { st.bloomStrength * (f + (1.2 - f - f) * st.bloomRadius) }
        // The bloom's threshold (0233): the web's 0.82 let a white car under the set's searchlights bloom into a glowing blob on
        // the title and a run's opening. 1.6 keeps the LEDs, lamps, beams and jets blooming (all well over 2) and the paint
        // crisp.
        lk.bloom = SIMD4(max(st.bloomThreshold, Launch.args.contains("-web-bloom") ? 0 : 1.6), factor(0.9), factor(0.5), factor(0.2))
        lookU = lk; stageLook = lk
        func glintBuf(_ s: StageComplex.Spots?) -> (MTLBuffer, Int) {
            let list = s.map { sp in zip(sp.spots, sp.colors).map { GlintGPU(pos: $0, color: SIMD4($1, 0)) } } ?? []
            return (device.makeBuffer(bytes: list.isEmpty ? [GlintGPU()] : list, length: MemoryLayout<GlintGPU>.stride * max(1, list.count), options: .storageModeShared)!, list.count)
        }
        (lampBuf, nLamps) = glintBuf(st.complex?.lamps)
        (beaconBuf, nBeacons) = glintBuf(st.complex?.beacons)
        let gl2 = st.glows.map { GlintGPU(pos: SIMD4($0.pos, $0.radius), color: SIMD4($0.color * st.glowScale, 0)) }
        glowBuf = device.makeBuffer(bytes: gl2.isEmpty ? [GlintGPU()] : gl2, length: MemoryLayout<GlintGPU>.stride * max(1, gl2.count), options: .storageModeShared)!
        nGlows = gl2.count
        launchCompileMs = (CACurrentMediaTime() - t0) * 1000
        crash.configure(layout: st.layout, paints: st.paints)
        if isDrive(course) {
            // A drive's car (0225): a full, glossy clear coat over the paint (the scored runs keep the web's satin), so the dusk
            // and the set's lights lie across its panels.
            if let i = st.roadster.submeshes.firstIndex(where: { $0.material.name == "roadster-paint" }) {
                stageMats[1][i].pbr = SIMD4(0.08, 0.3, 1.0, 0.05)
            }
            openSpin = st.wheels.map { Renderer.openFace(device: device, $0.spinPart) }
            rotorSub = st.wheels.first?.steerPart.submeshes.firstIndex { $0.material.name == "roadster-rotor" } ?? -1
        }
        // The forged car (0232) on every course since 0233: the scored runs' cameras see the same body (pixels only; the sim
        // never sees a mesh). `-roadster` (or a drive's `-fd-roadster`) draws the stage roadster instead.
        if !Launch.args.contains("-roadster") && !(roam && Launch.args.contains("-fd-roadster")), let dc = DriveCarModel(device: device) {
            // The forged car (0232): its materials after the stage's. Paint (11) gets the flakes and the grime, the rest of
            // the outside (12) the grime only (Shaders.metal).
            func carMatsOf(_ m: StageMesh) -> [MaterialU] {
                var list = mats(m)
                for (k, sm) in m.submeshes.enumerated() {
                    let n = sm.material.name
                    if n == "drive-paint" {
                        list[k].effectKind.x = 11
                        // A real white's albedo (≈ 0.6), not paper's: the car holds its shape under the set's lights and the sun.
                        list[k].color = SIMD4(SIMD3(list[k].color.x, list[k].color.y, list[k].color.z) * 0.8, list[k].color.w)
                    }
                    else if ["drive-trim", "drive-under", "drive-gloss-black", "drive-carbon", "drive-tyre", "drive-rim", "drive-rim-barrel", "drive-satin", "drive-plate", "drive-rubber-seal"].contains(n) { list[k].effectKind.x = 12 }
                }
                return list
            }
            carMats = stageMats.count; stageMats.append(carMatsOf(dc.body))
            carFarMats = stageMats.count; stageMats.append(carMatsOf(dc.bodyFar))
            driveWheelBase = stageMats.count
            for w in st.wheels { stageMats.append(carMatsOf(w.steers ? dc.frontSteer : dc.rearSteer)); stageMats.append(carMatsOf(w.steers ? dc.frontSpin : dc.rearSpin)) }
            rotorSub = dc.frontSteer.submeshes.firstIndex { $0.material.name == "roadster-rotor" } ?? -1
            func idx(_ m: StageMesh, _ name: String) -> Int { m.submeshes.firstIndex { $0.material.name == name } ?? -1 }
            dGlass = idx(dc.body, "drive-glass"); dGlassFar = idx(dc.bodyFar, "drive-glass")
            if dGlass >= 0 {
                dGlassMat = stageMats[carMats][dGlass]
                var cz = stageMats[carMats][dGlass]; cz.color = SIMD4(srgbHexToLinear(0x9a8a74), 0.9); cz.pbr = SIMD4(0.15, 0.55, 0, 0)
                dCrazedMat = cz
            }
            if dGlassFar >= 0 { dGlassFarMat = stageMats[carFarMats][dGlassFar] }
            // Lamps by name: 0 amber, 1 marker, 2 plate lamp, 3 ambient, 4 DRL, 5 tail.
            for (kind, name) in ["drive-amber", "drive-marker", "drive-plateLamp", "drive-ambient", "drive-drl", "drive-tail"].enumerated() {
                dLamps.append((idx(dc.body, name), idx(dc.bodyFar, name), kind))
            }
            driveCar = dc
        }
        applyThermal()
    }
    /// The spinning part with the aero disc's flat face (normals along the axle, x) taken out of the disc's submesh.
    private static func openFace(device: MTLDevice, _ m: StageMesh) -> StageMesh {
        guard let di = m.submeshes.firstIndex(where: { $0.material.name == "roadster-disc" }) else { return m }
        let vf = m.vertices.contents().bindMemory(to: Float.self, capacity: m.vertices.length / 4)
        let ix = m.indices.contents().bindMemory(to: UInt32.self, capacity: m.indices.length / 4)
        var out: [UInt32] = [], subs: [StageSubmesh] = []
        for (k, s) in m.submeshes.enumerated() {
            let start = out.count
            for t in stride(from: 0, to: s.indexCount, by: 3) {
                let a = Int(ix[s.indexStart + t]), b = Int(ix[s.indexStart + t + 1]), c = Int(ix[s.indexStart + t + 2])
                if k == di {
                    let nx = abs(vf[(s.vertexStart + a) * 11 + 3]) + abs(vf[(s.vertexStart + b) * 11 + 3]) + abs(vf[(s.vertexStart + c) * 11 + 3])
                    if nx > 2.4 { continue }   // all three facing along the axle: the flat face
                }
                out += [UInt32(a), UInt32(b), UInt32(c)]
            }
            subs.append(StageSubmesh(material: s.material, renderOrder: s.renderOrder, vertexStart: s.vertexStart, vertexCount: s.vertexCount,
                                     indexStart: start, indexCount: out.count - start, top: s.top))
        }
        guard let ib = device.makeBuffer(bytes: out, length: max(4, out.count * 4), options: .storageModeShared) else { return m }
        return StageMesh(vertices: m.vertices, indices: ib, submeshes: subs)
    }

    // --- The governor ------------------------------------------------------------------------------
    private var thermalCap: Float = 1
    func applyThermal() {
        let t = ProcessInfo.processInfo.thermalState, low = ProcessInfo.processInfo.isLowPowerModeEnabled
        thermalCap = t == .critical ? 0.55 : t == .serious ? 0.7 : low ? 0.75 : 1
        scale = min(scale, thermalCap)
        // Hot or saving power: the mirror goes before any frame does (0163); at critical, the lit air and half the mist too.
        shedThermal = t == .critical ? 2 : (t == .serious || low) ? 1 : 0
        shed = max(shed, shedThermal)
    }
    /// After each frame's GPU time: down a step when the frame runs past the budget, up one after 2 s of headroom.
    func govern(gpuMs: Double, budgetMs: Double) {
        gpuEMA = gpuEMA == 0 ? gpuMs : gpuEMA * 0.9 + gpuMs * 0.1
        if Launch.value("-scale") != nil { return }   // a pinned scale (bench attribution)
        #if !targetEnvironment(simulator)   // (the simulator's GPU says nothing about the phone's)
        // At the floor, with the frame still over: effects go, one at a time, 2 s apart; they come back only after 15 s well under.
        if scale <= 0.5 && gpuEMA > budgetMs * 0.92 { overFrames += 1; underFrames = 0 } else { overFrames = 0; if gpuEMA < budgetMs * 0.7 { underFrames += 1 } else { underFrames = 0 } }
        if overFrames > 240 && shed < 2 { shed += 1; overFrames = 0; print("LOOK shed \(shed): GPU \(String(format: "%.2f", gpuEMA)) ms at the resolution floor") }
        if underFrames > 1800 && shed > shedThermal { shed -= 1; underFrames = 0; print("LOOK shed \(shed): headroom again") }
        #endif
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
        // Quarter size: the mirror, and bloom's chain from there down, halved five times.
        let qw = max(16, rw / 4), qh = max(16, rh / 4), low = MTLPixelFormat.rg11b10Float
        mirrorDepth = tex(Renderer.depthFormat, qw, qh, ms: false, usage: .renderTarget, memoryless: true)
        mirrorRaw = tex(low, qw, qh, ms: false, usage: [.renderTarget, .shaderRead], memoryless: false)
        mirrorTex = tex(low, qw, qh, ms: false, usage: [.renderTarget, .shaderRead], memoryless: false)
        bloomChain = (0..<6).compactMap { i in tex(low, max(4, qw >> i), max(4, qh >> i), ms: false, usage: [.renderTarget, .shaderRead], memoryless: false) }
        bloomOut = tex(low, qw, qh, ms: false, usage: [.renderTarget, .shaderRead], memoryless: false)
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
        var dtReal = lastT < 0 ? 0 : min(0.1, max(0, t - lastT)); lastT = t
        if !holds.isEmpty && holdFrozen() { dtReal = 0 }
        heroClock += dtReal   // S.time: real seconds, each frame's capped at 0.1, as main.js adds them
        if let d = drive {
            if d.repairs != driveRepairs { driveRepairs = d.repairs; crash.repair() }
            d.effects(crash, dt: dtReal)
            let cl = d.carLook
            crash.car.pedal = cl.pedal
            grime = cl.grime
            if rotorSub >= 0 {
                for w in stage.wheels {
                    // Iron glowing: a deep red, toward orange as it heats; bright enough to bloom.
                    let g = cl.glow[w.index], hot = SIMD3<Float>(1, 0.06 + 0.22 * g, 0.01 + 0.03 * g) * (g * 3.2)
                    stageMats[(driveWheelBase >= 0 ? driveWheelBase : 2 + stage.parked.count) + w.index * 2][rotorSub].emissive = SIMD4(hot, 0)
                }
            }
        }
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
            let vel = r.velocity(at: c.tick)
            for k in 0..<10 { thr[k] = r.nozzle(k, at: tick) }
            var loaded = false
            for w in 0..<4 where r.wheel(w, at: tt).comp > 0.002 { loaded = true }
            if r.live { crash.car.setWing((simd_length(vel) - 20) / 20) }   // main.js liveStep
            crash.car.update(time: heroClock, carPos: carPos, carQuat: carQ, groundedNow: loaded, fanLevel: r.fan(at: tick), throttle: thr)
            crash.feed(r.impacts, tick: c.tick + r.tickBase, vel: vel, carPos: c.pos, carQuat: c.quat)
            if r.touchTick >= 0 && tick >= r.touchTick && !touched { touched = true; touchdown(sink: r.sink, carPos: carPos, carQuat: carQ) }
            mist.update(dt: Float(dtReal) * crash.slowK, thr: thr, carPos: carPos, carQuat: carQ, carVel: vel)
            // plumes.js update: a cone from each nozzle over 2 % open, its length and width from the valve.
            let p = pb.contents().bindMemory(to: PlumeU.self, capacity: 10)
            for k in 0..<10 where thr[k] > 0.02 {
                let o = carQ.act(plumeLocal[k].pos) + carPos, d = carQ.act(plumeLocal[k].jet), th = thr[k]
                p[nPlumes] = PlumeU(origin: SIMD4(o, min(1, th * 1.3)), dir: SIMD4(d, 0.4 + th * 2.4), extra: SIMD4(0.6 + th * 0.7, Float(k) * 7.3, 0, 0)); nPlumes += 1
            }
        }
        carM = translate(carPos) * simd_float4x4(carQ) * translate(SIMD3(0, -Float(SPEC.comHeight), 0))

        applyCarMaterials()
        updateSweep(Float(heroClock))
        var aspect = Float(out.width) / Float(max(1, out.height))
        // Free Drive: positions are relative to the drive's origin (0 near the centre); away from it the stage's own lights,
        // glints, beams and mirror are kilometres off and aren't drawn.
        let dv = drive, O = dv?.origin ?? .zero, away = O != .zero
        let stageM = translate(SIMD3<Float>(-O))
        lookU = dv?.look(over: stageLook) ?? stageLook
        if cam.shakeHook == nil {
            cam.shakeHook = true
            crash.shake = { [weak self, weak cam] a in if let d = self?.drive { d.shake(a) } else { cam?.shake(a) } }
            crash.cut = { [weak cam] p, v in cam?.crashCut(at: p, vel: v) }
        }
        var view = dv?.frameCamera(aspect: aspect, dt: dtReal)
            ?? cam.update(course: replay?.course ?? "show", car: carPos, vel: replay.map { $0.ticks > 0 ? $0.velocity(at: tick) : .zero } ?? .zero, phase: phase, tick: tick, time: t, aspect: aspect)
        if let fc = fxCam {
            let off: SIMD3<Float> = fc == "rear" ? [0.8, 0.7, -5.5] : fc == "front" ? [0.8, 0.7, 6] : [3.5, 3.5, -1]
            view.eye = carPos + carQ.act(off); view.view = lookAt(eye: view.eye, target: carPos, up: [0, 1, 0])
        }
        let fx = crash.write(sparks: sparkBufs[fi].contents().bindMemory(to: SparkGPU.self, capacity: Crash.NS),
                             puffs: puffBufs[fi].contents().bindMemory(to: PuffGPU.self, capacity: Crash.NM + 1),
                             chips: chipBufs[fi].contents().bindMemory(to: ChipGPU.self, capacity: Crash.NC))
        let nMist = skip.contains("mist") ? 0 : mist.write(mistBufs[fi].contents().bindMemory(to: PuffGPU.self, capacity: Plumes.maxMist))
        let lens = view.proj.columns
        var nPuffs = fx.1
        if let fl = crash.flash, nPuffs < Crash.NM + 1 {   // the flash rides at the end of the puff buffer
            puffBufs[fi].contents().bindMemory(to: PuffGPU.self, capacity: Crash.NM + 1)[nPuffs] = PuffGPU(pos: SIMD4(fl.pos, fl.size), color: SIMD4(1, 1, 1, fl.k)); nPuffs += 1
        }
        var camRight = SIMD4<Float>(view.view.columns.0.x, view.view.columns.1.x, view.view.columns.2.x, 0)
        var camUp = SIMD4<Float>(view.view.columns.0.y, view.view.columns.1.y, view.view.columns.2.y, 0)
        var u = FrameU()
        u.viewProj = view.proj * view.view
        u.invViewProj = u.viewProj.inverse
        u.proj = SIMD4(lens.0.x, lens.1.y, Float(renderSize.0), Float(renderSize.1))
        // The mist's budget: Renderer.mistScreens of overdraw (shed: half); -fx-log prints what it comes to.
        var mistK = SIMD4<Float>(1, 1, 0, 0)
        if nMist > 0 {
            mist.updateBudget(viewProj: u.viewProj, height: Float(renderSize.1), budget: Float(renderSize.0 * renderSize.1) * (shed >= 2 ? Renderer.mistScreens * 0.5 : Renderer.mistScreens))
            mistK = SIMD4(mist.budgetScale, min(2, 1 / max(mist.budgetScale, 0.1)), 0, 0)
        }
        if fxLog { fxFrames += 1; if fxFrames % 120 == 0 { print(String(format: "FX mist %d live, k %.2f, %.2f M fragments at %d×%d · cones %d · sparks %d, puffs %d, chips %d", mist.live, mist.budgetScale, mist.fragments(viewProj: u.viewProj, height: Float(renderSize.1)) * mist.budgetScale * mist.budgetScale / 1e6, renderSize.0, renderSize.1, nPlumes, fx.0, nPuffs, fx.2))
            for (i, pc) in crash.pieces.list.enumerated() where pc.on { print(String(format: "PIECE %d at (%.2f, %.2f, %.2f) v %.2f w %.2f still %.2f", i, pc.pos.x, pc.pos.y, pc.pos.z, simd_length(pc.v), simd_length(pc.w), pc.still)) } } }
        // The key light: the stage's, or in Free Drive the sun (or the moon) of the hour (0231). Its shadow box follows the car;
        // under a drive's sun it reaches 160 m back toward the light, so a tree that far off still lays its shadow across the road.
        let dk = dv?.key
        let keyDir = dk.map { simd_normalize($0.dir) } ?? simd_normalize(stage.keyOffset)
        let keyPos = dk != nil ? carPos + keyDir * 160 : carPos + stage.keyOffset
        let lv = lookAt(eye: keyPos, target: carPos, up: abs(keyDir.y) > 0.98 ? [0, 0, 1] : [0, 1, 0])
        let lp = dk != nil ? ortho(-34, 34, -34, 34, 1, 220) : ortho(-28, 28, -28, 28, 1, 140)
        u.lightViewProj = lp * lv
        u.eye = SIMD4(view.eye, Float(heroClock))
        u.keyDir = SIMD4(keyDir, dk?.intensity ?? stage.keyIntensity)
        u.keyColor = SIMD4(dk?.color ?? stage.keyColor, skip.contains("lights") || away ? 0 : Float(nLights))
        u.fogColor = SIMD4(stage.fogColor, dv == nil ? 1 : 0)
        u.fogRange = SIMD4(stage.fogNear, stage.fogFar, dk?.exposure ?? stage.exposure, 1 / Float(Renderer.shadowSize))
        let wantMirror = stage.wetMask != nil && !skip.contains("mirror") && !skip.contains("wet") && shed < 1 && view.eye.y > 0.05 && !away && lookU.fogExp.y > 0
        u.misc = SIMD4(0, wantMirror ? 1 : 0, 1 / Float(renderSize.0), 1 / Float(renderSize.1))
        fb.contents().storeBytes(of: u, as: FrameU.self)
        // The mirror's frame: the same lens looking at the world flipped in y. Its fragments keep their real world position and
        // normal for the lights; only the eye and the clip position change, and the winding (frontFace).
        let flip = simd_float4x4(diagonal: SIMD4(1, -1, 1, 1))
        var mu = u
        mu.viewProj = u.viewProj * flip
        mu.eye.y = -u.eye.y
        mu.misc.x = 1; mu.misc.y = 0
        mirrorFrames[fi].contents().storeBytes(of: mu, as: FrameU.self)
        let complexOn = stage.complex != nil && !skip.contains("complex") && sphereVisible((stage.complex?.center ?? .zero) - SIMD3<Float>(O), stage.complex?.radius ?? 1, u.viewProj)
        let beaconT = sin(Float(heroClock) * 3.1), beaconK = 2.4 * smoothstepF(-0.35, 0.75, beaconT)   // rocket.js update

        // -bench: each pass in its own command buffer, timed (passTimes), so one run attributes the GPU's frame.
        let split = Launch.bench
        guard var cmd = queue.makeCommandBuffer() else { gate.signal(); return }
        func cut(_ name: String) {
            guard split, let next = queue.makeCommandBuffer() else { return }
            let pt = passTimes
            cmd.addCompletedHandler { cb in pt.add(name, start: cb.gpuStartTime, end: cb.gpuEndTime) }
            cmd.commit(); cmd = next
        }
        // 0. the sky's LUTs (Free Drive's physical sky, 0231)
        if lookU.atmo.x > 0.5 {
            if skyLUT == nil { skyLUT = SkyLUT(device: device, library: library) }
            if let sl = skyLUT { sl.update(cmd, sun: SIMD3(lookU.skySun.x, lookU.skySun.y, lookU.skySun.z), eyeKm: lookU.atmo.z, sunE: SIMD3(lookU.sunE.x, lookU.sunE.y, lookU.sunE.z), time: lookU.sunE.w, night: lookU.atmo.w) } else { lookU.atmo.x = 0 }
        }
        skyTex = lookU.atmo.x > 0.5 ? skyLUT?.view : nil
        cut("sky")
        // 1. shadow
        let sp = MTLRenderPassDescriptor()
        sp.depthAttachment.texture = shadowMap; sp.depthAttachment.loadAction = .clear; sp.depthAttachment.clearDepth = 1; sp.depthAttachment.storeAction = .store
        if !skip.contains("shadow"), let e = cmd.makeRenderCommandEncoder(descriptor: sp) {
            e.setRenderPipelineState(shadowPipe); e.setDepthStencilState(dsShadow); e.setDepthBias(1.5, slopeScale: 2.5, clamp: 0.01)
            e.setVertexBuffer(fb, offset: 0, index: 1)
            drawMesh(e, stage.staticMesh, matsIndex: 0, model: stageM, opaqueOnly: true, shadow: true)
            parkedDraw(e, t: simT, shadow: true)
            bodyDraw(e, carM: carM, eye: view.eye, opaqueOnly: true, shadow: true)
            carPartsDraw(e, carM: carM, shadow: true)
            wheelsDraw(e, carM: carM, t: simT, opaqueOnly: true, shadow: true)
            if let dv, dk != nil, quality > 0 { dv.drawShadow(e, frame: fb, center: carPos) }
            e.endEncoding()
        }
        cut("shadow")
        // 2. the mirror (wet courses)
        if wantMirror, let mirrorRaw, let mirrorTex, let mirrorDepth {
            let rp = MTLRenderPassDescriptor()
            rp.colorAttachments[0].texture = mirrorRaw; rp.colorAttachments[0].loadAction = .clear; rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1); rp.colorAttachments[0].storeAction = .store
            rp.depthAttachment.texture = mirrorDepth; rp.depthAttachment.loadAction = .clear; rp.depthAttachment.clearDepth = 1; rp.depthAttachment.storeAction = .dontCare
            if let e = cmd.makeRenderCommandEncoder(descriptor: rp) {
                let mfb = mirrorFrames[fi]
                e.setVertexBuffer(mfb, offset: 0, index: 1); e.setFragmentBuffer(mfb, offset: 0, index: 1)
                e.setFragmentBuffer(lightsBuf, offset: 0, index: 3); e.setFragmentBytes(&lookU, length: MemoryLayout<LookU>.stride, index: 4)
                e.setFragmentTexture(shadowMap, index: 3); e.setFragmentTexture(stage.wetMask ?? dummy, index: 5); e.setFragmentTexture(dummy, index: 6)
                setEnv(e)
                mirrorDraw = true; frontFace = .clockwise
                drawMesh(e, stage.staticMesh, matsIndex: 0, model: stageM, opaqueOnly: true, standingOnly: true)
                if !skip.contains("parked") { parkedDraw(e, t: simT, shadow: false, cull: mu.viewProj) }
                if sphereVisible(carPos, 5, mu.viewProj) {
                    bodyDraw(e, carM: carM, eye: view.eye, opaqueOnly: true)
                    carPartsDraw(e, carM: carM, shadow: false)
                    wheelsDraw(e, carM: carM, t: simT, opaqueOnly: true, shadow: false)
                }
                if let c = stage.complex, !skip.contains("complex"), sphereVisible(c.center, c.radius, mu.viewProj) {
                    drawMesh(e, c.mesh, matsIndex: complexMats, model: matrix_identity_float4x4, opaqueOnly: true)
                    if !skip.contains("glints") { glintsDraw(e, c, beaconK: beaconK, pipe: mirrorGlintPipe) }
                }
                frontFace = .counterClockwise; mirrorDraw = false
                e.endEncoding()
            }
            let sp2 = MTLRenderPassDescriptor()
            sp2.colorAttachments[0].texture = mirrorTex; sp2.colorAttachments[0].loadAction = .dontCare; sp2.colorAttachments[0].storeAction = .store
            if let e = cmd.makeRenderCommandEncoder(descriptor: sp2) {
                e.setRenderPipelineState(smearPipe); e.setFragmentTexture(mirrorRaw, index: 0)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
            }
        }
        cut("mirror")
        // 3. main (HDR, MSAA, resolved)
        let mp = MTLRenderPassDescriptor()
        mp.colorAttachments[0].texture = msaa; mp.colorAttachments[0].resolveTexture = hdr
        mp.colorAttachments[0].loadAction = .dontCare; mp.colorAttachments[0].storeAction = .multisampleResolve
        mp.depthAttachment.texture = depth; mp.depthAttachment.loadAction = .clear; mp.depthAttachment.clearDepth = 1; mp.depthAttachment.storeAction = .dontCare
        if let e = cmd.makeRenderCommandEncoder(descriptor: mp) {
            e.setVertexBuffer(fb, offset: 0, index: 1); e.setFragmentBuffer(fb, offset: 0, index: 1)
            e.setFragmentBuffer(lightsBuf, offset: 0, index: 3); e.setFragmentBytes(&lookU, length: MemoryLayout<LookU>.stride, index: 4)
            e.setVertexBytes(&lookU, length: MemoryLayout<LookU>.stride, index: 4)
            e.setFragmentTexture(shadowMap, index: 3); e.setFragmentTexture(stage.wetMask ?? dummy, index: 5); e.setFragmentTexture(wantMirror ? (mirrorTex ?? dummy) : dummy, index: 6)
            setEnv(e)
            if !skip.contains("static") { drawMesh(e, stage.staticMesh, matsIndex: 0, model: stageM, opaqueOnly: true) }
            if !skip.contains("parked") { parkedDraw(e, t: simT, shadow: false, cull: u.viewProj) }
            bodyDraw(e, carM: carM, eye: view.eye, opaqueOnly: true)
            carPartsDraw(e, carM: carM, shadow: false)
            wheelsDraw(e, carM: carM, t: simT, opaqueOnly: true, shadow: false)
            if !away { sweepDraw(e, opaqueOnly: true) }
            if complexOn, let c = stage.complex { drawMesh(e, c.mesh, matsIndex: complexMats, model: stageM, opaqueOnly: true) }
            if let dv { dv.drawWorld(e, frame: fb, look: &lookU, shadow: shadowMap, sky: skyTex ?? dummy, viewProj: u.viewProj, quality: quality) }
            // The sky where nothing opaque stands (far plane, depth read).
            e.setCullMode(.none); e.setDepthStencilState(dsRead); e.setDepthBias(0, slopeScale: 0, clamp: 0); e.setRenderPipelineState(sky)
            e.setFragmentTexture(skyTex ?? dummy, index: 8); e.setFragmentTexture(skyTex != nil ? (skyLUT?.clouds ?? dummy) : dummy, index: 9)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
            if complexOn, let c = stage.complex, !skip.contains("translucent") {
                // rocket.js's draw order: the lattice, the beams, then the lamps over them.
                for (k, s) in c.mesh.submeshes.enumerated() where s.material.transparent {
                    if s.material.effect == 4 ? skip.contains("floodbeams") : skip.contains("lattice") { continue }
                    drawMesh(e, c.mesh, matsIndex: complexMats, model: stageM, opaqueOnly: false, from: k, to: k + 1)
                }
                if !skip.contains("glints") && !away { glintsDraw(e, c, beaconK: beaconK, pipe: glintPipe) }
            }
            if nGlows > 0 && shed < 2 && !skip.contains("glows") && !away {   // film.js's lit air round the lamps
                e.setRenderPipelineState(glowPipe); e.setDepthStencilState(dsRead); e.setCullMode(.none)
                e.setVertexBuffer(glowBuf, offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nGlows)
            }
            if !skip.contains("translucent") {
                drawMesh(e, stage.staticMesh, matsIndex: 0, model: stageM, opaqueOnly: false, to: blobSplit)
                // The contact shadow lies on the slab: in Free Drive only while the car is on it.
                if dv == nil || (!away && abs(carPos.x) < Float(700) && abs(carPos.z) < Float(700) && carPos.y < 3) { blobDraw(e, carPos: carPos, carQuat: carQ) }
                drawMesh(e, stage.staticMesh, matsIndex: 0, model: stageM, opaqueOnly: false, from: blobSplit)
                if !skip.contains("beams") && !away { sweepDraw(e, opaqueOnly: false) }
                bodyDraw(e, carM: carM, eye: view.eye, opaqueOnly: false)
                nozzleStatesDraw(e, carM: carM)
            }
            if nPlumes > 0 && !skip.contains("plumes") {
                e.setRenderPipelineState(plume); e.setDepthStencilState(dsRead); e.setCullMode(.none)
                e.setVertexBuffer(pb, offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 24 * 3, instanceCount: nPlumes)
            }
            if nMist > 0 {   // condensation (plumes.js), behind the crash's effects
                e.setRenderPipelineState(mistPipe); e.setDepthStencilState(dsRead); e.setCullMode(.none)
                e.setVertexBuffer(mistBufs[fi], offset: 0, index: 2); e.setVertexBytes(&mistK, length: 16, index: 3)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nMist)
            }
            // crash.js's effects: chips (lit-ish solids), dust and smoke (blended), sparks and the flash (additive).
            if fx.2 > 0 { e.setRenderPipelineState(chipPipe); e.setDepthStencilState(dsWrite); e.setCullMode(.none); e.setVertexBuffer(chipBufs[fi], offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 36, instanceCount: fx.2) }
            let hasFlash = crash.flash != nil
            let nDust = hasFlash ? nPuffs - 1 : nPuffs
            if nDust > 0 { e.setRenderPipelineState(puffPipe); e.setDepthStencilState(dsRead); e.setVertexBuffer(puffBufs[fi], offset: 0, index: 2)
                e.setVertexBytes(&aspect, length: 4, index: 3)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nDust) }
            if fx.0 > 0 { e.setRenderPipelineState(sparkPipe); e.setDepthStencilState(dsRead); e.setVertexBuffer(sparkBufs[fi], offset: 0, index: 2)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: fx.0) }
            if hasFlash { e.setRenderPipelineState(flashPipe); e.setDepthStencilState(dsOff); e.setVertexBuffer(puffBufs[fi], offset: MemoryLayout<PuffGPU>.stride * nDust, index: 2)
                e.setVertexBytes(&camRight, length: 16, index: 3); e.setVertexBytes(&camUp, length: 16, index: 4)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: 1) }
            e.endEncoding()
        }
        cut("main")
        // 4. bloom
        let bloomOn = lookU.fogExp.w > 0 && bloomChain.count == 6
        if bloomOn, let bloomOut {
            func small(_ tex: MTLTexture, _ pipe: MTLRenderPipelineState, _ set: (MTLRenderCommandEncoder) -> Void) {
                let rp = MTLRenderPassDescriptor()
                rp.colorAttachments[0].texture = tex; rp.colorAttachments[0].loadAction = .dontCare; rp.colorAttachments[0].storeAction = .store
                guard let e = cmd.makeRenderCommandEncoder(descriptor: rp) else { return }
                e.setRenderPipelineState(pipe); set(e); e.setFragmentBytes(&lookU, length: MemoryLayout<LookU>.stride, index: 4)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
            }
            small(bloomChain[0], bloomBright) { $0.setFragmentTexture(hdr, index: 0) }
            for i in 1..<6 { let src = bloomChain[i - 1]; small(bloomChain[i], bloomDown) { $0.setFragmentTexture(src, index: 0) } }
            small(bloomOut, bloomCompose) { e in for i in 0..<6 { e.setFragmentTexture(bloomChain[i], index: i) } }
        }
        cut("bloom")
        // 5. film
        let fp = MTLRenderPassDescriptor()
        fp.colorAttachments[0].texture = ldr; fp.colorAttachments[0].loadAction = .dontCare; fp.colorAttachments[0].storeAction = .store
        if let e = cmd.makeRenderCommandEncoder(descriptor: fp) {
            e.setRenderPipelineState(film); e.setFragmentTexture(hdr, index: 0); e.setFragmentTexture(bloomOut ?? dummy, index: 1); e.setFragmentBuffer(fb, offset: 0, index: 1)
            e.setFragmentBytes(&lookU, length: MemoryLayout<LookU>.stride, index: 4)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
        }
        cut("film")
        // 6. MetalFX, then present
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
        if split { let pt = passTimes; cmd.addCompletedHandler { cb in pt.add("present", start: cb.gpuStartTime, end: cb.gpuEndTime) } }
        let g = gate
        cmd.addCompletedHandler { [weak self] cb in
            let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
            onGPU?(ms)
            DispatchQueue.main.async { self?.govern(gpuMs: ms, budgetMs: 1000.0 / 120.0) }
            g.signal()
        }
        cmd.commit()
    }

    private var skyTex: MTLTexture?
    private func setEnv(_ e: MTLRenderCommandEncoder) { e.setFragmentTexture(stage.env, index: 7); e.setFragmentTexture(skyTex ?? dummy, index: 8) }
    /// rocket.js's lamps and beacons (they pulse together, eased).
    private func glintsDraw(_ e: MTLRenderCommandEncoder, _ c: StageComplex, beaconK: Float, pipe: MTLRenderPipelineState) {
        e.setRenderPipelineState(pipe); e.setDepthStencilState(dsRead); e.setCullMode(.none); e.setDepthBias(0, slopeScale: 0, clamp: 0)
        // Its minimum in the web's 1912-row buffer; the same share of the screen in this one's rows, and never under what a gaussian can draw.
        let pxK = Float(renderSize.1) / 1912
        var g = GlintGroup(size: c.lamps.size, minPx: max(2.5, c.lamps.minPx * pxK), tint: 1)
        e.setVertexBytes(&g, length: MemoryLayout<GlintGroup>.stride, index: 3); e.setVertexBuffer(lampBuf, offset: 0, index: 2)
        e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nLamps)
        if beaconK > 0.001 && nBeacons > 0 {
            g = GlintGroup(size: c.beacons.size, minPx: max(2.5, c.beacons.minPx * pxK), tint: beaconK)
            e.setVertexBytes(&g, length: MemoryLayout<GlintGroup>.stride, index: 3); e.setVertexBuffer(beaconBuf, offset: 0, index: 2)
            e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: nBeacons)
        }
    }
    /// A sphere against the frustum's sides (Gribb–Hartmann on the view-projection's rows).
    private func sphereVisible(_ c: SIMD3<Float>, _ r: Float, _ m: simd_float4x4) -> Bool {
        let t = m.transpose
        let row0 = t.columns.0, row1 = t.columns.1, row3 = t.columns.3
        for p in [row3 + row0, row3 - row0, row3 + row1, row3 - row1] {
            let n = SIMD3(p.x, p.y, p.z), len = simd_length(n)
            if len > 1e-6 && (simd_dot(n, c) + p.w) / len < -r { return false }
        }
        return true
    }

    // --- The car's own states (roadster.js), the searchlights (wall.js), the touchdown (main.js) ------------------------
    /// main.js touchdown, keyed to the sim's touch tick: mist from each tyre and a shake, scaled by sink rate
    /// (src/render/impact.js landingImpact). The camera's dip and punch-in are the director's.
    private func touchdown(sink: Float, carPos: SIMD3<Float>, carQuat: simd_quatf) {
        let r = max(0, sink) / 5, s = r >= 1 ? 1 : r * r
        func contact(_ i: Int) -> SIMD3<Float> {
            let a = anchors[i], w = carQuat.act(SIMD3(Float(a.0), Float(a.1), Float(a.2))) + carPos
            return SIMD3(w.x, max(0, w.y - 0.24 - Float(SPEC.wheelRadius)), w.z)
        }
        mist.burst((contact(0), contact(1), contact(2), contact(3)), perPoint: Int((6 + 34 * s).rounded()), speed: 1.5 + 6.5 * s)
        if !crash.reduced { crash.shake?(s) }
    }
    private func setLamp(_ p: CarPart, _ c: SIMD3<Float>) { stageMats[partBase + p.rawValue][0].color = SIMD4(c, 1) }
    private func setBodyLamp(_ sub: Int, _ c: SIMD3<Float>) { if sub >= 0 { stageMats[1][sub].color = SIMD4(c, 1) } }
    /// Each lamp's level this frame, and the canopy's glass or its crazing.
    private func applyCarMaterials() {
        let c = crash.car
        // Under Free Drive's daylight (0232) a lamp is a bright mark, not a blaze: its HDR colour scaled down until dusk.
        let lk: Float = lookU.atmo.x > 0.5 ? 0.25 + 0.75 * lookU.atmo.w : 1
        setLamp(.drl, c.drl * lk); setLamp(.heads, c.headC * lk); setLamp(.tailBar, c.tail * lk); setLamp(.tailDim, c.tailDim * lk); setLamp(.brake, c.brakeC * max(lk, 0.6))
        setBodyLamp(subAmber, c.amber * lk); setBodyLamp(subMarker, c.marker * lk); setBodyLamp(subPlate, c.plate * lk); setBodyLamp(subAmbient, c.ambient * lk)
        if subGlass >= 0, let m = c.crazed ? crazedMat : glassMat { stageMats[1][subGlass] = m }
        guard driveCar != nil else { return }
        // The forged car's lamps follow the same states; its glass crazes the same; the grime builds with the miles.
        for l in dLamps {
            let col: SIMD3<Float> = [c.amber, c.marker, c.plate, c.ambient, c.drl * 1.2, c.tail][l.kind] * lk
            if l.sub >= 0 { stageMats[carMats][l.sub].color = SIMD4(col, 1) }
            if l.far >= 0 { stageMats[carFarMats][l.far].color = SIMD4(col, 1) }
        }
        if dGlass >= 0, let m = c.crazed ? dCrazedMat : dGlassMat { stageMats[carMats][dGlass] = m }
        if dGlassFar >= 0, let m = c.crazed ? dCrazedMat : dGlassFarMat { stageMats[carFarMats][dGlassFar] = m }
        let g = grime
        for i in [carMats, carFarMats] + (driveWheelBase >= 0 ? Array(driveWheelBase..<driveWheelBase + stage.wheels.count * 2) : []) {
            for k in stageMats[i].indices where stageMats[i][k].effectKind.x >= 11 { stageMats[i][k].effect.w = g }
        }
    }
    /// The car's body: the stage roadster's, or the drive's forged one (LOD by its distance from the eye).
    private func bodyDraw(_ e: MTLRenderCommandEncoder, carM: simd_float4x4, eye: SIMD3<Float>, opaqueOnly: Bool, shadow: Bool = false) {
        guard let dc = driveCar else { drawMesh(e, stage.roadster, matsIndex: 1, model: carM, opaqueOnly: opaqueOnly, shadow: shadow); return }
        let p = carM.columns.3, far = simd_distance(SIMD3(p.x, p.y, p.z), eye) > DriveCarModel.farAt
        drawMesh(e, far || shadow ? dc.bodyFar : dc.body, matsIndex: far || shadow ? carFarMats : carMats, model: carM, opaqueOnly: opaqueOnly, shadow: shadow)
    }
    /// wall.js searchlights update: each pivot swings on its own slow sines.
    private func updateSweep(_ t: Float) {
        guard let sw = stage.sweep else { return }
        for (i, b) in sw.pivots.enumerated() {
            let rz = -b.tilt * 0.55 + sin(t * b.speed + b.phase) * 0.18, rx = b.lean + cos(t * b.speed * 0.8 + b.phase) * 0.12
            sweepM[i] = translate(b.pos) * rotX(rx) * rotZ(rz)
        }
    }
    private func sweepDraw(_ e: MTLRenderCommandEncoder, opaqueOnly: Bool) {
        guard let sw = stage.sweep else { return }
        for m in sweepM {
            if opaqueOnly {
                drawMesh(e, sw.head, matsIndex: sweepBase + 1, model: m, opaqueOnly: true)
                drawMesh(e, sw.lens, matsIndex: sweepBase + 2, model: m, opaqueOnly: true)
            } else { drawMesh(e, sw.beam, matsIndex: sweepBase, model: m, opaqueOnly: false) }
        }
    }
    private func part(_ e: MTLRenderCommandEncoder, _ p: CarPart, _ model: simd_float4x4, shadow: Bool, opaqueOnly: Bool = true, tint: SIMD4<Float>? = nil) {
        drawMesh(e, stage.parts[p.rawValue], matsIndex: partBase + p.rawValue, model: model, opaqueOnly: opaqueOnly, shadow: shadow, tint: tint)
    }
    /// The wing from its own frame (on the car, or flying in the pose it left in): applyWing.
    private func wingDraw(_ e: MTLRenderCommandEncoder, base: simd_float4x4, k: Float, air: Float, shadow: Bool) {
        let c = crash.car, r = c.rise(k, air), pv = base * c.wingPivot(k, air)
        part(e, .wingBlade, pv, shadow: shadow)
        if r > 0.003 {
            part(e, .wingStruts, pv * scaleM(1, max(0.001, r), 1), shadow: shadow)
            part(e, .wingPlates, pv * scaleM(1, max(0.001, r * 0.45), 1), shadow: shadow)
        }
        if r > 0.02 { part(e, .wingLower, base * translate(SIMD3(0, r * 0.45, 0)), shadow: shadow) }
    }
    /// Everything on the car that moves on its own or can tear off, then what has torn off.
    private func carPartsDraw(_ e: MTLRenderCommandEncoder, carM: simd_float4x4, shadow: Bool) {
        let c = crash.car, L = stage.layout
        if !c.isBroken(.wing) { wingDraw(e, base: carM * translate(L.wingPos) * rotX(L.wingRotX), k: c.wing, air: c.airbrake, shadow: shadow) }
        if !c.isBroken(.vanes) { part(e, .vanes, carM * translate(L.vanesPos) * rotX(c.vanesRotX), shadow: shadow) }
        if !c.isBroken(.barge) { part(e, .barge, carM * scaleM(c.bargeX, 1, 1), shadow: shadow) }
        if c.sideSkirtsShown { part(e, .sideSkirts, carM * translate(SIMD3(0, -0.11 * c.skirtSide, 0)), shadow: shadow) }
        if c.endSkirtsShown { part(e, .endSkirts, carM * translate(SIMD3(0, -0.11 * c.skirtEnd, 0)), shadow: shadow) }
        if !shadow {
            // Lamps (applyLights): the DRL and tail bar sweep out from the centre on wake; the covers drop and the heads come up.
            let sx = scaleM(max(0.001, c.sweep), 1, 1)
            if c.sweep > 0.002 {
                part(e, .drl, carM * translate(L.drlPos) * sx, shadow: false)
                part(e, .tailBar, carM * sx, shadow: false)
                part(e, .tailDim, carM * sx, shadow: false)
            }
            if c.lampsOn < 0.98 { part(e, .covers, carM * translate(SIMD3(0, -0.02 * c.lampsOn, -0.012 * c.lampsOn)), shadow: false) }
            if c.lampsOn > 0.01 { part(e, .heads, carM, shadow: false) }
            if c.brake > 0.02 && c.sweep > 0.5 { part(e, .brake, carM * translate(L.brakePos), shadow: false) }
            for f in L.fans { part(e, .rotor, carM * translate(f.pos) * rotX(f.rotX) * rotZ(c.fanAngle), shadow: false) }
        }
        // Torn-off parts (debris.js): each at its rigid body's pose.
        for b in crash.breakable {
            let pc = crash.pieces.list[b.piece]
            guard pc.on else { continue }
            let m = translate(pc.pos) * simd_float4x4(pc.quat)
            switch b.source {
            case .wing: wingDraw(e, base: m * translate(-b.center), k: c.tornK, air: c.tornAir, shadow: shadow)
            case .vanes: part(e, .vanes, m * translate(-b.center), shadow: shadow)
            case .sideSkirts: part(e, .pieceSkirtSide, m, shadow: shadow)
            case .endSkirts: part(e, .pieceSkirtEnd, m, shadow: shadow)
            case .barge: part(e, .pieceBarge, m, shadow: shadow)
            }
        }
    }
    /// scene.js heroBlob: the contact shadow follows the car on the slab and fades as it leaves the ground.
    private func blobDraw(_ e: MTLRenderCommandEncoder, carPos: SIMD3<Float>, carQuat: simd_quatf) {
        let g = carPos + carQuat.act(SIMD3(0, -Float(SPEC.comHeight), 0)), k = min(1, max(0, (g.y - 0.15) / 2.05)), up = k * k * (3 - 2 * k)
        if up >= 1 { return }
        let fwd = carQuat.act(SIMD3(0, 0, 1)), s = 1 + up * 0.6, i = partBase + CarPart.blob.rawValue
        stageMats[i][0].color.w = 0.7 * (1 - up)
        part(e, .blob, translate(SIMD3(g.x, 0.012, g.z)) * rotY(atan2(fwd.x, fwd.z)) * scaleM(s, 1, s), shadow: false, opaqueOnly: false)
    }
    /// applyNozzles: a bright core in each open throat, rime on its lip; black is invisible, so they're skipped.
    private func nozzleStatesDraw(_ e: MTLRenderCommandEncoder, carM: simd_float4x4) {
        let c = crash.car, L = stage.layout
        for i in 0..<min(10, L.nozzleCore.count, L.nozzleFrost.count) {
            let p = c.core[i], f = c.frost[i]
            if p > 0.01 { part(e, .jetCore, carM * L.nozzleCore[i], shadow: false, opaqueOnly: false, tint: SIMD4(0.7 * p * 0.55, 0.82 * p * 0.55, p * 0.55, 1)) }
            if f > 0.01 { part(e, .frost, carM * L.nozzleFrost[i], shadow: false, opaqueOnly: false, tint: SIMD4(0.5 * f, 0.55 * f, 0.6 * f, 1)) }
        }
    }

    /// The wheels, as main.js syncCar places them: pivot y = wheelCenterY(compression) (ANCHOR_Y − restLen + c), the fronts
    /// turned by the steer, the spinning part turned about its axle by the wheel's spin.
    private func wheelsDraw(_ e: MTLRenderCommandEncoder, carM: simd_float4x4, t: Double, opaqueOnly: Bool, shadow: Bool) {
        for w in stage.wheels {
            var comp: Float = Float(CAR.restLen - CAR.mountToCentre), spin: Float = 0, steer: Float = 0
            if let r = replay, r.ticks > 0 { let ws = r.wheel(w.index, at: t); comp = ws.comp; spin = ws.spin; steer = w.steers ? ws.steer : 0 }
            let anchorY = Float(anchors[w.index].1 + SPEC.comHeight)
            let y = anchorY - Float(CAR.restLen) + comp
            let pivot = carM * translate(SIMD3(w.x, y, w.z)) * simd_float4x4(simd_quatf(angle: steer, axis: [0, 1, 0]))
            let spinM = pivot * simd_float4x4(simd_quatf(angle: spin, axis: [1, 0, 0]))
            if let dc = driveCar {
                // The forged wheels (0232): built for one side, mirrored (and their winding with them) for the other.
                let mirrored = (w.x > 0) == (dc.builtForX < 0)
                let flip = mirrored ? scaleM(-1, 1, 1) : matrix_identity_float4x4
                let saved = frontFace
                if mirrored { frontFace = saved == .counterClockwise ? .clockwise : .counterClockwise }
                let base = driveWheelBase + w.index * 2
                drawMesh(e, w.steers ? dc.frontSteer : dc.rearSteer, matsIndex: base, model: pivot * flip, opaqueOnly: opaqueOnly, shadow: shadow)
                drawMesh(e, w.steers ? dc.frontSpin : dc.rearSpin, matsIndex: base + 1, model: spinM * flip, opaqueOnly: opaqueOnly, shadow: shadow)
                frontFace = saved
                continue
            }
            let base = 2 + stage.parked.count + w.index * 2
            drawMesh(e, w.steerPart, matsIndex: base, model: pivot, opaqueOnly: opaqueOnly, shadow: shadow)
            drawMesh(e, w.index < openSpin.count ? openSpin[w.index] : w.spinPart, matsIndex: base + 1, model: spinM, opaqueOnly: opaqueOnly, shadow: shadow)
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

    private func parkedDraw(_ e: MTLRenderCommandEncoder, t: Double, shadow: Bool, cull: simd_float4x4? = nil) {
        for (i, m) in stage.parked.enumerated() {
            let model = parkedModel(i, t: t)
            if let cull { let p = model.columns.3; if !sphereVisible(SIMD3(p.x, p.y, p.z), 7, cull) { continue } }   // (the tallest vehicle reaches 6 m from its origin)
            drawMesh(e, m, matsIndex: 2 + i, model: model, opaqueOnly: true, shadow: shadow)
            if !shadow { drawMesh(e, m, matsIndex: 2 + i, model: model, opaqueOnly: false) }
        }
    }

    private var mirrorDraw = false
    private func drawMesh(_ e: MTLRenderCommandEncoder, _ m: StageMesh, matsIndex: Int, model: simd_float4x4, opaqueOnly: Bool, shadow: Bool = false, tint: SIMD4<Float>? = nil, from: Int = 0, to: Int = .max, standingOnly: Bool = false) {
        var o = ObjectU(model: model, normal: model.inverse.transpose)
        e.setVertexBytes(&o, length: MemoryLayout<ObjectU>.stride, index: 2)
        e.setVertexBuffer(m.vertices, offset: 0, index: 0)
        let mats = stageMats[matsIndex]
        for (k, s) in m.submeshes.enumerated() where k >= from && k < to {
            let M = s.material
            let translucent = M.transparent || M.additive
            if opaqueOnly == translucent { continue }
            if shadow && (M.unlit || translucent) { continue }
            if M.effect == 9 { continue }   // the web's sky dome: the native sky pass draws it
            if standingOnly && s.top < 0.12 { continue }   // film.js tag(): the slab, its paint and the glows lying on it aren't in the mirror
            if !shadow {
                if mirrorDraw {
                    if translucent { continue }
                    e.setRenderPipelineState(mirrorPipe); e.setDepthStencilState(dsMirror)
                } else {
                    e.setRenderPipelineState(M.additive ? additive : translucent ? blend : (M.doubleSided ? opaqueCullNone : opaque))
                    e.setDepthStencilState(translucent || !M.depthWrite ? dsRead : dsWrite)
                }
                e.setCullMode(M.doubleSided ? .none : .back)
                e.setFrontFacing(frontFace)
                if let po = M.polygonOffset { e.setDepthBias(po.1 * 1e-5, slopeScale: po.0, clamp: 0) } else { e.setDepthBias(0, slopeScale: 0, clamp: 0) }
                var mu = mats[k]
                if let tint { mu.color = tint }
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

/// Per-pass GPU milliseconds over a bench (thread-safe: completion handlers run off the main thread). Each pass is its own
/// command buffer, and the GPU starts the next before the last has ended, so a buffer's start-to-end time counts the overlap
/// (on the phone the passes summed to ≈ 20 ms in an 8 ms frame). A pass is charged only from the later of its start and the
/// previous buffer's end (0231): the time it added to the frame.
final class PassTimes {
    private var sum: [String: Double] = [:], n: [String: Int] = [:]
    private var lastEnd: CFTimeInterval = 0
    private let lock = NSLock()
    func add(_ k: String, start: CFTimeInterval, end: CFTimeInterval) {
        lock.lock()
        let ms = max(0, end - max(start, lastEnd)) * 1000
        lastEnd = max(lastEnd, end)
        sum[k, default: 0] += ms; n[k, default: 0] += 1
        lock.unlock()
    }
    func report() -> String {
        lock.lock(); defer { lock.unlock() }
        return ["sky", "shadow", "mirror", "main", "bloom", "film", "metalfx", "present"].compactMap { k in n[k].map { String(format: "%@ %.2f", k, sum[k, default: 0] / Double($0)) } }.joined(separator: " · ")
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

func smoothstepF(_ a: Float, _ b: Float, _ x: Float) -> Float { let t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
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
