// The sound's building blocks (0250): filters, noise, oscillators, envelopes and the one-shot voice. Every type here is
// trivial (no references, no arrays), so the render callbacks can hold them in plain allocated memory and touch them
// without ARC, locks or allocation. Nothing here reads the sim.
import Foundation
import Synchronization

// MARK: - Filters

struct Biquad {
    enum Kind: UInt8 { case lowpass, highpass, bandpass, peak }
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0, z1 = 0.0, z2 = 0.0

    /// The Audio EQ Cookbook (the WebAudio spec's): lowpass/highpass take Q in dB, bandpass a linear Q; `peak` takes a
    /// linear Q and `gainDb`.
    mutating func set(_ k: Kind, _ freq: Double, _ q: Double, _ sr: Double, gainDb: Double = 0) {
        let f = min(max(freq, 10), sr * 0.45)
        let w = 2 * Double.pi * f / sr, c = cos(w), s = sin(w)
        var alpha: Double, n0: Double, n1: Double, n2: Double, a0: Double, d1: Double, d2: Double
        switch k {
        case .lowpass: alpha = s / (2 * pow(10, q / 20)); n0 = (1 - c) / 2; n1 = 1 - c; n2 = n0; a0 = 1 + alpha; d1 = -2 * c; d2 = 1 - alpha
        case .highpass: alpha = s / (2 * pow(10, q / 20)); n0 = (1 + c) / 2; n1 = -(1 + c); n2 = n0; a0 = 1 + alpha; d1 = -2 * c; d2 = 1 - alpha
        case .bandpass: alpha = s / (2 * max(q, 1e-4)); n0 = alpha; n1 = 0; n2 = -alpha; a0 = 1 + alpha; d1 = -2 * c; d2 = 1 - alpha
        case .peak:
            let A = pow(10, gainDb / 40)
            alpha = s / (2 * max(q, 1e-4))
            n0 = 1 + alpha * A; n1 = -2 * c; n2 = 1 - alpha * A; a0 = 1 + alpha / A; d1 = -2 * c; d2 = 1 - alpha / A
        }
        b0 = n0 / a0; b1 = n1 / a0; b2 = n2 / a0; a1 = d1 / a0; a2 = d2 / a0
    }
    @inline(__always) mutating func run(_ x: Double) -> Double {
        let y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        return y
    }
    mutating func clear() { z1 = 0; z2 = 0 }
}

/// A state-variable filter (Chamberlin, oversampled-free form after Simper): cheap to retune every sample, so the
/// sweeping layers (squeal, doppler whooshes, the gust) use it instead of recomputing biquads.
struct SVF {
    var ic1 = 0.0, ic2 = 0.0, g = 0.1, k = 1.0, a1 = 0.0, a2 = 0.0, a3 = 0.0
    @inline(__always) mutating func tune(_ freq: Double, q: Double, _ sr: Double) {
        let f = min(max(freq, 20), sr * 0.42)
        // tan(π f / sr), a rational approximation good to the 0.42·sr clamp.
        let x = Double.pi * f / sr
        let x2 = x * x
        g = x * (1 + x2 * (1.0 / 3 + x2 * (2.0 / 15 + x2 * 17.0 / 315)))
        k = 1 / max(q, 0.05)
        a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2
    }
    /// (lowpass, bandpass, highpass)
    @inline(__always) mutating func run(_ x: Double) -> (Double, Double, Double) {
        let v3 = x - ic2
        let v1 = a1 * ic1 + a2 * v3
        let v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2
        return (v2, v1, x - k * v1 - v2)
    }
    @inline(__always) mutating func bp(_ x: Double) -> Double { run(x).1 }
    @inline(__always) mutating func lp(_ x: Double) -> Double { run(x).0 }
    @inline(__always) mutating func hp(_ x: Double) -> Double { run(x).2 }
    mutating func clear() { ic1 = 0; ic2 = 0 }
}

