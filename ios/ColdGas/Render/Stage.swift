// A course's stage as scripts/native-stage.mjs exports it from the web's own builders (docs/NATIVE.md §4, 0153):
// the static stage merged by material, each parked vehicle in its own frame, the roadster, the lights, the look,
// the car's moving and lit parts, the searchlights, the textures. Vertex: float32 pos(3) nrm(3) uv(2) col(3) = 44 bytes.
import Foundation
import Metal
import MetalKit
import simd

struct StageMaterial {
    var name = ""
    var color = SIMD3<Float>(1, 1, 1), emissive = SIMD3<Float>(0, 0, 0)
    var metalness: Float = 0, roughness: Float = 1, clearcoat: Float = 0, clearcoatRoughness: Float = 0
    var opacity: Float = 1
    var unlit = false, transparent = false, depthWrite = true, doubleSided = false, additive = false, vertexColors = false, fog = true
    /// wall.js wetSlab: the puddles and the mirror.
    var wet = false
    var polygonOffset: (Float, Float)? = nil
    var map: Int? = nil, roughnessMap: Int? = nil, emissiveMap: Int? = nil, alphaMap: Int? = nil
    /// The web's ShaderMaterial effects (wall.js, rocket.js): 0 none, 1 beam, 2 glow decal, 3 spill, 4 a flood bank's beam, 9 skip.
    var effect: UInt32 = 0, effectColor = SIMD3<Float>(1, 1, 1), effectPower: Float = 0
}
struct StageSubmesh { let material: StageMaterial; let renderOrder: Int; let vertexStart, vertexCount, indexStart, indexCount: Int
    /// Its highest vertex: film.js's REFLECT layer is what stands over 12 cm off the slab.
    let top: Float }
struct StageMesh { let vertices: MTLBuffer; let indices: MTLBuffer; let submeshes: [StageSubmesh] }
/// A roadster wheel (main.js syncCar): its pivot at (x, wheelCenterY(compression), z) in the car's ground frame, turned by
/// the steer on the fronts; the spinning part also turned by the wheel's spin about its axle (x).
struct StageWheel { let index: Int; let x, z: Float; let steers: Bool; let steerPart, spinPart: StageMesh }
struct StageLight { let kind: String; let color: SIMD3<Float>; let intensity: Float; let position: SIMD3<Float>; let target: SIMD3<Float>?; let distance, decay, angle, penumbra: Float; let ground: SIMD3<Float> }
struct StageTexture { let texture: MTLTexture?; let repeatUV: SIMD2<Float>; let offset: SIMD2<Float> }

/// What roadster.js moves or lights on its own and what crash.js throws off the car, in the order of `Stage.parts`. Each is
/// in its own frame; the pose it hangs from is CarState's. The raw name is the key in stage.json's carParts.meshes.
enum CarPart: Int, CaseIterable {
    case wingBlade, wingPlates, wingStruts, wingLower, vanes, barge, sideSkirts, endSkirts
    case drl, heads, covers, tailBar, tailDim, brake, rotor, jetCore, frost, blob
    case pieceSkirtSide, pieceSkirtEnd, pieceBarge
}
/// The poses roadster.js builds its moving parts at, and crash.js's boxes around the two it tears off whole.
struct CarLayout {
    var wingPos = SIMD3<Float>(), wingRotX: Float = 0, wingCenter = SIMD3<Float>(), wingHalf = SIMD3<Float>(repeating: 0.1)
    var vanesPos = SIMD3<Float>(), vanesCenter = SIMD3<Float>(), vanesHalf = SIMD3<Float>(repeating: 0.1)
    var drlPos = SIMD3<Float>(), brakePos = SIMD3<Float>()
    var fans: [(pos: SIMD3<Float>, rotX: Float)] = []
    var nozzleCore: [simd_float4x4] = [], nozzleFrost: [simd_float4x4] = []
}
/// wall.js's searchlights: one drum, lens and beam, each pivot swinging on its own (update).
struct StageSweep {
    struct Pivot { let pos: SIMD3<Float>; let tilt, lean, phase, speed: Float }
    let pivots: [Pivot]
    let beam, head, lens: StageMesh
}

