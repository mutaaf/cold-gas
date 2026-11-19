// The 3D stage: a CAMetalLayer-backed view driven by a CAMetalDisplayLink at up to 120 Hz (ProMotion needs
// CADisableMinimumFrameDurationOnPhone in Info.plist). The renderer is built off the main thread; the link
// starts only once every pipeline exists, so the first frame compiles nothing. A size change is applied at
// the start of the next frame, never between a draw and its presentation (LESSONS 0044: a black frame).
import UIKit
import QuartzCore
import Metal
import ColdGasLayout

final class StageView: UIView, CAMetalDisplayLinkDelegate {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    private var metal: CAMetalLayer { layer as! CAMetalLayer }
    private(set) var renderer: Renderer?
    private var link: CAMetalDisplayLink?
    private var start = CACurrentMediaTime()
    private var stats = FrameStats()
    private var pendingSize: CGSize?
    private var bench: Bench?
    /// `-perf` (0296, Perf.swift): the window measured, when the first frame was drawn, and whether it has reported.
    private var perfBench: Bench?
    private var firstFrameAt: CFTimeInterval = 0, perfDone = false
    private var lastFrame: CFTimeInterval = 0
    #if DEBUG
    /// `-timescale ground,air` (Debug): the whole app on a slowed clock, so a screenshot's few seconds catch each camera shot.
    private let timescales = Launch.value("-timescale")?.split(separator: ",").compactMap { Double($0) } ?? []
    private var debugClock = 0.0
    #endif
    /// What the screens over the scene leave the camera: rebuilt when the layout or the control scheme changes.
    private var cameraLayout: (rows: Bool, scene: CGRect, controls: CGRect, safeTop: CGFloat)?
    private var framing = CameraFraming(), framingThumb: Bool?, framingRev = -1
    func setCameraLayout(rows: Bool, scene: CGRect, controls: CGRect, safeTop: CGFloat) { cameraLayout = (rows, scene, controls, safeTop); framingThumb = nil }

