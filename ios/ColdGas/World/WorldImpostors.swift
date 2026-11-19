// Far trees as impostors (0310, docs/NATIVE-FREEDRIVE.md §9.6). Past the forged LODs a tree was the kit's few-triangle cone or
// blob, a different silhouette from the forged tree it replaced. Now each tree kind's finest mesh is photographed once, at
// launch of the drive's view, from eight sides into an atlas (albedo and alpha; the normal), and drawn far off as one
// camera-facing quad that shows the photograph from the side the camera is on, lit by the stored normal through the same
// light (so a far tree has the near tree's crown, its sway, its sun and its shade). Two triangles a tree to the horizon.
// Made once; never redrawn.
import Metal
import simd
import ColdGasWorld

final class WorldImpostors {
    static let views = 8, viewW = 128, viewH = 256
    /// The kinds drawn as impostors at their last LOD: the two trees.
    static let kinds: [Int] = [PropKind.spruce.rawValue, PropKind.broadleaf.rawValue]
    let albedo: MTLTexture, normal: MTLTexture
    let quadVB: MTLBuffer, quadIB: MTLBuffer
    let pipe: MTLRenderPipelineState
    /// Per impostor kind: its half width and height (m, at scale 1) and its slice.
    private(set) var bounds: [Int: SIMD4<Float>] = [:]

    init?(device: MTLDevice, library: MTLLibrary, queue: MTLCommandQueue, kinds: [WorldProps.KindMesh], archive: PipelineArchive) {
        let n = WorldImpostors.kinds.count
        func tex(_ f: MTLPixelFormat) -> MTLTexture? {
            let d = MTLTextureDescriptor()
            d.textureType = .type2DArray; d.pixelFormat = f; d.width = WorldImpostors.viewW * WorldImpostors.views; d.height = WorldImpostors.viewH
            d.arrayLength = n; d.usage = [.renderTarget, .shaderRead]; d.storageMode = .private
            return device.makeTexture(descriptor: d)
        }
        let zd = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .depth32Float, width: WorldImpostors.viewW * WorldImpostors.views, height: WorldImpostors.viewH, mipmapped: false)
        zd.usage = .renderTarget; zd.storageMode = .private
        let pv = MTLVertexDescriptor()
        for (i, (fmt, off)) in [(MTLVertexFormat.float3, 0), (.float3, 12), (.float2, 24), (.float3, 32)].enumerated() {
            pv.attributes[i].format = fmt; pv.attributes[i].offset = off; pv.attributes[i].bufferIndex = 0
        }
        pv.layouts[0].stride = 44
        let bd = MTLRenderPipelineDescriptor()
        bd.vertexFunction = library.makeFunction(name: "cg_world_imp_bake_vertex"); bd.fragmentFunction = library.makeFunction(name: "cg_world_imp_bake_fragment")
        bd.vertexDescriptor = pv
        bd.colorAttachments[0].pixelFormat = .rgba8Unorm; bd.colorAttachments[1].pixelFormat = .rgba8Unorm; bd.depthAttachmentPixelFormat = .depth32Float
        let dd = MTLRenderPipelineDescriptor()
        dd.vertexFunction = library.makeFunction(name: "cg_world_imp_vertex"); dd.fragmentFunction = library.makeFunction(name: "cg_world_imp_fragment")
        dd.vertexDescriptor = pv
        dd.colorAttachments[0].pixelFormat = Renderer.hdrFormat; dd.depthAttachmentPixelFormat = Renderer.depthFormat; dd.rasterSampleCount = Renderer.samples
        dd.isAlphaToCoverageEnabled = Renderer.samples > 1
        // The quad: x −1 … 1 across, y 0 … 1 up (the stage's 44-byte vertex).
        let q: [Float] = [-1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1,   1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1,   1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1,   -1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1]
        let qi: [UInt32] = [0, 1, 2, 0, 2, 3]
        let dsd = MTLDepthStencilDescriptor(); dsd.isDepthWriteEnabled = true; dsd.depthCompareFunction = .less
        guard let a = tex(.rgba8Unorm), let nm = tex(.rgba8Unorm), let z = device.makeTexture(descriptor: zd),
              let bp = archive.pipeline(bd, name: "imp-bake"), let dp = archive.pipeline(dd, name: "imp"),
              let vb = device.makeBuffer(bytes: q, length: q.count * 4, options: .storageModeShared),
              let ib = device.makeBuffer(bytes: qi, length: qi.count * 4, options: .storageModeShared),
              let ds = device.makeDepthStencilState(descriptor: dsd), let cmd = queue.makeCommandBuffer() else { return nil }
        albedo = a; normal = nm; quadVB = vb; quadIB = ib; pipe = dp
        a.label = "world.impostor.albedo"; nm.label = "world.impostor.normal"
        // The photographs: one pass a kind, a viewport a side.
        for (slice, k) in WorldImpostors.kinds.enumerated() {
            guard k < kinds.count, let m = kinds[k].lods.first else { continue }
            // The mesh's extent (from its vertex buffer: 11 floats a vertex).
            let f = m.vb.contents().bindMemory(to: Float.self, capacity: m.vb.length / 4)
            var r: Float = 0.3, h: Float = 0.5
            for v in stride(from: 0, to: m.vb.length / 4 - 10, by: 11) { r = max(r, (f[v] * f[v] + f[v + 2] * f[v + 2]).squareRoot()); h = max(h, f[v + 1]) }
            r *= 1.04; h *= 1.02
            bounds[k] = SIMD4(r, h, Float(slice), 0)
            let rp = MTLRenderPassDescriptor()
            rp.colorAttachments[0].texture = a; rp.colorAttachments[0].slice = slice; rp.colorAttachments[0].loadAction = .clear
            rp.colorAttachments[0].clearColor = MTLClearColor(red: 0.04, green: 0.06, blue: 0.03, alpha: 0); rp.colorAttachments[0].storeAction = .store
            rp.colorAttachments[1].texture = nm; rp.colorAttachments[1].slice = slice; rp.colorAttachments[1].loadAction = .clear
            rp.colorAttachments[1].clearColor = MTLClearColor(red: 0.5, green: 1, blue: 0.5, alpha: 0); rp.colorAttachments[1].storeAction = .store
            rp.depthAttachment.texture = z; rp.depthAttachment.loadAction = .clear; rp.depthAttachment.clearDepth = 1; rp.depthAttachment.storeAction = .dontCare
            guard let e = cmd.makeRenderCommandEncoder(descriptor: rp) else { continue }
            e.setRenderPipelineState(bp); e.setDepthStencilState(ds); e.setCullMode(.none)
            e.setVertexBuffer(m.vb, offset: 0, index: 0)
            for i in 0..<WorldImpostors.views {
                e.setViewport(MTLViewport(originX: Double(i * WorldImpostors.viewW), originY: 0, width: Double(WorldImpostors.viewW), height: Double(WorldImpostors.viewH), znear: 0, zfar: 1))
                var u = SIMD4<Float>(r, h, Float(i) * 2 * .pi / Float(WorldImpostors.views), 0)
                e.setVertexBytes(&u, length: 16, index: 1)
                e.drawIndexedPrimitives(type: .triangle, indexCount: m.count, indexType: .uint32, indexBuffer: m.ib, indexBufferOffset: 0)
            }
            e.endEncoding()
        }
        cmd.commit()
    }
    var bytes: Int { albedo.allocatedSize + normal.allocatedSize }
}
