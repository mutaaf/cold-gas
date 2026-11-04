// The Metal renderer (docs/NATIVE.md §4, 0148). One CAMetalLayer, a CAMetalDisplayLink at up to 120 Hz,
// 4× MSAA in memoryless tile memory, uniforms in a triple-buffered ring (nothing allocated per frame), and
// every pipeline built ONCE at launch, off the main thread, for the real pixel formats, through an
// MTLBinaryArchive (kin's Unity client hitched 2.4–3.4 s compiling on first play; LESSONS 0046).
import Metal
import QuartzCore
import UIKit
import simd

struct FrameUniforms {
    var viewProj = matrix_identity_float4x4
    var model = matrix_identity_float4x4
    var eye = SIMD3<Float>(); var time: Float = 0
    var keyDir = SIMD3<Float>(); var hingeOpen: Float = 1
    var viewport = SIMD2<Float>(); var pad = SIMD2<Float>()
}
struct MaterialUniforms {
    var color = SIMD4<Float>(1, 1, 1, 1)
    var metalness: Float = 0, roughness: Float = 1, clearcoat: Float = 0, clearcoatRoughness: Float = 0
    var emissive: UInt32 = 0, p0: UInt32 = 0, p1: UInt32 = 0, p2: UInt32 = 0
}

final class Renderer {
    static let colorFormat = MTLPixelFormat.bgra8Unorm_srgb
    static let depthFormat = MTLPixelFormat.depth32Float
    static let samples = 4
    static let inFlight = 3

    let device: MTLDevice
    let queue: MTLCommandQueue
    private let carPipe, floorPipe, skyPipe: MTLRenderPipelineState
    private let carBlendPipe: MTLRenderPipelineState
    private let depthWrite, depthRead, depthOff: MTLDepthStencilState
    private let mesh: Mesh
    private let materials: MTLBuffer
    private let frames: [MTLBuffer]
    private var frameIndex = 0
    private let gate = DispatchSemaphore(value: Renderer.inFlight)
    private var msaa: MTLTexture?, depth: MTLTexture?
    private var size = CGSize.zero
    var hingeOpen: Float = 1
    /// Pipelines made after launch: must stay 0 (the bench prints it).
    private(set) var compilesAfterLaunch = 0
    let launchCompileMs: Double

