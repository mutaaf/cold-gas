// `-luma <tag>` (Debug, 0269): the glare probe. Every `-luma-every` frames (default 2) the LDR frame (after exposure and tone,
// before MetalFX) is read back and measured, and one line is printed:
//   LUMA <tag>#<track> t <s since the track started> car <% of the car's pixels clipped> hot <% near white> carMean sd carPeak carPx
//        frame <% clipped> hot <% near white> washed <% with luma ≥ 160> peak mean
// "Clipped" is all three channels ≥ 250, "near white" ≥ 235 (sRGB-encoded, 0…255); sd is the car's contrast; the car's pixels are those inside the convex hull of its bounding box
// projected to the screen (an approximation: the hull takes a little of what's behind the car). `-luma-snap 0.5,1,1.5` also
// writes the frame at each of those times to Caches/luma/<tag>-<t>.png. Debug builds only; nothing runs without the flag.
#if DEBUG
import Metal
import simd
import UIKit

final class LumaProbe {
    static let shared: LumaProbe? = Launch.args.contains("-luma") ? LumaProbe() : nil
    private init() { setvbuf(stdout, nil, _IOLBF, 0) }   // line by line through simctl's console
    private let tag = Launch.value("-luma") ?? "run"
    private let every = Launch.value("-luma-every").flatMap(Int.init) ?? 2
    private static let snapList: [Double] = (Launch.value("-luma-snap") ?? "").split(separator: ",").compactMap { Double($0) }.sorted()
    private var snaps = LumaProbe.snapList, lastT = 0.0, track = 0
    private var bufs: [MTLBuffer?] = [nil, nil, nil]
    private var n = 0, slot = 0
    private var box: (lo: SIMD3<Float>, hi: SIMD3<Float>)?
    private let dir: URL = {
        let d = Ready.url.deletingLastPathComponent().appendingPathComponent("luma")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    /// After the film pass: blit `ldr` into a shared buffer and measure it once the GPU is done. `hull` is the car's outline in
    /// the LDR target's pixels (empty: the car isn't in front of the lens).
    func capture(_ cmd: MTLCommandBuffer, ldr: MTLTexture, t: Double, car: StageMesh, carM: simd_float4x4, viewProj: simd_float4x4) {
        n += 1
        if t < lastT - 0.25 { snaps = LumaProbe.snapList; track += 1 }   // a new track (the title's loop, then the run): the times start over
        lastT = t
        var snap: Double? = nil
        if let s = snaps.first, t >= s { snap = s; snaps.removeFirst() }
        guard snap != nil || n % every == 0 else { return }
        let w = ldr.width, h = ldr.height, row = w * 4
        if box == nil {   // the roadster's bounds in its own frame, once (stride 11 floats: pos, normal, uv, colour)
            let f = car.vertices.contents().bindMemory(to: Float.self, capacity: car.vertices.length / 4)
            var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
            for i in 0..<(car.vertices.length / 44) { let v = SIMD3(f[i * 11], f[i * 11 + 1], f[i * 11 + 2]); lo = simd_min(lo, v); hi = simd_max(hi, v) }
            box = (lo, hi)
        }
        let hull = box.map { LumaProbe.hull(lo: $0.lo, hi: $0.hi, model: carM, viewProj: viewProj, w: w, h: h) } ?? []
        slot = (slot + 1) % bufs.count
        if bufs[slot] == nil || bufs[slot]!.length < row * h { bufs[slot] = ldr.device.makeBuffer(length: row * h, options: .storageModeShared) }
        guard let buf = bufs[slot], let b = cmd.makeBlitCommandEncoder() else { return }
        b.copy(from: ldr, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(), sourceSize: MTLSize(width: w, height: h, depth: 1),
               to: buf, destinationOffset: 0, destinationBytesPerRow: row, destinationBytesPerImage: row * h)
        b.endEncoding()
        let tag = "\(self.tag)#\(track)", dir = self.dir
        cmd.addCompletedHandler { _ in
            let p = buf.contents().bindMemory(to: UInt8.self, capacity: row * h)
            var clip = 0, peak = 0, sum = 0, carN = 0, carClip = 0, carPeak = 0
            // The hull's bounding rows and columns, then a point-in-convex-polygon test (the hull is counter-clockwise).
            let xs = hull.map(\.x), ys = hull.map(\.y)
            let x0 = max(0, Int(xs.min() ?? 0)), x1 = min(w - 1, Int(xs.max() ?? -1)), y0 = max(0, Int(ys.min() ?? 0)), y1 = min(h - 1, Int(ys.max() ?? -1))
            func inside(_ x: Float, _ y: Float) -> Bool {
                for i in 0..<hull.count {
                    let a = hull[i], c = hull[(i + 1) % hull.count]
                    if (c.x - a.x) * (y - a.y) - (c.y - a.y) * (x - a.x) < 0 { return false }
                }
                return true
            }
            var hot = 0, washed = 0, carHot = 0, carSum = 0, carSq = 0
            for y in 0..<h {
                let inRows = hull.count >= 3 && y >= y0 && y <= y1
                for x in 0..<w {
                    let o = y * row + x * 4
                    let bl = Int(p[o]), g = Int(p[o + 1]), r = Int(p[o + 2])
                    let l = (2126 * r + 7152 * g + 722 * bl) / 10000
                    let white = min(r, g, bl) >= 250, near = min(r, g, bl) >= 235
                    sum += l; if l > peak { peak = l }; if white { clip += 1 }; if near { hot += 1 }; if l >= 160 { washed += 1 }
                    if inRows && x >= x0 && x <= x1 && inside(Float(x) + 0.5, Float(y) + 0.5) {
                        carN += 1; if white { carClip += 1 }; if near { carHot += 1 }; if l > carPeak { carPeak = l }
                        carSum += l; carSq += l * l
                    }
                }
            }
            let px = Double(w * h), cn = Double(max(carN, 1)), cm = Double(carSum) / cn
            // clip: all channels ≥ 250; hot: ≥ 235 (detail gone); washed: luma ≥ 160; sd: the car's contrast (its shape).
            let line = String(format: "LUMA %@ t %.3f car %.2f hot %.2f carMean %.1f sd %.1f carPeak %d carPx %d frame %.3f hot %.3f washed %.2f peak %d mean %.1f",
                              tag, t, carN > 0 ? Double(carClip) * 100 / cn : -1, carN > 0 ? Double(carHot) * 100 / cn : -1, cm,
                              (Double(carSq) / cn - cm * cm).squareRoot(), carPeak, carN,
                              Double(clip) * 100 / px, Double(hot) * 100 / px, Double(washed) * 100 / px, peak, Double(sum) / px)
            print(line)
            // And Caches/luma/log.txt, for when the console isn't attached.
            let log = dir.appendingPathComponent("log.txt"), d = Data((line + "\n").utf8)
            if let fh = try? FileHandle(forWritingTo: log) { fh.seekToEndOfFile(); fh.write(d); try? fh.close() } else { try? d.write(to: log) }
            if let s = snap { LumaProbe.png(p, w: w, h: h, to: dir.appendingPathComponent(String(format: "%@-%.2f.png", tag, s))) }
        }
    }

    /// The car's box (its own frame) through `m` (model) and `vp` into the target's pixels, as a convex hull.
    static func hull(lo: SIMD3<Float>, hi: SIMD3<Float>, model m: simd_float4x4, viewProj vp: simd_float4x4, w: Int, h: Int) -> [SIMD2<Float>] {
        var pts: [SIMD2<Float>] = []
        for i in 0..<8 {
            let c = SIMD3<Float>(i & 1 == 0 ? lo.x : hi.x, i & 2 == 0 ? lo.y : hi.y, i & 4 == 0 ? lo.z : hi.z)
            let q = vp * (m * SIMD4(c, 1))
            if q.w <= 0.05 { return [] }
            pts.append(SIMD2((q.x / q.w * 0.5 + 0.5) * Float(w), (0.5 - q.y / q.w * 0.5) * Float(h)))
        }
        // Andrew's monotone chain; in pixel space (y down) a positive cross is a clockwise turn on screen, consistent for `inside`.
        pts.sort { $0.x < $1.x || ($0.x == $1.x && $0.y < $1.y) }
        func cross(_ o: SIMD2<Float>, _ a: SIMD2<Float>, _ b: SIMD2<Float>) -> Float { (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x) }
        var lower: [SIMD2<Float>] = [], upper: [SIMD2<Float>] = []
        for p in pts { while lower.count >= 2 && cross(lower[lower.count - 2], lower[lower.count - 1], p) <= 0 { lower.removeLast() }; lower.append(p) }
        for p in pts.reversed() { while upper.count >= 2 && cross(upper[upper.count - 2], upper[upper.count - 1], p) <= 0 { upper.removeLast() }; upper.append(p) }
        return Array(lower.dropLast() + upper.dropLast())
    }

    private static func png(_ p: UnsafePointer<UInt8>, w: Int, h: Int, to url: URL) {
        let data = Data(bytes: p, count: w * h * 4)
        guard let prov = CGDataProvider(data: data as CFData),
              let img = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
                                provider: prov, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let out = UIImage(cgImage: img).pngData() else { return }
        try? out.write(to: url)
    }
}
#endif
