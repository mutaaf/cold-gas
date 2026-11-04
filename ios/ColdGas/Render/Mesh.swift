// A mesh written by scripts/meshes.mjs from the web's own generators (src/render/roadster.js): one source for
// the car. roadster.bin = float32 position(3) normal(3) per vertex, then uint32 indices per submesh (0-based in it).
import Foundation
import Metal
import simd

struct Mesh {
    struct Submesh {
        let material: String
        let linearColor: SIMD3<Float>
        let opacity, metalness, roughness, clearcoat, clearcoatRoughness: Float
        let emissive: Bool
        let doubleSided: Bool
        let vertexStart, vertexCount, indexStart, indexCount: Int
    }
    let vertices: MTLBuffer
    let indices: MTLBuffer
    let submeshes: [Submesh]

    static func load(device: MTLDevice, name: String) -> Mesh? {
        guard let ju = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "Meshes"),
              let bu = Bundle.main.url(forResource: name, withExtension: "bin", subdirectory: "Meshes"),
              let jd = try? Data(contentsOf: ju), let bin = try? Data(contentsOf: bu),
              let j = try? JSONSerialization.jsonObject(with: jd) as? [String: Any],
              let off = j["indexOffsetBytes"] as? Int, let subs = j["submeshes"] as? [[String: Any]] else { return nil }
        let subsOut = subs.compactMap { s -> Submesh? in
            guard let hex = s["color"] as? String else { return nil }
            func f(_ k: String) -> Float { Float((s[k] as? Double) ?? 0) }
            func i(_ k: String) -> Int { (s[k] as? Int) ?? 0 }
            return Submesh(material: s["material"] as? String ?? "", linearColor: srgbToLinear(hex),
                           opacity: f("opacity"), metalness: f("metalness"), roughness: f("roughness"), clearcoat: f("clearcoat"),
                           clearcoatRoughness: f("clearcoatRoughness"), emissive: (s["emissive"] as? Bool) ?? false, doubleSided: (s["doubleSided"] as? Bool) ?? false,
                           vertexStart: i("vertexStart"), vertexCount: i("vertexCount"), indexStart: i("indexStart"), indexCount: i("indexCount"))
        }
        guard let vb = bin.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: off, options: .storageModeShared) }),
              let ib = bin.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress! + off, length: bin.count - off, options: .storageModeShared) })
        else { return nil }
        return Mesh(vertices: vb, indices: ib, submeshes: subsOut)
    }
}

func srgbToLinear(_ hex: String) -> SIMD3<Float> {
    let v = UInt32(hex.dropFirst(), radix: 16) ?? 0xffffff
    func c(_ x: UInt32) -> Float { let s = Float(x) / 255; return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4) }
    return SIMD3(c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255))
}
