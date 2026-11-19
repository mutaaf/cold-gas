// Free Drive's loose things drawn (0223): the cones, barriers and A-frame signs the engine moves (ColdGasPhysics
// Loose.swift), each a full pose (they tip and roll), instanced per kind with the props' 44-byte vertex and lit as the
// props are. Matte, in the stage's palette: off-white plastic with the one signal red, and retroreflective bands that
// catch the headlamps. The instances go into a triple-buffered ring: nothing is allocated per frame.
import Metal
import simd
import ColdGasPhysics

final class LooseView {
    static let maxPerKind = 96
    private struct Mesh { let vb: MTLBuffer; let ib: MTLBuffer; let count: Int; var lift: Float = 0 }
    private var meshes: [Mesh] = []
    private let inst: [MTLBuffer]
    private var slot = 0
    private var counts = [Int](repeating: 0, count: LooseKind.allCases.count)
    /// One instance: the model (relative to the origin) and a tint.
    struct Inst { var m: simd_float4x4; var tint: SIMD4<Float> }

    /// `forged`: a kind's mesh from the world's props (the roadside's, 0227), built standing on y = 0; drawn lowered by its
    /// half height so it sits on the collider's middle as the engine's pose does.
    init?(device: MTLDevice, forged: [LooseKind: (MTLBuffer, MTLBuffer, Int)] = [:]) {
        let per = LooseView.maxPerKind * LooseKind.allCases.count * MemoryLayout<Inst>.stride
        var bufs: [MTLBuffer] = []
        for _ in 0..<Renderer.inFlight { guard let b = device.makeBuffer(length: per, options: .storageModeShared) else { return nil }; bufs.append(b) }
        inst = bufs
        for k in LooseKind.allCases {
            if let f = forged[k] { meshes.append(Mesh(vb: f.0, ib: f.1, count: f.2, lift: -Float(k.half.1))); continue }
            let g = LooseView.mesh(k)
            guard let vb = device.makeBuffer(bytes: g.v, length: g.v.count * 4, options: .storageModeShared),
                  let ib = device.makeBuffer(bytes: g.i, length: g.i.count * 4, options: .storageModeShared) else { return nil }
            meshes.append(Mesh(vb: vb, ib: ib, count: g.i.count))
        }
    }

    /// This frame's poses (world metres, relative to `origin`).
    func update(_ bodies: [LooseBody], origin: SIMD3<Double>) {
        slot = (slot + 1) % inst.count
        for k in counts.indices { counts[k] = 0 }
        let base = inst[slot].contents().bindMemory(to: Inst.self, capacity: LooseView.maxPerKind * counts.count)
        for b in bodies where !b.parked {
            let k = Int(b.kind.rawValue)
            guard counts[k] < LooseView.maxPerKind else { continue }
            let q = simd_quatf(ix: Float(b.qx), iy: Float(b.qy), iz: Float(b.qz), r: Float(b.qw))
            var m = simd_float4x4(q)
            m.columns.3 = SIMD4(Float(b.x - origin.x), Float(b.y - origin.y), Float(b.z - origin.z), 1)
            if k < meshes.count, meshes[k].lift != 0 { m = m * translate(SIMD3(0, meshes[k].lift, 0)) }
            base[k * LooseView.maxPerKind + counts[k]] = Inst(m: m, tint: SIMD4(1, 1, 1, 0))
            counts[k] += 1
        }
    }
    var drawn: Int { counts.reduce(0, +) }

    /// In the world's pass, with the props' pipeline state swapped for the loose one (same buffers bound).
    func draw(_ e: MTLRenderCommandEncoder) {
        for (k, m) in meshes.enumerated() where counts[k] > 0 {
            e.setVertexBuffer(inst[slot], offset: k * LooseView.maxPerKind * MemoryLayout<Inst>.stride, index: 3)
            e.setVertexBuffer(m.vb, offset: 0, index: 0)
            e.drawIndexedPrimitives(type: .triangle, indexCount: m.count, indexType: .uint32, indexBuffer: m.ib, indexBufferOffset: 0, instanceCount: counts[k])
        }
    }

    // MARK: - The meshes (centred on the collider's middle, as the engine's pose is)