/// A one-pole lowpass/smoother.
struct OnePole {
    var y = 0.0, k = 0.1
    mutating func set(_ freq: Double, _ sr: Double) { k = 1 - exp(-2 * Double.pi * freq / sr) }
    @inline(__always) mutating func run(_ x: Double) -> Double { y += (x - y) * k; return y }
}

// MARK: - Noise and oscillators

/// noiseBuffer()'s generator: s = s·16807 mod (2³¹ − 1), mapped to −1…1 (the web's, so the crunch's seeds match).
struct Lcg {
    var s: Int64
    @inline(__always) mutating func next() -> Double { s = (s &* 16807) % 2147483647; return Double(s) / 2147483647 * 2 - 1 }
    @inline(__always) mutating func unit() -> Double { s = (s &* 16807) % 2147483647; return Double(s) / 2147483647 }
}

/// A fast white-noise source for the beds (xorshift32): cheaper than the LCG's modulo, never zero.
struct Xor {
    var s: UInt32
    public init(_ seed: UInt32) { s = seed == 0 ? 0x9e3779b9 : seed }
    @inline(__always) mutating func next() -> Double {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5
        return Double(Int32(bitPattern: s)) * (1.0 / 2147483648.0)
    }
    @inline(__always) mutating func unit() -> Double { next() * 0.5 + 0.5 }
}

/// Pink-ish noise (Kellet's economy filter): tyre roar and wind sound like air, not like a radio between stations.
struct Pink {
    var w = Xor(0x1234567), b0 = 0.0, b1 = 0.0, b2 = 0.0
    public init(_ seed: UInt32) { w = Xor(seed) }
    @inline(__always) mutating func next() -> Double {
        let x = w.next()
        b0 = 0.99765 * b0 + x * 0.0990460
        b1 = 0.96300 * b1 + x * 0.2965164
        b2 = 0.57000 * b2 + x * 1.0526913
        return (b0 + b1 + b2 + x * 0.1848) * 0.22
    }
}

/// sin(2π·p) for any p, to about −60 dB (a parabola and one refinement): the partial banks run dozens of these a sample.
@inline(__always) func sin2pi(_ p: Double) -> Double {
    let x = p - (p + 0.5).rounded(.down)            // −0.5…0.5
    let y = 8 * x - 16 * x * abs(x)
    return 0.225 * (y * abs(y) - y) + y
}