    /// Builds everything; call off the main thread.
    init?(device: MTLDevice) {
        let t0 = CACurrentMediaTime()
        self.device = device
        guard let q = device.makeCommandQueue(), let lib = device.makeDefaultLibrary(), let mesh = Mesh.load(device: device, name: "roadster") else { return nil }
        queue = q
        self.mesh = mesh
        let archive = PipelineArchive(device: device)
        func pipe(_ v: String, _ f: String, vertex: MTLVertexDescriptor?, blend: Bool = false, depth: Bool = true) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = lib.makeFunction(name: v); d.fragmentFunction = lib.makeFunction(name: f)
            d.vertexDescriptor = vertex
            d.colorAttachments[0].pixelFormat = Renderer.colorFormat
            if blend {
                d.colorAttachments[0].isBlendingEnabled = true
                d.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
                d.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
            }
            d.depthAttachmentPixelFormat = Renderer.depthFormat
            d.rasterSampleCount = Renderer.samples
            return archive.pipeline(d)
        }
        let vd = MTLVertexDescriptor()
        vd.attributes[0].format = .float3; vd.attributes[0].offset = 0; vd.attributes[0].bufferIndex = 0
        vd.attributes[1].format = .float3; vd.attributes[1].offset = 12; vd.attributes[1].bufferIndex = 0
        vd.layouts[0].stride = 24
        guard let c = pipe("cg_car_vertex", "cg_car_fragment", vertex: vd),
              let cb = pipe("cg_car_vertex", "cg_car_fragment", vertex: vd, blend: true),
              let fl = pipe("cg_floor_vertex", "cg_floor_fragment", vertex: nil),
              let sk = pipe("cg_sky_vertex", "cg_sky_fragment", vertex: nil) else { return nil }
        carPipe = c; carBlendPipe = cb; floorPipe = fl; skyPipe = sk
        archive.save()
        func ds(_ write: Bool, _ cmp: MTLCompareFunction) -> MTLDepthStencilState {
            let d = MTLDepthStencilDescriptor(); d.isDepthWriteEnabled = write; d.depthCompareFunction = cmp
            return device.makeDepthStencilState(descriptor: d)!
        }
        depthWrite = ds(true, .less); depthRead = ds(false, .lessEqual); depthOff = ds(false, .always)
        // Materials: one uniform block per submesh, made once.
        var mats = mesh.submeshes.map { s -> MaterialUniforms in
            var m = MaterialUniforms()
            m.color = SIMD4<Float>(s.linearColor, s.opacity)
            m.metalness = s.metalness; m.roughness = s.roughness; m.clearcoat = s.clearcoat; m.clearcoatRoughness = s.clearcoatRoughness
            m.emissive = s.emissive ? 1 : 0
            return m
        }
        materials = device.makeBuffer(bytes: &mats, length: MemoryLayout<MaterialUniforms>.stride * max(1, mats.count), options: .storageModeShared)!
        frames = (0..<Renderer.inFlight).map { _ in device.makeBuffer(length: MemoryLayout<FrameUniforms>.stride, options: .storageModeShared)! }
        launchCompileMs = (CACurrentMediaTime() - t0) * 1000
    }

    /// Reallocates the MSAA and depth targets for a new drawable size (only when it changes, at a frame's start).
    private func ensureTargets(_ w: Int, _ h: Int) {
        guard msaa?.width != w || msaa?.height != h else { return }
        let c = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: Renderer.colorFormat, width: w, height: h, mipmapped: false)
        c.textureType = .type2DMultisample; c.sampleCount = Renderer.samples; c.usage = .renderTarget; c.storageMode = .memoryless
        msaa = device.makeTexture(descriptor: c)
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: Renderer.depthFormat, width: w, height: h, mipmapped: false)
        d.textureType = .type2DMultisample; d.sampleCount = Renderer.samples; d.usage = .renderTarget; d.storageMode = .memoryless
        depth = device.makeTexture(descriptor: d)
    }

    /// One frame into `drawable`. `t`: seconds since start (the turntable).
    func draw(into drawable: CAMetalDrawable, time t: Double, onGPU: ((Double) -> Void)? = nil) {
        gate.wait()
        let tex = drawable.texture
        ensureTargets(tex.width, tex.height)
        let fb = frames[frameIndex]; frameIndex = (frameIndex + 1) % Renderer.inFlight
        let aspect = Float(tex.width) / Float(max(1, tex.height))
        // The lens holds the HORIZONTAL field of view across aspects (LESSONS 0108, director.js lens()): a near-square
        // inner screen and an upright outer one frame the car the same width.
        let hfov: Float = 0.92   // ≈ 53° across
        let vfov = 2 * atan(tan(hfov / 2) / aspect)
        let yaw = Float(t * 0.35)
        let dist: Float = aspect < 1 ? 7.6 : 6.4
        let eye = SIMD3<Float>(sin(yaw) * dist, 1.35, cos(yaw) * dist)
        let target = SIMD3<Float>(0, 0.55, 0)
        var u = FrameUniforms()
        u.viewProj = perspective(fovy: vfov, aspect: aspect, near: 0.1, far: 120) * lookAt(eye: eye, target: target, up: [0, 1, 0])
        u.model = matrix_identity_float4x4
        u.eye = eye; u.time = Float(t); u.keyDir = simd_normalize(SIMD3<Float>(0.55, 0.75, 0.45)); u.hingeOpen = hingeOpen
        u.viewport = SIMD2<Float>(Float(tex.width), Float(tex.height))
        fb.contents().storeBytes(of: u, as: FrameUniforms.self)

        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = msaa
        pass.colorAttachments[0].resolveTexture = tex
        pass.colorAttachments[0].loadAction = .dontCare
        pass.colorAttachments[0].storeAction = .multisampleResolve
        pass.depthAttachment.texture = depth
        pass.depthAttachment.loadAction = .clear; pass.depthAttachment.clearDepth = 1
        pass.depthAttachment.storeAction = .dontCare
        guard let cmd = queue.makeCommandBuffer(), let enc = cmd.makeRenderCommandEncoder(descriptor: pass) else { gate.signal(); return }
        enc.setDepthStencilState(depthOff)
        enc.setRenderPipelineState(skyPipe)
        enc.setFragmentBuffer(fb, offset: 0, index: 1)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.setDepthStencilState(depthWrite)
        enc.setRenderPipelineState(floorPipe)
        enc.setVertexBuffer(fb, offset: 0, index: 1); enc.setFragmentBuffer(fb, offset: 0, index: 1)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
        enc.setCullMode(.back); enc.setFrontFacing(.counterClockwise)
        enc.setVertexBuffer(mesh.vertices, offset: 0, index: 0)
        for (i, s) in mesh.submeshes.enumerated() where s.opacity >= 1 { drawSub(enc, i, s, fb) }
        // Glass last, blended, depth read-only.
        enc.setRenderPipelineState(carBlendPipe); enc.setDepthStencilState(depthRead)
        for (i, s) in mesh.submeshes.enumerated() where s.opacity < 1 { drawSub(enc, i, s, fb, set: false) }
        enc.endEncoding()
        cmd.present(drawable)
        let g = gate
        cmd.addCompletedHandler { cb in
            onGPU?((cb.gpuEndTime - cb.gpuStartTime) * 1000)
            g.signal()
        }
        cmd.commit()
    }
    private func drawSub(_ enc: MTLRenderCommandEncoder, _ i: Int, _ s: Mesh.Submesh, _ fb: MTLBuffer, set: Bool = true) {
        if set { enc.setRenderPipelineState(carPipe) }
        enc.setCullMode(s.doubleSided ? .none : .back)
        enc.setVertexBuffer(fb, offset: 0, index: 1)
        enc.setFragmentBuffer(fb, offset: 0, index: 1)
        enc.setFragmentBuffer(materials, offset: i * MemoryLayout<MaterialUniforms>.stride, index: 2)
        enc.drawIndexedPrimitives(type: .triangle, indexCount: s.indexCount, indexType: .uint32, indexBuffer: mesh.indices,
                                  indexBufferOffset: s.indexStart * 4, instanceCount: 1, baseVertex: s.vertexStart, baseInstance: 0)
    }
}

