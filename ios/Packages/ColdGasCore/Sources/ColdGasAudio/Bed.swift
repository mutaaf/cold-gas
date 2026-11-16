// The bed (0250): everything that rides with the camera and the car, in stereo. The drivetrain's voice (two motors'
// orders, the reduction gears, the inverter, regen), the tyres by surface, the squeal, the wind, the suspension, ABS,
// the cold-gas jets, the ambience round the listener, the title's music and the UI. One render callback; the
// spatial things (impacts, pass-bys, birds, the set's crowd) are the emitters' (Emitter.swift).
//
// Real time: trivial types in plain memory, parameters from atomics, one-shots from a ring, no allocation, no locks.
import Foundation

/// The bed's parameters (main thread → render thread).
public enum BP: Int, CaseIterable {
    case motorHz, load, speed, grounded, slip, slipLong, paved, gravel, grass, wet, concrete, deck, rough, abs
    case lift, side, grind, air, title, fx, music, trees, crickets, breeze, spinHz, split, master, speaker
}

/// The bed's one-shots.
public enum BedEvent: UInt8 { case thud, crunch, chime, tick, release, burst, close, airStart, land, thump, chirp, splash }

/// The drivetrain's orders: (order of the motor shaft, driving, coasting, regen). The reduction is a 9:1 two-stage
/// (ESTIMATE, a common EV single-speed): the first stage's 23-tooth pinion meshes at 23× the shaft, the second at 31/9×.
/// The motor (4 pole pairs) puts its electrical orders at 8×, 16×, and its 24/48-slot orders beside the mesh (they beat
/// against it: the roughness of a real e-motor). The second motor (the other rear wheel) runs at `split` of the first.
private let ORDERS: [(Double, Double, Double, Double)] = [
    (8, 0.30, 0.04, 0.22), (16, 0.12, 0.02, 0.24), (23, 0.42, 0.10, 0.28), (24, 0.15, 0.01, 0.20),
    (46, 0.13, 0.03, 0.10), (48, 0.05, 0.0, 0.08), (69, 0.04, 0.01, 0.03), (31.0 / 9, 0.16, 0.12, 0.12),
]

public struct BedCore {
    public var sr: Double
    let params: ParamBlock
    let ring: EventRing
    var pool: VoicePool
    let keys: ParamBlock          // the emitters' side-chain keys (read)
    let meter: RenderMeter
    let orders: UnsafeMutablePointer<(Double, Double, Double, Double)>
    let ph: UnsafeMutablePointer<Double>      // whine phases: [0..<8] motor A, [8..<16] motor B
    let orderCount: Int

    // Smoothed controls.
    var motorHz: Smooth, load: Smooth, speed: Smooth, slip: Smooth, paved: Smooth, gravel: Smooth, grass: Smooth, wet: Smooth
    var deck: Smooth, rough: Smooth, absK: Smooth, lift: Smooth, side: Smooth, grind: Smooth, air: Smooth, grounded: Smooth
    var trees: Smooth, crickets: Smooth, breeze: Smooth, pad: Smooth, fxGain: Smooth, musicGain: Smooth, master: Smooth
    var split = 1.0, spinHz = 0.0, slipLong = 0.0, concrete = 0.0, title = false

    // Noise sources.
    var pinkA = Pink(11), pinkB = Pink(23), pinkC = Pink(37), white = Xor(0xabcdef), whiteL = Xor(0x13579b), whiteR = Xor(0x2468ac)
    // Filters.
    var roarF = SVF(), roarLo = OnePole(), rumbleLo = OnePole(), deckA = Biquad(), deckB = Biquad()
    var gravA = SVF(), gravB = SVF(), gravLo = OnePole(), grassHi = SVF(), grassLo = OnePole(), sprayF = SVF()
    var sqF = SVF(), windLo = SVF(), whistle = SVF(), invHiss = SVF()
    var liftF = SVF(), sideF = SVF(), roarJet = OnePole()
    var grindHi = SVF(), grindLo = SVF()
    var leafL = Biquad(), leafR = Biquad(), breezeLo = OnePole(), padBq = Biquad()
    var whooshF = SVF()
    // Drifts (gusts, flutter, squeal wobble, crowd).
    var gust = Drift(seed: 3, period: 0.9, ease: 0.45, sr: 48000), sqWob = Drift(seed: 5, period: 0.035, ease: 0.02, sr: 48000)
    var sqAm = Drift(seed: 7, period: 0.012, ease: 0.006, sr: 48000), flutL = Drift(seed: 9, period: 0.05, ease: 0.025, sr: 48000)
    var flutR = Drift(seed: 13, period: 0.05, ease: 0.025, sr: 48000), stick = Drift(seed: 17, period: 0.008, ease: 0.003, sr: 48000)
    var grassAm = Drift(seed: 19, period: 0.07, ease: 0.03, sr: 48000)
    // Phases.
    var invPh = 0.0, invAm = 0.0, regenPh = 0.0, regenLfo = 0.0, sqPh1 = 0.0, sqPh2 = 0.0, sqPh3 = 0.0
    var absPh = 0.0, absHum = 0.0, jointPh = 0.0, jointRear = -1, treadPh = 0.0
    var padPh = (0.0, 0.0, 0.0, 0.0), padF = (55.0, 82.4, 110.0, 164.8), padLfo = 0.0
    var crk = (0.0, 0.0, 0.0, 0.0), crkT = (0.0, 0.0, 0.0, 0.0), ringPh = (0.0, 0.0)
    var whoosh = 0.0, whooshK = 0.0, whooshF0 = 400.0
    // Mix.
    var duck = 0.0, duckAtt = 0.0, duckRel = 0.0, n = 0

