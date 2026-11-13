// The sound's tools (0240), from launch flags (simulator and bench only; nothing here runs in normal play):
//   -sound demo                      the scripted demo, live (title, a drive over changing ground, a jump, a landing, hits)
//   -sound bench                     the same script rendered offline through the whole graph (bed, emitters, the
//                                    environment node, reverb, EQ, limiter): prints the cost as a share of one core, and
//                                    writes Documents/sound-bench.caf
//   -sound-capture <name> [-sound-capture-s 20] [-sound-capture-mute]
//                                    records the master (after the limiter) to Documents/<name>.caf once the engine runs;
//                                    -mute keeps the Mac's speakers quiet while it records
//   -sound-cpu                       the render callbacks' cost every 5 s (SoundFeed)
import AVFoundation
import ColdGasAudio
import QuartzCore
import Synchronization
import simd

enum SoundLab {
    static func startIfAsked() {
        let a = Launch.args
        if let i = a.firstIndex(of: "-sound"), i + 1 < a.count {
            switch a[i + 1] {
            case "demo": demo()
            case "bench": DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1) { bench() }
            default: break
            }
        }
        if let name = Launch.value("-sound-capture") { capture(name, seconds: Launch.value("-sound-capture-s").flatMap(Double.init) ?? 20, mute: a.contains("-sound-capture-mute")) }
    }

    // MARK: demo

    static let demoLength = 16.0
    static func demo() {
        let s = Sound.shared, t0 = CACurrentMediaTime()
        var fired = Set<Int>()
        Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
            if !demoFrame(s, t: CACurrentMediaTime() - t0, fired: &fired) { timer.invalidate(); s.update(speed: 0, lift: 0, side: 0, grounded: true, phase: .quiet) }
        }
        print("SOUND demo (\(Int(demoLength)) s)")
    }

    /// One frame of the scripted demo at `t` seconds; false when it's over.
    @discardableResult
    static func demoFrame(_ s: Sound, t: Double, fired: inout Set<Int>) -> Bool {
        func once(_ id: Int, at: Double, _ f: () -> Void) { if t >= at && !fired.contains(id) { fired.insert(id); f() } }
        var c = CarAudio()
        s.listen(eye: SIMD3(0, 1.6, -6), view: simd_float4x4(diagonal: SIMD4(1, 1, 1, 1)))
        switch t {
        case ..<2.0:
            s.ambience(trees: 0, crickets: 0.25, breeze: 0.25, crowd: 0)
            s.update(speed: 0, lift: 0, side: 0, grounded: true, phase: .title)
            return true
        case ..<6.0:                                                         // away on paving, then gravel, then grass
            s.ambience(trees: 0.7, crickets: 0.5, breeze: 0.5, crowd: 0.5)
            s.zone(t < 4.5 ? .open : .forest)
            let v = min(38, (t - 2) * 11)
            c.speed = v; c.spinHz = v / (2 * .pi * 0.367); c.motorHz = c.spinHz * 9; c.load = t < 5.2 ? 1 : 0
            if t >= 4.0 && t < 5.0 { c.paved = 0.15; c.gravel = 1 } else if t >= 5.0 { c.paved = 0; c.grass = 1 }
            c.slip = t > 2.1 && t < 2.6 ? 0.7 : 0
            once(1, at: 3.2) { s.passby(kind: 0, at: SIMD3(2.5, 1, 4), speed: v, dist: 3, seed: 5) }
            once(2, at: 3.6) { s.passby(kind: 1, at: SIMD3(-3, 1, 5), speed: v, dist: 3.5, seed: 6) }
            once(3, at: 4.4) { s.thump(0.7, pan: -1, seed: 9) }
            once(4, at: 5.5) { s.bird(kind: 0, at: SIMD3(-12, 8, 10), seed: 77) }
        case ..<9.5:                                                         // braking with regen, a slide, ABS, back on paving
            s.zone(.open)
            let v = max(5, 38 - (t - 6) * 9)
            c.speed = v; c.spinHz = v / (2 * .pi * 0.367); c.motorHz = c.spinHz * 9; c.load = -0.8
            c.abs = t > 6.8 && t < 8.2 ? 1 : 0; c.slip = t > 7.8 && t < 9 ? 0.8 : 0.1
        case ..<12.5:                                                        // the run-up, jets, airtime, landing
            s.zone(.set)
            let v = min(40, 8 + (t - 9.5) * 18)
            c.speed = v; c.spinHz = v / (2 * .pi * 0.367); c.motorHz = c.spinHz * 9; c.load = 1; c.concrete = 1
            once(10, at: 10.6) { s.release(); s.burst(bank: 0, k: 1, seed: 3); s.airborne(speed: v) }
            if t > 10.6 && t < 12.0 { c.grounded = 0; c.air = 1; c.lift = 3.6; c.load = 0; c.side = t > 11 && t < 11.5 ? 4 : 0 }
            once(11, at: 11.0) { s.burst(bank: 1, k: 0.8, seed: 4) }
            once(12, at: 11.5) { s.valveClose(bank: 1, k: 0.8, seed: 5) }
            once(13, at: 12.0) { s.valveClose(bank: 0, k: 1, seed: 6); s.land(sink: 3.4, paved: 1, seed: 7); s.cheer(0.7) }
        case ..<demoLength:                                                  // hits: a cone, a fence, a rail, the car
            s.zone(.open)
            let v = max(0, 20 - (t - 12.5) * 6)
            c.speed = v; c.spinHz = v / (2 * .pi * 0.367); c.motorHz = c.spinHz * 9; c.load = -0.4
            once(20, at: 12.7) { s.hit(.plastic, k: 0.6, at: SIMD3(1.5, 0.3, 3), seed: 21) }
            once(21, at: 13.3) { s.hit(.wood, k: 0.8, at: SIMD3(-2, 0.6, 4), seed: 22) }
            once(22, at: 14.0) { s.hit(.rail, k: 0.9, at: SIMD3(2.5, 0.5, 3), seed: 23) }
            c.grind = t > 14.0 && t < 14.8 ? 0.7 : 0
            once(23, at: 15.0) { s.impact(speed: 13, part: .roof, seed: 191, at: SIMD3(0, 0.8, 1), struck: true) }
        default: return false
        }
        s.drive(c)
        return true
    }

    // MARK: bench

    static func bench() {
        let sr = 48000.0, s = Sound(offlineRate: sr)
        var fired = Set<Int>(), out: [Float] = []
        out.reserveCapacity(Int(demoLength * sr * 2 * 4))
        let block = Int(sr / 60)
        var t = 0.0
        let rounds = 4
        let t0 = CACurrentMediaTime()
        _ = s.cpu()
        for _ in 0..<rounds {
            fired.removeAll(); t = 0
            while demoFrame(s, t: t, fired: &fired) { out.append(contentsOf: s.renderOffline(frames: block)); t += Double(block) / sr }
        }
        let wall = CACurrentMediaTime() - t0
        let audio = Double(out.count / 2) / sr
        let m = s.cpu()
        print(String(format: "SOUND bench: %.1f s of audio in %.0f ms: %.2f%% of one core for the whole graph; render callbacks %.2f%% (worst block %.0f µs)",
                     audio, wall * 1000, wall / audio * 100, m.percent, m.worstUs))
        // A peak and RMS for the record.
        var peak: Float = 0, sum = 0.0
        for x in out { peak = max(peak, abs(x)); sum += Double(x * x) }
        print(String(format: "SOUND bench: peak %.2f dBFS, RMS %.1f dBFS", 20 * log10(Double(max(peak, 1e-9))), 10 * log10(sum / Double(max(1, out.count)) + 1e-12)))
        write(out, sr: sr, name: "sound-bench")
        Ready.mark("sound-bench")
    }

    static func write(_ interleaved: [Float], sr: Double, name: String) {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("\(name).caf")
        guard let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2),
              let file = try? AVAudioFile(forWriting: url, settings: fmt.settings),
              let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(interleaved.count / 2)), let d = buf.floatChannelData else { return }
        let n = interleaved.count / 2
        for i in 0..<n { d[0][i] = interleaved[2 * i]; d[1][i] = interleaved[2 * i + 1] }
        buf.frameLength = AVAudioFrameCount(n)
        try? file.write(from: buf)
        print("SOUND wrote \(url.path)")
    }

    // MARK: capture

    /// The recording's state, shared by the tap's thread and the main thread's gate (it starts once a run or a drive is
    /// making sound, not on the title).
    private final class Take: @unchecked Sendable {
        let open = Atomic<Bool>(false)
        var file: AVAudioFile?, frames = 0.0, done = false
    }

    static func capture(_ name: String, seconds: Double, mute: Bool) {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("\(name).caf")
        try? FileManager.default.removeItem(at: url)
        let take = Take()
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { t in
            if Sound.shared.phase == .run { take.open.store(true, ordering: .relaxed); t.invalidate() }
        }
        Sound.shared.tapMaster(mute: mute) { buf in
            guard take.open.load(ordering: .relaxed), !take.done else { return }
            if take.file == nil { take.file = try? AVAudioFile(forWriting: url, settings: buf.format.settings, commonFormat: .pcmFormatFloat32, interleaved: false) }
            try? take.file?.write(from: buf)
            take.frames += Double(buf.frameLength)
            if take.frames >= seconds * buf.format.sampleRate {
                take.done = true; take.file = nil
                DispatchQueue.main.async { print("SOUND capture done \(url.path)"); Ready.mark("capture") }
            }
        }
        print("SOUND capture \(name) for \(Int(seconds)) s")
    }
}
