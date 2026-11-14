// The game's sound (0154 ported src/audio.js; 0250 made it a car's). All synthesised on the device, no sample files.
//
// The graph (AVAudioEngine):
//   bed (stereo AVAudioSourceNode: Bed.swift)  ── reverb (the zone's, on the car too) ─┐
//   emitters ×8 (mono AVAudioSourceNodes: Emitter.swift) → environment (HRTF/pan,     ├→ submix → EQ (a phone speaker's
//                                                 distance, the zone's reverb)       ─┘   voicing) → peak limiter → out
// The bed carries what rides with the car and the camera: the drivetrain (motor and gear orders, inverter, regen), the
// tyres by surface, the squeal, wind, suspension, ABS, the jets, the ambience bed, the title's music and the UI. The
// emitters are placed in the world: impacts by material at their contact point, pass-bys with their Doppler fall,
// birdsong round the listener, and the stunt set's crowd and PA hum (Doppler-shifted by the listener's motion).
// Impacts and the UI duck the beds (a side-chain key the emitters publish); a peak limiter holds the master.
//
// API (main thread only):
//   drive(_ CarAudio)                 once a display frame in a run, a replay or a drive (SoundFeed builds it)
//   update(speed:throttles:grounded:grind:phase:)   the old one-line form (the title, a pause, a plain replay)
//   thud(sink:) · land(sink:paved:)   a touchdown · impact(speed:part:seed:at:) a contact from the crash's events
//   hit(_ HitMaterial, k:, at:, seed:)   a struck world object · crunch(severity:glass:seed:) · release() · uiTap() · chime()
//   listen(eye:view:)                 the camera, once a frame (the renderer)
//   zone(_ Zone) · ambience(...)      reverb zones and the ambient bed (SoundFeed)
//   setEnabled / music / effects      Settings (persisted); `isEnabled`, `volume`
//   cpu                               the render callbacks' cost (`-sound-cpu` prints it every 5 s)
//
// Session: .ambient (the silent switch silences it; other apps' audio keeps playing, and while another app is playing
// our music steps aside: the secondary-audio hint). Interruptions, media-server resets, route and rate changes are
// handled; the background stops the engine.
import AVFoundation
import ColdGasAudio
import Synchronization
import QuartzCore
import simd
#if canImport(UIKit)
import UIKit
#endif

/// One frame of the car as the sound hears it (main thread → Sound.drive). Everything is read from existing state.
struct CarAudio {
    var speed = 0.0, motorHz = 0.0, load = 0.0, spinHz = 0.0, split = 1.0
    var grounded = 1.0, slip = 0.0, slipLong = 0.0, rough = 0.0, abs = 0.0
    var paved = 1.0, gravel = 0.0, grass = 0.0, wet = 0.0, concrete = 0.0, deck = 0.0
    var lift = 0.0, side = 0.0, grind = 0.0, air = 0.0
}

/// Where the listener is, for the reverb.
enum Zone: Int { case open, forest, canyon, set, under }

final class Sound {
    enum Phase { case title, run, quiet }
    /// render/crash.js's PART, as far as the sound cares.
    enum Part { case wheel, nose, tail, roof, side, floor }

    static let shared = Sound()
    static let emitterCount = 8

    private(set) var isEnabled: Bool
    var volume: Double = 1 { didSet { volume = min(1, max(0, volume)); pushGains() } }
    /// Settings' sliders (0…1, persisted).
    var music: Double { didSet { music = min(1, max(0, music)); if !offline { UserDefaults.standard.set(music, forKey: "coldgas.music") }; pushGains() } }
    var effects: Double { didSet { effects = min(1, max(0, effects)); if !offline { UserDefaults.standard.set(effects, forKey: "coldgas.effects") }; pushGains() } }
    private(set) var phase: Phase = .quiet
    private(set) var zone: Zone = .open
    var log = false

