// The root: the scene and the controls panel, placed by the fold (docs/NATIVE.md §5). The fold's division
// regions are read on EVERY layout pass: the read is what subscribes this view to the next fold (18-0's
// FoldModule: "skipping it because nothing changed would stop the passes that tell us something did").
// The hinge angle drives effects only (here: the stage light warms as the phone opens), never layout.
import UIKit
import ColdGasLayout

final class RootViewController: UIViewController {
    private let stage = StageView()
    private let container = UIView()
    private let controls = ControlsPanel()
    private let foldBand = UIView()
    private var hingeInteraction: AnyObject?
    private(set) var layoutNow: FoldLayout?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.039, green: 0.055, blue: 0.094, alpha: 1)
        view.addSubview(container)
        container.addSubview(stage)
        container.addSubview(controls)
        foldBand.backgroundColor = .black
        foldBand.isUserInteractionEnabled = false
        container.addSubview(foldBand)
        attachHinge()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // `-window WxH`: lay the app out at that size and scale it to fit the screen (a pose shot on any device).
        let size = Launch.window ?? view.bounds.size
        container.transform = .identity
        container.frame = CGRect(origin: .zero, size: size)
        if Launch.window != nil {
            let k = min(view.bounds.width / size.width, view.bounds.height / size.height)
            container.transform = CGAffineTransform(scaleX: k, y: k)
            container.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        }
        let safe = Launch.window != nil ? emulatedInsets(size) : view.safeAreaInsets
        var regions: [LRect] = []
        if #available(iOS 27.1, *) {
            for r in view.reservedRegions(kind: .division, options: .includeInactive) {
                let f = view.convert(r.frame, to: view)
                regions.append(LRect(x: f.minX, y: f.minY, w: f.width, h: f.height))
            }
        }
        if regions.isEmpty, let pose = Launch.pose {
            regions = Fold.emulatedRegions(pose: pose, width: size.width, height: size.height)
        }
        let l = Fold.layout(width: size.width, height: size.height,
                            safe: LInsets(top: safe.top, left: safe.left, bottom: safe.bottom, right: safe.right), regions: regions)
        if l != layoutNow {
            layoutNow = l
            stage.frame = l.scene.cg
            controls.frame = l.controls.cg
            controls.spread = l.spread
            foldBand.frame = l.fold?.cg ?? .zero
            foldBand.isHidden = l.fold == nil
            print("LAYOUT \(Int(size.width))x\(Int(size.height)) \(l.spread.rawValue) scene \(l.scene) controls \(l.controls) fold \(l.fold.map(\.description) ?? "-")")
        }
    }

    /// The Duo's measured insets for a `-window` pose (18-0's numbers), so a shot matches the device.
    private func emulatedInsets(_ s: CGSize) -> UIEdgeInsets {
        if s == CGSize(width: 951, height: 669) { return UIEdgeInsets(top: 0, left: 0, bottom: 34, right: 84) }
        if s == CGSize(width: 669, height: 951) { return UIEdgeInsets(top: 82, left: 0, bottom: 34, right: 0) }
        if s == CGSize(width: 466, height: 678) { return UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 84) }
        return view.safeAreaInsets
    }

    private func attachHinge() {
        if #available(iOS 27.1, *) {
            let i = UIHingeInteraction { [weak self] _, update in
                // Effect only: 0 closed … 1 flat. Layout never reads this.
                let open = update.hinge.map { min(1, max(0, $0.angle / .pi)) } ?? 1
                self?.stage.renderer?.hingeOpen = Float(open)
            }
            view.addInteraction(i)
            hingeInteraction = i
        }
    }
}

/// The trailing (book) or lower (tabletop) panel; on one screen, a strip over the scene. A placeholder for the
/// HUD in this spike: the build, the pose and the live frame rate.
final class ControlsPanel: UIView {
    private let title = UILabel(), stats = UILabel()
    var spread: Spread = .single { didSet { setNeedsLayout() } }
    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        title.text = "COLD GAS"
        title.font = .systemFont(ofSize: 22, weight: .light)
        title.textColor = UIColor(white: 0.92, alpha: 1)
        stats.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        stats.textColor = UIColor(white: 0.62, alpha: 1)
        stats.numberOfLines = 0
        addSubview(title); addSubview(stats)
        NotificationCenter.default.addObserver(forName: .frameStats, object: nil, queue: .main) { [weak self] n in
            self?.stats.text = n.object as? String
        }
    }
    required init?(coder: NSCoder) { nil }
    override func layoutSubviews() {
        super.layoutSubviews()
        let pad: CGFloat = 20
        title.frame = CGRect(x: pad, y: pad, width: bounds.width - 2 * pad, height: 28)
        stats.frame = CGRect(x: pad, y: pad + 34, width: bounds.width - 2 * pad, height: 60)
    }
}

extension Notification.Name { static let frameStats = Notification.Name("coldgas.frameStats") }
extension LRect { var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) } }
