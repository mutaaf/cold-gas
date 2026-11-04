// A course's stage as scripts/native-stage.mjs exports it from the web's own builders (docs/NATIVE.md §4, 0153):
// the static stage merged by material, each parked vehicle in its own frame, the roadster, the lights, the look,
// the textures. Vertex: float32 pos(3) nrm(3) uv(2) col(3) = 44 bytes.
import Foundation
import Metal
import MetalKit
import simd

struct StageMaterial {
    var color = SIMD3<Float>(1, 1, 1), emissive = SIMD3<Float>(0, 0, 0)
    var metalness: Float = 0, roughness: Float = 1, clearcoat: Float = 0, clearcoatRoughness: Float = 0
    var opacity: Float = 1
    var unlit = false, transparent = false, depthWrite = true, doubleSided = false, additive = false, vertexColors = false, fog = true
    var polygonOffset: (Float, Float)? = nil
    var map: Int? = nil, roughnessMap: Int? = nil, emissiveMap: Int? = nil, alphaMap: Int? = nil
    /// The web's ShaderMaterial effects (wall.js): 0 none, 1 beam, 2 glow decal, 3 spill, 9 skip.
    var effect: UInt32 = 0, effectColor = SIMD3<Float>(1, 1, 1), effectPower: Float = 0
}
struct StageSubmesh { let material: StageMaterial; let renderOrder: Int; let vertexStart, vertexCount, indexStart, indexCount: Int }
struct StageMesh { let vertices: MTLBuffer; let indices: MTLBuffer; let submeshes: [StageSubmesh] }
struct StageLight { let kind: String; let color: SIMD3<Float>; let intensity: Float; let position: SIMD3<Float>; let target: SIMD3<Float>?; let distance, decay, angle, penumbra: Float }
struct StageTexture { let texture: MTLTexture?; let repeatUV: SIMD2<Float>; let offset: SIMD2<Float> }

final class Stage {
    let course: String
    let staticMesh: StageMesh, roadster: StageMesh
    let parked: [StageMesh]
    let lights: [StageLight]
    let textures: [StageTexture]
    let exposure: Float
    let fogColor: SIMD3<Float>, fogNear: Float, fogFar: Float
    let keyColor: SIMD3<Float>, keyIntensity: Float, keyOffset: SIMD3<Float>