    public init(sr: Double, params: ParamBlock, ring: EventRing, keys: ParamBlock, meter: RenderMeter) {
        self.sr = sr; self.params = params; self.ring = ring; self.keys = keys; self.meter = meter
        pool = VoicePool(count: 112)
        orderCount = ORDERS.count
        orders = .allocate(capacity: ORDERS.count); orders.initialize(from: ORDERS, count: ORDERS.count)
        ph = .allocate(capacity: 16); ph.initialize(repeating: 0, count: 16)
        for i in 0..<16 { ph[i] = Double(i) * 0.173 - floor(Double(i) * 0.173) }
        func s(_ v: Double, _ t: Double, _ r: Double? = nil) -> Smooth { Smooth(v, tau: t, sr: sr, release: r) }
        motorHz = s(0, 0.05); load = s(0, 0.06); speed = s(0, 0.05); slip = s(0, 0.03, 0.08); paved = s(1, 0.15); gravel = s(0, 0.15)
        grass = s(0, 0.15); wet = s(0, 0.15); deck = s(0, 0.1); rough = s(0, 0.08); absK = s(0, 0.02, 0.1)
        lift = s(0, 0.008, 0.22); side = s(0, 0.008, 0.16); grind = s(0, 0.03); air = s(0, 0.2); grounded = s(1, 0.05)
        trees = s(0, 1.5); crickets = s(0, 2); breeze = s(0, 1.5); pad = s(0, 0.8); fxGain = s(1, 0.05); musicGain = s(1, 0.1)
        master = s(0, 0.01)
        var r = Lcg(s: 4242)
        padF = (55 * pow(2, r.next() * 4 / 1200), 82.4 * pow(2, r.next() * 4 / 1200), 110 * pow(2, r.next() * 4 / 1200), 164.8 * pow(2, r.next() * 4 / 1200))
        reconfigure(sr: sr)
    }
    public func free() { pool.free(); orders.deallocate(); ph.deallocate() }

    /// A new sample rate (a route change; the engine is stopped): filters and time constants follow.
    public mutating func reconfigure(sr: Double) {
        self.sr = sr
        func re(_ s: inout Smooth, _ t: Double, _ r: Double? = nil) { s.retime(tau: t, sr: sr, release: r) }
        re(&motorHz, 0.05); re(&load, 0.06); re(&speed, 0.05); re(&slip, 0.03, 0.08); re(&paved, 0.15); re(&gravel, 0.15)
        re(&grass, 0.15); re(&wet, 0.15); re(&deck, 0.1); re(&rough, 0.08); re(&absK, 0.02, 0.1); re(&lift, 0.008, 0.22)
        re(&side, 0.008, 0.16); re(&grind, 0.03); re(&air, 0.2); re(&grounded, 0.05); re(&trees, 1.5); re(&crickets, 2)
        re(&breeze, 1.5); re(&pad, 0.8); re(&fxGain, 0.05); re(&musicGain, 0.1); re(&master, 0.01)
        gust = Drift(seed: 3, period: 0.9, ease: 0.45, sr: sr); sqWob = Drift(seed: 5, period: 0.035, ease: 0.02, sr: sr)
        sqAm = Drift(seed: 7, period: 0.012, ease: 0.006, sr: sr); flutL = Drift(seed: 9, period: 0.05, ease: 0.025, sr: sr)
        flutR = Drift(seed: 13, period: 0.05, ease: 0.025, sr: sr); stick = Drift(seed: 17, period: 0.008, ease: 0.003, sr: sr)
        grassAm = Drift(seed: 19, period: 0.07, ease: 0.03, sr: sr)
        roarLo.set(900, sr); rumbleLo.set(110, sr); gravLo.set(160, sr); grassLo.set(200, sr); roarJet.set(380, sr); breezeLo.set(260, sr)
        deckA.set(.peak, 190, 4, sr, gainDb: 10); deckB.set(.peak, 430, 5, sr, gainDb: 8)
        gravA.tune(2900, q: 2.2, sr); gravB.tune(950, q: 1.6, sr); grassHi.tune(4200, q: 0.8, sr); sprayF.tune(6500, q: 0.6, sr)
        invHiss.tune(7200, q: 1.2, sr); grindHi.tune(2300, q: 3.5, sr); grindLo.tune(520, q: 1.2, sr)
        leafL.set(.highpass, 2600, 0.5, sr); leafR.set(.highpass, 2900, 0.5, sr); padBq.set(.lowpass, 700, 1, sr)
        duckAtt = 1 - exp(-1 / (0.004 * sr)); duckRel = 1 - exp(-1 / (0.35 * sr))
        pool.silence()
    }

    // MARK: control (once a block)

