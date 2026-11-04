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

    override init(frame: CGRect) {
        super.init(frame: frame)
        guard let device = MTLCreateSystemDefaultDevice() else { return }
        metal.device = device
        metal.pixelFormat = Renderer.colorFormat
        metal.framebufferOnly = true
        metal.maximumDrawableCount = 3
        isOpaque = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let r = Renderer(device: device)
            DispatchQueue.main.async {
                guard let self, let r else { print("RENDERER failed"); return }
                self.renderer = r
                print(String(format: "PIPELINES built at launch in %.1f ms (binary archive)", r.launchCompileMs))
                self.startLink()
            }
        }
    }
    required init?(coder: NSCoder) { nil }

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
        if let s = pendingSize, s.width > 0, s.height > 0 { metal.drawableSize = s; pendingSize = nil }
        let cpu0 = CACurrentMediaTime()
        let b = bench
        r.draw(into: update.drawable, time: cpu0 - start) { gpu in b?.gpu(gpu) }
        let now = CACurrentMediaTime()
        stats.add(interval: update.targetPresentationTimestamp, cpu: (now - cpu0) * 1000)
        if stats.firstFrame { Ready.mark("frame") }
        if stats.frames % 60 == 0 {
            NotificationCenter.default.post(name: .frameStats, object: String(format: "%.0f fps · %.2f ms cpu\n%d×%d px · MSAA 4×", stats.fps, stats.cpuAvg, Int(metal.drawableSize.width), Int(metal.drawableSize.height)))
        }
        if let b = bench {
            b.frame(target: update.targetPresentationTimestamp, cpu: (now - cpu0) * 1000)
            if b.done { bench = nil; b.report(compiles: r.compilesAfterLaunch, launchMs: r.launchCompileMs, size: metal.drawableSize) }
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
