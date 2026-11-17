// The sets' surfaces (0271): which of the static stage's materials are concrete and which are steel, the baked detail they
// read (Resources/Stages/set-detail.png, scripts/bake-set-detail.swift), and where each course's run line lays its rubber.
// The shader side is SetSurface.h. Pixels only: no collider, no mass, no tick reads any of this.
import Metal
import MetalKit

enum SetSurface {
    /// Material.flags.w bits (Shaders.metal): 8 concrete, 16 steel.
    static let concrete: UInt32 = 8, steel: UInt32 = 16

    /// The detail texture, linear, mipmapped; nil if the bundle has none (the shader's branch is then never taken).
    static func load(device: MTLDevice) -> MTLTexture? {
        guard !Launch.args.contains("-flat-sets"),
              let url = Bundle.main.url(forResource: "Stages/set-detail", withExtension: "png") else { return nil }
        return try? MTKTextureLoader(device: device).newTexture(URL: url, options: [
            .SRGB: NSNumber(value: false), .generateMipmaps: NSNumber(value: true),
            .textureUsage: NSNumber(value: MTLTextureUsage.shaderRead.rawValue), .textureStorageMode: NSNumber(value: MTLStorageMode.private.rawValue)])
    }

    /// Where a course's runs leave rubber (x of the run line; z where it's heaviest, z where it has thinned out).
    static func runLine(_ stage: String) -> SIMD4<Float> {
        switch stage {
        case "lineup": return SIMD4(0, -70, 0, 1)     // the mark to the lift-off
        default: return SIMD4(0, -6, -120, 1)         // the Show's and the Wall's: off the mark, and the runway's test runs behind it
        }
    }

    /// Marks the static stage's lit, opaque materials: metal ≥ 0.5 is steel, the rest concrete. Unlit (lamps, LEDs, the
    /// painted lines), translucent and effect materials stay as they are.
    static func classify(_ mats: inout [MaterialU], _ mesh: StageMesh, stage: String) {
        let run = runLine(stage)
        for (k, s) in mesh.submeshes.enumerated() where k < mats.count {
            let M = s.material
            guard !M.unlit, !M.transparent, !M.additive, M.effect == 0, M.emissive == .zero else { continue }
            let kind = M.metalness >= 0.5 ? steel : concrete
            mats[k].flags.w |= kind
            if kind == concrete { mats[k].effect = run }
        }
    }
}