    init?(device: MTLDevice, course: String) {
        guard let dir = Bundle.main.url(forResource: "Stages/\(course)", withExtension: nil),
              let jd = try? Data(contentsOf: dir.appendingPathComponent("stage.json")),
              let j = try? JSONSerialization.jsonObject(with: jd) as? [String: Any] else { return nil }
        self.course = course
        let loader = MTKTextureLoader(device: device)
        textures = (j["textures"] as? [[String: Any]] ?? []).map { t in
            var tex: MTLTexture? = nil
            if let f = t["file"] as? String {
                tex = try? loader.newTexture(URL: dir.appendingPathComponent(f), options: [
                    .SRGB: NSNumber(value: (t["srgb"] as? Bool) ?? false), .generateMipmaps: NSNumber(value: true),
                    .textureUsage: NSNumber(value: MTLTextureUsage.shaderRead.rawValue), .textureStorageMode: NSNumber(value: MTLStorageMode.private.rawValue)])
            }
            let rp = t["repeat"] as? [Double] ?? [1, 1], of = t["offset"] as? [Double] ?? [0, 0]
            return StageTexture(texture: tex, repeatUV: SIMD2(Float(rp[0]), Float(rp[1])), offset: SIMD2(Float(of[0]), Float(of[1])))
        }
        let texIndex = Dictionary(uniqueKeysWithValues: (j["textures"] as? [[String: Any]] ?? []).enumerated().compactMap { i, t in (t["id"] as? String).map { ($0, i) } })
        func mesh(_ m: [String: Any]) -> StageMesh? {
            guard let file = m["file"] as? String, let bin = try? Data(contentsOf: dir.appendingPathComponent(file)),
                  let off = m["indexOffsetBytes"] as? Int, let subs = m["submeshes"] as? [[String: Any]] else { return nil }
            let s = subs.map { sm -> StageSubmesh in
                let mt = sm["material"] as? [String: Any] ?? [:]
                func f(_ k: String, _ d: Float = 0) -> Float { (mt[k] as? NSNumber)?.floatValue ?? d }
                func b(_ k: String) -> Bool { mt[k] as? Bool ?? false }
                func v3(_ k: String) -> SIMD3<Float> { let a = mt[k] as? [Double] ?? [1, 1, 1]; return SIMD3(Float(a[0]), Float(a[1]), Float(a[2])) }
                var M = StageMaterial()
                M.color = v3("color"); M.emissive = v3("emissive") * f("emissiveIntensity", 1)
                M.metalness = f("metalness"); M.roughness = f("roughness", 1); M.clearcoat = f("clearcoat"); M.clearcoatRoughness = f("clearcoatRoughness")
                M.opacity = f("opacity", 1); M.unlit = b("unlit"); M.transparent = b("transparent"); M.depthWrite = mt["depthWrite"] as? Bool ?? true
                M.doubleSided = b("doubleSided"); M.additive = b("additive"); M.vertexColors = b("vertexColors"); M.fog = mt["fog"] as? Bool ?? true
                if let po = mt["polygonOffset"] as? [Double] { M.polygonOffset = (Float(po[0]), Float(po[1])) }
                M.map = (mt["map"] as? String).flatMap { texIndex[$0] }
                M.roughnessMap = (mt["roughnessMap"] as? String).flatMap { texIndex[$0] }
                M.emissiveMap = (mt["emissiveMap"] as? String).flatMap { texIndex[$0] }
                M.alphaMap = (mt["alphaMap"] as? String).flatMap { texIndex[$0] }
                if let fx = mt["effect"] as? [String: Any], let kind = fx["kind"] as? String {
                    M.effect = ["beam": 1, "glow": 2, "spill": 3][kind] ?? 9
                    if let c = fx["color"] as? [Double] { M.effectColor = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])) }
                    M.effectPower = (fx["power"] as? NSNumber)?.floatValue ?? 0
                }
                return StageSubmesh(material: M, renderOrder: sm["renderOrder"] as? Int ?? 0, vertexStart: sm["vertexStart"] as? Int ?? 0,
                                    vertexCount: sm["vertexCount"] as? Int ?? 0, indexStart: sm["indexStart"] as? Int ?? 0, indexCount: sm["indexCount"] as? Int ?? 0)
            }
            guard let vb = bin.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: max(off, 4), options: .storageModeShared) }),
                  let ib = bin.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress! + off, length: max(bin.count - off, 4), options: .storageModeShared) }) else { return nil }
            return StageMesh(vertices: vb, indices: ib, submeshes: s)
        }
        guard let st = j["static"] as? [String: Any], let s = mesh(st), let rd = j["roadster"] as? [String: Any], let r = mesh(rd) else { return nil }
        staticMesh = s; roadster = r
        parked = (j["parked"] as? [[String: Any]] ?? []).compactMap(mesh)
        lights = (j["lights"] as? [[String: Any]] ?? []).map { l in
            func v(_ k: String) -> SIMD3<Float>? { (l[k] as? [Double]).map { SIMD3(Float($0[0]), Float($0[1]), Float($0[2])) } }
            func f(_ k: String) -> Float { (l[k] as? NSNumber)?.floatValue ?? 0 }
            return StageLight(kind: l["kind"] as? String ?? "", color: v("color") ?? .one, intensity: f("intensity"), position: v("position") ?? .zero,
                              target: v("target"), distance: f("distance"), decay: f("decay"), angle: f("angle"), penumbra: f("penumbra"))
        }
        let look = j["look"] as? [String: Any] ?? [:]
        exposure = (look["exposure"] as? NSNumber)?.floatValue ?? 1
        if let fog = look["fog"] as? [String: Any], let c = fog["color"] as? [Double] {
            fogColor = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])); fogNear = (fog["near"] as? NSNumber)?.floatValue ?? 120; fogFar = (fog["far"] as? NSNumber)?.floatValue ?? 900
        } else { fogColor = SIMD3(0.02, 0.025, 0.04); fogNear = 150; fogFar = 1200 }
        if let k = look["keyLight"] as? [String: Any], let c = k["color"] as? [Double], let o = k["offset"] as? [Double] {
            keyColor = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])); keyIntensity = (k["intensity"] as? NSNumber)?.floatValue ?? 2; keyOffset = SIMD3(Float(o[0]), Float(o[1]), Float(o[2]))
        } else { keyColor = SIMD3(1, 0.86, 0.72); keyIntensity = 2.6; keyOffset = SIMD3(-30, 22, 46) }
    }
}