    mutating func pull() {
        let p = params
        let hz = max(0, p.get(BP.motorHz.rawValue))
        motorHz.target = hz; load.target = min(1, max(-1, p.get(BP.load.rawValue)))
        speed.target = max(0, p.get(BP.speed.rawValue))
        slip.target = min(1, max(0, p.get(BP.slip.rawValue))); slipLong = p.get(BP.slipLong.rawValue)
        paved.target = p.get(BP.paved.rawValue); gravel.target = p.get(BP.gravel.rawValue); grass.target = p.get(BP.grass.rawValue)
        wet.target = p.get(BP.wet.rawValue); concrete = p.get(BP.concrete.rawValue); deck.target = p.get(BP.deck.rawValue)
        rough.target = p.get(BP.rough.rawValue); absK.target = p.get(BP.abs.rawValue)
        lift.target = min(4, max(0, p.get(BP.lift.rawValue))); side.target = min(6, max(0, p.get(BP.side.rawValue)))
        grind.target = min(1, max(0, p.get(BP.grind.rawValue))); air.target = p.get(BP.air.rawValue)
        grounded.target = p.get(BP.grounded.rawValue)
        title = p.get(BP.title.rawValue) > 0.5
        pad.target = title ? 0.05 : 0
        fxGain.target = p.get(BP.fx.rawValue); musicGain.target = p.get(BP.music.rawValue)
        trees.target = p.get(BP.trees.rawValue); crickets.target = p.get(BP.crickets.rawValue); breeze.target = p.get(BP.breeze.rawValue)
        spinHz = p.get(BP.spinHz.rawValue); split = max(0.9, min(1.1, p.get(BP.split.rawValue)))
        if split == 0 { split = 1 }
        master.target = p.get(BP.master.rawValue)
    }

    mutating func drain() {
        var t = ring.cursors[1].load()
        let h = ring.cursors[0].loadAcquire()
        while t < h { start(ring.slots[t & (EventRing.size - 1)], sr); t += 1 }
        ring.cursors[1].storeRelease(t)
    }

    // MARK: one-shots

    mutating func start(_ e: SoundEvent, _ sr: Double) {
        guard let k = BedEvent(rawValue: e.kind) else { return }
        switch k {
        case .thud: startThud(hz: e.a, gain: e.b, decay: e.c, crunch: e.d)
        case .crunch: startCrunch(e.a, glass: e.b > 0.5, seed: e.seed)
        case .chime: startChime(Int(e.a))
        case .tick: spawn(.init(wave: .sine, f0: 1800, f1: 1800, g0: 0.05, peak: 0.05, decEnd: 0.04, gEnd: 0.0001, stop: 0.05, key: 0.4))
        case .release:
            spawn(.init(wave: .noise, filter: .bandpass, ff: 3800, fq: 0.9, atk: 0.004, peak: 0.35, decEnd: 0.16, stop: 0.18, seed: 99991, key: 0.5))
            spawn(.init(wave: .noise, filter: .bandpass, ff: 1100, fq: 0.7, atk: 0.006, peak: 0.18, decEnd: 0.11, stop: 0.13, seed: 7))
            spawn(.init(wave: .sine, f0: 120, f1: 48, glide: 0.09, atk: 0.002, peak: 0.3, decEnd: 0.12, stop: 0.14, amp2: 0.4, ratio2: 2, key: 0.4))
        case .burst: startBurst(bank: Int(e.a), k: e.b, seed: e.seed)
        case .close:
            // The valve seating: a tick and a short exhale.
            spawn(.init(wave: .sine, f0: 2600, f1: 2200, glide: 0.01, g0: 0.06 * e.b, peak: 0.06 * e.b, decEnd: 0.012, stop: 0.02, pan: e.a > 0.5 ? 0.15 : -0.15))
            spawn(.init(wave: .noise, filter: .bandpass, ff: 1700, fq: 0.8, atk: 0.003, peak: 0.07 * e.b, decEnd: 0.09, stop: 0.1, seed: e.seed))
        case .airStart:
            whoosh = 1; whooshK = min(1, e.a / 40); whooshF0 = 380 + 300 * whooshK
        case .land: startLand(sink: e.a, paved: e.b, seed: e.seed)
        case .thump: startThump(e.a, pan: e.b, seed: e.seed)
        case .chirp:
            // A tyre catching (a hard landing, a lock-up released): one bark of squeal.
            spawn(.init(wave: .sine, f0: 980, f1: 760, glide: 0.11, atk: 0.006, peak: 0.12 * e.a, decEnd: 0.12, stop: 0.14, amp2: 0.45, ratio2: 2.03))
        case .splash:
            spawn(.init(wave: .noise, filter: .highpass, ff: 1800, fq: 0.5, atk: 0.01, peak: 0.3 * e.a, decEnd: 0.5, stop: 0.55, rate: 0.8, seed: e.seed, key: 0.3))
            spawn(.init(wave: .sine, f0: 160, f1: 60, glide: 0.2, atk: 0.004, peak: 0.25 * e.a, decEnd: 0.22, stop: 0.25, amp2: 0.3, ratio2: 2))
        }
    }

    @inline(__always) mutating func spawn(_ s: VoicePool.Spec) { pool.spawn(s, sr: sr) }

