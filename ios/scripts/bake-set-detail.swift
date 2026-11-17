// Bakes the sets' surface detail (0271): one tileable 512² RGBA texture, linear, that the stage shader samples twice in world
// space (SetSurface.h): near (a 4 m tile) for the grain and the brushing, far (a 37 m tile) for the wear and the stains.
//   R  concrete grain: trowel cloud, aggregate specks, pores
//   G  wear: broad blotches where the slab is polished or dusty
//   B  stains: oil drops, rubber smudges and skid arcs, water tide lines (0 clean … 1 dark)
//   A  steel: brushing along u, with scratches and a few dents
// Seeded and deterministic; run once, the PNG is committed:
//   swift ios/scripts/bake-set-detail.swift ios/ColdGas/Resources/Stages/set-detail.png
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let N = 512
func hash(_ x: Int, _ y: Int, _ s: Int) -> Float {
    var h = UInt32(truncatingIfNeeded: x &* 374761393 &+ y &* 668265263 &+ s &* 2147483647)
    h = (h ^ (h >> 13)) &* 1274126177
    h ^= h >> 16
    return Float(h & 0xffffff) / Float(0xffffff)
}
/// Value noise with `cells` lattice cells across the tile, wrapping (so the tile repeats seamlessly).
func vnoise(_ u: Float, _ v: Float, _ cells: Int, _ s: Int) -> Float {
    let x = u * Float(cells), y = v * Float(cells)
    let xi = Int(floor(x)), yi = Int(floor(y))
    let fx = x - floor(x), fy = y - floor(y)
    let sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    func h(_ a: Int, _ b: Int) -> Float { hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, s) }
    let a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1)
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}
func fbm(_ u: Float, _ v: Float, _ cells: Int, _ oct: Int, _ s: Int) -> Float {
    var t: Float = 0, amp: Float = 0.5, c = cells, norm: Float = 0
    for o in 0..<oct { t += amp * vnoise(u, v, c, s + o * 101); norm += amp; amp *= 0.5; c *= 2 }
    return t / norm
}
func smooth(_ a: Float, _ b: Float, _ x: Float) -> Float { let t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/// Wrapped distance on the unit torus.
func wrap(_ d: Float) -> Float { var d = d; d -= (d).rounded(); return d }

var R = [Float](repeating: 0, count: N * N), G = R, B = R, A = R

// Stains placed as features (positions on the unit tile, wrapping): oil drops, smudges and skid arcs.
struct Drop { let u, v, r, k: Float }
var drops: [Drop] = []
for i in 0..<26 { drops.append(Drop(u: hash(i, 1, 7), v: hash(i, 2, 7), r: 0.006 + 0.03 * hash(i, 3, 7) * hash(i, 4, 7), k: 0.35 + 0.6 * hash(i, 5, 7))) }
struct Arc { let cu, cv, r, a0, a1, w, k: Float }
var arcs: [Arc] = []
for i in 0..<9 {
    let a0 = hash(i, 3, 11) * 6.283
    arcs.append(Arc(cu: hash(i, 1, 11), cv: hash(i, 2, 11), r: 0.08 + 0.3 * hash(i, 6, 11), a0: a0, a1: a0 + 0.6 + 1.6 * hash(i, 4, 11),
                    w: 0.0035 + 0.003 * hash(i, 5, 11), k: 0.25 + 0.45 * hash(i, 7, 11)))
}
struct Scratch { let u, v, dx, dy, len: Float }
var scratches: [Scratch] = []
for i in 0..<70 {
    let a = (hash(i, 1, 13) - 0.5) * 0.5   // mostly along u, as handling leaves them
    scratches.append(Scratch(u: hash(i, 2, 13), v: hash(i, 3, 13), dx: cos(a), dy: sin(a), len: 0.02 + 0.12 * hash(i, 4, 13)))
}

for y in 0..<N {
    for x in 0..<N {
        let u = (Float(x) + 0.5) / Float(N), v = (Float(y) + 0.5) / Float(N)
        let i = y * N + x
        // R: trowel cloud + aggregate specks (a few px, light and dark) + pores
        var r = 0.5 + 0.55 * (fbm(u, v, 8, 5, 1) - 0.5)
        let sp = hash(x, y, 3)
        if sp > 0.985 { r += 0.18 * hash(x, y, 4) } else if sp < 0.012 { r -= 0.22 }
        r += 0.12 * (vnoise(u, v, 128, 5) - 0.5)
        R[i] = min(1, max(0, r))
        // G: wear blotches, contrasty
        let g = fbm(u, v, 4, 4, 21)
        G[i] = smooth(0.3, 0.7, g)
        // B: stains
        var b: Float = 0
        let tide = fbm(u, v, 3, 3, 31)
        b += 0.25 * smooth(0.62, 0.66, tide) * (1 - smooth(0.66, 0.75, tide))   // a tide line where a puddle dried
        for d in drops {
            let du = wrap(u - d.u), dv = wrap(v - d.v)
            let rr = (du * du + dv * dv).squareRoot() / d.r
            if rr < 1.6 {
                let edge = 1 - smooth(0.7, 1.0, rr + 0.25 * (vnoise(u, v, 64, 41) - 0.5))
                b = max(b, d.k * edge * (0.75 + 0.25 * rr))   // an oil drop dries darker at its rim
            }
        }
        for a in arcs {
            let du = wrap(u - a.cu), dv = wrap(v - a.cv)
            let rr = (du * du + dv * dv).squareRoot()
            var ang = atan2(dv, du); if ang < a.a0 { ang += 6.283 }
            if ang <= a.a1 {
                let along = (ang - a.a0) / (a.a1 - a.a0)
                let fade = smooth(0, 0.15, along) * (1 - smooth(0.6, 1, along))
                for off: Float in [-0.012, 0.012] {   // a pair of tyres
                    let d = abs(rr - a.r - off)
                    b = max(b, a.k * fade * (1 - smooth(a.w * 0.4, a.w, d)) * (0.7 + 0.3 * vnoise(u, v, 96, 43)))
                }
            }
        }
        b = max(b, 0.18 * smooth(0.68, 0.85, fbm(u, v, 6, 3, 51)))   // general grime
        B[i] = min(1, b)
        // A: brushing along u (fine streaks), scratches, dents
        var s = 0.5 + 0.35 * (vnoise(u * 0.02, v, 256, 61) - 0.5) + 0.25 * (vnoise(u, v, 16, 62) - 0.5)
        for sc in scratches {
            let du = wrap(u - sc.u), dv = wrap(v - sc.v)
            let t = du * sc.dx + dv * sc.dy, n = abs(-du * sc.dy + dv * sc.dx)
            if t > 0 && t < sc.len && n < 0.0016 { s = max(s, 0.92 - 0.3 * t / sc.len) }
        }
        A[i] = min(1, max(0, s))
    }
}

var bytes = [UInt8](repeating: 0, count: N * N * 4)
for i in 0..<(N * N) {
    bytes[i * 4] = UInt8(R[i] * 255); bytes[i * 4 + 1] = UInt8(G[i] * 255); bytes[i * 4 + 2] = UInt8(B[i] * 255); bytes[i * 4 + 3] = UInt8(A[i] * 255)
}
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "set-detail.png")
let cs = CGColorSpace(name: CGColorSpace.linearSRGB)!
let provider = CGDataProvider(data: Data(bytes) as CFData)!
// Unpremultiplied RGBA: the alpha is data (the steel's brushing), not coverage.
let img = CGImage(width: N, height: N, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: N * 4, space: cs,
                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
print(CGImageDestinationFinalize(dest) ? "wrote \(out.path)" : "failed")
