// Free Drive's marks on the ground (0223): rubber laid down by a sliding or spinning tyre. The strips persist, a ring of
// 4,096 quads that only drops the oldest, and stay where they were laid as the origin floats (they're kept in world
// metres and rewritten relative to the origin when it moves). A strip follows each wheel while it marks, and a gap
// starts a new one. Nothing is allocated per frame: the vertices go straight into one shared buffer.
import Foundation
import Metal
import simd

final class SkidMarks {
    static let cap = 4096
    /// One vertex: position relative to the origin the buffer was written for, then the mark's strength.
    private static let stride = 16
    let buf: MTLBuffer
    private struct Seg { var a0 = SIMD3<Double>(), a1 = SIMD3<Double>(), b0 = SIMD3<Double>(), b1 = SIMD3<Double>(); var s0: Float = 0, s1: Float = 0 }
    private var segs = [Seg](repeating: Seg(), count: SkidMarks.cap)
    private var head = 0
    private(set) var count = 0
    private var written = SIMD3<Double>(.nan, .nan, .nan)
    /// Each wheel's last marked point (left and right edge), or nil when it isn't marking.
    private var last: [(l: SIMD3<Double>, r: SIMD3<Double>, s: Float)?] = [nil, nil, nil, nil]

    init?(device: MTLDevice) {
        guard let b = device.makeBuffer(length: SkidMarks.cap * 6 * SkidMarks.stride, options: .storageModeShared) else { return nil }
        buf = b
    }

    /// Wheel `i` touches the ground at `p` (world metres, on the surface), its axle's lateral direction `side` (unit, in
    /// the ground plane), marking with strength `s` (0…1). Below 0.05 the strip ends.
    func mark(_ i: Int, at p: SIMD3<Double>, side: SIMD3<Double>, width: Double, strength s: Float, origin: SIMD3<Double>) {
        guard s > 0.05 else { last[i] = nil; return }
        let h = side * (width / 2), lift = SIMD3<Double>(0, 0.02, 0)
        let l = p - h + lift, r = p + h + lift
        guard let prev = last[i] else { last[i] = (l, r, s); return }
        // A new quad every 0.35 m of travel (short enough to follow a slide's curve).
        let d = simd_length_squared((l + r) * 0.5 - (prev.l + prev.r) * 0.5)
        if d < 0.35 * 0.35 { return }
        if d > 4 { last[i] = (l, r, s); return }   // a jump (a reset, a hop): no streak across it
        segs[head] = Seg(a0: prev.l, a1: prev.r, b0: l, b1: r, s0: prev.s, s1: s)
        if written == origin { write(head, origin) }
        head = (head + 1) % SkidMarks.cap
        count = min(SkidMarks.cap, count + 1)
        last[i] = (l, r, s)
    }
    /// Every strip ends (a reset).
    func lift() { last = [nil, nil, nil, nil] }
    func clear() { lift(); count = 0; head = 0 }

    /// Before the draw: the buffer relative to `origin` (rewritten in full only when the origin has moved).
    func prepare(origin: SIMD3<Double>) {
        if written == origin { return }
        written = origin
        for k in 0..<count { write(k, origin) }
    }
    private func write(_ k: Int, _ o: SIMD3<Double>) {
        let s = segs[k]
        let p = buf.contents().advanced(by: k * 6 * SkidMarks.stride).bindMemory(to: SIMD4<Float>.self, capacity: 6)
        func v(_ x: SIMD3<Double>, _ a: Float) -> SIMD4<Float> { SIMD4(SIMD3<Float>(x - o), a) }
        p[0] = v(s.a0, s.s0); p[1] = v(s.b0, s.s1); p[2] = v(s.a1, s.s0)
        p[3] = v(s.a1, s.s0); p[4] = v(s.b0, s.s1); p[5] = v(s.b1, s.s1)
    }
}