    /// thud({ thudHz, thudGain, thudDecay, crunch }) (audio.js), with a second harmonic so a phone's speaker can say it.
    mutating func startThud(hz: Double, gain: Double, decay: Double, crunch: Double) {
        let g = min(1, gain)
        spawn(.init(wave: .sine, f0: hz, f1: max(30, hz * 0.33), glide: decay * 0.6, g0: g, peak: g, decEnd: decay, gEnd: 0.001, stop: decay + 0.05, amp2: 0.35, ratio2: 2, key: g))
        if crunch > 0 {
            spawn(.init(wave: .noise, filter: .bandpass, ff: 420, fq: 0.8, g0: 0.5 * crunch, peak: 0.5 * crunch, decEnd: 0.2, gEnd: 0.001, stop: 0.25, seed: 1))
        }
    }

    /// crunch(severity, { glass, seed }) (audio.js): thump, crack, folding metal and, when glass goes, the pings.
    mutating func startCrunch(_ severity: Double, glass: Bool, seed: Int64) {
        let k = min(1, max(0, severity))
        var r = Lcg(s: (seed &* 16807) % 2147483647); if r.s <= 0 { r.s = 1 }
        let out = 0.35 + 0.65 * k
        spawn(.init(wave: .sine, f0: 95 + 40 * k, f1: 32, glide: 0.3, g0: 0.9, peak: 0.9, decEnd: 0.45 + 0.3 * k, gEnd: 0.001, stop: 0.8, out: out, amp2: 0.3, ratio2: 2, key: 1))
        let rate = 0.7 + r.unit() * 0.5
        let skip = Int64(r.unit() * 0.5 * 48000) + 1
        spawn(.init(wave: .noise, filter: .lowpass, ff: 900 + 5200 * k, fq: 0.8, g0: 0.75, peak: 0.75, decEnd: 0.18 + 0.35 * k, gEnd: 0.001, stop: 0.7, out: out, rate: rate, seed: skip))
        let parts = 3 + Int((3 * k).rounded())
        for i in 0..<parts {
            let f = 140 + r.unit() * 900 * (0.6 + k)
            let f1 = f * (0.55 + r.unit() * 0.3)
            let d = 0.06 + r.unit() * 0.3 * (0.4 + k)
            let atk = 0.004 + r.unit() * 0.03
            spawn(.init(wave: i % 2 == 1 ? .triangle : .square, f0: f, f1: f1, glide: 0.4, filter: .bandpass, ff: f * 1.5, fq: 6,
                        atk: atk, peak: 0.5, decEnd: d + 0.05, stop: d + 0.1, out: out))
        }
        if glass { glassPings(k, &r, out) }
        debris(k, &r, out, bright: 3200)
    }

    mutating func glassPings(_ k: Double, _ r: inout Lcg, _ out: Double) {
        spawn(.init(wave: .noise, filter: .highpass, ff: 3500, fq: 1, g0: 0.6, peak: 0.6, decEnd: 0.12, gEnd: 0.001, stop: 0.15, out: out, seed: Int64(r.unit() * 24000) + 1))
        let pings = Int((10 + 8 * k).rounded(.up))
        for _ in 0..<pings {
            let f = 2800 + r.unit() * 5200, at = 0.03 + r.unit() * (0.35 + 0.4 * k), pk = 0.07 + r.unit() * 0.08, len = 0.05 + r.unit() * 0.12
            spawn(.init(wave: .sine, f0: f, f1: f, delay: at, atk: 0.003, peak: pk, decEnd: len, stop: len + 0.15, out: out, pan: r.next() * 0.7))
        }
    }

    /// Bits coming down after a hit: clicks and rattles at falling, irregular intervals.
    mutating func debris(_ k: Double, _ r: inout Lcg, _ out: Double, bright: Double) {
        let n = 2 + Int(6 * k)
        var t = 0.08 + r.unit() * 0.06
        for i in 0..<n {
            let g = (0.16 + 0.14 * k) * pow(0.78, Double(i)) * (0.6 + 0.4 * r.unit())
            spawn(.init(wave: .crackle, filter: .bandpass, ff: bright * (0.6 + 0.8 * r.unit()), fq: 2.5, delay: t, atk: 0.001, peak: g, decEnd: 0.03 + 0.04 * r.unit(),
                        stop: 0.08, out: out, seed: Int64(r.unit() * 1e6) + 3, density: 0.35, pan: r.next() * 0.8))
            t += 0.04 + r.unit() * 0.14 * (1 + Double(i) * 0.25)
        }
    }

    mutating func startChime(_ i: Int) {
        let notes = (659.25, 783.99, 987.77, 1318.5)
        let j = ((i % 4) + 4) % 4
        let f = j == 0 ? notes.0 : j == 1 ? notes.1 : j == 2 ? notes.2 : notes.3
        spawn(.init(wave: .sine, f0: f, f1: f, atk: 0.01, peak: 0.12, decEnd: 1.1, stop: 1.2, amp2: 0.08, ratio2: 3.01, key: 0.35))
    }

