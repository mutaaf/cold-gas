// The game's three looks (0280), picked in Settings → Look and kept on this device: render-only, the sim never sees them.
//   Real   the stage as it was: physically based, bloom, MetalFX.
//   Anime  cel shading: banded light and hard highlights in the stage's fragment, a flat banded sky, ink outlines from the
//          depth (film pass), speed lines on a big moment.
//   8-bit  the scene drawn at a fixed low resolution (≈240 columns), no bloom, mirror or MetalFX, a small palette with
//          ordered (Bayer) dither, shown with nearest-neighbour blocks. The cheapest of the three.
import Foundation
import ColdGasClient

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
    static let key = "cg.look"
    /// What the renderer draws this frame. `-look real|anime|pixel` pins it (shots); otherwise the saved choice, default Real.
    /// Set on the main thread between frames; the renderer reads it at a frame's start (a stale read costs one frame).
    nonisolated(unsafe) static var current: Look = Launch.value("-look").flatMap(Look.init(rawValue:))
        ?? UserDefaults.standard.string(forKey: key).flatMap(Look.init(rawValue:)) ?? .real
    static func set(_ l: Look) {
        current = l
        UserDefaults.standard.set(l.rawValue, forKey: key)
        DispatchQueue.main.async { PerfCenter.shared.note(l.feature) }   // 0300: the looks chosen, a flag each a session
    }
    /// The look as a feature flag in the session's summary (0300).
    var feature: Perf.Feature {
        switch self { case .real: .lookReal; case .anime: .lookAnime; case .pixel: .lookPixel }
    }
    /// 8-bit's block: the screen's short side over ≈240 columns (5 px on a 1206-wide phone), never under 2.
    static func pixelBlock(outW: Int, outH: Int) -> Int { max(2, Int((Float(min(outW, outH)) / 240).rounded())) }
}
