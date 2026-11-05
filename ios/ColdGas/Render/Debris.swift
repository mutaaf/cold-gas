// src/render/debris.js, ported (0159): torn-off parts as small rigid bodies, a box (the part's bounds) with mass and inertia
// that falls, strikes the concrete on its corners (an impulse with restitution and Coulomb friction at each corner below
// the ground), tumbles and settles flat. Cosmetic: the sim never sees them. A fixed list, nothing allocated per frame.
// One line differs from the web's, on purpose: see `a` in step.
import simd

final class Debris {
    struct Piece {
        var pos = SIMD3<Float>(), quat = simd_quatf(angle: 0, axis: [0, 1, 0])
        var v = SIMD3<Float>(), w = SIMD3<Float>()
        var half: SIMD3<Float>, I: SIMD3<Float>
        var on = false, still: Float = 0
    }
    private static let G: Float = 9.81, E: Float = 0.25, MU: Float = 0.55, SUB = 2
    private static let CORNERS: [SIMD3<Float>] = { var c: [SIMD3<Float>] = []; for x: Float in [-1, 1] { for y: Float in [-1, 1] { for z: Float in [-1, 1] { c.append(SIMD3(x, y, z)) } } }; return c }()
    private(set) var list: [Piece] = []
    var floorY: Float = 0

    func removeAll() { list.removeAll() }
    func isOn(_ i: Int) -> Bool { list[i].on }
    /// A piece: its box's half extents. Thin panels get a floor on their inertia, so a 1 cm skirt edge doesn't spin like a top.
    func add(half h: SIMD3<Float>) -> Int {
        var I = SIMD3((h.y * h.y + h.z * h.z) / 3, (h.x * h.x + h.z * h.z) / 3, (h.x * h.x + h.y * h.y) / 3)
        let fl = max(I.x, I.y, I.z) * 0.08
        I = SIMD3(max(I.x, fl), max(I.y, fl), max(I.z, fl))
        list.append(Piece(half: h, I: I))
        return list.count - 1
    }
    func spawn(_ i: Int, pos: SIMD3<Float>, quat: simd_quatf, v: SIMD3<Float>, w: SIMD3<Float>) {
        list[i].pos = pos; list[i].quat = quat; list[i].v = v; list[i].w = w; list[i].on = true; list[i].still = 0
    }
    func reset() { for i in list.indices { list[i].on = false } }
    func update(_ dt: Float) {
        if dt <= 0 { return }
        let h = min(dt, 0.05) / Float(Debris.SUB)
        for i in list.indices where list[i].on && list[i].still <= 1 {
            for _ in 0..<Debris.SUB { step(&list[i], h) }
        }
    }
    /// Inverse world inertia applied to x: R · I⁻¹ · Rᵀ · x.
    @inline(__always) private func invI(_ pc: Piece, _ x: SIMD3<Float>) -> SIMD3<Float> {
        let l = pc.quat.inverse.act(x)
        return pc.quat.act(SIMD3(l.x / pc.I.x, l.y / pc.I.y, l.z / pc.I.z))
    }
    private func step(_ pc: inout Piece, _ dt: Float) {
        pc.v.y -= Debris.G * dt
        pc.pos += pc.v * dt
        let wl = simd_length(pc.w)
        if wl > 1e-6 { pc.quat = simd_normalize(simd_quatf(angle: wl * dt, axis: pc.w / wl) * pc.quat) }
        var deepest: Float = 0
        for c in Debris.CORNERS {
            let r = pc.quat.act(c * pc.half), p = pc.pos + r
            if p.y >= floorY { continue }
            deepest = min(deepest, p.y - floorY)
            var vp = simd_cross(pc.w, r) + pc.v
            if vp.y >= 0 { continue }
            // Normal impulse at this corner (ground normal +y). a = r × n. debris.js has it as (r.z, 0, -r.x), n × r: each bounce
            // then spins the corner further into the floor, and its parts gain energy and climb tens of metres (run it headless).
            // With this sign they skid and settle flat, as the file says they should.
            let a = SIMD3(-r.z, 0, r.x)
            let ia = invI(pc, a), kn = 1 + simd_dot(a, ia), jn = (-(1 + Debris.E) * vp.y) / kn
            pc.v.y += jn
            pc.w += ia * jn
            // Friction against the sliding velocity at the corner, capped by μ·jn.
            vp = simd_cross(pc.w, r) + pc.v
            var t = SIMD3(vp.x, 0, vp.z)
            let vt = simd_length(t)
            if vt > 1e-5 {
                t /= vt
                let b = simd_cross(r, t), ib = invI(pc, b), kt = 1 + simd_dot(b, ib), jt = min(Debris.MU * jn, vt / kt)
                pc.v -= t * jt
                pc.w -= ib * jt
            }
        }
        if deepest < 0 { pc.pos.y -= deepest }
        if deepest < 0 && simd_length_squared(pc.v) < 0.04 && simd_length_squared(pc.w) < 0.09 {
            pc.still += dt
            pc.v *= 0.8; pc.w *= 0.8
        } else { pc.still = 0 }
    }
}