    /// A bank's valves opening: the pressure front (a punch of broadband air and a low push), then the hiss takes over.
    mutating func startBurst(bank: Int, k: Double, seed: Int64) {
        let g = min(1, max(0.2, k))
        let side = bank == 1
        spawn(.init(wave: .noise, filter: .bandpass, ff: side ? 3200 : 2100, fq: 0.6, atk: 0.003, peak: 0.42 * g, decEnd: 0.13, stop: 0.15, seed: seed, key: 0.6 * g))
        spawn(.init(wave: .sine, f0: side ? 150 : 115, f1: 46, glide: 0.08, atk: 0.002, peak: 0.36 * g, decEnd: 0.1, stop: 0.12, amp2: 0.45, ratio2: 2, key: 0.4 * g))
        spawn(.init(wave: .crackle, filter: .highpass, ff: 1500, fq: 0.7, atk: 0.001, peak: 0.25 * g, decEnd: 0.018, stop: 0.03, seed: seed &+ 11, density: 0.5))
    }

    /// The touchdown at `sink` m/s: the body's thump (deeper and longer the harder), the suspension bottoming, a tyre's
    /// bark on paving, the shell rattling.
    mutating func startLand(sink: Double, paved: Double, seed: Int64) {
        let v = max(0, sink), r0 = v / 5, s = r0 >= 1 ? 1 : r0 * r0
        var r = Lcg(s: max(1, seed % 2147483647))
        let hz = 150 - 95 * s, gain = 0.14 + 0.8 * s, decay = 0.2 + 0.42 * s
        spawn(.init(wave: .sine, f0: hz, f1: max(30, hz * 0.33), glide: decay * 0.6, g0: gain, peak: gain, decEnd: decay, gEnd: 0.001, stop: decay + 0.05, amp2: 0.4, ratio2: 2, key: gain))
        spawn(.init(wave: .noise, filter: .bandpass, ff: 650 + 400 * s, fq: 0.8, atk: 0.002, peak: 0.18 + 0.35 * s, decEnd: 0.1 + 0.1 * s, stop: 0.25, seed: seed))
        if s > 0.25 {
            let c = (s - 0.25) / 0.75
            spawn(.init(wave: .square, f0: 190, f1: 120, glide: 0.05, filter: .bandpass, ff: 420, fq: 3, atk: 0.001, peak: 0.25 * c, decEnd: 0.07, stop: 0.09))
            spawn(.init(wave: .noise, filter: .bandpass, ff: 420, fq: 0.8, g0: 0.5 * c, peak: 0.5 * c, decEnd: 0.2, stop: 0.25, seed: seed &+ 5))
        }
        if paved > 0.5 && v > 1.2 { spawn(.init(wave: .sine, f0: 1020, f1: 780, glide: 0.1, atk: 0.004, peak: 0.08 + 0.1 * s, decEnd: 0.11, stop: 0.13, amp2: 0.4, ratio2: 2.03)) }
        if s > 0.15 { debris(0.3 * s, &r, 0.6, bright: 2600) }
    }

    /// One corner's suspension hitting a bump: a short low knock, panned to its side.
    mutating func startThump(_ k: Double, pan: Double, seed: Int64) {
        let g = min(1, k)
        spawn(.init(wave: .sine, f0: 95 + 30 * g, f1: 52, glide: 0.06, atk: 0.002, peak: 0.12 + 0.22 * g, decEnd: 0.08 + 0.06 * g, stop: 0.16, amp2: 0.35, ratio2: 2.1, key: 0.2 * g, pan: pan * 0.4))
        spawn(.init(wave: .noise, filter: .bandpass, ff: 340, fq: 1.2, atk: 0.001, peak: 0.08 + 0.12 * g, decEnd: 0.05, stop: 0.07, seed: seed, pan: pan * 0.4))
        if g > 0.5 { spawn(.init(wave: .crackle, filter: .bandpass, ff: 2400, fq: 2, delay: 0.02, atk: 0.001, peak: 0.08 * g, decEnd: 0.05, stop: 0.07, seed: seed &+ 3, density: 0.3, pan: pan * 0.5)) }
    }

    // MARK: render

