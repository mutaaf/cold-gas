// The scored run's skid marks (0281): rubber laid on the set where a tyre slides or spins, read from the track's own
// wheels (pose, compression, spin, steer: what's drawn), never the sim, so a replay lays the same marks as the run. The
// quads are World/Marks.swift's capped ring (4,096, the oldest dropped), drawn by a pass of their own (Skid.metal) after
// the stage's opaque surfaces, so a look can restyle the rubber in one place. Free Drive and the roams draw theirs in
// the world's view (WorldView) and don't come here.
//
// Each tick a wheel is on the ground, its contact patch's velocity (the patch's own motion between two ticks, so the
// car's yaw counts) is split along and across the wheel: the slip angle and the slip against the tread's speed give how
// hard it's sliding, the same thresholds as Free Drive's marks. The lateral slip speed also feeds the tyre smoke.
import Metal
import simd
import ColdGasCore
import ColdGasPhysics

final class RunSkids {
    let marks: SkidMarks
    private let pipe: MTLRenderPipelineState, depth: MTLDepthStencilState
    private let anchors = wheelAnchors()
    private var lastT = -1.0, lastTick = -1
    private weak var track: Replay?
    /// Each wheel's sideways slip speed this frame (m/s), for the smoke.
    private(set) var lateral = SIMD4<Float>(repeating: 0)

    init?(device: MTLDevice, library: MTLLibrary, samples: Int, color: MTLPixelFormat, depth depthFormat: MTLPixelFormat) {
        guard let m = SkidMarks(device: device) else { return nil }
        marks = m
        let vd = MTLVertexDescriptor()
        vd.attributes[0].format = .float4; vd.attributes[0].offset = 0; vd.attributes[0].bufferIndex = 0
        vd.layouts[0].stride = 16
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = library.makeFunction(name: "cg_skid_vertex"); d.fragmentFunction = library.makeFunction(name: "cg_skid_fragment")
        d.vertexDescriptor = vd
        d.colorAttachments[0].pixelFormat = color
        d.colorAttachments[0].isBlendingEnabled = true
        d.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha; d.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        d.colorAttachments[0].sourceAlphaBlendFactor = .zero; d.colorAttachments[0].destinationAlphaBlendFactor = .one
        d.depthAttachmentPixelFormat = depthFormat
        d.rasterSampleCount = samples
        guard d.vertexFunction != nil, let p = try? device.makeRenderPipelineState(descriptor: d) else { return nil }
        pipe = p
        let ds = MTLDepthStencilDescriptor(); ds.isDepthWriteEnabled = false; ds.depthCompareFunction = .lessEqual
        guard let dss = device.makeDepthStencilState(descriptor: ds) else { return nil }
        depth = dss
    }

    func clear() { marks.clear(); lastT = -1; lastTick = -1; lateral = .zero }

    /// Once a frame, at the track's time `t` (s).
    func update(_ r: Replay, t: Double) {
        if r !== track { track = r; clear() }
        if t < lastT - 1e-6 { clear() }   // the track went back (a replay looping, the encore, a retry)
        lastT = t
        guard r.ticks > 2 else { return }
        let tick = min(r.ticks - 1, Int(t * Replay.hz))
        guard tick != lastTick, tick > 0 else { return }
        lastTick = tick
        let dtTick = 1 / Replay.hz
        let t1 = Double(tick) / Replay.hz, t0 = t1 - dtTick
        let c1 = r.car(at: t1), c0 = r.car(at: t0)
        let up = c1.quat.act(SIMD3<Float>(0, 1, 0))
        for i in 0..<4 {
            let w1 = r.wheel(i, at: t1), w0 = r.wheel(i, at: t0)
            let p1 = contact(i, c1.pos, c1.quat, w1.comp), p0 = contact(i, c0.pos, c0.quat, w0.comp)
            let fwdL = SIMD3<Float>(sin(w1.steer), 0, cos(w1.steer)), sideL = SIMD3<Float>(cos(w1.steer), 0, -sin(w1.steer))
            let wf = c1.quat.act(fwdL), ws = c1.quat.act(sideL)
            guard w1.comp > 0.002 else { lateral[i] = 0; marks.mark(i, at: SIMD3<Double>(p1), side: SIMD3<Double>(ws), width: 0.25, strength: 0, origin: .zero); continue }
            let v = (p1 - p0) * Float(Replay.hz)
            let vLong = simd_dot(v, wf), vLat = simd_dot(v, ws)
            let rim = (w1.spin - w0.spin) * Float(Replay.hz) * Float(wheelRadiusOf(i))
            let speed = simd_length(v)
            let kappa = (rim - vLong) / max(abs(vLong), 3), alpha = atan2(abs(vLat), max(abs(vLong), 1.5))
            let longS = max(0, (abs(kappa) - 0.08) / 0.2), latS = max(0, (alpha - 0.05) / 0.12)
            let s = min(1, max(longS, latS)) * (speed > 1.2 || abs(rim) > 2 ? 1 : 0)
            lateral[i] = alpha > 0.1 ? abs(vLat) : 0
            marks.mark(i, at: SIMD3<Double>(p1), side: SIMD3<Double>(ws), width: 0.25, strength: Float(s), origin: .zero, up: SIMD3<Double>(up))
        }
    }
    /// Wheel i's contact patch in the world: its centre as the renderer draws it (anchor − rest length + compression,
    /// Renderer.wheelsDraw), a radius down the car's own up.
    private func contact(_ i: Int, _ pos: SIMD3<Float>, _ q: simd_quatf, _ comp: Float) -> SIMD3<Float> {
        let a = anchors[i]
        let local = SIMD3<Float>(Float(a.0), Float(a.1 - CAR.restLen) + comp - Float(wheelRadiusOf(i)), Float(a.2))
        return pos + q.act(local)
    }

    /// In the main pass, after the stage's opaque surfaces: the rubber over the floor.
    func draw(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU) {
        guard marks.count > 0 else { return }
        marks.prepare(origin: .zero)
        e.setRenderPipelineState(pipe); e.setCullMode(.none); e.setDepthStencilState(depth); e.setDepthBias(-24, slopeScale: -3, clamp: 0)
        e.setVertexBuffer(frame, offset: 0, index: 1); e.setFragmentBuffer(frame, offset: 0, index: 1)
        e.setFragmentBytes(&look, length: MemoryLayout<LookU>.stride, index: 4)
        e.setVertexBuffer(marks.buf, offset: 0, index: 0)
        e.tris(marks.count * 6)
        e.setDepthBias(0, slopeScale: 0, clamp: 0)
    }
}
