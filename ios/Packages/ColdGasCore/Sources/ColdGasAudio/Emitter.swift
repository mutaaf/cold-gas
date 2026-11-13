// The spatial emitters (0240): mono sources the environment node places in the world (HRTF on headphones, panned on a
// speaker, attenuated by distance, sent to the zone's reverb). Each one plays the positioned one-shots it's handed
// (material-aware impacts with their debris, pass-bys with their Doppler fall, birdsong) and the first one also carries
// the stunt set's crowd and PA hum, which follow the listener's motion in pitch.
//
// Real time: as the bed (trivial state in plain memory, atomics, a ring; no allocation).
import Foundation

/// What a thing is made of, as the ear hears it hit.
public enum HitMaterial: UInt8 {
    /// A car's shell (painted steel and aluminium, the glazing).
    case body
    /// A road cone, a water-fill barrier: hollow polyethylene.
    case plastic
    /// A timber fence bay.
    case wood
    /// A steel guard rail section: a long ring.
    case rail
    /// A sign plate on its post: a wobbling clang.
    case sign
    /// Concrete, rock, a boulder: a dead thud and grit.
    case stone
    /// Earth and grass: soft.
    case earth
}

public enum EmitterEvent: UInt8 { case impact, passby, bird, cheer }
/// The emitters' parameters.
public enum EP: Int, CaseIterable { case crowd, doppler, fx }

public struct EmitterCore {
    public var sr: Double
    let params: ParamBlock
    let ring: EventRing
    var pool: VoicePool
    let keys: ParamBlock
    let keySlot: Int
    let meter: RenderMeter
    // The set's crowd and PA (emitter 0 only).
    var crowd: Smooth, cheer = 0.0, cheerRate = 0.0, fx: Smooth
    var humPh = (0.0, 0.0, 0.0, 0.0)
    var bandA = SVF(), bandB = SVF(), bandC = SVF(), bandD = SVF()
    var amA = Drift(seed: 31, period: 0.22, ease: 0.09, sr: 48000), amB = Drift(seed: 37, period: 0.19, ease: 0.08, sr: 48000)
    var amC = Drift(seed: 41, period: 0.27, ease: 0.1, sr: 48000), swell = Drift(seed: 43, period: 2.5, ease: 1.2, sr: 48000)
    var noise = Xor(0x55aa55), pink = Pink(77)
    var doppler = 1.0, n = 0

    public init(sr: Double, params: ParamBlock, ring: EventRing, keys: ParamBlock, keySlot: Int, meter: RenderMeter) {
        self.sr = sr; self.params = params; self.ring = ring; self.keys = keys; self.keySlot = keySlot; self.meter = meter
        pool = VoicePool(count: 48)
        crowd = Smooth(0, tau: 0.8, sr: sr); fx = Smooth(1, tau: 0.05, sr: sr)
        noise = Xor(UInt32(0x55aa55 &+ keySlot &* 7919))
        reconfigure(sr: sr)
    }
    public func free() { pool.free() }

    public mutating func reconfigure(sr: Double) {
        self.sr = sr
        crowd.retime(tau: 0.8, sr: sr); fx.retime(tau: 0.05, sr: sr)
        amA = Drift(seed: 31, period: 0.22, ease: 0.09, sr: sr); amB = Drift(seed: 37, period: 0.19, ease: 0.08, sr: sr)
        amC = Drift(seed: 41, period: 0.27, ease: 0.1, sr: sr); swell = Drift(seed: 43, period: 2.5, ease: 1.2, sr: sr)
        cheerRate = 1 - exp(-1 / (1.6 * sr))
        pool.silence()
    }

    @inline(__always) mutating func spawn(_ s: VoicePool.Spec) { pool.spawn(s, sr: sr) }

    mutating func drain() {
        var t = ring.cursors[1].load()
        let h = ring.cursors[0].loadAcquire()
        while t < h {
            let e = ring.slots[t & (EventRing.size - 1)]
            switch EmitterEvent(rawValue: e.kind) {
            case .impact: startImpact(HitMaterial(rawValue: UInt8(e.a)) ?? .body, k: e.b, glass: e.c > 0.5, seed: e.seed)
            case .passby: startPassby(kind: Int(e.a), speed: e.b, dist: e.c, seed: e.seed)
            case .bird: startBird(kind: Int(e.a), seed: e.seed)
            case .cheer: cheer = max(cheer, min(1, e.a))
            case nil: break
            }
            t += 1
        }
        ring.cursors[1].storeRelease(t)
    }

