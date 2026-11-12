// What Free Drive's props look like (docs/NATIVE-FREEDRIVE.md §4.4). Where they stand is ColdGasWorld's (`props`); how
// each kind is drawn comes from a `PropSource`, the first that has it:
//   1. ForgeProps: the forge pipeline's assets (tools/forge → the stage's 44-byte vertex format), when the bundle has
//      them: Resources/Props/props.json + <kind>/lod<i>.bin. Written by that pipeline, never by hand.
//   2. ProceduralProps: our own low-poly kit (cones, a canopy, a faceted boulder, a delineator), so the world draws with
//      no assets at all.
// A kind's LOD chain is finest first, each with the distance it's drawn to. `uv.x > 0.5` marks a retroreflector.
import Foundation
import simd
import ColdGasWorld

/// One LOD of a prop, in the stage's vertex format: pos(3) nrm(3) uv(2) col(3), 11 floats.
struct PropGeometry {
    var vertices: [Float] = []
    var indices: [UInt32] = []
    /// Drawn up to this distance (m).
    var end: Double
}
protocol PropSource {
    func lods(for kind: String) -> [PropGeometry]?
}

/// The forge's props, if this build carries them.
struct ForgeProps: PropSource {
    private let table: [String: [PropGeometry]]
    init(bundle: Bundle = .main) {
        var t: [String: [PropGeometry]] = [:]
        if let dir = bundle.url(forResource: "Props", withExtension: nil),
           let d = try? Data(contentsOf: dir.appendingPathComponent("props.json")),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let kinds = j["kinds"] as? [String: [[String: Any]]] {
            // props.json: { "kinds": { "tree.spruce": [ { "file": "tree.spruce/lod0.bin", "vertices": n, "end": 220 }, … ] } }
            // Each .bin: n × 11 float32 vertices, then uint32 indices.
            for (kind, lods) in kinds {
                var list: [PropGeometry] = []
                for l in lods {
                    guard let f = l["file"] as? String, let n = l["vertices"] as? Int, let end = (l["end"] as? NSNumber)?.doubleValue,
                          let bin = try? Data(contentsOf: dir.appendingPathComponent(f)), bin.count >= n * 44 else { continue }
                    var g = PropGeometry(end: end)
                    g.vertices = bin.prefix(n * 44).withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
                    g.indices = bin.dropFirst(n * 44).withUnsafeBytes { Array($0.bindMemory(to: UInt32.self)) }
                    if !g.indices.isEmpty { list.append(g) }
                }
                if !list.isEmpty { t[kind] = list }
            }
        }
        table = t
    }
    func lods(for kind: String) -> [PropGeometry]? { table[kind] }
}

/// Our own low-poly kit: matte shapes that read at a distance in the blue-hour light.
struct ProceduralProps: PropSource {
    func lods(for kind: String) -> [PropGeometry]? {
        switch kind {
        case PropKind.spruce.id: return [spruce(sides: 9, tiers: 3, end: 240), spruce(sides: 5, tiers: 1, end: 1200)]
        case PropKind.broadleaf.id: return [broadleaf(sub: 1, end: 240), broadleaf(sub: 0, end: 1200)]
        case PropKind.shrub.id: return [blob(r: 0.9, squash: 0.62, y: 0.45, col: SIMD3(0.05, 0.066, 0.036), seed: 3, sub: 1, end: 160), blob(r: 0.9, squash: 0.62, y: 0.45, col: SIMD3(0.05, 0.066, 0.036), seed: 3, sub: 0, end: 600)]
        case PropKind.rock.id: return [blob(r: 1.1, squash: 0.62, y: 0.2, col: SIMD3(0.15, 0.145, 0.14), seed: 9, sub: 1, end: 300, rough: 0.28), blob(r: 1.1, squash: 0.62, y: 0.2, col: SIMD3(0.15, 0.145, 0.14), seed: 9, sub: 0, end: 900, rough: 0.28)]
        case PropKind.post.id: return [post(end: 700)]
        default: return nil
        }
    }

