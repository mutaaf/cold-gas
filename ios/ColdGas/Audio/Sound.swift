// The web's procedural sound (src/audio.js), ported to AVAudioEngine (docs/NATIVE.md §7, 0154).
// Near-silence, on purpose: an electric whine that climbs with speed, tyre roar, wind, the hiss of each nozzle bank,
// bodywork grinding, the touchdown thud, the crash, and one soft pad under the title. All procedural, no files.
//
// API (main thread only), and the web call each one replaces:
//   Sound.shared.update(speed:throttles:grounded:grind:phase:)   once per display frame
//       ← updateAudio({ speed, grounded, throttles, title }) + setGrind(level) + suspendAudio()/resumeAudio().
//         speed m/s (whine, tyres, wind saturate at 45), throttles the ten valves 0…1 ([0..3] lift bank, [4..9] side
//         bank), grounded (tyre roar), grind 0…1 (bodywork sliding: crash.js's st.grind · slowK), phase .title (the
//         pad, no whine) / .run / .quiet (pause, results-over-ad, a hidden app: the engine stops, as 0060's suspend).
//   thud(sink:)                ← main.js touchdown(): thud(landingImpact(sink)). Soft is a light high tap; hard is a deep,
//                                long thump with the suspension crunch on top (render/impact.js's mapping, mirrored).
//   impact(speed:part:seed:)   ← render/crash.js's per-contact audio: a wheel strike > 5 m/s is thud() at its defaults;
//                                a body HIT ≥ 1.6 m/s is crunch((v − 2)/12, glass: roof|side && v > 5, seed).
//   crunch(severity:glass:seed:) ← crunch(severity, { glass, seed }) directly (same seeded partials as the replay).
//   release()                  ← no web sound (the web only buzz('release')s). A 160 ms valve crack on the lift-hiss
//                                band, so the haptic's transient has a sound under it (§6: haptics never alone).
//   uiTap()                    ← tick() (ui.js's pad/menu click: 1.8 kHz, 40 ms).
//   chime(_ i:)                ← chime(i) (results reveal, quest steps: E5 G5 B5 E6).
//   setEnabled(_:) / isEnabled ← setMuted(!on) / !isMuted() (persisted, "coldgas.muted"). Off also stops the engine.
//   volume                     ← (new) 0…1 on top of the web's master 0.8.
//   Sound.demoIfRequested()    `-sound demo`: plays the 13 s scripted demo (title, a run, jets, a landing, a crash).
//
// Not in the web, so not here: a fan, the tank pressure (the web's sound reads neither). Spatial jets (§7) are later.
//
// Audio chain (as initAudio): every voice → master (0.8 · volume, 0 when off) → compressor (−16 dB, 4:1, 30 dB knee,
// 3 ms / 250 ms, Chrome's makeup) → a soft safety ceiling at −0.4 dBFS → output. Filters are the WebAudio spec's
// biquads (lowpass/highpass Q in dB, bandpass Q linear); ramps are setTargetAtTime one-poles and true exponential
// ramps; oscillators are PolyBLEP saw/square, naive triangle, sine; noise is the web's LCG (16807 mod 2³¹−1).
//
// Real time: the render block touches only an UnsafeMutablePointer<SynthCore> (trivial types, no ARC, no arrays),
// reads parameters from Atomic<UInt32> float bit patterns the main thread writes, and drains one-shots from a
// single-producer/single-consumer ring (acquire/release indices). Nothing is allocated or locked in it.
//
// Session: .ambient (the silent switch silences it; other apps' audio keeps playing). Interruptions (a call, Siri)
// and media-server resets restart the engine when they end; a route or hardware-rate change reconnects at the new
// rate; the background stops the engine, the foreground brings it back if a phase wants it.
import AVFoundation
import Synchronization
import QuartzCore
#if canImport(UIKit)
import UIKit
#endif

// MARK: - DSP (render thread)

struct Biquad {
    enum Kind: UInt8 { case lowpass, highpass, bandpass }
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0, z1 = 0.0, z2 = 0.0

    /// The WebAudio spec's coefficients (Audio EQ Cookbook; lowpass/highpass take Q in dB, bandpass linear).
    mutating func set(_ k: Kind, _ freq: Double, _ q: Double, _ sr: Double) {
        let f = min(max(freq, 10), sr * 0.49)
        let w = 2 * Double.pi * f / sr, c = cos(w), s = sin(w)
        let alpha: Double, n0: Double, n1: Double, n2: Double
        switch k {
        case .lowpass: alpha = s / (2 * pow(10, q / 20)); n0 = (1 - c) / 2; n1 = 1 - c; n2 = n0
        case .highpass: alpha = s / (2 * pow(10, q / 20)); n0 = (1 + c) / 2; n1 = -(1 + c); n2 = n0
        case .bandpass: alpha = s / (2 * max(q, 1e-4)); n0 = alpha; n1 = 0; n2 = -alpha
        }
        let a0 = 1 + alpha
        b0 = n0 / a0; b1 = n1 / a0; b2 = n2 / a0; a1 = -2 * c / a0; a2 = (1 - alpha) / a0
    }
    @inline(__always) mutating func run(_ x: Double) -> Double {
        let y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        return y
    }
}

