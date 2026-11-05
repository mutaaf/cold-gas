// The 3D stage: a CAMetalLayer-backed view driven by a CAMetalDisplayLink at up to 120 Hz (ProMotion needs
// CADisableMinimumFrameDurationOnPhone in Info.plist). The renderer is built off the main thread; the link
// starts only once every pipeline exists, so the first frame compiles nothing. A size change is applied at
// the start of the next frame, never between a draw and its presentation (LESSONS 0044: a black frame).
import UIKit
import QuartzCore
import Metal

final class StageView: UIView, CAMetalDisplayLinkDelegate {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    private var metal: CAMetalLayer { layer as! CAMetalLayer }
    private(set) var renderer: Renderer?
    private var link: CAMetalDisplayLink?
    private var start = CACurrentMediaTime()
    private var stats = FrameStats()
    private var pendingSize: CGSize?
    private var bench: Bench?
    private var lastFrame: CFTimeInterval = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        guard let device = MTLCreateSystemDefaultDevice() else { return }
        metal.device = device
        metal.pixelFormat = Renderer.drawableFormat
        metal.framebufferOnly = true
        metal.maximumDrawableCount = 3
        isOpaque = true
        self.device = device
        // `-replay <vector>`: a recorded run looping (the shots and the bench); otherwise the game sets the stage.
        if let which = Launch.value("-replay") { load(course: nil, vector: which) }

        // No GPU work off screen (iOS kills an app that encodes in the background); the run pauses as it loses the screen.
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.link?.isPaused = true }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in self?.lastFrame = 0; self?.link?.isPaused = false }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { Game.shared.resignActive() } }
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.renderer?.applyThermal() }
        NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in self?.renderer?.applyThermal() }
    }
    required init?(coder: NSCoder) { nil }
    private var device: MTLDevice?
    /// One renderer per course, built once off the main thread (the binary archive makes the pipelines ≈20 ms) and kept.
    private var renderers: [String: Renderer] = [:]
    private var loading: String?

    /// Draw `course` with `track` (a live run, or a recorded run looping). The course's renderer is built on first use.
    func load(course: String, track: Replay?) {
        if let r = renderers[course] { renderer = r; r.setTrack(track); startLinkIfNeeded(); return }
        build(course) { [weak self] r in
            r.setTrack(track)
            self?.renderer = r
            self?.startLinkIfNeeded()
        }
    }
    private func load(course: String?, vector: String) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let replay = Replay(runVector: vector)
            if let rp = replay { print(String(format: "REPLAY %@ flown by the Swift sim in %.0f ms: %.1f %@", vector, rp.flownMs, rp.score, rp.verdict)) }
            DispatchQueue.main.async { self?.load(course: replay?.course ?? course ?? "show", track: replay) }
        }
    }
    private var pendingBuilds: [String: [(Renderer) -> Void]] = [:]
    private func build(_ course: String, then: @escaping (Renderer) -> Void) {
        if pendingBuilds[course] != nil { pendingBuilds[course, default: []].append(then); return }
        pendingBuilds[course] = [then]
        guard let device else { return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let r = Renderer(device: device, course: course, replay: nil)
            DispatchQueue.main.async {
                guard let self else { return }
                let waiting = self.pendingBuilds.removeValue(forKey: course) ?? []
                guard let r else { print("RENDERER failed for \(course)"); return }
                self.renderers[course] = r
                print(String(format: "PIPELINES built for %@ in %.1f ms (binary archive), %d lights", course, r.launchCompileMs, r.nLights))
                for w in waiting.suffix(1) { w(r) }   // only the latest ask for this course draws
            }
        }
    }
    private func startLinkIfNeeded() { if link == nil { startLink() } }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.nativeScale ?? UIScreen.main.nativeScale
        pendingSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        metal.contentsScale = scale
    }

    private func startLink() {
        let l = CAMetalDisplayLink(metalLayer: metal)
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        l.preferredFrameLatency = 2
        l.delegate = self
        l.add(to: .main, forMode: .common)
        link = l
        start = CACurrentMediaTime()
        if Launch.bench { bench = Bench(seconds: 10) }
    }

    func metalDisplayLink(_ link: CAMetalDisplayLink, needsUpdate update: CAMetalDisplayLink.Update) {
        guard let r = renderer else { return }
        let now0 = CACurrentMediaTime()
        let dt = lastFrame == 0 ? 0 : now0 - lastFrame, k = r.slowK
        MainActor.assumeIsolated { Game.shared.frame(dt: dt, slowK: k) }   // the link runs on the main run loop
        lastFrame = now0
        if let s = pendingSize, s.width > 0, s.height > 0 { metal.drawableSize = s; pendingSize = nil }
        let cpu0 = CACurrentMediaTime()
        let b = bench
        r.draw(into: update.drawable, time: cpu0 - start) { gpu in b?.gpu(gpu) }
        let now = CACurrentMediaTime()
        stats.add(interval: update.targetPresentationTimestamp, cpu: (now - cpu0) * 1000)
        if stats.firstFrame { Ready.mark("frame") }
        if stats.frames % 60 == 0 {
            NotificationCenter.default.post(name: .frameStats, object: String(format: "%.0f fps · %.2f ms cpu\n%d×%d px · render %.0f%% · MSAA 4× · MetalFX", stats.fps, stats.cpuAvg, Int(metal.drawableSize.width), Int(metal.drawableSize.height), r.scale * 100))
        }
        if let b = bench {
            b.frame(target: update.targetPresentationTimestamp, cpu: (now - cpu0) * 1000)
            if b.done { bench = nil; b.report(compiles: r.compilesAfterLaunch, launchMs: r.launchCompileMs, size: metal.drawableSize); print(String(format: "BENCH render-scale %.2f thermal %d lowpower %d · passes (ms) %@", r.scale, ProcessInfo.processInfo.thermalState.rawValue, ProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 0, r.passTimes.report())) }
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
