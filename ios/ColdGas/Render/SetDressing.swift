// The sets dressed (0273): what a working backlot leaves round a stunt, and the crew's paint on the slab.
//   - The dressing (ColdGasPhysics dressingSet: tyre stacks, drums, flight cases, safety barrier, the generator) drawn where
//     it stands in a scored run, as one static mesh with LooseView's own shapes. Pixels only: it isn't in the scored world,
//     so it sits clear of every run's line. On a roam the same things are loose bodies (FreeDrive) and LooseView draws them,
//     so this mesh isn't drawn there.
//   - Floor paint: stencilled set names, KEEP CLEAR hatching, CREW bays, run chevrons. Our own words in our own type, worn by
//     tyres and weather, drawn as decals on the slab from one atlas made at launch.
import Metal
import UIKit
import simd
import ColdGasCore
import ColdGasPhysics

final class SetDressing {
    /// The dressing at rest (opaque, lit, vertex-coloured), or nil on a set without any.
    let props: StageMesh?
    /// The floor paint (translucent, lit, the atlas as its map).
    let paint: StageMesh?
    /// The paint's texture, in a list of its own (drawMesh's `textures`).
    let textures: [StageTexture]

    init(device: MTLDevice, stage: String) {
        // The dressing: every spot's mesh, turned and set down on its base.
        var v: [Float] = [], idx: [UInt32] = []
        var cache: [LooseKind: (v: [Float], i: [UInt32])] = [:]
        for s in dressingSet(stage) {
            let g = cache[s.kind] ?? LooseView.mesh(s.kind)
            cache[s.kind] = g
            let c = Float(cos(s.yaw)), sn = Float(sin(s.yaw))
            let t = SIMD3<Float>(Float(s.x), Float(s.y + s.kind.half.1), Float(s.z))
            let base = UInt32(v.count / 11)
            for k in stride(from: 0, to: g.v.count, by: 11) {
                let p = SIMD3(g.v[k], g.v[k + 1], g.v[k + 2]), n = SIMD3(g.v[k + 3], g.v[k + 4], g.v[k + 5])
                // yaw about y (a quaternion's (0, sin h, 0, cos h) with h = yaw / 2, as addLoose stands it)
                let rp = SIMD3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z) + t, rn = SIMD3(c * n.x + sn * n.z, n.y, -sn * n.x + c * n.z)
                v += [rp.x, rp.y, rp.z, rn.x, rn.y, rn.z, 0, 0, g.v[k + 8], g.v[k + 9], g.v[k + 10]]
            }
            idx += g.i.map { $0 + base }
        }
        var m = StageMaterial()
        m.name = "set-dressing"; m.vertexColors = true; m.roughness = 0.78; m.metalness = 0
        props = SetDressing.mesh(device, v, idx, m)

