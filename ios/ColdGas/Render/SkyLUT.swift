// Free Drive's atmosphere (0231, salvaged from #365 by 0310; Sky.h, SkyLUT.metal): the LUTs and their passes. The
// transmittance and multiple-scattering LUTs are drawn once a session; the sky-view only when the sun or the eye's height has
// moved enough to see (it follows both), then mipmapped so rougher reflections and the ambient read blurrier levels; the cloud
// map when the sky-view is redrawn, and otherwise every 8th frame (the clouds drift ≈ 4 m/s at 2 km: a few texels a second).
// Most frames encode nothing at all. Nothing is allocated per frame.
import Metal
import simd

struct SkyParamsU { var sun = SIMD4<Float>(), eye = SIMD4<Float>(), light = SIMD4<Float>() }

final class SkyLUT {
    let trans: MTLTexture, ms: MTLTexture, view: MTLTexture, clouds: MTLTexture
    private let transPipe, msPipe, viewPipe, cloudPipe: MTLRenderPipelineState
    private var frame = 0
    private var baked = false
    private var last = SIMD4<Float>(repeating: -9)
    /// Redraws so far (the bench's line): the sky-view, the clouds.
    private(set) var viewDraws = 0, cloudDraws = 0
    static let cloudEvery = 8

    init?(device: MTLDevice, library: MTLLibrary, archive: PipelineArchive? = nil) {
        func tex(_ w: Int, _ h: Int, mips: Bool) -> MTLTexture? {
            let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float, width: w, height: h, mipmapped: mips)
            d.usage = [.renderTarget, .shaderRead]; d.storageMode = .private
            return device.makeTexture(descriptor: d)
        }
        func pipe(_ f: String) -> MTLRenderPipelineState? {
            let d = MTLRenderPipelineDescriptor()
            d.vertexFunction = library.makeFunction(name: "cg_skylut_vertex"); d.fragmentFunction = library.makeFunction(name: f)
            d.colorAttachments[0].pixelFormat = .rgba16Float
            return archive?.pipeline(d, name: f) ?? (try? device.makeRenderPipelineState(descriptor: d))
        }
        guard let t = tex(256, 64, mips: false), let m = tex(32, 32, mips: false), let v = tex(192, 108, mips: true), let c = tex(384, 192, mips: false),
              let tp = pipe("cg_skylut_trans_fragment"), let mp = pipe("cg_skylut_ms_fragment"), let vp = pipe("cg_skylut_view_fragment"),
              let cp = pipe("cg_skylut_cloud_fragment") else { return nil }
        trans = t; ms = m; view = v; clouds = c; transPipe = tp; msPipe = mp; viewPipe = vp; cloudPipe = cp
    }

    /// Encode this frame's LUT work: the first time, all of it; afterwards the sky-view only when the sun has turned
    /// (≈ 0.03°) or the eye has climbed or dropped 50 m, and the clouds every `cloudEvery` frames.
    func update(_ cmd: MTLCommandBuffer, sun: SIMD3<Float>, eyeKm: Float, sunE: SIMD3<Float>, time: Float, night: Float) {
        let key = SIMD4(sun, eyeKm)
        let moved = simd_length(SIMD3(key.x, key.y, key.z) - SIMD3(last.x, last.y, last.z)) > 0.0005 || abs(key.w - last.w) > 0.05
        frame += 1
        var p = SkyParamsU(sun: SIMD4(sun, 0), eye: SIMD4(eyeKm, 0.3, night, 0), light: SIMD4(sunE, time))
        if baked && !moved {
            if frame % SkyLUT.cloudEvery == 0 { cloudPass(cmd, &p) }
            return
        }
        Signs.world("sky") {
            func pass(_ target: MTLTexture, _ pipe: MTLRenderPipelineState, _ set: (MTLRenderCommandEncoder) -> Void) {
                let rp = MTLRenderPassDescriptor()
                rp.colorAttachments[0].texture = target; rp.colorAttachments[0].loadAction = .dontCare; rp.colorAttachments[0].storeAction = .store
                guard let e = cmd.pass(rp) else { return }
                e.setRenderPipelineState(pipe); set(e)
                e.setFragmentBytes(&p, length: MemoryLayout<SkyParamsU>.stride, index: 0)
                e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
            }
            if !baked {
                pass(trans, transPipe) { _ in }
                pass(ms, msPipe) { $0.setFragmentTexture(self.trans, index: 0) }
                baked = true
            }
            pass(view, viewPipe) { $0.setFragmentTexture(self.trans, index: 0); $0.setFragmentTexture(self.ms, index: 1) }
            if let b = cmd.makeBlitCommandEncoder() { b.generateMipmaps(for: view); b.endEncoding() }
            viewDraws += 1
            cloudPass(cmd, &p)
            last = key
        }
    }
    private func cloudPass(_ cmd: MTLCommandBuffer, _ p: inout SkyParamsU) {
        let rp = MTLRenderPassDescriptor()
        rp.colorAttachments[0].texture = clouds; rp.colorAttachments[0].loadAction = .dontCare; rp.colorAttachments[0].storeAction = .store
        guard let e = cmd.pass(rp) else { return }
        e.setRenderPipelineState(cloudPipe); e.setFragmentTexture(view, index: 0)
        e.setFragmentBytes(&p, length: MemoryLayout<SkyParamsU>.stride, index: 0)
        e.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3); e.endEncoding()
        cloudDraws += 1
    }
    /// What the LUTs hold on the GPU (bytes), for the perf line's Metal MB.
    var bytes: Int { [trans, ms, view, clouds].reduce(0) { $0 + $1.allocatedSize } }
}

/// The sun's light at the ground, on the CPU (the key light and the exposure): the same air as Sky.h, integrated along the
/// sun's ray from the eye's height, 32 steps. Called when the time of day changes, not every frame.
enum SkyCPU {
    static let rg = 6360.0, rt = 6460.0
    static let sunE = 7.0
    static func transmittance(heightKm h0: Double, sunY: Double) -> SIMD3<Double> {
        let r = rg + max(h0, 0.002), mu = sunY
        // the earth in the way
        let b = r * mu, c = r * r - rg * rg, disc = b * b - c
        if disc > 0 && -b - disc.squareRoot() > 0 { return .zero }
        let ca = r * r - rt * rt, da = b * b - ca
        guard da > 0 else { return SIMD3(repeating: 1) }
        let t = -b + da.squareRoot()
        var od = SIMD3<Double>.zero
        let n = 32, dt = t / Double(n)
        for i in 0..<n {
            let s = (Double(i) + 0.5) * dt
            let h = (r * r + s * s + 2 * r * s * mu).squareRoot() - rg
            let dr = exp(-h / 8), dm = exp(-h / 1.2), dz = max(0, 1 - abs(h - 25) / 15)
            od += (SIMD3(5.802, 13.558, 33.1) * 1e-3 * dr + SIMD3(repeating: 4.44e-3 * dm) + SIMD3(0.650, 1.881, 0.085) * 1e-3 * dz) * dt
        }
        return SIMD3(exp(-od.x), exp(-od.y), exp(-od.z))
    }
}
