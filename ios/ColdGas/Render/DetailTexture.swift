// The surfaces' detail, baked (0231): one 256² RGBA8 tile of our own procedural noise, made at launch on the CPU and
// mipmapped, that the world's and the sets' shaders read at a few scales instead of evaluating value noise, fbm and Worley
// cells per pixel. On the open Duo the per-pixel noise made the main pass ≈ 17 ms at half resolution. The texture tiles
// (every lattice wraps at the tile's edge), and its mips do the distance fade the shaders did by hand.
//   R  fbm, four octaves from 4 cells a tile: tone, patches, stains
//   G  value noise, 8 cells a tile: mid variation, wear
//   B  value noise, 32 cells a tile: grain, clumps, aggregate
//   A  Worley cells, 12 a tile: the gap to the second-nearest point (0 on a cell's edge): cracks, stones, fractures
import Metal

enum DetailTexture {
    static let size = 256
    private static var cache: [ObjectIdentifier: MTLTexture] = [:]

    static func shared(_ device: MTLDevice) -> MTLTexture? {
        let key = ObjectIdentifier(device)
        if let t = cache[key] { return t }
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: size, height: size, mipmapped: true)
        d.usage = .shaderRead; d.storageMode = .shared
        guard let t = device.makeTexture(descriptor: d), let q = device.makeCommandQueue(), let cb = q.makeCommandBuffer() else { return nil }
        let px = bake()
        t.replace(region: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0, withBytes: px, bytesPerRow: size * 4)
        // The mips on a private copy would be faster to sample; a shared one is fine at 256² (≈ 350 kB with its mips).
        if let b = cb.makeBlitCommandEncoder() { b.generateMipmaps(for: t); b.endEncoding() }
        cb.commit(); cb.waitUntilCompleted()
        cache[key] = t
        return t
    }

    private static func hash(_ x: Int, _ y: Int, _ s: UInt32) -> Float {
        var h = UInt32(truncatingIfNeeded: x &* 374_761_393 &+ y &* 668_265_263) ^ s
        h = (h ^ (h >> 13)) &* 1_274_126_177
        h ^= h >> 16
        return Float(h & 0xffffff) / Float(0xffffff)
    }
    /// Value noise with `n` cells across the tile, wrapping.
    private static func value(_ u: Float, _ v: Float, _ n: Int, _ s: UInt32) -> Float {
        let x = u * Float(n), y = v * Float(n)
        let xi = Int(x.rounded(.down)), yi = Int(y.rounded(.down))
        let fx = x - Float(xi), fy = y - Float(yi)
        let sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
        func h(_ i: Int, _ j: Int) -> Float { hash(((i % n) + n) % n, ((j % n) + n) % n, s) }
        let a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1)
        return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy
    }
    private static func worley(_ u: Float, _ v: Float, _ n: Int) -> Float {
        let x = u * Float(n), y = v * Float(n)
        let xi = Int(x.rounded(.down)), yi = Int(y.rounded(.down))
        var d1: Float = 9, d2: Float = 9
        for j in -1...1 { for i in -1...1 {
            let ci = xi + i, cj = yi + j
            let wi = ((ci % n) + n) % n, wj = ((cj % n) + n) % n
            let px = Float(ci) + hash(wi, wj, 0x51), py = Float(cj) + hash(wi, wj, 0x77)
            let d = ((px - x) * (px - x) + (py - y) * (py - y)).squareRoot()
            if d < d1 { d2 = d1; d1 = d } else if d < d2 { d2 = d }
        } }
        return min(1, (d2 - d1) * 1.6)
    }
    private static func bake() -> [UInt8] {
        var out = [UInt8](repeating: 0, count: size * size * 4)
        func b(_ f: Float) -> UInt8 { UInt8(max(0, min(255, (f * 255).rounded()))) }
        for y in 0..<size { for x in 0..<size {
            let u = (Float(x) + 0.5) / Float(size), v = (Float(y) + 0.5) / Float(size)
            let fbm = value(u, v, 4, 1) * 0.5 + value(u, v, 8, 2) * 0.25 + value(u, v, 16, 3) * 0.15 + value(u, v, 32, 4) * 0.1
            let o = (y * size + x) * 4
            out[o] = b(fbm); out[o + 1] = b(value(u, v, 8, 5)); out[o + 2] = b(value(u, v, 32, 6)); out[o + 3] = b(worley(u, v, 12))
        } }
        return out
    }
}
