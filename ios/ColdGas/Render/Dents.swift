// Dents (src/render/crash.js dent / dentHero / dentParked): the roadster's skin pushed in at the hull probe that crushed,
// along the contact normal, by how much more it crushed since the last dent there; a struck parked car dented where it was
// hit. The vertices move in place in the meshes' shared buffers and the normals are recomputed where they moved (the web's
// indexed path, computeVertexNormals). A new run restores the pristine copies.
import Metal
import simd
import ColdGasCore
import ColdGasPhysics

final class Dents {
    private struct Dentable {
        let mesh: StageMesh
        let count: Int
        let orig: [Float]
        var dirty = false
    }
    private var hero: Dentable
    private var parked: [Dentable]
    private var applied = [Float](repeating: 0, count: HullProbes.count)
    static let stride = 11   // floats per vertex: pos3 nrm3 uv2 col3

    init(roadster: StageMesh, parked p: [StageMesh]) {
        func make(_ m: StageMesh) -> Dentable {
            let n = m.vertices.length / (Dents.stride * 4)
            let ptr = m.vertices.contents().bindMemory(to: Float.self, capacity: n * Dents.stride)
            return Dentable(mesh: m, count: n, orig: Array(UnsafeBufferPointer(start: ptr, count: n * Dents.stride)))
        }
        hero = make(roadster)
        parked = p.map(make)
    }

    func restore() {
        func r(_ d: inout Dentable) {
            guard d.dirty else { return }
            let ptr = d.mesh.vertices.contents().bindMemory(to: Float.self, capacity: d.orig.count)
            d.orig.withUnsafeBufferPointer { ptr.update(from: $0.baseAddress!, count: d.orig.count) }
            d.dirty = false
        }
        r(&hero)
        for i in parked.indices { r(&parked[i]) }
        for i in applied.indices { applied[i] = 0 }
    }

    /// crash.js dentHero: `n` is the contact normal in the world; `carQ` the car's rotation.
    func hero(probe: Int, crush: Float, normal n: SIMD3<Float>, carQ: simd_quatf, salt: Float) {
        guard let h = HullProbes.probe(probe) else { return }
        let delta = crush - applied[probe]
        if delta <= 0.002 { return }
        applied[probe] = crush
        let ld = carQ.inverse.act(n)
        // Skin local = the physics body frame + comHeight (the model is built in the ground frame); the probes sit a few cm
        // inside the skin, so the dent is centred 6 cm further out.
        let lp = SIMD3<Float>(Float(h.x), Float(h.y + SPEC.comHeight), Float(h.z)) - ld * 0.06
        dent(&hero, at: lp, along: ld, radius: 0.42 + crush * 1.3, depth: delta * 1.15, salt: salt)
    }

    /// crash.js dentParked: `model` is the parked car's model matrix now; the dent goes into it, against the normal.
    func parked(_ i: Int, at p: SIMD3<Float>, normal n: SIMD3<Float>, model: simd_float4x4, depth: Float, salt: Float) {
        guard i >= 0, i < parked.count else { return }
        let inv = model.inverse
        let lp4 = inv * SIMD4(p, 1), wp4 = inv * SIMD4(p - n, 1)
        let lp = SIMD3(lp4.x, lp4.y, lp4.z), ld = simd_normalize(SIMD3(wp4.x, wp4.y, wp4.z) - lp)
        dent(&parked[i], at: lp, along: ld, radius: 0.45 + depth * 1.2, depth: depth, salt: salt)
    }

    private func dent(_ d: inout Dentable, at lp: SIMD3<Float>, along ld: SIMD3<Float>, radius: Float, depth: Float, salt: Float) {
        let a = d.mesh.vertices.contents().bindMemory(to: Float.self, capacity: d.count * Dents.stride)
        let R2 = radius * radius, S = Dents.stride
        var moved = [Bool](repeating: false, count: d.count)
        var hit = false
        for i in 0..<d.count {
            let o = i * S
            let dx = a[o] - lp.x, dy = a[o + 1] - lp.y, dz = a[o + 2] - lp.z, r2 = dx * dx + dy * dy + dz * dz
            if r2 >= R2 { continue }
            let w = 1 - r2 / R2, hh = sin(Float(i) * 12.9898 + salt) * 43758.5453
            let k = depth * w * w * (0.7 + 0.6 * (hh - hh.rounded(.down)))
            a[o] += ld.x * k; a[o + 1] += ld.y * k; a[o + 2] += ld.z * k
            moved[i] = true; hit = true
        }
        if !hit { return }
        d.dirty = true
        // computeVertexNormals for the triangles that touch a moved vertex.
        let idx = d.mesh.indices.contents().bindMemory(to: UInt32.self, capacity: d.mesh.indices.length / 4)
        var acc = [Int: SIMD3<Float>]()
        for sm in d.mesh.submeshes {
            var t = sm.indexStart
            while t + 2 < sm.indexStart + sm.indexCount {
                let i0 = Int(idx[t]) + sm.vertexStart, i1 = Int(idx[t + 1]) + sm.vertexStart, i2 = Int(idx[t + 2]) + sm.vertexStart
                t += 3
                guard i0 < d.count, i1 < d.count, i2 < d.count, moved[i0] || moved[i1] || moved[i2] else { continue }
                func p(_ i: Int) -> SIMD3<Float> { SIMD3(a[i * S], a[i * S + 1], a[i * S + 2]) }
                let fn = simd_cross(p(i1) - p(i0), p(i2) - p(i0))
                for i in [i0, i1, i2] where moved[i] { acc[i, default: .zero] += fn }
            }
        }
        for (i, nv) in acc {
            let l = simd_length(nv)
            if l < 1e-12 { continue }
            let u = nv / l, o = i * S + 3
            a[o] = u.x; a[o + 1] = u.y; a[o + 2] = u.z
        }
    }
}