    // MARK: impacts (modal: a few damped partials at the material's ratios, a noise transient, debris after)

    mutating func modes(_ f: Double, _ ratios: (Double, Double, Double, Double, Double), _ decay: Double, _ amp: Double, _ count: Int, _ r: inout Lcg, bright: Double) {
        for j in 0..<count {
            let ratio: Double
            switch j { case 0: ratio = ratios.0; case 1: ratio = ratios.1; case 2: ratio = ratios.2; case 3: ratio = ratios.3; default: ratio = ratios.4 }
            let fj = f * ratio * (1 + (r.unit() - 0.5) * 0.02)
            if fj > 12000 { continue }
            let a = amp * pow(0.62, Double(j)) * (j == 0 ? 1 : bright)
            let d = decay * pow(0.72, Double(j))
            // The pair beats a little (a real panel's degenerate modes).
            spawn(.init(wave: .sine, f0: fj, f1: fj, atk: 0.0008, peak: a, decEnd: d, stop: d + 0.03, amp2: 0.6, ratio2: 1.004 + r.unit() * 0.006, key: a))
        }
    }

    mutating func startImpact(_ m: HitMaterial, k: Double, glass: Bool, seed: Int64) {
        let g = min(1, max(0, k))
        var r = Lcg(s: max(1, (seed &* 16807) % 2147483647))
        let out = 0.3 + 0.7 * g
        switch m {
        case .body:
            // The shell: a thump of mass, a crack, panels ringing, folding metal; glass if it went.
            spawn(.init(wave: .sine, f0: 95 + 40 * g, f1: 34, glide: 0.25, atk: 0.001, peak: 0.8 * out, decEnd: 0.35 + 0.3 * g, stop: 0.7, amp2: 0.35, ratio2: 2, key: out))
            spawn(.init(wave: .noise, filter: .lowpass, ff: 1100 + 5000 * g, fq: 0.8, g0: 0.6 * out, peak: 0.6 * out, decEnd: 0.15 + 0.3 * g, stop: 0.6, rate: 0.7 + 0.5 * r.unit(), seed: seed))
            modes(170 + 160 * r.unit(), (1, 2.76, 5.40, 8.93, 13.34), 0.22 + 0.4 * g, 0.22 * out, 3 + Int(2 * g), &r, bright: 0.5 + 0.5 * g)
            let parts = 2 + Int((3 * g).rounded())
            for i in 0..<parts {
                let f = 140 + r.unit() * 900 * (0.6 + g), d = 0.06 + r.unit() * 0.3 * (0.4 + g)
                spawn(.init(wave: i % 2 == 1 ? .triangle : .square, f0: f, f1: f * (0.55 + r.unit() * 0.3), glide: 0.4, filter: .bandpass, ff: f * 1.5, fq: 6,
                            atk: 0.004 + r.unit() * 0.03, peak: 0.4 * out, decEnd: d, stop: d + 0.08))
            }
            if glass {
                spawn(.init(wave: .noise, filter: .highpass, ff: 3500, fq: 1, g0: 0.5 * out, peak: 0.5 * out, decEnd: 0.12, stop: 0.15, seed: seed &+ 9))
                for _ in 0..<Int(8 + 8 * g) {
                    let f = 2800 + r.unit() * 5200, at = 0.03 + r.unit() * (0.35 + 0.4 * g), len = 0.05 + r.unit() * 0.12
                    spawn(.init(wave: .sine, f0: f, f1: f, delay: at, atk: 0.003, peak: (0.06 + r.unit() * 0.07) * out, decEnd: len, stop: len + 0.12))
                }
            }
            debris(g, &r, out, f: 2600, spread: 0.7, low: 0)
        case .plastic:
            // Hollow polyethylene: a bonk, a cough of air from inside, then it bounces and rolls.
            let f = 300 + 180 * r.unit()
            spawn(.init(wave: .sine, f0: 150, f1: 70, glide: 0.07, atk: 0.001, peak: 0.45 * out, decEnd: 0.09, stop: 0.12, amp2: 0.4, ratio2: 2, key: out))
            modes(f, (1, 1.58, 2.31, 3.1, 4.2), 0.09, 0.3 * out, 3, &r, bright: 0.7)
            spawn(.init(wave: .noise, filter: .bandpass, ff: 620, fq: 2, atk: 0.001, peak: 0.25 * out, decEnd: 0.07, stop: 0.09, seed: seed))
            var t = 0.16 + 0.1 * g, a = 0.55
            for _ in 0..<(2 + Int(3 * g)) {
                spawn(.init(wave: .sine, f0: f * 0.97, f1: f * 0.9, glide: 0.04, delay: t, atk: 0.001, peak: 0.22 * a * out, decEnd: 0.05, stop: 0.07, amp2: 0.5, ratio2: 1.58))
                spawn(.init(wave: .noise, filter: .bandpass, ff: 700, fq: 2, delay: t, atk: 0.001, peak: 0.12 * a * out, decEnd: 0.04, stop: 0.05, seed: seed &+ Int64(t * 1000)))
                t += (0.18 + 0.12 * r.unit()) * a; a *= 0.6
            }
        case .wood:
            // Timber: a crack, the boards' short knock, splinters, the bay falling.
            spawn(.init(wave: .noise, filter: .highpass, ff: 1600, fq: 0.7, atk: 0.0005, peak: 0.7 * out, decEnd: 0.025, stop: 0.04, seed: seed, key: out))
            spawn(.init(wave: .sine, f0: 130, f1: 60, glide: 0.1, atk: 0.001, peak: 0.5 * out, decEnd: 0.14, stop: 0.18, amp2: 0.35, ratio2: 2, key: out))
            modes(230 + 150 * r.unit(), (1, 2.3, 3.9, 5.2, 7.1), 0.11, 0.25 * out, 4, &r, bright: 0.6)
            spawn(.init(wave: .crackle, filter: .bandpass, ff: 2800, fq: 1.2, atk: 0.002, peak: 0.35 * out, decEnd: 0.35, stop: 0.4, seed: seed &+ 3, density: 0.03))
            debris(g, &r, out, f: 900, spread: 0.6, low: 200)
        case .rail:
            // Steel: a bang that rings on, a boom under it, the bolts.
            spawn(.init(wave: .noise, filter: .bandpass, ff: 1300, fq: 0.8, atk: 0.0005, peak: 0.6 * out, decEnd: 0.08, stop: 0.1, seed: seed, key: out))
            spawn(.init(wave: .sine, f0: 78, f1: 52, glide: 0.3, atk: 0.001, peak: 0.45 * out, decEnd: 0.45, stop: 0.5, amp2: 0.4, ratio2: 2, key: out))
            modes(135 + 70 * r.unit(), (1, 2.32, 4.25, 6.63, 9.38), 0.9 + 0.7 * g, 0.2 * out, 5, &r, bright: 0.8)
            for _ in 0..<(2 + Int(3 * g)) {
                let f = 2800 + 1800 * r.unit(), at = 0.05 + r.unit() * 0.6
                spawn(.init(wave: .sine, f0: f, f1: f, delay: at, atk: 0.001, peak: 0.05 * out, decEnd: 0.12, stop: 0.15, amp2: 0.4, ratio2: 2.7))
            }
        case .sign:
            // A sign plate: a clang that wobbles as the plate flaps.
            spawn(.init(wave: .noise, filter: .bandpass, ff: 2000, fq: 1, atk: 0.0005, peak: 0.45 * out, decEnd: 0.05, stop: 0.07, seed: seed, key: out))
            spawn(.init(wave: .square, f0: 310, f1: 290, glide: 0.5, filter: .bandpass, ff: 620, fq: 4, atk: 0.001, peak: 0.25 * out, decEnd: 0.5, stop: 0.55, amp2: 0.9, ratio2: 1.035))
            modes(480 + 120 * r.unit(), (1, 2.1, 3.6, 5.3, 7.4), 0.4, 0.15 * out, 4, &r, bright: 0.7)
            debris(g * 0.5, &r, out, f: 1200, spread: 0.4, low: 0)
        case .stone:
            // A dead thud, a crunch of grit, small stones after.
            spawn(.init(wave: .sine, f0: 85, f1: 42, glide: 0.2, atk: 0.001, peak: 0.6 * out, decEnd: 0.25, stop: 0.3, amp2: 0.3, ratio2: 2, key: out))
            spawn(.init(wave: .noise, filter: .lowpass, ff: 700 + 1400 * g, fq: 0.7, atk: 0.001, peak: 0.45 * out, decEnd: 0.18, stop: 0.22, seed: seed))
            spawn(.init(wave: .crackle, filter: .bandpass, ff: 2200, fq: 1, atk: 0.002, peak: 0.3 * out, decEnd: 0.45, stop: 0.5, seed: seed &+ 5, density: 0.04))
        case .earth:
            spawn(.init(wave: .sine, f0: 70, f1: 40, glide: 0.15, atk: 0.003, peak: 0.45 * out, decEnd: 0.2, stop: 0.25, amp2: 0.3, ratio2: 2, key: out * 0.7))
            spawn(.init(wave: .noise, filter: .lowpass, ff: 500, fq: 0.7, atk: 0.003, peak: 0.35 * out, decEnd: 0.25, stop: 0.3, seed: seed))
            spawn(.init(wave: .crackle, filter: .lowpass, ff: 1600, fq: 0.7, atk: 0.004, peak: 0.25 * out, decEnd: 0.5, stop: 0.55, seed: seed &+ 5, density: 0.06))
        }
    }

