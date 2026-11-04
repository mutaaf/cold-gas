// scripts/engine-spike.js in Swift, number for number: Doubles where the JS has numbers, Float where a
// number crosses into the engine (the bindings take f32; `Float(Double)` rounds to nearest like
// wasm-bindgen). The same FNV-1a hash as the WASM build proves native Rapier is bit-exact with it
// (docs/NATIVE.md §3, 0147). Pure: makes and frees its own world.
#if canImport(CRapier)
import CRapier
import ColdGasCore

public enum EngineSpike {
    /// TS TriMeshFlags.FIX_INTERNAL_EDGES = 0b1000_0000 | MERGE_DUPLICATE_VERTICES (1 << 4).
    static let fixInternalEdges: UInt32 = 0x90

    public static func run(steps: Int = 2400) -> (hash: String, car: String) {
        let w = cg_world_new(0, Float(-9.81), 0)!
        defer { cg_world_free(w) }
        cg_world_set_timestep(w, Float(1.0 / 240.0))

        var d = cg_collider_desc_default()
        d.translation = (0, -0.5, 0); d.friction = Float(0.9)
        let floor = cg_shape_cuboid(200, 0.5, 200)
        _ = cg_collider_create(w, floor, &d, CG_NONE)
        cg_shape_free(floor)

        // A quarter-pipe of 120 facets, radius 8 m, 4 m wide (dmath, as the JS).
        var verts: [Float] = [], idx: [UInt32] = []
        let N = 120
        for i in 0...N {
            let a = (-DMath.PI / 2) + (Double(i) / Double(N)) * (DMath.PI / 2) * 1.6
            let z = 30 + 8 * DMath.dcos(a), y = 8 + 8 * DMath.dsin(a)
            verts += [-2, Float(y), Float(z), 2, Float(y), Float(z)]
            if i < N { let k = UInt32(2 * i); idx += [k, k + 2, k + 1, k + 1, k + 2, k + 3] }
        }
        let ramp = verts.withUnsafeBufferPointer { v in idx.withUnsafeBufferPointer { ix in
            cg_shape_trimesh(v.baseAddress, v.count / 3, ix.baseAddress, ix.count, fixInternalEdges) } }!
        d = cg_collider_desc_default(); d.friction = 1
        _ = cg_collider_create(w, ramp, &d, CG_NONE)
        cg_shape_free(ramp)

        var boxes: [UInt64] = []
        for i in 0..<6 {
            var bd = cg_body_desc_default(0)
            bd.translation = (Float(Double(i % 2) * 0.3), Float(0.75 + 1.52 * jsFloor(Double(i) / 2)), Float(12 + Double(i % 3) * 0.1))
            let b = cg_body_create(w, &bd)
            var cd = cg_collider_desc_default()
            cd.density = Float(300 + 50 * Double(i)); cd.friction = Float(0.6); cd.restitution = Float(0.1)
            let s = cg_shape_cuboid(0.9, 0.75, 2.3)
            _ = cg_collider_create(w, s, &cd, b)
            cg_shape_free(s)
            boxes.append(b)
        }
        var bd = cg_body_desc_default(0)
        bd.translation = (0.4, 1.0, -10); bd.can_sleep = false
        let car = cg_body_create(w, &bd)
        var cd = cg_collider_desc_default()
        cd.mass_props_mode = 1; cd.mass = 2400; cd.friction = 0.5
        let cs = cg_shape_cuboid(1, 0.35, 2.2)
        let carCol = cg_collider_create(w, cs, &cd, car)
        cg_shape_free(cs)

        let anchors: [(Double, Double, Double)] = [(-0.85, -0.2, 1.4), (0.85, -0.2, 1.4), (-0.85, -0.2, -1.4), (0.85, -0.2, -1.4)]
        var prev: [Double] = [0, 0, 0, 0]
        var p = [Float](repeating: 0, count: 3), q = [Float](repeating: 0, count: 4)
        var hit = CgRayHit()
        for t in 0..<steps {
            cg_body_translation(w, car, &p); cg_body_rotation(w, car, &q)
            let px = Double(p[0]), py = Double(p[1]), pz = Double(p[2])
            let qx = Double(q[0]), qy = Double(q[1]), qz = Double(q[2]), qw = Double(q[3])
            for wh in 0..<4 {
                let a = anchors[wh]
                let tx = 2 * (qy * a.2 - qz * a.1), ty = 2 * (qz * a.0 - qx * a.2), tz = 2 * (qx * a.1 - qy * a.0)
                let wx = a.0 + qw * tx + (qy * tz - qz * ty), wy = a.1 + qw * ty + (qz * tx - qx * tz), wz = a.2 + qw * tz + (qx * ty - qy * tx)
                let ox = Float(px + wx), oy = Float(py + wy), oz = Float(pz + wz)   // the JS ray's origin, as the engine reads it
                if !cg_cast_ray_and_get_normal(w, ox, oy, oz, 0, -1, 0, Float(0.8), true, 0, CG_NONE, carCol, CG_NONE, &hit) {
                    prev[wh] = 0; continue
                }
                let comp = 0.8 - Double(hit.toi), f = jsMax(0, 90000 * comp + 6000 * (comp - prev[wh]) * 240)
                prev[wh] = comp
                let nx = Double(hit.normal.0), ny = Double(hit.normal.1), nz = Double(hit.normal.2)
                cg_body_add_force_at_point(w, car, Float(nx * f), Float(ny * f), Float(nz * f), ox, oy, oz, true)
                let body = cg_collider_parent(w, hit.collider)
                if body != CG_NONE && body != car {
                    cg_body_add_force_at_point(w, body, Float(-nx * f), Float(-ny * f), Float(-nz * f), ox, oy, oz, true)
                }
            }
            let push: Double = t < 600 ? 9000 : t < 900 ? -4000 : 2500
            cg_body_add_force(w, car, Float(Double(t % 97) * 3), 0, Float(push), true)
            cg_body_add_torque(w, car, 0, t > 1200 && t < 1300 ? 4000 : 0, t > 1500 && t < 1530 ? 30000 : 0, true)
            cg_world_step(w)
            cg_body_reset_forces(w, car, true); cg_body_reset_torques(w, car, true)
            for b in boxes { cg_body_reset_forces(w, b, false) }
        }
        // FNV-1a over the f32 bits of every pose and velocity.
        var h: UInt32 = 0x811c9dc5
        var v = [Float](repeating: 0, count: 3), av = [Float](repeating: 0, count: 3)
        for b in [car] + boxes {
            cg_body_translation(w, b, &p); cg_body_rotation(w, b, &q); cg_body_linvel(w, b, &v); cg_body_angvel(w, b, &av)
            for x in [p[0], p[1], p[2], q[0], q[1], q[2], q[3], v[0], v[1], v[2], av[0], av[1], av[2]] { h ^= x.bitPattern; h = h &* 0x01000193 }
        }
        cg_body_translation(w, car, &p)
        let hex = String(h, radix: 16), padded = String(repeating: "0", count: 8 - hex.count) + hex
        return (padded, p.map { fixed4(Double($0)) }.joined(separator: ","))
    }
    // JS toFixed(4) for the moderate values the spike prints.
    static func fixed4(_ x: Double) -> String {
        let r = jsRound(x * 10000) / 10000
        let neg = r < 0 || (r == 0 && x < 0 && r.sign == .minus)
        let a = abs(r), whole = Int(a), frac = Int(jsRound((a - Double(whole)) * 10000))
        let f = String(frac), pad = String(repeating: "0", count: 4 - f.count) + f
        return (neg ? "-" : "") + "\(whole).\(pad)"
    }
}
#endif