/// Pipelines through an MTLBinaryArchive in Caches: compiled once per device and app build, loaded after.
final class PipelineArchive {
    private let device: MTLDevice
    private var archive: MTLBinaryArchive?
    private let url: URL
    private var dirty = false
    init(device: MTLDevice) {
        self.device = device
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pipelines-\(build).metallib")
        #if targetEnvironment(simulator)
        // The simulator's GPU can't build archives ("Target device architecture is nil"): pipelines are still all
        // built at launch, just not cached across launches.
        archive = nil
        #else
        let d = MTLBinaryArchiveDescriptor()
        if FileManager.default.fileExists(atPath: url.path) { d.url = url }
        archive = try? device.makeBinaryArchive(descriptor: d)
        if archive == nil { archive = try? device.makeBinaryArchive(descriptor: MTLBinaryArchiveDescriptor()) }
        #endif
    }
    func pipeline(_ d: MTLRenderPipelineDescriptor) -> MTLRenderPipelineState? {
        if let a = archive {
            d.binaryArchives = [a]
            if (try? a.addRenderPipelineFunctions(descriptor: d)) != nil { dirty = true }
        }
        return try? device.makeRenderPipelineState(descriptor: d)
    }
    func save() { if dirty, let a = archive { try? a.serialize(to: url) } }
}

func perspective(fovy: Float, aspect: Float, near: Float, far: Float) -> simd_float4x4 {
    let y = 1 / tan(fovy / 2), x = y / aspect, z = far / (near - far)
    return simd_float4x4(columns: (SIMD4(x, 0, 0, 0), SIMD4(0, y, 0, 0), SIMD4(0, 0, z, -1), SIMD4(0, 0, z * near, 0)))
}
func lookAt(eye: SIMD3<Float>, target: SIMD3<Float>, up: SIMD3<Float>) -> simd_float4x4 {
    let f = simd_normalize(target - eye), s = simd_normalize(simd_cross(f, up)), u = simd_cross(s, f)
    return simd_float4x4(columns: (SIMD4(s.x, u.x, -f.x, 0), SIMD4(s.y, u.y, -f.y, 0), SIMD4(s.z, u.z, -f.z, 0),
                                   SIMD4(-simd_dot(s, eye), -simd_dot(u, eye), simd_dot(f, eye), 1)))
}
