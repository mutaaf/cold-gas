// The game's three looks (0280, 0290), picked in Settings → Look and kept on this device: render-only, the sim never sees them.
//   Real   the stage as it was: physically based, bloom, MetalFX.
//   Anime  cel animation (0290): light through a per-material ramp in three hard bands with tinted (never grey) shadows, a
//          hard rim, shaped highlight blobs, a painted night sky (gradient, soft clouds, a big moon where the key light comes
//          from), ink at the render size from the depth's silhouettes (thick) and its normals' creases (thin, none on a smooth
//          curve), a print that saturates without going to white; speed lines over 28 m/s and impact frames on a hard landing or
//          a big hit (none with Reduce Motion or Dim Flashing Lights).
//   8-bit  pixel art (0290): ≈ 160 columns across the short side shown as whole nearest-neighbour blocks, the same cel ramp,
//          32 fixed colours chosen for the night stage, the red loop and the white car, nearest entry with no dither (a 2×2
//          checker only where the sky changes band), a 1 px outline from the depth and the normals at that size, a banded sky
//          with single-pixel stars and a pixel moon; the lens snapped so the car sits on whole pixels (no swimming). No bloom,
//          mirror or MetalFX: the cheapest of the three.
// The car, the stage, the sky, the effects, Roam and Free Drive's world all take the look (Shaders.metal, World.metal).
import Foundation

enum Look: String, CaseIterable, Identifiable {
    case real, anime, pixel
    var id: String { rawValue }
    var title: String {
        switch self { case .real: "Real"; case .anime: "Anime"; case .pixel: "8-bit" }
    }
    /// The shaders' switch (Frame.style.x).
    var code: Float {
        switch self { case .real: 0; case .anime: 1; case .pixel: 2 }
    }
    /// Anime and 8-bit read the main pass's depth (ink and outlines).
    var readsDepth: Bool { self != .real }
    static let key = "cg.look"
    /// What the renderer draws this frame. `-look real|anime|pixel` pins it (shots); otherwise the saved choice, default Real.
    /// Set on the main thread between frames; the renderer reads it at a frame's start (a stale read costs one frame).
    nonisolated(unsafe) static var current: Look = Launch.value("-look").flatMap(Look.init(rawValue:))
        ?? UserDefaults.standard.string(forKey: key).flatMap(Look.init(rawValue:)) ?? .real
    static func set(_ l: Look) {
        current = l
        UserDefaults.standard.set(l.rawValue, forKey: key)
    }
    /// 8-bit's columns across the screen's short side: a 16-bit console's ≈ 160 (pixel art, not a filter: 0290).
    static let pixelColumns: Float = 160
    /// 8-bit's block: the short side over ≈ 160 columns (8 px on a 1206-wide phone), never under 3.
    static func pixelBlock(outW: Int, outH: Int) -> Int { max(3, Int((Float(min(outW, outH)) / pixelColumns).rounded())) }
    /// Anime's impact frames flash the screen for a few frames: none with Reduce Motion or Dim Flashing Lights.
    static var impactsAllowed: Bool { !Flashing.reduced }
}
