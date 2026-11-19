// Two images' difference (0297, scripts/perf-shots.sh): the mean absolute difference per channel (0–255) and the share of
// pixels where any channel moved by more than 8. Run as `swift scripts/imgdiff.swift a.jpg b.jpg [more pairs…]`.
import CoreGraphics
import Foundation
import ImageIO

func pixels(_ path: String) -> (w: Int, h: Int, px: [UInt8])? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let w = img.width, h = img.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (w, h, px)
}
let args = Array(CommandLine.arguments.dropFirst())
var i = 0
while i + 1 < args.count {
    let a = args[i], b = args[i + 1]
    i += 2
    guard let A = pixels(a), let B = pixels(b), A.w == B.w, A.h == B.h else { print("\(a) \(b): unreadable or a different size"); continue }
    var sum = 0, moved = 0
    for p in 0..<(A.w * A.h) {
        var m = 0
        for c in 0..<3 { let d = abs(Int(A.px[p * 4 + c]) - Int(B.px[p * 4 + c])); sum += d; m = max(m, d) }
        if m > 8 { moved += 1 }
    }
    let n = Double(A.w * A.h)
    print(String(format: "%@ · mean %.2f · moved %.2f%%", (b as NSString).lastPathComponent, Double(sum) / (n * 3), Double(moved) / n * 100))
}