    /// Pieces coming down after a hit: knocks and clicks at falling, irregular intervals.
    mutating func debris(_ g: Double, _ r: inout Lcg, _ out: Double, f: Double, spread: Double, low: Double) {
        let count = 2 + Int(6 * g)
        var t = 0.1 + r.unit() * 0.08
        for i in 0..<count {
            let a = (0.14 + 0.16 * g) * pow(0.8, Double(i)) * (0.6 + 0.4 * r.unit()) * out
            spawn(.init(wave: .crackle, filter: .bandpass, ff: f * (1 - spread / 2 + spread * r.unit()), fq: 2.5, delay: t, atk: 0.001, peak: a, decEnd: 0.03 + 0.05 * r.unit(),
                        stop: 0.09, seed: Int64(r.unit() * 1e6) + 3, density: 0.35))
            if low > 0 { spawn(.init(wave: .sine, f0: low * (0.8 + 0.5 * r.unit()), f1: low * 0.7, glide: 0.05, delay: t, atk: 0.001, peak: a * 0.8, decEnd: 0.06, stop: 0.08, amp2: 0.3, ratio2: 2.4)) }
            t += 0.05 + r.unit() * 0.16 * (1 + Double(i) * 0.3)
        }
    }

    // MARK: pass-bys (the emitter stands at the thing; the env node pans it past; the pitch falls through closest approach)