/// noiseBuffer()'s generator: s = s·16807 mod (2³¹ − 1), mapped to −1…1.
struct Lcg {
    var s: Int64
    @inline(__always) mutating func next() -> Double { s = (s &* 16807) % 2147483647; return Double(s) / 2147483647 * 2 - 1 }
    @inline(__always) mutating func unit() -> Double { s = (s &* 16807) % 2147483647; return Double(s) / 2147483647 }
}

/// setTargetAtTime: v → target with time constant tau, per sample.
struct Smooth {
    var v: Double, target: Double, k: Double
    init(_ v: Double, tau: Double, sr: Double) { self.v = v; target = v; k = 1 - exp(-1 / (tau * sr)) }
    @inline(__always) mutating func step() -> Double { v += (target - v) * k; return v }
    var silent: Bool { target == 0 && v < 1e-6 }
}

@inline(__always) private func blep(_ t: Double, _ dt: Double) -> Double {
    if t < dt { let x = t / dt; return x + x - x * x - 1 }
    if t > 1 - dt { let x = (t - 1) / dt; return x * x + x + x + 1 }
    return 0
}
enum Wave: UInt8 { case sine, triangle, square, sawtooth, noise }
@inline(__always) private func osc(_ w: Wave, _ p: Double, _ dt: Double) -> Double {
    switch w {
    case .sine: return sin(2 * Double.pi * p)
    case .triangle: return 1 - 4 * abs(p - 0.5)
    case .sawtooth: return 2 * p - 1 - blep(p, dt)
    case .square:
        var q = p + 0.5; if q >= 1 { q -= 1 }
        return (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(q, dt)
    case .noise: return 0
    }
}

/// One of loopNoise()'s chains: looping noise → biquad → gain.
struct NoiseLoop {
    var rng: Lcg, bq = Biquad(), kind: Biquad.Kind, q: Double, f: Smooth, g: Smooth, fSet = -1.0
    init(seed: Int64, _ kind: Biquad.Kind, freq: Double, q: Double, tauG: Double, tauF: Double, sr: Double) {
        rng = Lcg(s: seed); self.kind = kind; self.q = q
        f = Smooth(freq, tau: tauF, sr: sr); g = Smooth(0, tau: tauG, sr: sr)
        bq.set(kind, freq, q, sr); fSet = freq
    }
    @inline(__always) mutating func sample(_ sr: Double, _ retune: Bool) -> Double {
        let gv = g.step(), fv = f.step()
        if retune && abs(fv - fSet) > 0.5 { bq.set(kind, fv, q, sr); fSet = fv }
        return bq.run(rng.next()) * gv
    }
}

/// A one-shot: an oscillator or noise, an exponential glide, an optional fixed biquad, and the web's gain automation
/// (hold g0 until `delay`, exponential to `peak` over `atk`, exponential to `gEnd` by `decEnd`, stop at `stop`).
struct Voice {
    var on = false, wave = Wave.sine
    var phase = 0.0, freq = 0.0, fMul = 1.0, glideN = 0
    var rng = Lcg(s: 1), rate = 1.0, nA = 0.0, nB = 0.0, nFrac = 0.0
    var filtered = false, bq = Biquad()
    var n = 0, delayN = 0, atkEndN = 0, decEndN = 0, stopN = 0
    var g = 0.0, g0 = 0.0, peak = 0.0, gEnd = 0.0, mulA = 1.0, mulD = 1.0, out = 1.0

    @inline(__always) mutating func sample(_ sr: Double) -> Double {
        if n >= stopN { on = false; return 0 }
        if n < delayN { g = g0 }
        else if n < atkEndN { if n == delayN { g = g0 }; g *= mulA }
        else if n == atkEndN { g = peak }
        else if n < decEndN { g *= mulD }
        else { g = gEnd }
        if n < glideN { freq *= fMul }
        var s: Double
        if wave == .noise {
            nFrac += rate
            while nFrac >= 1 { nFrac -= 1; nA = nB; nB = rng.next() }
            s = nA + (nB - nA) * nFrac
        } else {
            let dt = freq / sr
            s = osc(wave, phase, dt)
            phase += dt; if phase >= 1 { phase -= 1 }
        }
        if filtered { s = bq.run(s) }
        n += 1
        return s * g * out
    }
}

/// A one-shot request from the main thread (trivial, so the ring is plain memory).
struct SoundEvent {
    enum Kind: UInt8 { case thud, crunch, chime, tick, release }
    var kind = Kind.tick, a = 0.0, b = 0.0, c = 0.0, d = 0.0, seed: Int64 = 1
}

/// Parameter slots: Float bit patterns in Atomic<UInt32>s.
enum P: Int, CaseIterable { case speed, grounded, lift, side, grind, title, master }

/// Everything the render block touches. Trivial types only; lives in one UnsafeMutablePointer.
struct SynthCore {
    static let voiceCount = 128, ringSize = 64
    var sr: Double
    let params: UnsafeMutablePointer<Atomic<UInt32>>
    let ring: UnsafeMutablePointer<SoundEvent>
    let cursors: UnsafeMutablePointer<Atomic<Int>>      // [0] head (main writes), [1] tail (render writes)
    let voices: UnsafeMutablePointer<Voice>

    // initAudio()'s continuous graph.
    var mPh1 = 0.0, mPh2 = 0.0, mF1: Smooth, mF2: Smooth, mBq = Biquad(), mg: Smooth
    var padPh = (0.0, 0.0, 0.0, 0.0), padF = (55.0, 82.4, 110.0, 164.8), padBq = Biquad(), pad: Smooth
    var tyres: NoiseLoop, wind: NoiseLoop, hissLift: NoiseLoop, hissSide: NoiseLoop, grind: NoiseLoop, grindLo: NoiseLoop
    var master: Smooth
    // DynamicsCompressor (threshold −16, ratio 4, knee 30, attack 3 ms, release 250 ms).
    var compEnv = 0.0, compAtt = 0.0, compRel = 0.0, makeup = 1.0
    var block = 0

    init(sr: Double, params: UnsafeMutablePointer<Atomic<UInt32>>, ring: UnsafeMutablePointer<SoundEvent>,
         cursors: UnsafeMutablePointer<Atomic<Int>>, voices: UnsafeMutablePointer<Voice>) {
        self.sr = sr; self.params = params; self.ring = ring; self.cursors = cursors; self.voices = voices
        mF1 = Smooth(60, tau: 0.06, sr: sr); mF2 = Smooth(120, tau: 0.06, sr: sr); mg = Smooth(0, tau: 0.06, sr: sr)
        pad = Smooth(0, tau: 0.8, sr: sr)
        tyres = NoiseLoop(seed: 1, .lowpass, freq: 300, q: 0.7, tauG: 0.03, tauF: 0.06, sr: sr)
        wind = NoiseLoop(seed: 7919, .bandpass, freq: 900, q: 0.5, tauG: 0.06, tauF: 0.06, sr: sr)
        hissLift = NoiseLoop(seed: 104729, .bandpass, freq: 3800, q: 0.9, tauG: 0.02, tauF: 0.06, sr: sr)
        hissSide = NoiseLoop(seed: 1299709, .bandpass, freq: 5600, q: 1.4, tauG: 0.02, tauF: 0.06, sr: sr)
        grind = NoiseLoop(seed: 15485863, .bandpass, freq: 2300, q: 3.5, tauG: 0.03, tauF: 0.05, sr: sr)
        grindLo = NoiseLoop(seed: 32452843, .bandpass, freq: 520, q: 1.2, tauG: 0.03, tauF: 0.06, sr: sr)
        master = Smooth(0, tau: 0.01, sr: sr)
        // The pad's detune: ±4 cents, fixed per launch as Math.random() is.
        var r = Lcg(s: 4242)
        padF = (55 * pow(2, r.next() * 4 / 1200), 82.4 * pow(2, r.next() * 4 / 1200),
                110 * pow(2, r.next() * 4 / 1200), 164.8 * pow(2, r.next() * 4 / 1200))
        reconfigure(sr: sr)
    }

    /// The sample rate changed (a route change): filters and time constants follow. Called while the engine is stopped.
    mutating func reconfigure(sr: Double) {
        self.sr = sr
        mBq.set(.lowpass, 900, 3, sr); padBq.set(.lowpass, 700, 1, sr)
        mF1 = Smooth(mF1.v, tau: 0.06, sr: sr); mF2 = Smooth(mF2.v, tau: 0.06, sr: sr); mg = Smooth(mg.v, tau: 0.06, sr: sr)
        pad = Smooth(pad.v, tau: 0.8, sr: sr); master = Smooth(master.v, tau: 0.01, sr: sr)
        func re(_ l: inout NoiseLoop, _ tg: Double, _ tf: Double) {
            l.g = Smooth(l.g.v, tau: tg, sr: sr); l.f = Smooth(l.f.v, tau: tf, sr: sr); l.bq.set(l.kind, l.f.v, l.q, sr); l.fSet = l.f.v
        }
        re(&tyres, 0.03, 0.06); re(&wind, 0.06, 0.06); re(&hissLift, 0.02, 0.06); re(&hissSide, 0.02, 0.06)
        re(&grind, 0.03, 0.05); re(&grindLo, 0.03, 0.06)
        compAtt = 1 - exp(-1 / (0.003 * sr)); compRel = 1 - exp(-1 / (0.25 * sr))
        // Chrome's makeup gain: (1 / gain at 0 dBFS)^0.6.
        makeup = pow(1 / pow(10, SynthCore.reduction(0) / 20), 0.6)
        for i in 0..<SynthCore.voiceCount { voices[i].on = false }
    }

    /// The compressor's static curve: gain change in dB for an input level in dB (knee from threshold to +30 dB).
    @inline(__always) static func reduction(_ x: Double) -> Double {
        let t = -16.0, w = 30.0, r = 4.0
        if x <= t { return 0 }
        if x < t + w { let d = x - t; return (1 / r - 1) * d * d / (2 * w) }
        return (1 / r - 1) * w / 2 + (x - t - w) * (1 / r - 1)
    }

    @inline(__always) func param(_ p: P) -> Double { Double(Float(bitPattern: params[p.rawValue].load(ordering: .relaxed))) }

    mutating func pullParams() {
        let s = min(1, max(0, param(.speed) / 45))
        let title = param(.title) > 0.5, grounded = param(.grounded) > 0.5
        mF1.target = 60 + s * 520; mF2.target = 120 + s * 1040
        mg.target = title ? 0 : 0.03 + s * 0.08
        tyres.g.target = grounded ? s * 0.22 : 0
        wind.g.target = s * s * 0.18; wind.f.target = 500 + s * 1400
        hissLift.g.target = min(0.55, param(.lift) * 0.15)
        hissSide.g.target = min(0.35, param(.side) * 0.12)
        pad.target = title ? 0.05 : 0
        let k = min(1, max(0, param(.grind)))
        grind.g.target = k * 0.32; grind.f.target = 1600 + k * 2200; grindLo.g.target = k * 0.28
        master.target = param(.master)
    }

    mutating func drainEvents() {
        var t = cursors[1].load(ordering: .relaxed)
        let h = cursors[0].load(ordering: .acquiring)
        while t < h {
            let e = ring[t & (SynthCore.ringSize - 1)]
            switch e.kind {
            case .thud: startThud(hz: e.a, gain: e.b, decay: e.c, crunch: e.d)
            case .crunch: startCrunch(e.a, glass: e.b > 0.5, seed: e.seed)
            case .chime: startChime(Int(e.a))
            case .tick: startTick()
            case .release: startRelease()
            }
            t += 1
        }
        cursors[1].store(t, ordering: .releasing)
    }

    // MARK: one-shots (each mirrors its audio.js function)

    mutating func spawn(_ wave: Wave, f0: Double = 0, f1: Double = 0, glide: Double = 0,
                        filter: Biquad.Kind? = nil, ff: Double = 0, fq: Double = 1,
                        delay: Double = 0, g0: Double, atk: Double = 0, peak: Double, decEnd: Double, gEnd: Double,
                        stop: Double, out: Double = 1, rate: Double = 1, seed: Int64 = 1) {
        var slot = -1
        for i in 0..<SynthCore.voiceCount where !voices[i].on { slot = i; break }
        if slot < 0 { return }
        var v = Voice()
        v.on = true; v.wave = wave; v.freq = f0
        v.glideN = Int(glide * sr); v.fMul = v.glideN > 0 && f0 > 0 ? pow(f1 / f0, 1 / Double(v.glideN)) : 1
        v.rng = Lcg(s: max(1, seed % 2147483647)); v.rate = rate
        if let k = filter { v.filtered = true; v.bq.set(k, ff, fq, sr) }
        v.delayN = Int(delay * sr); v.atkEndN = v.delayN + Int(atk * sr); v.decEndN = max(v.atkEndN + 1, Int(decEnd * sr))
        v.stopN = Int(stop * sr)
        v.g0 = g0; v.peak = peak; v.gEnd = gEnd; v.g = g0; v.out = out
        let aN = v.atkEndN - v.delayN, dN = v.decEndN - v.atkEndN
        v.mulA = aN > 0 ? pow(peak / g0, 1 / Double(aN)) : 1
        v.mulD = dN > 0 ? pow(gEnd / peak, 1 / Double(dN)) : 1
        voices[slot] = v
    }

    /// thud({ thudHz, thudGain, thudDecay, crunch }).
    mutating func startThud(hz: Double, gain: Double, decay: Double, crunch: Double) {
        spawn(.sine, f0: hz, f1: max(30, hz * 0.33), glide: decay * 0.6,
              g0: min(1, gain), peak: min(1, gain), decEnd: decay, gEnd: 0.001, stop: decay + 0.05)
        if crunch > 0 {
            spawn(.noise, filter: .bandpass, ff: 420, fq: 0.8, g0: 0.5 * crunch, peak: 0.5 * crunch, decEnd: 0.2, gEnd: 0.001,
                  stop: 0.25, seed: 1)
        }
    }

    /// crunch(severity, { glass, seed }): thump, crack, folding metal, and when glass goes, the pings.
    mutating func startCrunch(_ severity: Double, glass: Bool, seed: Int64) {
        let k = min(1, max(0, severity))
        var r = Lcg(s: (seed &* 16807) % 2147483647); if r.s <= 0 { r.s = 1 }
        let out = 0.35 + 0.65 * k
        // Thump: the mass of the car stopping.
        spawn(.sine, f0: 95 + 40 * k, f1: 32, glide: 0.3, g0: 0.9, peak: 0.9, decEnd: 0.45 + 0.3 * k, gEnd: 0.001, stop: 0.8, out: out)
        // Crack: noise, low-passed less the harder the hit, at 0.7–1.2× playback.
        let rate = 0.7 + r.unit() * 0.5
        let skip = Int64(r.unit() * 0.5 * 48000) + 1
        spawn(.noise, filter: .lowpass, ff: 900 + 5200 * k, fq: 0.8, g0: 0.75, peak: 0.75, decEnd: 0.18 + 0.35 * k, gEnd: 0.001,
              stop: 0.7, out: out, rate: rate, seed: skip)
        // Metal folding: inharmonic partials, each its own short decay.
        let parts = 3 + Int((3 * k).rounded())
        for i in 0..<parts {
            let f = 140 + r.unit() * 900 * (0.6 + k)
            let f1 = f * (0.55 + r.unit() * 0.3)
            let d = 0.06 + r.unit() * 0.3 * (0.4 + k)
            let atk = 0.004 + r.unit() * 0.03
            spawn(i % 2 == 1 ? .triangle : .square, f0: f, f1: f1, glide: 0.4, filter: .bandpass, ff: f * 1.5, fq: 6,
                  g0: 0.0001, atk: atk, peak: 0.5, decEnd: d + 0.05, gEnd: 0.0001, stop: d + 0.1, out: out)
        }
        if glass {
            spawn(.noise, filter: .highpass, ff: 3500, fq: 1, g0: 0.6, peak: 0.6, decEnd: 0.12, gEnd: 0.001, stop: 0.15, out: out,
                  seed: Int64(r.unit() * 0.5 * 48000) + 1)
            let pings = Int((10 + 8 * k).rounded(.up))
            for _ in 0..<pings {
                let f = 2800 + r.unit() * 5200
                let at = 0.03 + r.unit() * (0.35 + 0.4 * k)
                let pk = 0.07 + r.unit() * 0.08
                let len = 0.05 + r.unit() * 0.12
                spawn(.sine, f0: f, f1: f, delay: at, g0: 0.0001, atk: 0.003, peak: pk, decEnd: at + len, gEnd: 0.0001,
                      stop: at + 0.2, out: out)
            }
        }
    }

    mutating func startChime(_ i: Int) {
        let notes = (659.25, 783.99, 987.77, 1318.5)
        let j = ((i % 4) + 4) % 4
        let f = j == 0 ? notes.0 : j == 1 ? notes.1 : j == 2 ? notes.2 : notes.3
        spawn(.sine, f0: f, f1: f, g0: 0.0001, atk: 0.01, peak: 0.12, decEnd: 1.1, gEnd: 0.0001, stop: 1.2)
    }
    mutating func startTick() {
        spawn(.sine, f0: 1800, f1: 1800, g0: 0.05, peak: 0.05, decEnd: 0.04, gEnd: 0.0001, stop: 0.05)
    }
    /// Native only: the valves cracking open (the hiss band, a fast attack, 160 ms), and a low puff under it.
    mutating func startRelease() {
        spawn(.noise, filter: .bandpass, ff: 3800, fq: 0.9, g0: 0.0001, atk: 0.004, peak: 0.35, decEnd: 0.16, gEnd: 0.0001, stop: 0.18, seed: 99991)
        spawn(.noise, filter: .bandpass, ff: 1100, fq: 0.7, g0: 0.0001, atk: 0.006, peak: 0.18, decEnd: 0.11, gEnd: 0.0001, stop: 0.13, seed: 7)
    }

    // MARK: render

    mutating func render(_ out: UnsafeMutablePointer<Float>, _ frames: Int) {
        pullParams()
        drainEvents()
        let sr = self.sr
        let motorOn = !(mg.silent), padOn = !(pad.silent)
        for i in 0..<frames {
            let retune = (block & 31) == 0
            block &+= 1
            var y = 0.0
            if motorOn {
                let f1 = mF1.step(), f2 = mF2.step(), g = mg.step()
                let d1 = f1 / sr, d2 = f2 / sr
                let x = osc(.sawtooth, mPh1, d1) + osc(.sine, mPh2, d2)
                mPh1 += d1; if mPh1 >= 1 { mPh1 -= 1 }
                mPh2 += d2; if mPh2 >= 1 { mPh2 -= 1 }
                y += mBq.run(x) * g
            } else { _ = mF1.step(); _ = mF2.step(); _ = mg.step() }
            if padOn {
                let g = pad.step()
                let x = osc(.triangle, padPh.0, 0) + osc(.triangle, padPh.1, 0) + osc(.triangle, padPh.2, 0) + osc(.triangle, padPh.3, 0)
                padPh.0 += padF.0 / sr; if padPh.0 >= 1 { padPh.0 -= 1 }
                padPh.1 += padF.1 / sr; if padPh.1 >= 1 { padPh.1 -= 1 }
                padPh.2 += padF.2 / sr; if padPh.2 >= 1 { padPh.2 -= 1 }
                padPh.3 += padF.3 / sr; if padPh.3 >= 1 { padPh.3 -= 1 }
                y += padBq.run(x) * g
            } else { _ = pad.step() }
            if !tyres.g.silent { y += tyres.sample(sr, retune) } else { _ = tyres.f.step() }
            if !wind.g.silent { y += wind.sample(sr, retune) } else { _ = wind.f.step() }
            if !hissLift.g.silent { y += hissLift.sample(sr, retune) }
            if !hissSide.g.silent { y += hissSide.sample(sr, retune) }
            if !grind.g.silent { y += grind.sample(sr, retune) } else { _ = grind.f.step() }
            if !grindLo.g.silent { y += grindLo.sample(sr, retune) }
            for v in 0..<SynthCore.voiceCount where voices[v].on { y += voices[v].sample(sr) }

            y *= master.step()
            // Compressor: peak detector on the gain change, then Chrome's makeup.
            let lvl = 20 * log10(abs(y) + 1e-9)
            let want = SynthCore.reduction(lvl)
            compEnv += (want - compEnv) * (want < compEnv ? compAtt : compRel)
            y *= pow(10, compEnv / 20) * makeup
            // Safety ceiling at 0.955 (−0.4 dBFS): soft above 0.9, never past it.
            let a = abs(y)
            if a > 0.9 { y = (y < 0 ? -1 : 1) * (0.9 + 0.055 * tanh((a - 0.9) / 0.055)) }
            if !y.isFinite { y = 0; resetFilters() }
            out[i] = Float(y)
        }
    }

    mutating func resetFilters() {
        mBq.z1 = 0; mBq.z2 = 0; padBq.z1 = 0; padBq.z2 = 0
        tyres.bq.z1 = 0; tyres.bq.z2 = 0; wind.bq.z1 = 0; wind.bq.z2 = 0
        hissLift.bq.z1 = 0; hissLift.bq.z2 = 0; hissSide.bq.z1 = 0; hissSide.bq.z2 = 0
        grind.bq.z1 = 0; grind.bq.z2 = 0; grindLo.bq.z1 = 0; grindLo.bq.z2 = 0
        compEnv = 0
        for v in 0..<SynthCore.voiceCount { voices[v].on = false }
    }
}

// MARK: - The player (main thread)

final class Sound {
    enum Phase { case title, run, quiet }
    /// render/crash.js's PART, as far as the sound cares.
    enum Part { case wheel, nose, tail, roof, side, floor }

    static let shared = Sound()

    private(set) var isEnabled: Bool
    var volume: Double = 1 { didSet { volume = min(1, max(0, volume)); pushMaster() } }
    private(set) var phase: Phase = .quiet
    var log = false

    private var engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private let core: UnsafeMutablePointer<SynthCore>
    private let params: UnsafeMutablePointer<Atomic<UInt32>>
    private let ring: UnsafeMutablePointer<SoundEvent>
    private let cursors: UnsafeMutablePointer<Atomic<Int>>
    private let voices: UnsafeMutablePointer<Voice>
    private let offline: Bool
    private var foreground = true, interrupted = false
    private var observers: [NSObjectProtocol] = []

    /// The app's player. `offlineRate` (tests, the harness) renders by hand instead: no session, no hardware.
    init(offlineRate: Double? = nil) {
        offline = offlineRate != nil
        isEnabled = offline ? true : !UserDefaults.standard.bool(forKey: "coldgas.muted")
        params = .allocate(capacity: P.allCases.count)
        for i in 0..<P.allCases.count { (params + i).initialize(to: Atomic<UInt32>(0)) }
        ring = .allocate(capacity: SynthCore.ringSize); ring.initialize(repeating: SoundEvent(), count: SynthCore.ringSize)
        cursors = .allocate(capacity: 2)
        cursors.initialize(to: Atomic<Int>(0)); (cursors + 1).initialize(to: Atomic<Int>(0))
        voices = .allocate(capacity: SynthCore.voiceCount); voices.initialize(repeating: Voice(), count: SynthCore.voiceCount)
        #if os(iOS)
        if !offline { Sound.configureSession() }
        #endif
        let rate = offlineRate ?? Sound.hardwareRate(engine)
        core = .allocate(capacity: 1)
        core.initialize(to: SynthCore(sr: rate, params: params, ring: ring, cursors: cursors, voices: voices))
        pushMaster()
        if let r = offlineRate {
            connect(rate: r)
            let fmt = AVAudioFormat(standardFormatWithSampleRate: r, channels: 1)!
            try? engine.enableManualRenderingMode(.offline, format: fmt, maximumFrameCount: 4096)
            try? engine.start()
        } else {
            connect(rate: rate)
            observe()
        }
    }
    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        engine.stop()
        core.deinitialize(count: 1); core.deallocate()
        params.deinitialize(count: P.allCases.count); params.deallocate()
        cursors.deinitialize(count: 2); cursors.deallocate()
        ring.deallocate(); voices.deallocate()
    }

    // MARK: API

    /// Once per display frame. `throttles` is the ten valves (0…1): [0..3] the lift bank, [4..9] the side bank.
    func update(speed: Double, throttles: [Double], grounded: Bool, grind: Double = 0, phase: Phase = .run) {
        var lift = 0.0, side = 0.0
        let n = throttles.count
        var i = 0
        while i < n { if i < 4 { lift += throttles[i] } else { side += throttles[i] }; i += 1 }
        update(speed: speed, lift: lift, side: side, grounded: grounded, grind: grind, phase: phase)
    }
    /// The same with the banks already summed (lift 0…4, side 0…6).
    func update(speed: Double, lift: Double, side: Double, grounded: Bool, grind: Double = 0, phase: Phase = .run) {
        set(.speed, speed); set(.lift, lift); set(.side, side); set(.grind, grind)
        set(.grounded, grounded ? 1 : 0); set(.title, phase == .title ? 1 : 0)
        if phase != self.phase { self.phase = phase; applyRunning() }
    }

    /// A touchdown at `sink` m/s: render/impact.js's landingImpact() sound, then thud().
    func thud(sink: Double) {
        let v = sink > 0 ? sink : 0, r = v / 5, s = r >= 1 ? 1 : r * r
        thud(hz: 150 - 95 * s, gain: 0.12 + 0.78 * s, decay: 0.18 + 0.42 * s, crunch: s > 0.3 ? (s - 0.3) / 0.7 : 0)
    }
    /// thud({ thudHz, thudGain, thudDecay, crunch }) as the web takes it (defaults as audio.js's).
    func thud(hz: Double = 110, gain: Double = 0.45, decay: Double = 0.4, crunch: Double = 0) {
        post(SoundEvent(kind: .thud, a: hz, b: gain, c: decay, d: crunch))
    }
    /// One contact at `speed` m/s, as render/crash.js sounds it. `seed` makes a replayed impact sound the same.
    func impact(speed v: Double, part: Part, seed: Int = 1) {
        if part == .wheel { if v > 5 { thud() }; return }
        if v < 1.6 { return }
        crunch(severity: min(1, max(0, (v - 2) / 12)), glass: (part == .roof || part == .side) && v > 5, seed: seed)
    }
    func crunch(severity: Double, glass: Bool = false, seed: Int = 1) {
        post(SoundEvent(kind: .crunch, a: severity, b: glass ? 1 : 0, seed: Int64(truncatingIfNeeded: seed)))
    }
    func release() { post(SoundEvent(kind: .release)) }
    func uiTap() { post(SoundEvent(kind: .tick)) }
    func chime(_ i: Int = 0) { post(SoundEvent(kind: .chime, a: Double(i))) }

    func setEnabled(_ on: Bool) {
        isEnabled = on
        if !offline { UserDefaults.standard.set(!on, forKey: "coldgas.muted") }
        pushMaster(); applyRunning()
    }

    // MARK: offline rendering (the harness, tests)

    /// Renders `frames` mono samples (manual rendering mode only).
    func renderOffline(frames: Int) -> [Float] {
        precondition(offline)
        let fmt = engine.manualRenderingFormat
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(frames)) else { return [] }
        var out: [Float] = []; out.reserveCapacity(frames)
        var left = frames
        while left > 0 {
            let n = min(left, Int(engine.manualRenderingMaximumFrameCount))
            guard (try? engine.renderOffline(AVAudioFrameCount(n), to: buf)) == .success, let d = buf.floatChannelData else { break }
            out.append(contentsOf: UnsafeBufferPointer(start: d[0], count: Int(buf.frameLength)))
            left -= n
        }
        return out
    }

    // MARK: demo (`-sound demo`; the app calls Sound.demoIfRequested() once it wants it)

    static func demoIfRequested() {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-sound"), i + 1 < a.count, a[i + 1] == "demo" else { return }
        let s = Sound.shared, t0 = CACurrentMediaTime()
        var fired = Set<Int>()
        Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
            let t = CACurrentMediaTime() - t0
            if !Sound.demoFrame(s, t: t, fired: &fired) { timer.invalidate(); s.update(speed: 0, lift: 0, side: 0, grounded: true, phase: .quiet) }
        }
        print("SOUND demo (\(Int(Sound.demoLength)) s)")
    }
    static let demoLength = 13.0
    /// One frame of the scripted demo at `t` seconds; false when it's over. The harness renders the same script.
    @discardableResult
    static func demoFrame(_ s: Sound, t: Double, fired: inout Set<Int>) -> Bool {
        func once(_ id: Int, at: Double, _ f: () -> Void) { if t >= at && !fired.contains(id) { fired.insert(id); f() } }
        switch t {
        case ..<2.5: s.update(speed: 0, lift: 0.4, side: 0, grounded: true, phase: .title)       // the title: pad, idle hiss
        case ..<5.5: s.update(speed: (t - 2.5) / 3 * 40, lift: 0, side: 0, grounded: true)      // the run-up
        case ..<8.0:                                                                           // airborne, jets
            once(1, at: 5.5) { s.release() }
            let k = min(1, (t - 5.5) / 0.4)
            s.update(speed: 40 - (t - 5.5) * 4, lift: 3.6 * k, side: t > 6.5 && t < 7.3 ? 4 : 0, grounded: false)
        case ..<10.5:
            once(2, at: 8.0) { s.thud(sink: 3.2) }
            s.update(speed: max(0, 30 - (t - 8) * 12), lift: 0, side: 0, grounded: true, grind: t > 9 && t < 10 ? 0.8 : 0)
            once(3, at: 9.0) { s.impact(speed: 9, part: .nose, seed: 77) }
            once(4, at: 9.6) { s.impact(speed: 13, part: .roof, seed: 191) }
        case ..<demoLength:
            s.update(speed: 0, lift: 0, side: 0, grounded: true)
            for i in 0..<4 { once(10 + i, at: 10.8 + Double(i) * 0.25) { s.chime(i) } }
            once(20, at: 12.3) { s.uiTap() }; once(21, at: 12.5) { s.uiTap() }
        default: return false
        }
        return true
    }

    // MARK: plumbing

    private func set(_ p: P, _ v: Double) {
        let f = v.isFinite ? Float(v) : 0
        params[p.rawValue].store(f.bitPattern, ordering: .relaxed)
    }
    private func pushMaster() { set(.master, isEnabled ? 0.8 * volume : 0) }

    /// Single producer (main thread). A one-shot with nothing to hear it (off, paused, backgrounded) is dropped, as the
    /// web's are when muted, so nothing stale fires on resume.
    private func post(_ e: SoundEvent) {
        guard isEnabled, offline || engine.isRunning else { return }
        let h = cursors[0].load(ordering: .relaxed), t = cursors[1].load(ordering: .acquiring)
        if h - t >= SynthCore.ringSize { return }
        ring[h & (SynthCore.ringSize - 1)] = e
        cursors[0].store(h + 1, ordering: .releasing)
    }

    private func connect(rate: Double) {
        if let s = source { engine.disconnectNodeOutput(s); engine.detach(s) }
        core.pointee.reconfigure(sr: rate)
        // Drop any one-shots queued for the old graph.
        cursors[1].store(cursors[0].load(ordering: .acquiring), ordering: .releasing)
        let c = core
        let node = AVAudioSourceNode { _, _, frameCount, abl -> OSStatus in
            let list = UnsafeMutableAudioBufferListPointer(abl)
            guard list.count > 0, let first = list[0].mData else { return noErr }
            let out = first.assumingMemoryBound(to: Float.self), n = Int(frameCount)
            c.pointee.render(out, n)
            if list.count > 1 {
                for b in 1..<list.count { if let d = list[b].mData { d.copyMemory(from: first, byteCount: n * 4) } }
            }
            return noErr
        }
        let fmt = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: fmt)
        source = node
    }

    private static func hardwareRate(_ e: AVAudioEngine) -> Double {
        let r = e.outputNode.outputFormat(forBus: 0).sampleRate
        return r > 0 ? r : 48000
    }

    private var wantsRunning: Bool { isEnabled && phase != .quiet && foreground && !interrupted }

    private func applyRunning() {
        if offline { return }
        if wantsRunning {
            guard !engine.isRunning else { return }
            #if os(iOS)
            try? AVAudioSession.sharedInstance().setActive(true)
            #endif
            engine.prepare()
            do { try engine.start(); if log { print("SOUND engine started") } } catch { print("SOUND engine failed: \(error)") }
        } else if engine.isRunning {
            engine.pause()
            if log { print("SOUND engine paused") }
        }
    }

    #if os(iOS)
    private static func configureSession() {
        let s = AVAudioSession.sharedInstance()
        do { try s.setCategory(.ambient, mode: .default, options: []) } catch { print("SOUND session: \(error)") }
        try? s.setPreferredIOBufferDuration(0.01)
    }
    #endif

    private func observe() {
        let nc = NotificationCenter.default
        func on(_ name: Notification.Name, _ object: Any? = nil, _ f: @escaping (Notification) -> Void) {
            observers.append(nc.addObserver(forName: name, object: object, queue: .main, using: f))
        }
        // A route or hardware-rate change stops the engine: reconnect at the new rate, then start again if wanted.
        on(.AVAudioEngineConfigurationChange, engine) { [weak self] _ in
            guard let self else { return }
            let r = Sound.hardwareRate(self.engine)
            if r != self.core.pointee.sr || !self.engine.isRunning {
                self.engine.stop(); self.connect(rate: r)
            }
            self.applyRunning()
        }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        on(AVAudioSession.interruptionNotification, session) { [weak self] n in
            guard let self, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began { self.interrupted = true; self.engine.pause() }
            else { self.interrupted = false; self.applyRunning() }   // .ambient: restart whether or not .shouldResume
        }
        on(AVAudioSession.routeChangeNotification, session) { [weak self] _ in self?.applyRunning() }
        on(AVAudioSession.mediaServicesWereResetNotification, session) { [weak self] _ in
            guard let self else { return }
            Sound.configureSession()
            self.engine = AVAudioEngine(); self.source = nil
            self.connect(rate: Sound.hardwareRate(self.engine))
            self.observers.forEach { nc.removeObserver($0) }; self.observers = []; self.observe()
            self.applyRunning()
        }
        on(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.foreground = false; self?.applyRunning() }
        on(UIApplication.willEnterForegroundNotification) { [weak self] _ in self?.foreground = true; self?.applyRunning() }
        #endif
    }
}