        // The paint: decals on the slab, each a quad over its cell of the atlas.
        v = []; idx = []
        for d in SetDressing.decals(stage) {
            let cell = SetDressing.cells[d.cell]
            let a = Float(d.yaw), right = SIMD3<Float>(-cos(a), 0, sin(a)), up = SIMD3<Float>(sin(a), 0, cos(a))
            let c = SIMD3<Float>(d.x, 0.006, d.z), hw = d.w / 2, hh = d.w * Float(cell.aspect) / 2
            let u0 = Float(cell.rect.minX), u1 = Float(cell.rect.maxX), v0 = Float(cell.rect.minY), v1 = Float(cell.rect.maxY)
            let corners: [(SIMD3<Float>, Float, Float)] = [(c - right * hw - up * hh, u0, v1), (c + right * hw - up * hh, u1, v1),
                                                            (c + right * hw + up * hh, u1, v0), (c - right * hw + up * hh, u0, v0)]
            let base = UInt32(v.count / 11)
            for (p, u, vv) in corners { v += [p.x, p.y, p.z, 0, 1, 0, Float(u), Float(vv), d.color.x, d.color.y, d.color.z] }
            idx += [base, base + 2, base + 1, base, base + 3, base + 2]
        }
        var pm = StageMaterial()
        pm.name = "set-paint"; pm.vertexColors = true; pm.transparent = true; pm.depthWrite = false; pm.roughness = 0.62
        pm.map = 0; pm.polygonOffset = (-1, -4); pm.doubleSided = true
        paint = SetDressing.mesh(device, v, idx, pm)
        textures = [StageTexture(texture: SetDressing.atlas(device: device), repeatUV: SIMD2(1, 1), offset: .zero)]
    }

    private static func mesh(_ device: MTLDevice, _ v: [Float], _ i: [UInt32], _ m: StageMaterial) -> StageMesh? {
        guard !i.isEmpty, let vb = device.makeBuffer(bytes: v, length: v.count * 4, options: .storageModeShared),
              let ib = device.makeBuffer(bytes: i, length: i.count * 4, options: .storageModeShared) else { return nil }
        var top: Float = 0
        for k in stride(from: 1, to: v.count, by: 11) { top = max(top, v[k]) }
        return StageMesh(vertices: vb, indices: ib, submeshes: [StageSubmesh(material: m, renderOrder: 0, vertexStart: 0, vertexCount: v.count / 11, indexStart: 0, indexCount: i.count, top: top)])
    }

    // MARK: - The paint

    /// The atlas's cells (u, v in 0…1; aspect = height / width of the painted area).
    struct Cell { let rect: CGRect; var aspect: CGFloat { rect.height * 2 / rect.width } }   // the atlas is 2:1
    enum Mark: Int { case stage1, stage2, stage3, keepClear, crew, chevrons, hatch, noJets, unitB }
    static let cells: [Cell] = [
        Cell(rect: CGRect(x: 0, y: 0, width: 1, height: 0.125)),          // STAGE 1 · THE SHOW
        Cell(rect: CGRect(x: 0, y: 0.125, width: 1, height: 0.125)),      // STAGE 2 · THE WALL
        Cell(rect: CGRect(x: 0, y: 0.25, width: 1, height: 0.125)),       // STAGE 3 · THE LINEUP
        Cell(rect: CGRect(x: 0, y: 0.375, width: 0.5, height: 0.125)),    // KEEP CLEAR
        Cell(rect: CGRect(x: 0.5, y: 0.375, width: 0.25, height: 0.125)), // CREW
        Cell(rect: CGRect(x: 0.75, y: 0.375, width: 0.25, height: 0.125)),// chevrons
        Cell(rect: CGRect(x: 0, y: 0.5, width: 0.25, height: 0.5)),       // a hatched box
        Cell(rect: CGRect(x: 0.25, y: 0.5, width: 0.75, height: 0.125)),  // NO JETS ON THE APRON
        Cell(rect: CGRect(x: 0.25, y: 0.625, width: 0.375, height: 0.125)),// UNIT B
    ]
    struct Decal { let cell: Int; let x, z, w: Float; let yaw: Float; let color: SIMD3<Float> }
    static let paintWhite = SIMD3<Float>(0.72, 0.72, 0.69), paintRed = SIMD3<Float>(0.6, 0.04, 0.03)

    /// Where each set's paint lies. Yaw 0 reads from the -z side looking +z (the mark's view of the curl); π reads looking
    /// back down the run. Clear of the pad's rings and the parked row's own lines.
    static func decals(_ stage: String) -> [Decal] {
        func d(_ m: Mark, _ x: Float, _ z: Float, _ w: Float, _ yaw: Float, _ c: SIMD3<Float> = paintWhite) -> Decal { Decal(cell: m.rawValue, x: x, z: z, w: w, yaw: yaw, color: c) }
        let pi = Float.pi
        switch stage {
        case "lineup":
            return [d(.stage3, 0, -96, 9, pi), d(.chevrons, 0, -58, 2.4, 0), d(.chevrons, 0, -36, 2.4, 0),
                    d(.hatch, -7, 22, 3, 0, paintRed), d(.hatch, 7, 22, 3, 0, paintRed), d(.keepClear, -10.5, 22, 4.5, pi / 2),
                    d(.crew, 16, -24, 3, -pi / 2), d(.unitB, -16, 6, 3.6, pi / 2), d(.noJets, 15, 60, 7, -pi / 2)]
        default:
            let name: Mark = stage == "wall" ? .stage2 : .stage1
            return [d(name, 0, -64, 8.6, pi), d(.chevrons, 0, -100, 2.2, 0), d(.chevrons, 0, -150, 2.2, 0),
                    d(.hatch, -4.6, 6, 3, 0, paintRed), d(.hatch, 4.6, 6, 3, 0, paintRed), d(.keepClear, -7.4, 6, 4.5, pi / 2),
                    d(.crew, 14.6, -14.8, 3, -pi / 2), d(.unitB, -15, -22, 3.6, pi / 2), d(.noJets, -14, -60, 7, pi / 2)]
        }
    }

    /// The paint's atlas (2048 × 1024, alpha only matters; the colour is the decal's): stencil type with its bridges, worn
    /// where tyres and boots cross it. Made once and shared by every set.
    private static var made: MTLTexture?
    private static let lock = NSLock()
    static func atlas(device: MTLDevice) -> MTLTexture? {
        lock.lock(); defer { lock.unlock() }
        if let t = made { return t }
        let W = 2048, H = 1024
        guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.translateBy(x: 0, y: CGFloat(H)); ctx.scaleBy(x: 1, y: -1)   // top-left origin, as the cells are written
        UIGraphicsPushContext(ctx)
        let white = UIColor.white
        func rect(_ c: Cell) -> CGRect { CGRect(x: c.rect.minX * CGFloat(W), y: c.rect.minY * CGFloat(H), width: c.rect.width * CGFloat(W), height: c.rect.height * CGFloat(H)) }
        func text(_ s: String, _ c: Cell, size: CGFloat) {
            let r = rect(c)
            let font = UIFont(name: "Michroma-Regular", size: size) ?? .systemFont(ofSize: size, weight: .heavy)
            let attr: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: white, .kern: size * 0.12]
            let str = NSAttributedString(string: s, attributes: attr)
            let b = str.size()
            str.draw(at: CGPoint(x: r.midX - b.width / 2, y: r.midY - b.height / 2))
            // Stencil bridges: thin gaps across each letter's middle, as a cut stencil leaves.
            ctx.setBlendMode(.clear)
            ctx.fill(CGRect(x: r.minX, y: r.midY - size * 0.03, width: r.width, height: size * 0.06))
            ctx.setBlendMode(.normal)
        }
        text("STAGE 1 · THE SHOW", cells[0], size: 86)
        text("STAGE 2 · THE WALL", cells[1], size: 86)
        text("STAGE 3 · THE LINEUP", cells[2], size: 80)
        text("KEEP CLEAR", cells[3], size: 76)
        text("CREW", cells[4], size: 70)
        text("UNIT B", cells[8], size: 74)
        text("NO JETS ON THE APRON", cells[7], size: 62)
        // Chevrons: three, pointing to the cell's top (the way the run goes).
        let ch = rect(cells[5])
        white.setFill()
        for k in 0..<3 {
            let cx = ch.minX + ch.width * (0.22 + 0.28 * CGFloat(k)), cy = ch.midY, s = ch.height * 0.34
            let p = UIBezierPath()
            p.move(to: CGPoint(x: cx - s * 0.5, y: cy - s)); p.addLine(to: CGPoint(x: cx + s * 0.5, y: cy)); p.addLine(to: CGPoint(x: cx - s * 0.5, y: cy + s))
            p.addLine(to: CGPoint(x: cx - s * 0.1, y: cy + s)); p.addLine(to: CGPoint(x: cx + s * 0.9, y: cy)); p.addLine(to: CGPoint(x: cx - s * 0.1, y: cy - s)); p.close()
            p.fill()
        }
        // A hatched box: a frame and 45° stripes.
        let hb = rect(cells[6]).insetBy(dx: 18, dy: 18)
        ctx.saveGState()
        ctx.setLineWidth(22); ctx.setStrokeColor(white.cgColor); ctx.stroke(hb.insetBy(dx: 11, dy: 11))
        ctx.clip(to: hb)
        ctx.setLineWidth(26)
        var x = hb.minX - hb.height
        while x < hb.maxX { ctx.move(to: CGPoint(x: x, y: hb.maxY)); ctx.addLine(to: CGPoint(x: x + hb.height, y: hb.minY)); x += 78 }
        ctx.strokePath()
        ctx.restoreGState()
        UIGraphicsPopContext()
        // Wear: the paint thins in drifts and drops out in flecks, worst along wheel lines (value noise, seeded).
        guard let data = ctx.data else { return nil }
        let px = data.bindMemory(to: UInt8.self, capacity: W * H * 4)
        func hash(_ x: Int, _ y: Int) -> Float { var h = UInt32(truncatingIfNeeded: x &* 374761393 &+ y &* 668265263); h = (h ^ (h >> 13)) &* 1274126177; return Float((h ^ (h >> 16)) & 0xffff) / 65535 }
        func noise(_ x: Int, _ y: Int, _ cell: Int) -> Float {
            let xi = x / cell, yi = y / cell, fx = Float(x % cell) / Float(cell), fy = Float(y % cell) / Float(cell)
            let a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
            let sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
            return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
        }
        for y in 0..<H {
            for x in 0..<W {
                let o = (y * W + x) * 4
                let a = px[o + 3]
                px[o] = 255; px[o + 1] = 255; px[o + 2] = 255   // white everywhere (the mips then fade only the alpha)
                if a == 0 { continue }
                let drift = noise(x, y, 64) * 0.6 + noise(x, y, 16) * 0.4
                let fleck = hash(x &* 3, y &* 7)
                var k = min(1, max(0, (drift - 0.18) * 1.6)) * 0.85
                if fleck < 0.08 { k *= 0.3 }
                let na = UInt8(Float(a) * k)
                px[o + 3] = na   // the decal's colour comes from its vertices
            }
        }
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: W, height: H, mipmapped: true)
        d.usage = .shaderRead; d.storageMode = .shared
        guard let t = device.makeTexture(descriptor: d) else { return nil }
        t.replace(region: MTLRegionMake2D(0, 0, W, H), mipmapLevel: 0, withBytes: data, bytesPerRow: W * 4)
        if let q = device.makeCommandQueue(), let cb = q.makeCommandBuffer(), let bl = cb.makeBlitCommandEncoder() {
            bl.generateMipmaps(for: t); bl.endEncoding(); cb.commit(); cb.waitUntilCompleted()
        }
        made = t
        return t
    }
}