    /// kind: 0 a trunk, 1 a post or sign, 2 a rail section, 3 a parked car.
    mutating func startPassby(kind: Int, speed: Double, dist: Double, seed: Int64) {
        let c = 343.0, v = min(80, speed)
        let up = c / (c - v * 0.9), down = c / (c + v * 0.9)
        let tau = max(0.03, min(0.5, dist / max(v, 1)))      // the time it's alongside
        let f0: Double, q: Double, gain: Double
        switch kind {
        case 0: f0 = 520; q = 1.2; gain = 0.32
        case 1: f0 = 1300; q = 2.2; gain = 0.22
        case 2: f0 = 900; q = 1.6; gain = 0.14
        default: f0 = 420; q = 1.0; gain = 0.4
        }
        let g = gain * min(1, v / 30) * min(1, 3 / max(1, dist))
        spawn(.init(wave: .noise, atk: tau * 1.6, peak: g, decEnd: tau * 2.4, stop: tau * 2.6, rate: 1, seed: seed,
                    sweepF0: f0 * up, sweepF1: f0 * down, sweepAt: tau * 1.2, sweepDur: tau * 0.9, sweepQ: q))
        if kind == 1 || kind == 2 {
            // The air slapped off a post: a tick at closest approach.
            spawn(.init(wave: .noise, filter: .bandpass, ff: 2600, fq: 1.5, delay: tau * 1.6, atk: 0.002, peak: g * 0.6, decEnd: 0.03, stop: 0.04, seed: seed &+ 1))
        }
    }

    // MARK: birdsong