    // A faceted triangle soup builder: each triangle gets its own normal (the matte, low-poly look).
    private struct Soup {
        var g: PropGeometry
        init(end: Double) { g = PropGeometry(end: end) }
        mutating func tri(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ col: SIMD3<Float>, glow: Float = 0) {
            var n = simd_cross(b - a, c - a)
            let l = simd_length(n); n = l > 1e-9 ? n / l : SIMD3(0, 1, 0)
            for p in [a, b, c] {
                g.indices.append(UInt32(g.vertices.count / 11))
                g.vertices += [p.x, p.y, p.z, n.x, n.y, n.z, glow, 0, col.x, col.y, col.z]
            }
        }
        mutating func quad(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ d: SIMD3<Float>, _ col: SIMD3<Float>, glow: Float = 0) {
            tri(a, b, c, col, glow: glow); tri(a, c, d, col, glow: glow)
        }
    }
    private func ring(_ r: Float, _ y: Float, _ k: Int, _ n: Int, _ phase: Float = 0) -> SIMD3<Float> {
        let a = Float(k) / Float(n) * 2 * .pi + phase
        return SIMD3(r * cos(a), y, r * sin(a))
    }
    private func spruce(sides n: Int, tiers: Int, end: Double) -> PropGeometry {
        var s = Soup(end: end)
        let bark = SIMD3<Float>(0.07, 0.05, 0.038), needles = SIMD3<Float>(0.028, 0.05, 0.034)
        if tiers > 1 { for k in 0..<5 { s.quad(ring(0.22, 0, k, 5), ring(0.22, 2.4, k, 5), ring(0.22, 2.4, k + 1, 5), ring(0.22, 0, k + 1, 5), bark) } }
        let layers: [(Float, Float, Float)] = tiers == 1 ? [(1.2, 12, 2.3)] : [(1.6, 7.4, 2.6), (4.0, 10.0, 2.0), (6.4, 12.4, 1.4)]
        for (i, (y0, y1, r)) in layers.enumerated() {
            let tip = SIMD3<Float>(0, y1, 0), ph = Float(i) * 0.6
            for k in 0..<n {
                let a = ring(r, y0, k, n, ph), b = ring(r, y0, k + 1, n, ph)
                s.tri(a, tip, b, needles * (0.85 + 0.15 * Float(k % 3) / 2))
                s.tri(a, b, SIMD3(0, y0 + 0.4, 0), needles * 0.6)
            }
        }
        return s.g
    }
    private func icosahedron(_ sub: Int) -> [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] {
        let t: Float = (1 + 5.0.squareRoot().f) / 2
        var v: [SIMD3<Float>] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
        v = v.map { simd_normalize($0) }
        let f: [(Int, Int, Int)] = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                                   (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        var tris = f.map { (v[$0.0], v[$0.1], v[$0.2]) }
        for _ in 0..<sub {
            var next: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] = []
            for (a, b, c) in tris {
                let ab = simd_normalize(a + b), bc = simd_normalize(b + c), ca = simd_normalize(c + a)
                next += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
            }
            tris = next
        }
        return tris
    }
    /// A lumpy blob: an icosphere, each direction pushed in or out by a fixed hash (the same lumps on every LOD).
    private func blob(r: Float, squash: Float, y: Float, col: SIMD3<Float>, seed: Int, sub: Int, end: Double, rough: Float = 0.14) -> PropGeometry {
        var s = Soup(end: end)
        func shape(_ p: SIMD3<Float>) -> SIMD3<Float> {
            let h = sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719 + Float(seed)) * 43758.5453
            let k = 1 + (h - h.rounded(.down) - 0.5) * 2 * rough
            return SIMD3(p.x * r * k, p.y * r * squash * k + y, p.z * r * k)
        }
        for (a, b, c) in icosahedron(sub) { s.tri(shape(a), shape(c), shape(b), col * (0.85 + 0.3 * max(0, (a.y + 1) / 2))) }
        return s.g
    }
    private func broadleaf(sub: Int, end: Double) -> PropGeometry {
        var g = blob(r: 3.2, squash: 0.85, y: 6.6, col: SIMD3(0.045, 0.068, 0.034), seed: 5, sub: sub, end: end, rough: 0.18)
        if sub > 0 {
            var s = Soup(end: end); s.g = g
            let bark = SIMD3<Float>(0.07, 0.055, 0.04)
            for k in 0..<5 { s.quad(ring(0.28, 0, k, 5), ring(0.2, 4.4, k, 5), ring(0.2, 4.4, k + 1, 5), ring(0.28, 0, k + 1, 5), bark) }
            g = s.g
        }
        return g
    }
    /// A delineator: a white post, a black band, an amber reflector facing the oncoming lane.
    private func post(end: Double) -> PropGeometry {
        var s = Soup(end: end)
        let w: Float = 0.06, d: Float = 0.05, white = SIMD3<Float>(0.55, 0.55, 0.53), band = SIMD3<Float>(0.02, 0.02, 0.022)
        func box(_ y0: Float, _ y1: Float, _ c: SIMD3<Float>) {
            let p = [SIMD3(-w, y0, -d), SIMD3(w, y0, -d), SIMD3(w, y0, d), SIMD3(-w, y0, d), SIMD3(-w, y1, -d), SIMD3(w, y1, -d), SIMD3(w, y1, d), SIMD3(-w, y1, d)]
            s.quad(p[0], p[4], p[5], p[1], c); s.quad(p[1], p[5], p[6], p[2], c); s.quad(p[2], p[6], p[7], p[3], c); s.quad(p[3], p[7], p[4], p[0], c); s.quad(p[4], p[7], p[6], p[5], c)
        }
        box(0, 0.78, white); box(0.78, 0.95, band); box(0.95, 1.05, white)
        // The reflector: on the face toward −z (the post is turned to face the traffic), bright where it's lit.
        s.quad(SIMD3(-0.04, 0.8, -d - 0.004), SIMD3(-0.04, 0.92, -d - 0.004), SIMD3(0.04, 0.92, -d - 0.004), SIMD3(0.04, 0.8, -d - 0.004), SIMD3(0.35, 0.2, 0.06), glow: 1)
        return s.g
    }
}

private extension Double { var f: Float { Float(self) } }
