// The contract in code (0310, docs/NATIVE-FREEDRIVE.md §9.4): how WATER and MATTER plug into Free Drive's world. A layer is
// added to the drive's WorldView (`FreeDrive.view?.add(layer)`) and is called at fixed points of the frame, with the world's
// bindings already set (the table in §9.4; WorldBind below names them). Everything has an empty default.
import Metal
import simd

protocol WorldLayer: AnyObject {
    /// A layer that draws the sea's surface itself: tiles are then built with the seabed under it (§9.3).
    var ownsSea: Bool { get }
    /// Main thread, once a frame, after the world has chosen its tiles (`eye` in world metres).
    func update(_ w: WorldView, eye: SIMD3<Double>, dt: Double)
    /// Compute or blit work in the frame's command buffer before its passes (a rut stamp, a wave step).
    func encode(_ w: WorldView, cmd: MTLCommandBuffer)
    /// Casters into the world's cached shadow map (drawn only when that map is redrawn, §9.6).
    func drawShadow(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext)
    /// The main pass, after the land, the roads and the props.
    func drawOpaque(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext)
    /// The main pass, after the sky: water, spray, anything blended.
    func drawLate(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext)
    /// The ground's own resources for `matter_ground` (MATTER's trace atlas at fragment buffer and texture
    /// `WorldBind.matterTable` / `.matterTraces`), bound after WorldView's empty defaults on every world draw (0330).
    func bindGround(_ w: WorldView, _ e: MTLRenderCommandEncoder)
}
extension WorldLayer {
    var ownsSea: Bool { false }
    func update(_ w: WorldView, eye: SIMD3<Double>, dt: Double) {}
    func encode(_ w: WorldView, cmd: MTLCommandBuffer) {}
    func drawShadow(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext) {}
    func drawOpaque(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext) {}
    func drawLate(_ w: WorldView, _ e: MTLRenderCommandEncoder, _ c: WorldDrawContext) {}
    func bindGround(_ w: WorldView, _ e: MTLRenderCommandEncoder) {}
}

/// What a layer's draw knows about the frame (the same things are bound on the encoder, §9.4).
struct WorldDrawContext {
    /// The floating origin: render space is world − origin.
    let origin: SIMD3<Double>
    /// The eye, world metres.
    let eye: SIMD3<Double>
    /// The lens (render space); in drawShadow, the shadow map's.
    let viewProj: simd_float4x4
    /// The look this frame.
    let look: Look
    /// The drive's clock (s).
    let time: Double
}

/// The fixed bindings of every world draw (§9.4).
enum WorldBind {
    static let frame = 1, look = 4, drive = 5, gpu = 6
    static let shadow = 3, skyView = 8, detail = 10, surface = 11, traces = 12, leafIndex = 13, worldShadow = 14
    /// MATTER's fine trace atlas (0330, WorldMatter.h): its window table (fragment buffer) and its layers (fragment texture).
    static let matterTable = 9, matterTraces = 9
    /// WorldMatter.h WTrace's size: head, scale and a 32 × 32 table of UInt16.
    static let matterTableSize = 32 + 32 * 32 * 2
}

/// World.metal's WorldGPU (§9.5).
struct WorldGPUU {
    /// xy: leafIndex's corner (render space x, z); z: a leaf's size; w: the grid's cells a side.
    var leafOrigin = SIMD4<Float>()
    /// x: the sea's level, render space.
    var sea = SIMD4<Float>()
    /// x: a layer owns the sea; y: traces on; z: a trace slice's texels a side.
    var flags = SIMD4<Float>()
    var spare = SIMD4<Float>()
}