    override init(frame: CGRect) {
        super.init(frame: frame)
        guard let device = MTLCreateSystemDefaultDevice() else { return }
        metal.device = device
        metal.pixelFormat = Renderer.drawableFormat
        metal.framebufferOnly = true
        metal.maximumDrawableCount = 3
        isOpaque = true
        self.device = device
        if Perf.on { Perf.watchMainThread() }
        // `-replay <vector>`: a recorded run looping (the shots and the bench); otherwise the game sets the stage.
        if let which = Launch.value("-replay") { load(course: nil, vector: which) }

        // No GPU work off screen (iOS kills an app that encodes in the background); the run pauses as it loses the screen.
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.link?.isPaused = true }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in self?.lastFrame = 0; self?.link?.isPaused = false }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { Game.shared.resignActive() } }
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.renderer?.applyThermal() }
        NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in self?.renderer?.applyThermal() }
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in self?.shed() }
    }
    required init?(coder: NSCoder) { nil }
    private var device: MTLDevice?
    /// One renderer per course, built once off the main thread (the binary archive makes the pipelines ≈20 ms) and kept.
    private var renderers: [String: Renderer] = [:]
    private var loading: String?
    /// Every kept renderer's GPU bytes (0296, `-perf`).
    private func residentBytes() -> Int { var seen = Set<ObjectIdentifier>(); return renderers.values.reduce(0) { $0 + $1.residentBytes(seen: &seen) } }

    /// Draw `course` with `track` (a live run, or a recorded run looping). The course's renderer is built on first use.
    func load(course: String, track: Replay?) {
        if let r = renderers[course] { show(r); r.setTrack(track); startLinkIfNeeded(); return }
        build(course) { [weak self] r in
            r.setTrack(track)
            self?.show(r)
            self?.startLinkIfNeeded()
        }
    }
    /// Draw `r` from the next frame; the renderer it replaces lets go of its targets, its track and its dents (0299, Renderer.idle).
    private func show(_ r: Renderer) {
        if let old = renderer, old !== r { old.idle() }
        renderer = r
    }
    private func load(course: String?, vector: String) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let replay = Replay(runVector: vector)
            if let rp = replay { print(String(format: "REPLAY %@ flown by the Swift sim in %.0f ms: %.1f %@", vector, rp.flownMs, rp.score, rp.verdict)) }
            DispatchQueue.main.async { self?.load(course: replay?.course ?? course ?? "show", track: replay) }
        }
    }
    private var pendingBuilds: [String: [(Renderer) -> Void]] = [:]
    /// The last ask that couldn't be drawn (0293): the title's note retries it.
    private var failedAsk: (course: String, then: (Renderer) -> Void)?
    private func build(_ course: String, retry: Bool = false, then: @escaping (Renderer) -> Void) {
        if pendingBuilds[course] != nil { pendingBuilds[course, default: []].append(then); return }
        pendingBuilds[course] = [then]
        guard let device else {
            pendingBuilds[course] = nil
            Report.error(.render, .error, "no Metal device")
            MainActor.assumeIsolated { Game.shared.notice = StageView.cantDraw }
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            // 0293: a renderer that can't be built is tried once more without the pipeline cache (the damaged-cache case).
            var r = Renderer(device: device, course: course, replay: nil)
            var retried = false
            if r == nil && !retry {
                PipelineArchive.purge()
                retried = true
                r = Renderer(device: device, course: course, replay: nil)
            }
            DispatchQueue.main.async {
                guard let self else { return }
                let waiting = self.pendingBuilds.removeValue(forKey: course) ?? []
                if retried || retry { Report.recovered(.webgl, ok: r != nil) }
                guard let r else {
                    print("RENDERER failed for \(course)")
                    if let last = waiting.last { self.failedAsk = (course, last) }
                    MainActor.assumeIsolated { Game.shared.notice = StageView.cantDraw }
                    return
                }
                self.renderers[course] = r
                // A later build that worked (the tap, or the next course) takes the "couldn't be drawn" note away.
                if self.failedAsk?.course == course { self.failedAsk = nil }
                MainActor.assumeIsolated { if Game.shared.notice?.action == .retryStage { Game.shared.notice = nil } }
                print(String(format: "PIPELINES built for %@ in %.1f ms (binary archive), %d lights", course, r.launchCompileMs, r.nLights))
                for w in waiting.suffix(1) { w(r) }   // only the latest ask for this course draws
            }
        }
    }
    static let cantDraw = Notice(text: "The stage couldn\u{2019}t be drawn on this iPhone. Tap to try again.", action: .retryStage, seconds: nil)
    /// The note's tap: build the stage that failed again.
    func retryFailedBuild() {
        guard let ask = failedAsk else { return }
        failedAsk = nil
        build(ask.course, retry: true, then: ask.then)
    }
    /// A memory warning (0293): every renderer but the one drawing goes (one is rebuilt on demand from the archive, ≈20 ms).
    private func shed() {
        let before = renderers.count
        renderers = renderers.filter { $0.value === renderer }
        if before > renderers.count { print("MEMORY warning: dropped \(before - renderers.count) idle renderer(s)") }
    }
    private func startLinkIfNeeded() { if link == nil { startLink() } }
    /// One fixed rate (0280): the governor's cadence, min = max, so every frame is shown for the same time (a 60–120 range
    /// let a frame that missed 120's deadline show for 16.7 ms between 8.3 ms ones: the judder).
    private static func range(_ hz: Int) -> CAFrameRateRange { let f = Float(hz); return CAFrameRateRange(minimum: f, maximum: f, preferred: f) }
    private var linkCadence = 120
    /// Free Drive's bench starts once the world near the car is built (Game.startDrive's `-bench`).
    func startBench(seconds: Double) { if bench == nil { bench = Bench(seconds: seconds) } }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.nativeScale ?? UIScreen.main.nativeScale
        pendingSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        metal.contentsScale = scale
    }

    private func startLink() {
        let l = CAMetalDisplayLink(metalLayer: metal)
        l.preferredFrameRateRange = StageView.range(renderer?.cadence ?? 120)
        linkCadence = renderer?.cadence ?? 120
        l.preferredFrameLatency = Launch.value("-frame-latency").flatMap(Float.init) ?? 2
        l.delegate = self
        l.add(to: .main, forMode: .common)
        link = l
        start = CACurrentMediaTime()
        if Launch.bench && !Launch.freedrive { bench = Bench(seconds: 10) }
    }

    func metalDisplayLink(_ link: CAMetalDisplayLink, needsUpdate update: CAMetalDisplayLink.Update) {
        guard let r = renderer else { return }
        if r.cadence != linkCadence { linkCadence = r.cadence; link.preferredFrameRateRange = StageView.range(r.cadence) }
        let now0 = CACurrentMediaTime()
        let tc0 = Perf.on ? Perf.threadMs() : 0   // (0296: the main thread's own CPU time, which a loaded Mac's other work doesn't inflate)
        var dt = lastFrame == 0 ? 0 : now0 - lastFrame
        let k = r.slowK
        #if DEBUG
        if let g = timescales.first { dt *= MainActor.assumeIsolated { Game.shared.hud.phase >= 2 } ? (timescales.last ?? g) : g; debugClock += dt }
        #endif

        MainActor.assumeIsolated {   // the link runs on the main run loop
            Game.shared.frame(dt: dt, slowK: k)
            let thumb = Game.shared.oneThumb
            let rev = HudStore.shared.revision * 4 + (HudTier.allCases.firstIndex(of: HudTier(tier: Game.shared.tier)) ?? 0)
            if thumb != framingThumb || rev != framingRev, let l = cameraLayout {
                framingThumb = thumb; framingRev = rev
                framing = CameraFraming(rows: l.rows, scene: l.scene, controls: l.controls, safeTop: l.safeTop, oneThumb: thumb)
            }
        }
        r.cam.framing = framing
        lastFrame = now0
        if let s = pendingSize, s.width > 0, s.height > 0 { metal.drawableSize = s; pendingSize = nil }
        let cpu0 = CACurrentMediaTime()
        let tcEnc = Perf.on ? Perf.threadMs() : 0
        let b = bench
        if Perf.on && perfBench == nil && !perfDone && firstFrameAt > 0 && now0 - firstFrameAt >= Perf.wait { perfBench = Bench(seconds: Perf.seconds ?? 8) }
        let pb = perfBench
        var drawT = cpu0 - start
        #if DEBUG
        if !timescales.isEmpty { drawT = debugClock }
        #endif
        r.draw(into: update.drawable, time: drawT) { gpu in b?.gpu(gpu); pb?.gpu(gpu) }
        let now = CACurrentMediaTime()
        stats.add(interval: update.targetPresentationTimestamp, cpu: (now - cpu0) * 1000)
        InputLag.frame(target: update.targetPresentationTimestamp)
        if stats.firstFrame {
            firstFrameAt = now; Perf.launchMs = Perf.sinceProcessStart()
            Ready.mark("frame")
        }
        if let pb {
            let tc1 = Perf.threadMs()
            pb.frame(target: update.targetPresentationTimestamp, cpu: tc1 - tc0, enc: tc1 - tcEnc)
            if pb.done {
                perfBench = nil; perfDone = true
                print(pb.perfLine(look: Look.current.rawValue, cadence: linkCadence, scale: r.scale, size: metal.drawableSize, gpuBytes: residentBytes()))
                fflush(stdout)
                Ready.mark("perf")
                exit(0)
            }
        }
        if stats.frames % 60 == 0 {
            NotificationCenter.default.post(name: .frameStats, object: String(format: "%.0f fps · %.2f ms cpu\n%d×%d px · render %.0f%% · MSAA 4× · MetalFX · %d Hz · %@", stats.fps, stats.cpuAvg, Int(metal.drawableSize.width), Int(metal.drawableSize.height), r.scale * 100, r.cadence, Look.current.title))
        }
        if let b = bench {
            b.frame(target: update.targetPresentationTimestamp, cpu: (now - cpu0) * 1000)
            if b.done { bench = nil; b.report(compiles: r.compilesAfterLaunch, launchMs: r.launchCompileMs, size: metal.drawableSize); if let fd = MainActor.assumeIsolated({ Game.shared.freeDrive }) { print("BENCH freedrive \(fd.statsLine)") }; print("BENCH look \(Look.current.rawValue) cadence \(r.cadence)"); print(String(format: "BENCH render-scale %.2f thermal %d lowpower %d · passes (ms) %@", r.scale, ProcessInfo.processInfo.thermalState.rawValue, ProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 0, r.passTimes.report())) }
        }
    }
}

struct FrameStats {
    var frames = 0, last: CFTimeInterval = 0, fps = 0.0, cpuAvg = 0.0
    var firstFrame: Bool { frames == 1 }
    mutating func add(interval t: CFTimeInterval, cpu: Double) {
        frames += 1
        if last > 0 { let dt = t - last; if dt > 0 { fps = fps * 0.9 + (1 / dt) * 0.1 } }
        last = t
        cpuAvg = cpuAvg * 0.95 + cpu * 0.05
    }
}