    /// kind 0: a songbird's phrase; 1: a gull's call (the coast); 2: a single dusk alarm chip.
    mutating func startBird(kind: Int, seed: Int64) {
        var r = Lcg(s: max(1, seed % 2147483647))
        switch kind {
        case 1:
            var t = 0.0
            for _ in 0..<(2 + Int(3 * r.unit())) {
                let f = 1150 + 300 * r.unit(), d = 0.18 + 0.12 * r.unit()
                spawn(.init(wave: .sawtooth, f0: f, f1: f * 0.72, glide: d, filter: .bandpass, ff: 1700, fq: 1.4, delay: t, atk: 0.02, peak: 0.07, decEnd: d, stop: d + 0.03))
                t += d + 0.06 + 0.1 * r.unit()
            }
        case 2:
            let f = 3800 + 900 * r.unit()
            for i in 0..<(1 + Int(2 * r.unit())) {
                spawn(.init(wave: .sine, f0: f, f1: f * 0.8, glide: 0.03, delay: Double(i) * 0.16, atk: 0.002, peak: 0.07, decEnd: 0.035, stop: 0.04, amp2: 0.15, ratio2: 2))
            }
        default:
            var t = 0.0
            let base = 2600 + 1800 * r.unit()
            for _ in 0..<(3 + Int(5 * r.unit())) {
                let up = r.unit() < 0.5, d = 0.04 + 0.08 * r.unit()
                let f0 = base * (0.8 + 0.5 * r.unit()), f1 = up ? f0 * (1.2 + 0.4 * r.unit()) : f0 * (0.6 + 0.2 * r.unit())
                spawn(.init(wave: .sine, f0: f0, f1: f1, glide: d, delay: t, atk: 0.005, peak: 0.05 + 0.04 * r.unit(), decEnd: d, stop: d + 0.02, amp2: 0.12, ratio2: 2))
                t += d + 0.03 + 0.09 * r.unit()
            }
        }
    }

    // MARK: render

    public mutating func render(_ out: UnsafeMutablePointer<Float>, _ frames: Int) {
        let t0 = mach_absolute_time()
        crowd.target = params.get(EP.crowd.rawValue)
        fx.target = params.get(EP.fx.rawValue)
        let dp = params.get(EP.doppler.rawValue)
        doppler = dp > 0.5 && dp < 2 ? dp : 1
        drain()
        let sr = self.sr, isr = 1 / sr
        var keyMax = 0.0
        for i in 0..<frames {
            n &+= 1
            var y = 0.0
            let cw = crowd.step(), fg = fx.step()
            if cw > 1e-4 || cheer > 1e-4 {
                // The set: mains hum through the PA, a crowd's murmur in three formant-ish bands, a cheer that swells.
                cheer -= cheer * cheerRate
                if (n & 15) == 0 {
                    bandA.tune(480 * doppler, q: 2.4, sr); bandB.tune(1150 * doppler, q: 2.6, sr)
                    bandC.tune(2400 * doppler, q: 2.8, sr); bandD.tune(3300 * doppler, q: 1.5, sr)
                }
                let f = 60 * doppler * isr
                humPh.0 += 2 * f; humPh.1 += 3 * f; humPh.2 += 4 * f; humPh.3 += 6 * f
                if humPh.0 >= 1 { humPh.0 -= 1 }; if humPh.1 >= 1 { humPh.1 -= 1 }; if humPh.2 >= 1 { humPh.2 -= 1 }; if humPh.3 >= 1 { humPh.3 -= 1 }
                let hum = sin2pi(humPh.0) + 0.6 * sin2pi(humPh.1) + 0.35 * sin2pi(humPh.2) + 0.2 * sin2pi(humPh.3)
                let sw = swell.step()
                let p = pink.next(), w = noise.next()
                let mur = bandA.bp(p) * amA.step() + bandB.bp(p) * amB.step() * 0.8 + bandC.bp(w) * amC.step() * 0.25
                let ch = bandD.bp(w) * cheer
                y += hum * 0.018 * cw + mur * cw * (0.5 + 0.5 * sw) * (1 + 3 * cheer) * 0.9 + ch * 0.5
            }
            var key = 0.0
            for j in 0..<pool.count where pool.voices[j].on {
                y += pool.voices[j].sample(sr)
                key += pool.voices[j].level
            }
            keyMax = max(keyMax, key)
            y *= fg
            let a = abs(y)
            if a > 0.85 { y = (y < 0 ? -1 : 1) * (0.85 + 0.13 * tanh((a - 0.85) / 0.13)) }
            if !y.isFinite { y = 0; pool.silence(); bandA.clear(); bandB.clear(); bandC.clear(); bandD.clear() }
            out[i] = Float(y)
        }
        keys.set(keySlot, keyMax)
        meter.add(busy: mach_absolute_time() - t0, frames: 0)
    }
}