@inline(__always) func blep(_ t: Double, _ dt: Double) -> Double {
    if t < dt { let x = t / dt; return x + x - x * x - 1 }
    if t > 1 - dt { let x = (t - 1) / dt; return x * x + x + x + 1 }
    return 0
}
enum Wave: UInt8 { case sine, triangle, square, sawtooth, noise, crackle }
@inline(__always) func osc(_ w: Wave, _ p: Double, _ dt: Double) -> Double {
    switch w {
    case .sine: return sin2pi(p)
    case .triangle: return 1 - 4 * abs(p - 0.5)
    case .sawtooth: return 2 * p - 1 - blep(p, dt)
    case .square:
        var q = p + 0.5; if q >= 1 { q -= 1 }
        return (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(q, dt)
    case .noise, .crackle: return 0
    }
}

/// setTargetAtTime: v → target with time constant tau, per sample. `kUp`/`kDown` differ when an attack and a release
/// want their own speeds (the jets' hiss opens in 10 ms and dies over a quarter second).
struct Smooth {
    var v: Double, target: Double, k: Double, kDown: Double
    public init(_ v: Double, tau: Double, sr: Double, release: Double? = nil) {
        self.v = v; target = v; k = 1 - exp(-1 / (tau * sr)); kDown = 1 - exp(-1 / ((release ?? tau) * sr))
    }
    @inline(__always) mutating func step() -> Double { v += (target - v) * (target >= v ? k : kDown); return v }
    var silent: Bool { target == 0 && v < 1e-6 }
    mutating func retime(tau: Double, sr: Double, release: Double? = nil) { k = 1 - exp(-1 / (tau * sr)); kDown = 1 - exp(-1 / ((release ?? tau) * sr)) }
}

/// A slow random walk 0…1 (gusts, leaf flutter, a crowd's swell): a target redrawn every `period` seconds, eased to.
struct Drift {
    var rng: Xor, v = 0.5, target = 0.5, k = 0.0, n = 0, period = 1
    public init(seed: UInt32, period: Double, ease: Double, sr: Double) {
        rng = Xor(seed); self.period = max(1, Int(period * sr)); k = 1 - exp(-1 / (ease * sr))
    }
    @inline(__always) mutating func step() -> Double {
        n += 1
        if n >= period { n = 0; target = rng.unit() }
        v += (target - v) * k
        return v
    }
}

// MARK: - One-shots

/// A one-shot: an oscillator, noise or a crackle (sparse random impulses), an exponential pitch glide, an optional
/// fixed filter, and the web's gain automation (hold g0 until `delay`, exponential to `peak` over `atk`, exponential to
/// `gEnd` by `decEnd`, stop at `stop`). Two partials of one voice can beat (`f2`): modal sounds want pairs.
struct Voice {
    var on = false, wave = Wave.sine
    var phase = 0.0, freq = 0.0, fMul = 1.0, glideN = 0
    var phase2 = 0.0, ratio2 = 0.0, amp2 = 0.0
    var rng = Lcg(s: 1), rate = 1.0, nA = 0.0, nB = 0.0, nFrac = 0.0, density = 0.0
    var filtered = false, bq = Biquad()
    var n = 0, delayN = 0, atkEndN = 0, decEndN = 0, stopN = 0
    var g = 0.0, g0 = 0.0, peak = 0.0, gEnd = 0.0, mulA = 1.0, mulD = 1.0, out = 1.0
    /// Its share of the side-chain key (impacts and the UI duck the beds).
    var key = 0.0
    /// −1 left … +1 right (the bed's stereo voices; the emitters are mono).
    var pan = 0.0
    /// A swept band-pass (a pass-by's Doppler fall): from `fc` by `fcMul` a sample between sweepA and sweepB.
    var sweep = false, svf = SVF(), fc = 0.0, fcMul = 1.0, fq = 1.0, sweepA = 0, sweepB = 0

    @inline(__always) mutating func sample(_ sr: Double) -> Double {
        if n >= stopN { on = false; return 0 }
        if n < delayN { g = g0; n += 1; return 0 }
        if n < atkEndN { if n == delayN { g = g0 }; g *= mulA }
        else if n == atkEndN { g = peak }
        else if n < decEndN { g *= mulD }
        else { g = gEnd }
        if n < glideN { freq *= fMul }
        var s: Double
        switch wave {
        case .noise:
            nFrac += rate
            while nFrac >= 1 { nFrac -= 1; nA = nB; nB = rng.next() }
            s = nA + (nB - nA) * nFrac
        case .crackle:
            // Sparse impulses: grit, splinters, gravel under a tyre.
            let u = rng.unit()
            s = u < density ? rng.next() * 2.5 : 0
        default:
            let dt = freq / sr
            s = osc(wave, phase, dt)
            phase += dt; if phase >= 1 { phase -= 1 }
            if amp2 != 0 {
                s += amp2 * sin2pi(phase2)
                phase2 += dt * ratio2; if phase2 >= 1 { phase2 -= floor(phase2) }
            }
        }
        if filtered { s = bq.run(s) }
        if sweep {
            if n > sweepA && n < sweepB { fc *= fcMul }
            if (n & 7) == 0 { svf.tune(fc, q: fq, sr) }
            s = svf.bp(s)
        }
        n += 1
        return s * g * out
    }
    /// How loud it is now (for the side-chain key).
    var level: Double { n < delayN ? 0 : g * out * key }
}

/// A voice pool in plain memory, with the spawn that fills one slot (the web's oscillator + gain automation).
struct VoicePool {
    let voices: UnsafeMutablePointer<Voice>
    let count: Int
    var active = 0

    public init(count: Int) {
        self.count = count
        voices = .allocate(capacity: count); voices.initialize(repeating: Voice(), count: count)
    }
    public func free() { voices.deallocate() }

    struct Spec {
        var wave = Wave.sine, f0 = 0.0, f1 = 0.0, glide = 0.0
        var filter: Biquad.Kind? = nil, ff = 0.0, fq = 1.0
        var delay = 0.0, g0 = 0.0001, atk = 0.0, peak = 0.0, decEnd = 0.1, gEnd = 0.0001, stop = 0.15
        var out = 1.0, rate = 1.0, seed: Int64 = 1, density = 0.0, amp2 = 0.0, ratio2 = 0.0, key = 0.0, pan = 0.0
        /// A swept band-pass: `sweepF0` until `sweepAt` (s after the delay), gliding to `sweepF1` over `sweepDur`.
        var sweepF0 = 0.0, sweepF1 = 0.0, sweepAt = 0.0, sweepDur = 0.0, sweepQ = 1.0
    }

    /// Fills a free slot; when none is free the quietest playing voice gives way.
    mutating func spawn(_ p: Spec, sr: Double) {
        var slot = -1, quiet = Double.infinity, qi = 0
        for i in 0..<count {
            if !voices[i].on { slot = i; break }
            let w = voices[i].n < voices[i].delayN ? voices[i].peak : voices[i].g; let l = abs(w * voices[i].out)
            if l < quiet { quiet = l; qi = i }
        }
        if slot < 0 { slot = qi }
        var v = Voice()
        v.on = true; v.wave = p.wave; v.freq = p.f0
        let gN = Int(p.glide * sr); v.fMul = gN > 0 && p.f0 > 0 && p.f1 > 0 ? pow(p.f1 / p.f0, 1 / Double(gN)) : 1
        v.rng = Lcg(s: max(1, (p.seed & 0x7fffffff) % 2147483647)); v.rate = p.rate; v.density = p.density
        v.ratio2 = p.ratio2; v.amp2 = p.amp2; v.key = p.key; v.pan = p.pan
        if let k = p.filter { v.filtered = true; v.bq.set(k, p.ff, p.fq, sr) }
        v.delayN = Int(p.delay * sr); v.glideN = v.delayN + gN; v.atkEndN = v.delayN + Int(p.atk * sr); v.decEndN = max(v.atkEndN + 1, Int(p.decEnd * sr) + v.delayN)
        v.stopN = Int(p.stop * sr) + v.delayN
        let g0 = max(p.g0, 1e-5), pk = max(p.peak, 1e-5), ge = max(p.gEnd, 1e-5)
        v.g0 = g0; v.peak = pk; v.gEnd = ge; v.g = g0; v.out = p.out
        let aN = v.atkEndN - v.delayN, dN = v.decEndN - v.atkEndN
        v.mulA = aN > 0 ? pow(pk / g0, 1 / Double(aN)) : 1
        v.mulD = dN > 0 ? pow(ge / pk, 1 / Double(dN)) : 1
        if p.f0 > 0 && p.wave != .noise && p.wave != .crackle { v.phase = Double(slot) * 0.137; v.phase -= floor(v.phase) }
        if p.sweepF0 > 0 {
            v.sweep = true; v.fc = p.sweepF0; v.fq = p.sweepQ
            v.sweepA = v.delayN + Int(p.sweepAt * sr); v.sweepB = v.sweepA + max(1, Int(p.sweepDur * sr))
            v.fcMul = pow(max(20, p.sweepF1) / p.sweepF0, 1 / Double(v.sweepB - v.sweepA))
            v.svf.tune(v.fc, q: v.fq, sr)
        }
        voices[slot] = v
    }

    mutating func silence() { for i in 0..<count { voices[i].on = false } }
}

// MARK: - The one-shot ring (main thread → render thread)

/// A request from the main thread. Trivial, so the ring is plain memory.
public struct SoundEvent {
    public var kind: UInt8 = 0
    public var a = 0.0, b = 0.0, c = 0.0, d = 0.0, seed: Int64 = 1
    public init(kind: UInt8 = 0, a: Double = 0, b: Double = 0, c: Double = 0, d: Double = 0, seed: Int64 = 1) {
        self.kind = kind; self.a = a; self.b = b; self.c = c; self.d = d; self.seed = seed
    }
}

/// A single-producer (main), single-consumer (render) ring with acquire/release indices.
public struct EventRing {
    public static let size = 64
    let slots: UnsafeMutablePointer<SoundEvent>
    let cursors: UnsafeMutablePointer<AtomicInt>

    public init() {
        slots = .allocate(capacity: EventRing.size); slots.initialize(repeating: SoundEvent(), count: EventRing.size)
        cursors = .allocate(capacity: 2)
        cursors.initialize(to: AtomicInt(0)); (cursors + 1).initialize(to: AtomicInt(0))
    }
    public func free() { slots.deallocate(); cursors.deinitialize(count: 2); cursors.deallocate() }

    /// Main thread. False when full (the event is dropped: a stale burst is worse than none).
    @discardableResult public func push(_ e: SoundEvent) -> Bool {
        let h = cursors[0].load(), t = cursors[1].loadAcquire()
        if h - t >= EventRing.size { return false }
        slots[h & (EventRing.size - 1)] = e
        cursors[0].storeRelease(h + 1)
        return true
    }
    /// Main thread, engine stopped: drop anything queued for an old graph.
    public func flush() { cursors[1].storeRelease(cursors[0].loadAcquire()) }
}

// MARK: - Atomics (Synchronization)

typealias AtomicInt = Atomic<Int>
extension Atomic where Value == Int {
    @inline(__always) func load() -> Int { load(ordering: .relaxed) }
    @inline(__always) func loadAcquire() -> Int { load(ordering: .acquiring) }
    @inline(__always) func storeRelease(_ v: Int) { store(v, ordering: .releasing) }
}

/// Float parameters the main thread writes and the render thread reads (bit patterns in Atomic<UInt32>s, relaxed: a
/// value one block late is fine, a torn one isn't possible).
public struct ParamBlock {
    let slots: UnsafeMutablePointer<Atomic<UInt32>>
    let count: Int
    public init(count: Int) {
        self.count = count
        slots = .allocate(capacity: count)
        for i in 0..<count { (slots + i).initialize(to: Atomic<UInt32>(0)) }
    }
    public func free() { slots.deinitialize(count: count); slots.deallocate() }
    @inline(__always) public func get(_ i: Int) -> Double { Double(Float(bitPattern: slots[i].load(ordering: .relaxed))) }
    @inline(__always) public func set(_ i: Int, _ v: Double) { slots[i].store((v.isFinite ? Float(v) : 0).bitPattern, ordering: .relaxed) }
}

/// What the render callbacks cost, in host ticks (written by the render thread, read by the main).
public struct RenderMeter {
    let ticks: UnsafeMutablePointer<Atomic<UInt64>>   // [0] busy ticks, [1] frames rendered, [2] worst block's ticks, [3] callbacks
    public init() { ticks = .allocate(capacity: 4); for i in 0..<4 { (ticks + i).initialize(to: Atomic<UInt64>(0)) } }
    public func free() { ticks.deinitialize(count: 4); ticks.deallocate() }
    @inline(__always) func add(busy: UInt64, frames: Int) {
        ticks[0].wrappingAdd(busy, ordering: .relaxed)
        ticks[1].wrappingAdd(UInt64(frames), ordering: .relaxed)
        ticks[3].wrappingAdd(1, ordering: .relaxed)
        if busy > ticks[2].load(ordering: .relaxed) { ticks[2].store(busy, ordering: .relaxed) }
    }
    public func read() -> (busy: UInt64, frames: UInt64, worst: UInt64, calls: UInt64) {
        (ticks[0].load(ordering: .relaxed), ticks[1].load(ordering: .relaxed), ticks[2].load(ordering: .relaxed), ticks[3].load(ordering: .relaxed))
    }
    public func reset() { for i in 0..<4 { ticks[i].store(0, ordering: .relaxed) } }
}