    public mutating func render(_ L: UnsafeMutablePointer<Float>, _ R: UnsafeMutablePointer<Float>, _ frames: Int) {
        let t0 = mach_absolute_time()
        pull()
        drain()
        let sr = self.sr, isr = 1 / sr
        var extKey = 0.0
        for i in 0..<keys.count { extKey = max(extKey, keys.get(i)) }
        // Voice-free layers that can sleep.
        let carOn = !(motorHz.silent && speed.silent && slip.silent)
        for i in 0..<frames {
            n &+= 1
            let retune = (n & 15) == 0
            let hz = motorHz.step(), ld = load.step(), v = speed.step(), sl = slip.step()
            let pv = paved.step(), gv = gravel.step(), gs = grass.step(), wt = wet.step(), dk = deck.step(), rg = rough.step(), ab = absK.step()
            let lf = lift.step(), sd = side.step(), gr = grind.step(), ar = air.step(), gd = grounded.step()
            let tr = trees.step(), ck = crickets.step(), bz = breeze.step(), pd = pad.step(), fx = fxGain.step(), mu = musicGain.step(), mg = master.step()
            let s = min(1, v / 45)
            var car = 0.0       // centred
            var wl = 0.0, wr = 0.0   // stereo (ambience, wind)

            if carOn {
                // --- Drivetrain: the motors' and the gears' orders.
                let drive = max(0, ld), regen = max(0, -ld), coast = 1 - min(1, abs(ld))
                let on = hz < 1.5 ? 0 : min(1, (hz - 1.5) / 10)
                if on > 0 {
                    let level = on * (0.075 + 0.2 * drive + 0.12 * regen + 0.05 * coast)
                    var w = 0.0
                    for j in 0..<orderCount {
                        let o = orders[j]
                        let f = o.0 * hz
                        if f < 35 || f > 13000 { ph[j] += f * isr; ph[j] -= floor(ph[j]); ph[j + 8] += f * split * isr; ph[j + 8] -= floor(ph[j + 8]); continue }
                        // Above 7 kHz the orders fade (a phone squeals there; real cabins damp it).
                        let hf = f > 7000 ? 1 - (f - 7000) / 6000 : 1
                        let lfade = f < 120 ? (f - 35) / 85 : 1
                        let a = (o.1 * drive + o.2 * coast + o.3 * regen) * hf * lfade
                        ph[j] += f * isr; if ph[j] >= 1 { ph[j] -= 1 }
                        ph[j + 8] += f * split * isr; if ph[j + 8] >= 1 { ph[j + 8] -= 1 }
                        w += a * (sin2pi(ph[j]) + 0.6 * sin2pi(ph[j + 8]))
                    }
                    car += w * level
                    // The inverter: at low speed its switching is audible, a carrier stepping up through sync ratios
                    // with sidebands at twice the electrical frequency; past ~60 km/h it's above hearing.
                    let e = 4 * hz
                    let nSync: Double = e < 40 ? 0 : e < 90 ? 27 : e < 160 ? 15 : 9
                    let fc = nSync == 0 ? 1450 + e * 6 : e * nSync
                    let invK = abs(ld) * max(0, 1 - v / 17) * on
                    if invK > 0.001 {
                        invPh += fc * isr; if invPh >= 1 { invPh -= 1 }
                        invAm += 2 * e * isr; if invAm >= 1 { invAm -= 1 }
                        car += sin2pi(invPh) * (0.55 + 0.45 * sin2pi(invAm)) * 0.028 * invK
                    }
                    let hiss = invHiss.bp(white.next())
                    car += hiss * 0.012 * abs(ld) * on
                    // Regen: a hum at the third electrical order with the controller's tremolo.
                    if regen > 0.01 {
                        regenPh += 3 * e * isr; if regenPh >= 1 { regenPh -= 1 }
                        regenLfo += 6.5 * isr; if regenLfo >= 1 { regenLfo -= 1 }
                        car += sin2pi(regenPh) * (0.7 + 0.3 * sin2pi(regenLfo)) * 0.03 * regen * on
                    }
                }
                // The driveline's low rumble (felt more than heard; a headphone's business).
                car += rumbleLo.run(pinkC.next()) * 0.18 * s * gd * (1 + 2 * rg)

                // --- Tyres by surface.
                if gd > 0.01 && v > 0.3 {
                    treadPh += spinHz * 8 * isr; if treadPh >= 1 { treadPh -= 1 }
                    if retune { roarF.tune(320 + 950 * s, q: 0.7, sr) }
                    let tread = 1 + 0.12 * sin2pi(treadPh)
                    var roar = roarF.bp(pinkA.next()) * (0.03 + 0.3 * pow(s, 1.25)) * tread
                    // The Wall's steel deck: hollow and booming.
                    if dk > 0.01 { roar += (deckB.run(deckA.run(roar)) - roar) * dk * 1.4 }
                    car += roar * pv * gd
                    // Concrete slabs every 4.5 m: the front axle, then the rear one wheelbase later.
                    if concrete > 0.5 && v > 2 {
                        jointPh += v / 4.5 * isr
                        if jointPh >= 1 {
                            jointPh -= 1
                            let g = 0.04 + 0.14 * s
                            spawn(.init(wave: .sine, f0: 82, f1: 55, glide: 0.04, atk: 0.001, peak: g, decEnd: 0.05, stop: 0.07, amp2: 0.4, ratio2: 2.2))
                            spawn(.init(wave: .sine, f0: 78, f1: 52, glide: 0.04, delay: 2.75 / v, atk: 0.001, peak: g * 0.85, decEnd: 0.05, stop: 0.07, amp2: 0.4, ratio2: 2.2))
                        }
                    }
                    // Gravel: grains (sparse impulses) through two rocks' resonances, more with speed and slip.
                    if gv > 0.01 {
                        let dens = min(0.12, 0.004 + v * 0.0016 + sl * 0.03 + rg * 0.01)
                        let u = white.unit()
                        let grain = u < dens ? white.next() * (0.5 + white.unit()) : 0
                        let c = gravA.bp(grain) * 0.9 + gravB.bp(grain) * 0.7 + gravLo.run(pinkB.next()) * 0.6 * s
                        car += c * gv * gd * (0.25 + 0.6 * s)
                    }
                    // Grass and dirt: a swish of blades, a soft thrum of soil.
                    if gs > 0.01 {
                        let am = grassAm.step()
                        let sw = grassHi.bp(white.next()) * (0.4 + 0.9 * am)
                        car += (sw * (0.03 + 0.14 * s) + grassLo.run(pinkB.next()) * 0.35 * s) * gs * gd
                    }
                    // Wet, snow, sand: spray hiss rising with the square of speed.
                    if wt > 0.01 { car += sprayF.bp(white.next()) * 0.3 * s * s * wt * gd * (1 + sl) }
                    // Rough ground: the suspension working, a rattle in the shell.
                    if rg > 0.01 { car += rumbleLo.y * 0.8 * rg * s }

                    // --- Squeal: a rubber's tonal howl that wobbles; on loose ground it's a scrabble instead.
                    let sq = sl * gd
                    if sq > 0.01 {
                        let wob = sqWob.step(), amr = sqAm.step()
                        let f0 = (slipLong > 0.5 ? 640 : 820) + 380 * sl + 160 * (wob - 0.5)
                        let d1 = f0 * isr
                        sqPh1 += d1; if sqPh1 >= 1 { sqPh1 -= 1 }
                        sqPh2 += d1 * 2.03; if sqPh2 >= 1 { sqPh2 -= 1 }
                        sqPh3 += d1 * 3.11; if sqPh3 >= 1 { sqPh3 -= 1 }
                        if retune { sqF.tune(f0 * 1.5, q: 7, sr) }
                        let tone = sin2pi(sqPh1) + 0.5 * sin2pi(sqPh2) + 0.22 * sin2pi(sqPh3) + sqF.bp(white.next()) * 2.2
                        let absGate = ab > 0.05 ? 0.45 + 0.55 * (absPh < 0.5 ? 1 : 0.15) : 1
                        let g = pow(sq, 1.4) * (0.6 + 0.4 * amr) * absGate
                        car += tone * g * 0.11 * pv
                    }
                    // ABS: the pump's buzz and the valves chattering at ≈ 14 Hz.
                    if ab > 0.02 {
                        absPh += 14 * isr
                        if absPh >= 1 {
                            absPh -= 1
                            spawn(.init(wave: .noise, filter: .bandpass, ff: 1400, fq: 1.5, atk: 0.001, peak: 0.07 * ab, decEnd: 0.014, stop: 0.02, seed: Int64(n & 0xffff) + 1))
                        }
                        absHum += 155 * isr; if absHum >= 1 { absHum -= 1 }
                        car += osc(.square, absHum, 155 * isr) * 0.012 * ab
                    }
                }
            }

            // --- Wind: a broad roar and a whistle round the canopy, louder and more open in the air.
            if v > 1 {
                let gu = gust.step()
                if retune {
                    windLo.tune((260 + 2300 * s) * (1 + 0.3 * ar), q: 0.7, sr)
                    whistle.tune(540 + 950 * s + 120 * (gu - 0.5), q: 5, sr)
                }
                let w = windLo.lp(pinkB.next()) * 0.28 * s * s * (1 + 0.6 * ar) * (0.8 + 0.4 * gu)
                let wh = whistle.bp(white.next()) * 0.02 * s * s * gu
                wl += w + wh * 0.8; wr += w * 0.9 + wh
            }
            // The airtime whoosh: a sweep up as the wheels leave.
            if whoosh > 0.0005 {
                whoosh *= 1 - 2.2 * isr
                if retune { whooshF.tune(whooshF0 * (1 + 2.2 * (1 - whoosh)), q: 1.1, sr) }
                let x = whooshF.bp(pinkA.next()) * whoosh * 0.3 * (0.4 + whooshK)
                wl += x; wr += x
            }

            // --- The jets: each bank's hiss (it opens in 8 ms and dies over a quarter second, dropping in pitch as it
            // goes), the lift bank's low roar under it.
            if lf > 1e-4 || sd > 1e-4 {
                if retune {
                    liftF.tune(2400 + 1500 * min(1, lf / 2), q: 0.9, sr)
                    sideF.tune(3800 + 1900 * min(1, sd / 3), q: 1.4, sr)
                }
                let hl = liftF.bp(whiteL.next()) * min(0.55, lf * 0.15)
                let hs = sideF.bp(whiteR.next()) * min(0.35, sd * 0.12)
                let rr = roarJet.run(pinkC.next()) * min(0.3, lf * 0.07)
                car += hl + hs * 0.8 + rr
                wl += hs * 0.15; wr -= hs * 0.15
            }
            // --- Grinding: stick-slip, and the struck metal ringing at its modes.
            if gr > 1e-4 {
                let st = stick.step()
                if retune { grindHi.tune(1600 + 2200 * gr, q: 3.5, sr) }
                var g = grindHi.bp(white.next()) * gr * 0.16 * (0.4 + 1.2 * st) + grindLo.bp(pinkA.next()) * gr * 0.3
                ringPh.0 += 1880 * isr; if ringPh.0 >= 1 { ringPh.0 -= 1 }
                ringPh.1 += 3310 * isr; if ringPh.1 >= 1 { ringPh.1 -= 1 }
                g += (sin2pi(ringPh.0) + 0.6 * sin2pi(ringPh.1)) * 0.04 * gr * st
                car += g
            }

            // --- Ambience: a breeze, leaves in it, crickets.
            if bz > 1e-4 || tr > 1e-4 {
                let gu = gust.v
                let b = breezeLo.run(pinkC.next()) * bz * (0.06 + 0.12 * gu)
                let fl = flutL.step(), fr = flutR.step()
                let ll = leafL.run(whiteL.next()) * tr * 0.05 * gu * (0.3 + fl)
                let lr = leafR.run(whiteR.next()) * tr * 0.05 * gu * (0.3 + fr)
                wl += b + ll; wr += b * 0.95 + lr
            }
            if ck > 1e-4 { let c = crickets(ck, isr); wl += c.0; wr += c.1 }

            // --- Music: the title's pad, its filter breathing.
            var mus = 0.0
            if pd > 1e-6 {
                padLfo += 0.07 * isr; if padLfo >= 1 { padLfo -= 1 }
                if retune { padBq.set(.lowpass, 600 + 260 * sin2pi(padLfo), 1, sr) }
                let x = osc(.triangle, padPh.0, 0) + osc(.triangle, padPh.1, 0) + osc(.triangle, padPh.2, 0) + osc(.triangle, padPh.3, 0)
                padPh.0 += padF.0 * isr; if padPh.0 >= 1 { padPh.0 -= 1 }
                padPh.1 += padF.1 * isr; if padPh.1 >= 1 { padPh.1 -= 1 }
                padPh.2 += padF.2 * isr; if padPh.2 >= 1 { padPh.2 -= 1 }
                padPh.3 += padF.3 * isr; if padPh.3 >= 1 { padPh.3 -= 1 }
                mus = padBq.run(x) * pd
            }

            // --- One-shots (panned) and the side-chain key.
            var vl = 0.0, vr = 0.0, key = extKey
            for j in 0..<pool.count where pool.voices[j].on {
                let x = pool.voices[j].sample(sr)
                let p = pool.voices[j].pan
                if p == 0 { vl += x; vr += x } else { vl += x * (1 - max(0, p)); vr += x * (1 + min(0, p)) }
                key += pool.voices[j].level
            }
            let kk = min(1, key)
            duck += (kk - duck) * (kk > duck ? duckAtt : duckRel)
            let dg = 1 - 0.5 * duck

            var l = ((car + wl) * dg) * fx + vl * fx + mus * mu * dg
            var r = ((car + wr) * dg) * fx + vr * fx + mus * mu * dg
            l *= mg; r *= mg
            // A soft ceiling per node (the master's limiter does the rest).
            l = soft(l); r = soft(r)
            if !l.isFinite || !r.isFinite { l = 0; r = 0; clear() }
            L[i] = Float(l); R[i] = Float(r)
        }
        meter.add(busy: mach_absolute_time() - t0, frames: frames)
    }