    private var engine = AVAudioEngine()
    private var bedNode: AVAudioSourceNode?
    private var emitNodes: [AVAudioSourceNode] = []
    private var env = AVAudioEnvironmentNode()
    private var bedVerb = AVAudioUnitReverb()
    private var submix = AVAudioMixerNode()
    private var eq = AVAudioUnitEQ(numberOfBands: 3)
    private var limiter: AVAudioUnitEffect
    private let bed: UnsafeMutablePointer<BedCore>
    private let emitters: UnsafeMutablePointer<EmitterCore>
    private let bedParams = ParamBlock(count: BP.allCases.count)
    private let bedRing = EventRing()
    private let emitParams: [ParamBlock]
    private let emitRings: [EventRing]
    private let keys = ParamBlock(count: Sound.emitterCount)
    let meter = RenderMeter()
    private let offline: Bool
    private var foreground = true, interrupted = false, otherAudio = false, speaker = false
    private var observers: [NSObjectProtocol] = []
    private var emitUsed = [Double](repeating: 0, count: Sound.emitterCount)
    private var lastLand = -10.0
    private var listener = SIMD3<Float>(0, 0, 0), listenerVel = SIMD3<Float>(0, 0, 0)

    /// The app's player. `offlineRate` (the bench, the harness) renders by hand: no session, no hardware.
    init(offlineRate: Double? = nil) {
        offline = offlineRate != nil
        let d = UserDefaults.standard
        isEnabled = offline ? true : !d.bool(forKey: "coldgas.muted")
        music = offline ? 1 : (d.object(forKey: "coldgas.music") as? Double ?? 1)
        effects = offline ? 1 : (d.object(forKey: "coldgas.effects") as? Double ?? 1)
        emitParams = (0..<Sound.emitterCount).map { _ in ParamBlock(count: EP.allCases.count) }
        emitRings = (0..<Sound.emitterCount).map { _ in EventRing() }
        limiter = Sound.makeLimiter()
        #if os(iOS)
        if !offline { Sound.configureSession() }
        #endif
        let rate = offlineRate ?? Sound.hardwareRate(engine)
        bed = .allocate(capacity: 1)
        bed.initialize(to: BedCore(sr: rate, params: bedParams, ring: bedRing, keys: keys, meter: meter))
        emitters = .allocate(capacity: Sound.emitterCount)
        for i in 0..<Sound.emitterCount {
            (emitters + i).initialize(to: EmitterCore(sr: rate, params: emitParams[i], ring: emitRings[i], keys: keys, keySlot: i, meter: meter))
            emitParams[i].set(EP.doppler.rawValue, 1)
        }
        bedParams.set(BP.split.rawValue, 1); bedParams.set(BP.paved.rawValue, 1); bedParams.set(BP.grounded.rawValue, 1)
        pushGains()
        #if os(iOS)
        if !offline { otherAudio = AVAudioSession.sharedInstance().secondaryAudioShouldBeSilencedHint; pushGains() }
        #endif
        if let r = offlineRate {
            let fmt = AVAudioFormat(standardFormatWithSampleRate: r, channels: 2)!
            try? engine.enableManualRenderingMode(.offline, format: fmt, maximumFrameCount: 4096)
            connect(rate: r)
            try? engine.start()
        } else {
            connect(rate: rate)
            observe()
            routeChanged()
        }
    }
    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        engine.stop()
        bed.pointee.free(); bed.deinitialize(count: 1); bed.deallocate()
        for i in 0..<Sound.emitterCount { emitters[i].free() }
        emitters.deinitialize(count: Sound.emitterCount); emitters.deallocate()
        bedParams.free(); bedRing.free(); keys.free(); meter.free()
        emitParams.forEach { $0.free() }; emitRings.forEach { $0.free() }
    }

    // MARK: - API: continuous

    /// The car this frame (a run, a replay, a drive).
    func drive(_ c: CarAudio, phase: Phase = .run) {
        let p = bedParams
        p.set(BP.speed.rawValue, c.speed); p.set(BP.motorHz.rawValue, c.motorHz); p.set(BP.load.rawValue, c.load)
        p.set(BP.spinHz.rawValue, c.spinHz); p.set(BP.split.rawValue, c.split); p.set(BP.grounded.rawValue, c.grounded)
        p.set(BP.slip.rawValue, c.slip); p.set(BP.slipLong.rawValue, c.slipLong); p.set(BP.rough.rawValue, c.rough)
        p.set(BP.abs.rawValue, c.abs); p.set(BP.paved.rawValue, c.paved); p.set(BP.gravel.rawValue, c.gravel)
        p.set(BP.grass.rawValue, c.grass); p.set(BP.wet.rawValue, c.wet); p.set(BP.concrete.rawValue, c.concrete)
        p.set(BP.deck.rawValue, c.deck); p.set(BP.lift.rawValue, c.lift); p.set(BP.side.rawValue, c.side)
        p.set(BP.grind.rawValue, c.grind); p.set(BP.air.rawValue, c.air)
        p.set(BP.title.rawValue, phase == .title ? 1 : 0)
        setPhase(phase)
    }

    /// The old form: speed alone stands for the drivetrain (the title, a pause, a plain replay). `throttles` is the ten
    /// valves (0…1): [0..3] the lift bank, [4..9] the side bank.
    func update(speed: Double, throttles: [Double], grounded: Bool, grind: Double = 0, phase: Phase = .run) {
        var lift = 0.0, side = 0.0
        for i in 0..<throttles.count { if i < 4 { lift += throttles[i] } else { side += throttles[i] } }
        update(speed: speed, lift: lift, side: side, grounded: grounded, grind: grind, phase: phase)
    }
    func update(speed: Double, lift: Double, side: Double, grounded: Bool, grind: Double = 0, phase: Phase = .run) {
        var c = CarAudio()
        c.speed = speed; c.lift = lift; c.side = side; c.grind = grind; c.grounded = grounded ? 1 : 0
        c.spinHz = speed / (2 * .pi * 0.36)
        c.motorHz = c.spinHz * 9
        c.load = speed > 0.5 ? 0.25 : 0
        c.concrete = 0
        drive(c, phase: phase)
    }

    /// The ambient bed: wind in the trees (0…1), crickets (0…1), a breeze (0…1); and the set's crowd (0…1, on emitter 0).
    func ambience(trees: Double, crickets: Double, breeze: Double, crowd: Double) {
        bedParams.set(BP.trees.rawValue, trees); bedParams.set(BP.crickets.rawValue, crickets); bedParams.set(BP.breeze.rawValue, breeze)
        emitParams[0].set(EP.crowd.rawValue, crowd)
    }
    /// The set's crowd stands at `at` (render space).
    func placeCrowd(at p: SIMD3<Float>) {
        guard emitNodes.count > 0 else { return }
        emitNodes[0].position = AVAudio3DPoint(x: p.x, y: p.y, z: p.z)
        // Doppler: the listener's speed toward it raises the pitch.
        let d = p - listener, l = simd_length(d)
        let vr = l > 1 ? simd_dot(listenerVel, d / l) : 0
        emitParams[0].set(EP.doppler.rawValue, Double(343 / max(200, 343 - vr)))
    }

    /// The camera (render space), once a frame: the listener, and the source of the listener's motion.
    func listen(eye: SIMD3<Float>, view: simd_float4x4, dt: Double = 1.0 / 60) {
        guard !offline || emitNodes.count > 0 else { return }
        let fwd = SIMD3<Float>(-view.columns.0.z, -view.columns.1.z, -view.columns.2.z)
        let up = SIMD3<Float>(view.columns.0.y, view.columns.1.y, view.columns.2.y)
        if dt > 0 {
            let v = (eye - listener) / Float(dt)
            // A camera cut (or the drive's origin moving) isn't motion.
            listenerVel = simd_length(v) < 120 ? listenerVel + (v - listenerVel) * 0.2 : listenerVel
        }
        listener = eye
        env.listenerPosition = AVAudio3DPoint(x: eye.x, y: eye.y, z: eye.z)
        env.listenerVectorOrientation = AVAudio3DVectorOrientation(forward: AVAudio3DVector(x: fwd.x, y: fwd.y, z: fwd.z), up: AVAudio3DVector(x: up.x, y: up.y, z: up.z))
    }
    var listenerPos: SIMD3<Float> { listener }

    /// A reverb zone: open air, among trees, a canyon's walls, the stunt set, under a deck or a bridge.
    func zone(_ z: Zone) {
        guard z != zone || emitNodes.isEmpty else { return }
        zone = z
        let preset: AVAudioUnitReverbPreset, blend: Float, wet: Float, level: Float
        switch z {
        case .open: preset = .mediumHall; blend = 0.06; wet = 0; level = -14
        case .forest: preset = .mediumRoom; blend = 0.18; wet = 6; level = -8
        case .canyon: preset = .largeHall2; blend = 0.38; wet = 16; level = -3
        case .set: preset = .largeHall; blend = 0.22; wet = 8; level = -6
        case .under: preset = .largeChamber; blend = 0.5; wet = 22; level = -2
        }
        env.reverbParameters.enable = true
        env.reverbParameters.loadFactoryReverbPreset(preset)
        env.reverbParameters.level = level
        for (i, n) in emitNodes.enumerated() where i > 0 { n.reverbBlend = blend }
        if !emitNodes.isEmpty { emitNodes[0].reverbBlend = max(0.25, blend) }
        bedVerb.loadFactoryPreset(z == .under ? .mediumChamber : z == .canyon ? .largeHall : .mediumRoom)
        bedVerb.wetDryMix = wet
        bedVerb.bypass = wet == 0
        if log { print("SOUND zone \(z)") }
    }

    // MARK: - API: one-shots

    /// A touchdown at `sink` m/s (render/impact.js's landingImpact()).
    func thud(sink: Double) { land(sink: sink, paved: 1) }
    /// A touchdown at `sink` m/s on paving (`paved` 1) or not: the body, the suspension, a tyre's bark, a rattle.
    func land(sink: Double, paved: Double, seed: Int = 1) {
        lastLand = CACurrentMediaTime()
        postBed(SoundEvent(kind: BedEvent.land.rawValue, a: sink, b: paved, seed: Int64(seed)))
    }
    /// thud({ thudHz, thudGain, thudDecay, crunch }) as the web takes it (defaults as audio.js's).
    func thud(hz: Double = 110, gain: Double = 0.45, decay: Double = 0.4, crunch: Double = 0) {
        postBed(SoundEvent(kind: BedEvent.thud.rawValue, a: hz, b: gain, c: decay, d: crunch))
    }
    /// One contact at `speed` m/s, as render/crash.js sounds it. `seed` makes a replayed impact sound the same. `at`
    /// (render space) places a body hit in the world; `struck` says it hit another car rather than the ground.
    func impact(speed v: Double, part: Part, seed: Int = 1, at: SIMD3<Float>? = nil, struck: Bool = false) {
        if part == .wheel {
            // A landing already said it.
            if v > 5 && CACurrentMediaTime() - lastLand > 0.2 { thud() }
            return
        }
        if v < 1.6 { return }
        let sev = min(1, max(0, (v - 2) / 12)), glass = (part == .roof || part == .side) && v > 5
        guard let p = at else { crunch(severity: sev, glass: glass, seed: seed); return }
        // The car's own crunch rides with it; what it struck answers from where it was struck.
        crunch(severity: sev * 0.75, glass: glass, seed: seed)
        hit(struck ? .body : .stone, k: sev, at: p, seed: seed &+ 7)
    }
    /// The car's body striking something at `at` (render space), from the crash's HIT events: the car's own crunch, and
    /// what it struck answering in its material (another car's shell, or the world's thing there: a trunk, a rail…).
    func bodyHit(severity: Double, glass: Bool, seed: Int, at p: SIMD3<Float>, struck: Bool) {
        crunch(severity: severity * 0.8, glass: glass, seed: seed)
        let m: HitMaterial = struck ? .body : SoundFeed.shared.material(at: p)
        hit(m, k: severity, at: p, seed: seed &+ 7)
    }
    func crunch(severity: Double, glass: Bool = false, seed: Int = 1) {
        postBed(SoundEvent(kind: BedEvent.crunch.rawValue, a: severity, b: glass ? 1 : 0, seed: Int64(truncatingIfNeeded: seed)))
    }
    /// A world object struck at `at` (render space), `k` 0…1 by impulse.
    func hit(_ m: HitMaterial, k: Double, at: SIMD3<Float>, seed: Int = 1, glass: Bool = false) {
        postEmitter(at: at, SoundEvent(kind: EmitterEvent.impact.rawValue, a: Double(m.rawValue), b: k, c: glass ? 1 : 0, seed: Int64(truncatingIfNeeded: seed)), hold: 1.2)
    }
    /// Passing a thing at `speed` m/s, `dist` m from it (kind: 0 trunk, 1 post/sign, 2 rail, 3 a parked car).
    func passby(kind: Int, at: SIMD3<Float>, speed: Double, dist: Double, seed: Int) {
        postEmitter(at: at, SoundEvent(kind: EmitterEvent.passby.rawValue, a: Double(kind), b: speed, c: dist, seed: Int64(seed)), hold: 0.6)
    }
    /// A bird calls from `at` (kind: 0 songbird, 1 gull, 2 a dusk chip).
    func bird(kind: Int, at: SIMD3<Float>, seed: Int) {
        postEmitter(at: at, SoundEvent(kind: EmitterEvent.bird.rawValue, a: Double(kind), seed: Int64(seed)), hold: 1.0)
    }
    /// The set's crowd answers a landing (0…1).
    func cheer(_ k: Double) { postEmitterIndex(0, SoundEvent(kind: EmitterEvent.cheer.rawValue, a: k)) }

    func release() { postBed(SoundEvent(kind: BedEvent.release.rawValue)) }
    /// A jet bank opening (bank 0 lift, 1 side) with strength `k` 0…1.
    func burst(bank: Int, k: Double, seed: Int) { postBed(SoundEvent(kind: BedEvent.burst.rawValue, a: Double(bank), b: k, seed: Int64(seed))) }
    func valveClose(bank: Int, k: Double, seed: Int) { postBed(SoundEvent(kind: BedEvent.close.rawValue, a: Double(bank), b: k, seed: Int64(seed))) }
    func airborne(speed: Double) { postBed(SoundEvent(kind: BedEvent.airStart.rawValue, a: speed)) }
    /// A corner's suspension over a bump (k 0…1; pan −1 left … +1 right).
    func thump(_ k: Double, pan: Double, seed: Int) { postBed(SoundEvent(kind: BedEvent.thump.rawValue, a: k, b: pan, seed: Int64(seed))) }
    func chirp(_ k: Double) { postBed(SoundEvent(kind: BedEvent.chirp.rawValue, a: k)) }
    func splash(_ k: Double, seed: Int) { postBed(SoundEvent(kind: BedEvent.splash.rawValue, a: k, seed: Int64(seed))) }
    func uiTap() { postBed(SoundEvent(kind: BedEvent.tick.rawValue)) }
    func chime(_ i: Int = 0) { postBed(SoundEvent(kind: BedEvent.chime.rawValue, a: Double(i))) }

    func setEnabled(_ on: Bool) {
        isEnabled = on
        if !offline { UserDefaults.standard.set(!on, forKey: "coldgas.muted") }
        pushGains(); applyRunning()
    }

    // MARK: - CPU

    /// The render callbacks' cost: the share of one core they took over the audio rendered since the last call, and the
    /// worst block in µs. (Apple's environment node, reverb and limiter run outside these callbacks.)
    func cpu(reset: Bool = true) -> (percent: Double, worstUs: Double, blocks: UInt64) {
        let m = meter.read()
        var tb = mach_timebase_info_data_t(); mach_timebase_info(&tb)
        let ns = Double(m.busy) * Double(tb.numer) / Double(tb.denom)
        let audioNs = Double(m.frames) / max(1, bed.pointee.sr) * 1e9
        let worst = Double(m.worst) * Double(tb.numer) / Double(tb.denom) / 1000
        if reset { meter.reset() }
        return (audioNs > 0 ? ns / audioNs * 100 : 0, worst, m.calls)
    }

    // MARK: - Offline rendering (the bench, the harness)

    /// Renders `frames` stereo frames, interleaved L R (manual rendering mode only).
    func renderOffline(frames: Int) -> [Float] {
        precondition(offline)
        let fmt = engine.manualRenderingFormat
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 4096) else { return [] }
        var out: [Float] = []; out.reserveCapacity(frames * 2)
        var left = frames
        while left > 0 {
            let n = min(left, 4096)
            guard (try? engine.renderOffline(AVAudioFrameCount(n), to: buf)) == .success, let d = buf.floatChannelData else { break }
            let ch = Int(fmt.channelCount)
            for i in 0..<Int(buf.frameLength) { out.append(d[0][i]); out.append(d[ch > 1 ? 1 : 0][i]) }
            left -= n
        }
        return out
    }

    /// The master after the limiter, handed to `block` (SoundLab's capture). `mute` silences the output itself.
    func tapMaster(mute: Bool, _ block: @escaping (AVAudioPCMBuffer) -> Void) {
        limiter.removeTap(onBus: 0)
        limiter.installTap(onBus: 0, bufferSize: 4096, format: limiter.outputFormat(forBus: 0)) { buf, _ in block(buf) }
        if mute { engine.mainMixerNode.outputVolume = 0 }
    }

    // MARK: - Plumbing

    private func pushGains() {
        let on = isEnabled ? 1.0 : 0
        bedParams.set(BP.master.rawValue, 0.8 * volume * on)
        bedParams.set(BP.fx.rawValue, effects)
        bedParams.set(BP.music.rawValue, otherAudio ? 0 : music)
        for p in emitParams { p.set(EP.fx.rawValue, effects * 0.8 * volume * on) }
    }
    private func setPhase(_ p: Phase) { if p != phase { phase = p; applyRunning() } }

    private var audible: Bool { isEnabled && (offline || engine.isRunning) }
    /// Single producer (main thread). A one-shot with nothing to hear it (off, paused, backgrounded) is dropped, as the
    /// web's are when muted, so nothing stale fires on resume.
    private func postBed(_ e: SoundEvent) { if audible { bedRing.push(e) } }
    private func postEmitterIndex(_ i: Int, _ e: SoundEvent) { if audible { emitRings[i].push(e) } }
    /// Places the oldest free emitter (1…) at `at` and hands it the event.
    private func postEmitter(at: SIMD3<Float>, _ e: SoundEvent, hold: Double) {
        guard audible, emitNodes.count == Sound.emitterCount else { return }
        let now = CACurrentMediaTime()
        var best = 1, bestT = Double.infinity
        for i in 1..<Sound.emitterCount where emitUsed[i] < bestT { bestT = emitUsed[i]; best = i }
        emitUsed[best] = now + hold
        emitNodes[best].position = AVAudio3DPoint(x: at.x, y: at.y, z: at.z)
        emitRings[best].push(e)
    }

    private static func makeLimiter() -> AVAudioUnitEffect {
        let d = AudioComponentDescription(componentType: kAudioUnitType_Effect, componentSubType: kAudioUnitSubType_PeakLimiter,
                                          componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
        return AVAudioUnitEffect(audioComponentDescription: d)
    }

    private func connect(rate: Double) {
        let wasOffline = offline
        for n in [bedNode].compactMap({ $0 }) + emitNodes { engine.disconnectNodeOutput(n); engine.detach(n) }
        emitNodes = []; bedNode = nil
        for n in [env, bedVerb, submix, eq, limiter] as [AVAudioNode] where n.engine != nil { engine.disconnectNodeOutput(n); engine.detach(n) }
        bed.pointee.reconfigure(sr: rate)
        for i in 0..<Sound.emitterCount { emitters[i].reconfigure(sr: rate) }
        bedRing.flush(); emitRings.forEach { $0.flush() }

        let stereo = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
        let mono = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
        let b = bed
        let bn = AVAudioSourceNode(format: stereo) { _, _, frameCount, abl -> OSStatus in
            let list = UnsafeMutableAudioBufferListPointer(abl)
            guard list.count > 0, let l = list[0].mData else { return noErr }
            let n = Int(frameCount)
            let L = l.assumingMemoryBound(to: Float.self)
            let R = list.count > 1 ? (list[1].mData?.assumingMemoryBound(to: Float.self) ?? L) : L
            b.pointee.render(L, R, n)
            return noErr
        }
        for n in [bn as AVAudioNode, env, bedVerb, submix, eq, limiter] { engine.attach(n) }
        engine.connect(bn, to: bedVerb, format: stereo)
        engine.connect(bedVerb, to: submix, format: stereo)
        for i in 0..<Sound.emitterCount {
            let e = emitters + i
            let node = AVAudioSourceNode(format: mono) { _, _, frameCount, abl -> OSStatus in
                let list = UnsafeMutableAudioBufferListPointer(abl)
                guard list.count > 0, let d = list[0].mData else { return noErr }
                e.pointee.render(d.assumingMemoryBound(to: Float.self), Int(frameCount))
                return noErr
            }
            engine.attach(node)
            engine.connect(node, to: env, format: mono)
            node.renderingAlgorithm = .auto
            node.sourceMode = .pointSource
            node.reverbBlend = 0.06
            emitNodes.append(node)
        }
        engine.connect(env, to: submix, format: stereo)
        engine.connect(submix, to: eq, format: stereo)
        engine.connect(eq, to: limiter, format: stereo)
        engine.connect(limiter, to: engine.mainMixerNode, format: stereo)
        bedNode = bn
        env.outputType = .auto
        env.distanceAttenuationParameters.distanceAttenuationModel = .inverse
        env.distanceAttenuationParameters.referenceDistance = 3
        env.distanceAttenuationParameters.maximumDistance = 500
        env.distanceAttenuationParameters.rolloffFactor = 0.9
        // The limiter: fast enough for a crash, a little make-up for a phone's small speaker.
        let au = limiter.audioUnit
        AudioUnitSetParameter(au, kLimiterParam_AttackTime, kAudioUnitScope_Global, 0, 0.004, 0)
        AudioUnitSetParameter(au, kLimiterParam_DecayTime, kAudioUnitScope_Global, 0, 0.08, 0)
        AudioUnitSetParameter(au, kLimiterParam_PreGain, kAudioUnitScope_Global, 0, 0, 0)
        voice(speaker: speaker)
        let z = zone; zone = z == .open ? .set : .open; self.zone(z)   // reapply the zone to the new nodes
        _ = wasOffline
    }

    /// A phone's own speaker can't move air below ~150 Hz: cut it (the headroom goes to what it can play) and lift the
    /// presence band a little. Headphones and AirPods get it flat.
    private func voice(speaker on: Bool) {
        speaker = on
        let b = eq.bands
        b[0].filterType = .highPass; b[0].frequency = 130; b[0].bandwidth = 0.7; b[0].bypass = !on
        b[1].filterType = .parametric; b[1].frequency = 2800; b[1].bandwidth = 1.2; b[1].gain = 2.5; b[1].bypass = !on
        b[2].filterType = .parametric; b[2].frequency = 220; b[2].bandwidth = 1.0; b[2].gain = -2; b[2].bypass = !on
        bedParams.set(BP.speaker.rawValue, on ? 1 : 0)
    }
    private func routeChanged() {
        #if os(iOS)
        let outs = AVAudioSession.sharedInstance().currentRoute.outputs
        voice(speaker: outs.contains { $0.portType == .builtInSpeaker || $0.portType == .builtInReceiver })
        #endif
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
        on(.AVAudioEngineConfigurationChange, engine) { [weak self] _ in
            guard let self else { return }
            let r = Sound.hardwareRate(self.engine)
            if r != self.bed.pointee.sr || !self.engine.isRunning { self.engine.stop(); self.connect(rate: r) }
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
        on(AVAudioSession.routeChangeNotification, session) { [weak self] _ in self?.routeChanged(); self?.applyRunning() }
        on(AVAudioSession.silenceSecondaryAudioHintNotification, session) { [weak self] n in
            guard let self, let raw = n.userInfo?[AVAudioSessionSilenceSecondaryAudioHintTypeKey] as? UInt else { return }
            self.otherAudio = raw == AVAudioSession.SilenceSecondaryAudioHintType.begin.rawValue
            self.pushGains()
        }
        on(AVAudioSession.mediaServicesWereResetNotification, session) { [weak self] _ in
            guard let self else { return }
            Sound.configureSession()
            self.engine = AVAudioEngine(); self.env = AVAudioEnvironmentNode(); self.bedVerb = AVAudioUnitReverb()
            self.submix = AVAudioMixerNode(); self.eq = AVAudioUnitEQ(numberOfBands: 3); self.limiter = Sound.makeLimiter()
            self.bedNode = nil; self.emitNodes = []
            self.connect(rate: Sound.hardwareRate(self.engine))
            self.observers.forEach { nc.removeObserver($0) }; self.observers = []; self.observe()
            self.applyRunning()
        }
        on(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.foreground = false; self?.applyRunning() }
        on(UIApplication.willEnterForegroundNotification) { [weak self] _ in self?.foreground = true; self?.applyRunning() }
        #endif
    }
}