/// rocket.js's launch complex, baked (scripts/native-stage-page.js bakeComplex): one mesh, and its lamps as soft glints.
struct StageComplex {
    struct Spots { let size, minPx: Float; let spots: [SIMD4<Float>]; let colors: [SIMD3<Float>] }
    let mesh: StageMesh, center: SIMD3<Float>, radius: Float
    let lamps, beacons: Spots
}
struct StageGlow { let pos: SIMD3<Float>, color: SIMD3<Float>, radius: Float }

final class Stage {
    let course: String
    let complex: StageComplex?
    /// scene.environment: the PMREM read back as a cube, mip i at roughness i / (mips - 1) (exporter's exportEnv).
    let env: MTLTexture?
    let envIntensity: Float
    let wetMask: MTLTexture?
    let hemiSky: SIMD3<Float>, hemiGround: SIMD3<Float>
    let fogDensity: Float
    let glows: [StageGlow]
    let bloomStrength, bloomRadius, bloomThreshold: Float
    // film.js LOOKS, and the sky's own numbers.
    let hazeA, hazeB, vignette, glowScale: Float
    let hazeColor, sunColor, sunDir: SIMD3<Float>
    let dusk: Bool, skyZenith, skyMid, skyHorizon, skySun: SIMD3<Float>
    let parts: [StageMesh]
    let layout: CarLayout
    let sweep: StageSweep?
    /// crash.js parkedFor: each parked car's paint, as sRGB hex.
    let paints: [UInt32]
    let staticMesh: StageMesh, roadster: StageMesh
    let parked: [StageMesh]
    let wheels: [StageWheel]
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
                M.name = mt["name"] as? String ?? ""
                M.color = v3("color"); M.emissive = v3("emissive") * f("emissiveIntensity", 1)
                M.metalness = f("metalness"); M.roughness = f("roughness", 1); M.clearcoat = f("clearcoat"); M.clearcoatRoughness = f("clearcoatRoughness")
                M.opacity = f("opacity", 1); M.unlit = b("unlit"); M.transparent = b("transparent"); M.depthWrite = mt["depthWrite"] as? Bool ?? true
                M.wet = b("wet"); M.doubleSided = b("doubleSided"); M.additive = b("additive"); M.vertexColors = b("vertexColors"); M.fog = mt["fog"] as? Bool ?? true
                if let po = mt["polygonOffset"] as? [Double] { M.polygonOffset = (Float(po[0]), Float(po[1])) }
                M.map = (mt["map"] as? String).flatMap { texIndex[$0] }
                M.roughnessMap = (mt["roughnessMap"] as? String).flatMap { texIndex[$0] }
                M.emissiveMap = (mt["emissiveMap"] as? String).flatMap { texIndex[$0] }
                M.alphaMap = (mt["alphaMap"] as? String).flatMap { texIndex[$0] }
                if let fx = mt["effect"] as? [String: Any], let kind = fx["kind"] as? String {
                    M.effect = ["beam": 1, "glow": 2, "spill": 3, "floodBeam": 4][kind] ?? 9
                    if let c = fx["color"] as? [Double] { M.effectColor = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])) }
                    M.effectPower = (fx["power"] as? NSNumber)?.floatValue ?? 0
                }
                return StageSubmesh(material: M, renderOrder: sm["renderOrder"] as? Int ?? 0, vertexStart: sm["vertexStart"] as? Int ?? 0,
                                    vertexCount: sm["vertexCount"] as? Int ?? 0, indexStart: sm["indexStart"] as? Int ?? 0, indexCount: sm["indexCount"] as? Int ?? 0,
                                    top: (sm["top"] as? NSNumber)?.floatValue ?? 100)
            }
            guard let vb = bin.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: max(off, 4), options: .storageModeShared) }),
                  let ib = bin.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress! + off, length: max(bin.count - off, 4), options: .storageModeShared) }) else { return nil }
            return StageMesh(vertices: vb, indices: ib, submeshes: s)
        }
        guard let st = j["static"] as? [String: Any], let s = mesh(st), let rd = j["roadster"] as? [String: Any], let r = mesh(rd) else { return nil }
        staticMesh = s; roadster = r
        let parkedJ = j["parked"] as? [[String: Any]] ?? []
        parked = parkedJ.compactMap(mesh)
        paints = parkedJ.map { ($0["paint"] as? NSNumber)?.uint32Value ?? 0xe3e4e2 }
        guard let cp = j["carParts"] as? [String: Any], let cm = cp["meshes"] as? [String: [String: Any]] else { return nil }
        var list: [StageMesh] = []
        for part in CarPart.allCases {
            guard let d = cm[String(describing: part)], let m = mesh(d) else { return nil }
            list.append(m)
        }
        parts = list
        func vec(_ a: Any?) -> SIMD3<Float> { guard let a = a as? [Double], a.count == 3 else { return .zero }; return SIMD3(Float(a[0]), Float(a[1]), Float(a[2])) }
        func num(_ a: Any?) -> Float { (a as? NSNumber)?.floatValue ?? 0 }
        func matrices(_ a: Any?) -> [simd_float4x4] {
            (a as? [[Double]] ?? []).compactMap { e in
                guard e.count == 16 else { return nil }
                let f = e.map { Float($0) }
                return simd_float4x4(columns: (SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]), SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15])))
            }
        }
        var lay = CarLayout()
        let wing = cp["wing"] as? [String: Any], vanes = cp["vanes"] as? [String: Any], pieces = cp["pieces"] as? [String: [String: Any]]
        lay.wingPos = vec(wing?["position"]); lay.wingRotX = num(wing?["rotationX"]); lay.vanesPos = vec(vanes?["position"])
        lay.wingCenter = vec(pieces?["wing"]?["center"]); lay.wingHalf = vec(pieces?["wing"]?["half"])
        lay.vanesCenter = vec(pieces?["vanes"]?["center"]); lay.vanesHalf = vec(pieces?["vanes"]?["half"])
        lay.drlPos = vec((cp["drl"] as? [String: Any])?["position"]); lay.brakePos = vec((cp["brake"] as? [String: Any])?["position"])
        lay.fans = (cp["fans"] as? [[String: Any]] ?? []).map { (vec($0["position"]), num($0["rotationX"])) }
        lay.nozzleCore = matrices(cp["nozzleCore"]); lay.nozzleFrost = matrices(cp["nozzleFrost"])
        layout = lay
        if let sw = j["sweep"] as? [String: Any], let bj = sw["beam"] as? [String: Any], let hj = sw["head"] as? [String: Any], let lj = sw["lens"] as? [String: Any],
           let bm = mesh(bj), let hm = mesh(hj), let lm = mesh(lj) {
            let pv = (sw["pivots"] as? [[String: Any]] ?? []).map { StageSweep.Pivot(pos: vec($0["position"]), tilt: num($0["tilt"]), lean: num($0["lean"]), phase: num($0["phase"]), speed: num($0["speed"])) }
            sweep = StageSweep(pivots: pv, beam: bm, head: hm, lens: lm)
        } else { sweep = nil }
        wheels = (j["wheels"] as? [[String: Any]] ?? []).compactMap { w in
            guard let sp = w["steerPart"] as? [String: Any], let st = mesh(sp), let pp = w["spinPart"] as? [String: Any], let pm = mesh(pp) else { return nil }
            return StageWheel(index: w["index"] as? Int ?? 0, x: (w["x"] as? NSNumber)?.floatValue ?? 0, z: (w["z"] as? NSNumber)?.floatValue ?? 0,
                              steers: w["steers"] as? Bool ?? false, steerPart: st, spinPart: pm)
        }
        lights = (j["lights"] as? [[String: Any]] ?? []).map { l in
            func v(_ k: String) -> SIMD3<Float>? { (l[k] as? [Double]).map { SIMD3(Float($0[0]), Float($0[1]), Float($0[2])) } }
            func f(_ k: String) -> Float { (l[k] as? NSNumber)?.floatValue ?? 0 }
            return StageLight(kind: l["kind"] as? String ?? "", color: v("color") ?? .one, intensity: f("intensity"), position: v("position") ?? .zero,
                              target: v("target"), distance: f("distance"), decay: f("decay"), angle: f("angle"), penumbra: f("penumbra"), ground: v("ground") ?? .zero)
        }
        let hemi = lights.first { $0.kind == "HemisphereLight" }
        hemiSky = (hemi?.color ?? .zero) * (hemi?.intensity ?? 0); hemiGround = (hemi?.ground ?? .zero) * (hemi?.intensity ?? 0)
        func spots(_ a: Any?) -> StageComplex.Spots {
            let d = a as? [String: Any] ?? [:]; let list = d["spots"] as? [[Double]] ?? []
            return .init(size: num(d["size"]), minPx: num(d["minPx"]), spots: list.filter { $0.count == 6 }.map { SIMD4(Float($0[0]), Float($0[1]), Float($0[2]), 0) },
                         colors: list.filter { $0.count == 6 }.map { SIMD3(Float($0[3]), Float($0[4]), Float($0[5])) })
        }
        if let c = j["complex"] as? [String: Any], let mj = c["mesh"] as? [String: Any], let cm = mesh(mj) {
            complex = StageComplex(mesh: cm, center: vec(c["center"]), radius: num(c["radius"]), lamps: spots(c["lamps"]), beacons: spots(c["beacons"]))
        } else { complex = nil }
        env = Stage.loadEnv(device: device, dir: dir, j["env"] as? [String: Any])
        if let w = j["wetMask"] as? String, let i = texIndex[w] { wetMask = textures[i].texture } else { wetMask = nil }
        let look = j["look"] as? [String: Any] ?? [:]
        exposure = (look["exposure"] as? NSNumber)?.floatValue ?? 1
        envIntensity = (look["environmentIntensity"] as? NSNumber)?.floatValue ?? 1
        fogDensity = ((look["fog"] as? [String: Any])?["density"] as? NSNumber)?.floatValue ?? 0
        let bl = look["bloom"] as? [String: Any]
        bloomStrength = num(bl?["strength"]); bloomRadius = num(bl?["radius"]); bloomThreshold = num(bl?["threshold"])
        let fl = look["film"] as? [String: Any]
        hazeA = num(fl?["fogA"]); hazeB = num(fl?["fogB"]); vignette = num(fl?["vignette"]); glowScale = (fl?["glow"] as? NSNumber)?.floatValue ?? 1
        hazeColor = vec(fl?["fogCol"]); sunColor = vec(fl?["sunCol"]); sunDir = vec(fl?["sunDir"])
        let sk = look["sky"] as? [String: Any]
        dusk = (sk?["kind"] as? String) == "dusk"
        skyZenith = vec(sk?["zenith"]); skyMid = vec(sk?["mid"]); skyHorizon = vec(sk?["horizon"]); skySun = vec(sk?["sunDir"])
        glows = (look["glows"] as? [[String: Any]] ?? []).map { StageGlow(pos: vec($0["pos"]), color: vec($0["color"]), radius: num($0["radius"])) }
        if let fog = look["fog"] as? [String: Any], let c = fog["color"] as? [Double] {
            fogColor = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])); fogNear = (fog["near"] as? NSNumber)?.floatValue ?? 120; fogFar = (fog["far"] as? NSNumber)?.floatValue ?? 900
        } else { fogColor = SIMD3(0.02, 0.025, 0.04); fogNear = 150; fogFar = 1200 }
        if let k = look["keyLight"] as? [String: Any], let c = k["color"] as? [Double], let o = k["offset"] as? [Double] {
            keyColor = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])); keyIntensity = (k["intensity"] as? NSNumber)?.floatValue ?? 2; keyOffset = SIMD3(Float(o[0]), Float(o[1]), Float(o[2]))
        } else { keyColor = SIMD3(1, 0.86, 0.72); keyIntensity = 2.6; keyOffset = SIMD3(-30, 22, 46) }
    }

    /// env.bin: half floats, RGBA, per mip then per face.
    private static func loadEnv(device: MTLDevice, dir: URL, _ j: [String: Any]?) -> MTLTexture? {
        guard let j, let file = j["file"] as? String, let sizes = j["sizes"] as? [Int], let top = sizes.first,
              let data = try? Data(contentsOf: dir.appendingPathComponent(file)) else { return nil }
        let d = MTLTextureDescriptor.textureCubeDescriptor(pixelFormat: .rgba16Float, size: top, mipmapped: true)
        d.mipmapLevelCount = sizes.count; d.usage = .shaderRead; d.storageMode = .shared
        guard let t = device.makeTexture(descriptor: d) else { return nil }
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var off = 0
            for (mip, n) in sizes.enumerated() {
                let row = n * 8
                for face in 0..<6 where off + row * n <= raw.count {
                    t.replace(region: MTLRegionMake2D(0, 0, n, n), mipmapLevel: mip, slice: face, withBytes: base + off, bytesPerRow: row, bytesPerImage: row * n)
                    off += row * n
                }
            }
        }
        return t
    }
}