    /// Four crickets, each a carrier gated into three-pulse chirps at its own rate, at fixed places round the head.
    @inline(__always) mutating func crickets(_ k: Double, _ isr: Double) -> (Double, Double) {
        var l = 0.0, r = 0.0
        for j in 0..<4 {
            // (carrier, chirp period, pan)
            let c: (Double, Double, Double)
            switch j { case 0: c = (4350, 0.55, -0.8); case 1: c = (4720, 0.62, 0.85); case 2: c = (4480, 0.71, -0.25); default: c = (4910, 0.49, 0.4) }
            var t: Double, p: Double
            switch j { case 0: t = crkT.0; p = crk.0; case 1: t = crkT.1; p = crk.1; case 2: t = crkT.2; p = crk.2; default: t = crkT.3; p = crk.3 }
            t += isr; if t >= c.1 { t -= c.1 }
            p += c.0 * isr; if p >= 1 { p -= 1 }
            // three 16 ms pulses 30 ms apart, then silence
            let pt = t.truncatingRemainder(dividingBy: 0.03)
            let gate = t < 0.09 && pt < 0.016 ? sin2pi(pt / 0.032) : 0
            let x = sin2pi(p) * gate * 0.011 * k
            l += x * (1 - max(0, c.2)); r += x * (1 + min(0, c.2))
            switch j { case 0: crkT.0 = t; crk.0 = p; case 1: crkT.1 = t; crk.1 = p; case 2: crkT.2 = t; crk.2 = p; default: crkT.3 = t; crk.3 = p }
        }
        return (l, r)
    }

    @inline(__always) func soft(_ x: Double) -> Double {
        let a = abs(x)
        if a <= 0.85 { return x }
        return (x < 0 ? -1 : 1) * (0.85 + 0.13 * tanh((a - 0.85) / 0.13))
    }

    mutating func clear() {
        roarF.clear(); gravA.clear(); gravB.clear(); grassHi.clear(); sprayF.clear(); sqF.clear(); windLo.clear(); whistle.clear()
        invHiss.clear(); liftF.clear(); sideF.clear(); grindHi.clear(); grindLo.clear(); whooshF.clear()
        deckA.clear(); deckB.clear(); leafL.clear(); leafR.clear(); padBq.clear(); duck = 0
        rumbleLo.y = 0; gravLo.y = 0; grassLo.y = 0; roarJet.y = 0; breezeLo.y = 0; roarLo.y = 0
        pool.silence()
    }
}