    private struct Soup {
        var v: [Float] = [], i: [UInt32] = []
        mutating func tri(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ col: SIMD3<Float>, glow: Float = 0, smooth: SIMD3<Float>? = nil) {
            var n = simd_cross(b - a, c - a)
            let l = simd_length(n); n = l > 1e-9 ? n / l : SIMD3(0, 1, 0)
            for p in [a, b, c] {
                let nn: SIMD3<Float> = smooth.map { s in simd_normalize(SIMD3(p.x - s.x, 0, p.z - s.z) + SIMD3(0, n.y, 0)) } ?? n
                i.append(UInt32(v.count / 11))
                v += [p.x, p.y, p.z, nn.x, nn.y, nn.z, glow, 0, col.x, col.y, col.z]
            }
        }
        mutating func quad(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ d: SIMD3<Float>, _ col: SIMD3<Float>, glow: Float = 0, smooth: SIMD3<Float>? = nil) {
            tri(a, b, c, col, glow: glow, smooth: smooth); tri(a, c, d, col, glow: glow, smooth: smooth)
        }
        mutating func box(_ c: SIMD3<Float>, _ h: SIMD3<Float>, _ col: SIMD3<Float>, glow: Float = 0) {
            let x = h.x, y = h.y, z = h.z
            func p(_ sx: Float, _ sy: Float, _ sz: Float) -> SIMD3<Float> { c + SIMD3(sx * x, sy * y, sz * z) }
            quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), col, glow: glow)
            quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), col, glow: glow)
            quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), col, glow: glow)
            quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), col, glow: glow)
            quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), col, glow: glow)
            quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), col, glow: glow)
        }
        /// A ring band (y0…y1, radius r0 at the bottom, r1 at the top), smooth-shaded about the y axis; `inward` faces it in.
        mutating func band(_ y0: Float, _ y1: Float, _ r0: Float, _ r1: Float, _ col: SIMD3<Float>, n: Int = 20, inward: Bool = false, glow: Float = 0) {
            for j in 0..<n {
                let a0 = Float(j) / Float(n) * 2 * .pi, a1 = Float(j + 1) / Float(n) * 2 * .pi
                let p0 = SIMD3(r0 * cos(a0), y0, r0 * sin(a0)), p1 = SIMD3(r0 * cos(a1), y0, r0 * sin(a1))
                let p2 = SIMD3(r1 * cos(a1), y1, r1 * sin(a1)), p3 = SIMD3(r1 * cos(a0), y1, r1 * sin(a0))
                if inward { quad(p0, p1, p2, p3, col, glow: glow, smooth: .zero) } else { quad(p0, p3, p2, p1, col, glow: glow, smooth: .zero) }
            }
        }
        /// A flat ring at height y between radii ri and ro (ri 0: a disc), facing up or down.
        mutating func ring(_ y: Float, _ ri: Float, _ ro: Float, _ col: SIMD3<Float>, up: Bool, n: Int = 20) {
            for j in 0..<n {
                let a0 = Float(j) / Float(n) * 2 * .pi, a1 = Float(j + 1) / Float(n) * 2 * .pi
                let o0 = SIMD3(ro * cos(a0), y, ro * sin(a0)), o1 = SIMD3(ro * cos(a1), y, ro * sin(a1))
                let i0 = SIMD3(ri * cos(a0), y, ri * sin(a0)), i1 = SIMD3(ri * cos(a1), y, ri * sin(a1))
                if up { quad(i0, i1, o1, o0, col) } else { quad(i0, o0, o1, i1, col) }
            }
        }
    }
    // Linear albedos: the signal red (Theme's), plastic off-white, rubber black.
    static let red = SIMD3<Float>(0.62, 0.035, 0.03), white = SIMD3<Float>(0.62, 0.62, 0.6), rubber = SIMD3<Float>(0.025, 0.025, 0.028)

    static func mesh(_ k: LooseKind) -> (v: [Float], i: [UInt32]) {
        var s = Soup()
        let (hx, hy, hz) = k.half
        let H = Float(hy), X = Float(hx), Z = Float(hz)
        switch k {
        case .cone:
            // A 750 mm cone on a square rubber base: 16 sides, smooth-shaded, two retroreflective white bands.
            let n = 16, y0 = -H, base: Float = 0.03
            s.box(SIMD3(0, y0 + base / 2, 0), SIMD3(0.19, base / 2, 0.19), rubber)
            let rings: [(Float, Float, SIMD3<Float>, Float)] = [(0.0, 0.155, red, 0), (0.30, 0.12, red, 0), (0.36, 0.113, white, 1), (0.46, 0.098, white, 1),
                                                                (0.52, 0.09, red, 0), (0.58, 0.083, white, 1), (0.63, 0.077, white, 1), (0.69, 0.07, red, 0), (0.72, 0.025, red, 0)]
            let axis = SIMD3<Float>(0, 0, 0)
            for r in 0..<(rings.count - 1) {
                let (ya, ra, col, glow) = rings[r], (yb, rb, _, _) = rings[r + 1]
                for j in 0..<n {
                    let a0 = Float(j) / Float(n) * 2 * .pi, a1 = Float(j + 1) / Float(n) * 2 * .pi
                    let p0 = SIMD3(ra * cos(a0), y0 + base + ya, ra * sin(a0)), p1 = SIMD3(ra * cos(a1), y0 + base + ya, ra * sin(a1))
                    let p2 = SIMD3(rb * cos(a1), y0 + base + yb, rb * sin(a1)), p3 = SIMD3(rb * cos(a0), y0 + base + yb, rb * sin(a0))
                    s.quad(p0, p3, p2, p1, col, glow: glow, smooth: axis)
                }
            }
        case .barrier:
            // A water-fill block: a tapered white body, a red top band, fork-lift slots dark at the foot.
            s.box(SIMD3(0, -H + 0.06, 0), SIMD3(X, 0.06, Z), rubber)
            s.box(SIMD3(0, -0.02, 0), SIMD3(X, H - 0.1, Z * 0.86), white)
            s.box(SIMD3(0, H - 0.1, 0), SIMD3(X * 0.98, 0.1, Z * 0.6), red)
            s.box(SIMD3(0, 0.12, Z * 0.865), SIMD3(X * 0.7, 0.05, 0.004), white, glow: 1)
            s.box(SIMD3(0, 0.12, -Z * 0.865), SIMD3(X * 0.7, 0.05, 0.004), white, glow: 1)
        case .tyre:
            // A bare tyre lying flat: tread, rounded shoulders, sidewalls down to the bead, the hole through it.
            let ro = X, ri: Float = 0.22, sh: Float = 0.03, worn = SIMD3<Float>(0.034, 0.033, 0.035)
            s.band(-H + sh, H - sh, ro, ro, worn, n: 24)
            s.band(H - sh, H, ro, ro - sh, rubber, n: 24); s.band(-H, -H + sh, ro - sh, ro, rubber, n: 24)
            s.ring(H, ri, ro - sh, rubber, up: true, n: 24); s.ring(-H, ri, ro - sh, rubber, up: false, n: 24)
            s.band(-H, H, ri, ri, SIMD3(0.015, 0.015, 0.016), n: 24, inward: true)
        case .drum:
            // A 200 L drum: two rolling hoops, a chime at each end, a bung on the lid; the set's own grey with a white band.
            let r = X, steel = SIMD3<Float>(0.085, 0.09, 0.095), hoop = SIMD3<Float>(0.06, 0.064, 0.068)
            s.band(-H + 0.02, H - 0.02, r, r, steel, n: 20)
            for y: Float in [-0.15, 0.15] { s.band(y - 0.015, y + 0.015, r + 0.008, r + 0.008, hoop, n: 20) }
            s.band(0.3, 0.36, r + 0.002, r + 0.002, white, n: 20)
            s.band(H - 0.02, H, r + 0.006, r + 0.006, hoop, n: 20); s.band(-H, -H + 0.02, r + 0.006, r + 0.006, hoop, n: 20)
            s.ring(H - 0.01, 0, r, steel, up: true); s.ring(-H, 0, r, steel, up: false)
            s.box(SIMD3(0.16, H - 0.0, 0.05), SIMD3(0.03, 0.012, 0.03), hoop)
        case .roadCase:
            // A flight case: black ply, aluminium edge rails and ball corners, a lid seam, two latches, a red crew band.
            let ply = SIMD3<Float>(0.022, 0.022, 0.024), alu = SIMD3<Float>(0.36, 0.37, 0.38)
            s.box(.zero, SIMD3(X, H, Z), ply)
            for sy: Float in [-1, 1] { for sz: Float in [-1, 1] { s.box(SIMD3(0, sy * (H - 0.012), sz * (Z - 0.012)), SIMD3(X + 0.004, 0.014, 0.014), alu) } }
            for sx: Float in [-1, 1] { for sz: Float in [-1, 1] { s.box(SIMD3(sx * (X - 0.012), 0, sz * (Z - 0.012)), SIMD3(0.014, H + 0.002, 0.014), alu) } }
            s.box(SIMD3(0, H * 0.45, 0), SIMD3(X + 0.003, 0.01, Z + 0.003), alu)
            for sx: Float in [-0.5, 0.5] { s.box(SIMD3(sx * X, H * 0.45, Z + 0.006), SIMD3(0.04, 0.03, 0.006), alu) }
            s.box(SIMD3(0, -H * 0.2, Z + 0.004), SIMD3(X * 0.6, 0.04, 0.003), red)
            s.box(SIMD3(0, -H * 0.2, -Z - 0.004), SIMD3(X * 0.6, 0.04, 0.003), red)
        case .kRail:
            // Precast safety barrier, its section stepped as the real ones are: a wide foot, a sloped face, a narrow top;
            // concrete with a white reflector each side.
            let conc = SIMD3<Float>(0.24, 0.235, 0.22)
            let foot: Float = 0.08
            s.box(SIMD3(0, -H + foot / 2, 0), SIMD3(X, foot / 2, Z), conc)
            let zb = Z, zm = Z * 0.8, zt = Z * 0.45, ym = -H + 0.33
            let prof: [(Float, Float)] = [(zb, -H + foot), (zm, ym), (zt, H), (-zt, H), (-zm, ym), (-zb, -H + foot)]
            for i in 0..<(prof.count - 1) {
                let (za, ya) = prof[i], (zb2, yb) = prof[i + 1]
                s.quad(SIMD3(-X, ya, za), SIMD3(X, ya, za), SIMD3(X, yb, zb2), SIMD3(-X, yb, zb2), conc)
            }
            for sx: Float in [-1, 1] {   // the ends
                var pts = prof.map { SIMD3<Float>(sx * X, $0.1, $0.0) }
                if sx < 0 { pts.reverse() }
                for i in 1..<(pts.count - 1) { s.tri(pts[0], pts[i + 1], pts[i], conc) }
            }
            for sz: Float in [-1, 1] { s.box(SIMD3(0, ym + 0.12, sz * (zm + (zt - zm) * 0.35)), SIMD3(0.06, 0.03, 0.004), white, glow: 1) }
        case .generator:
            // A towable set on its skid: an off-white canopy, louvres along each side, the panel door, the exhaust.
            let canopy = SIMD3<Float>(0.42, 0.42, 0.40), dark = SIMD3<Float>(0.03, 0.03, 0.032)
            s.box(SIMD3(0, -H + 0.08, 0), SIMD3(X, 0.08, Z), dark)
            s.box(SIMD3(0, 0.08, 0), SIMD3(X - 0.04, H - 0.08, Z - 0.03), canopy)
            for k in 0..<9 {
                let x = -X * 0.75 + Float(k) * X * 0.12
                for sz: Float in [-1, 1] { s.box(SIMD3(x, 0.25, sz * (Z - 0.025)), SIMD3(0.035, 0.32, 0.008), dark) }
            }
            s.box(SIMD3(X * 0.68, 0.05, Z - 0.025), SIMD3(0.32, 0.45, 0.006), SIMD3(0.3, 0.3, 0.29))
            s.box(SIMD3(X * 0.68, 0.35, Z - 0.02), SIMD3(0.12, 0.05, 0.006), red, glow: 0.3)
            s.band(H, H + 0.35, 0.05, 0.05, dark, n: 10)
            s.box(SIMD3(-X + 0.1, H + 0.005, 0), SIMD3(0.06, 0.005, Z * 0.7), dark)
        case .fence, .signpost, .rail:
            // (the world's forged meshes draw these; a plain box if a build has none)
            s.box(.zero, SIMD3(X, H, Z), k == .fence ? SIMD3(0.17, 0.13, 0.095) : SIMD3(0.42, 0.44, 0.45))
        case .sign:
            // An A-frame board: two leaning panels, a red chevron face, a black hinge rail.
            let lean: Float = 0.24
            for sz: Float in [1, -1] {
                let a = SIMD3<Float>(-X, -H, sz * Z), b = SIMD3<Float>(X, -H, sz * Z), c = SIMD3<Float>(X, H, sz * (Z - lean)), d = SIMD3<Float>(-X, H, sz * (Z - lean))
                if sz > 0 { s.quad(a, b, c, d, white) } else { s.quad(b, a, d, c, white) }
                let off = SIMD3<Float>(0, 0, sz * 0.006)
                let m0 = a + (c - a) * 0.25, m1 = b + (d - b) * 0.25
                let k0 = SIMD3<Float>(0, -H + 2 * H * 0.62, sz * (Z - lean * 0.62))
                if sz > 0 { s.tri(m0 + off, m1 + off, k0 + off, red, glow: 1) } else { s.tri(m1 + off, m0 + off, k0 + off, red, glow: 1) }
            }
            s.box(SIMD3(0, H - 0.02, 0), SIMD3(X * 1.02, 0.025, Z - lean + 0.02), rubber)
        }
        return (s.v, s.i)
    }
}
