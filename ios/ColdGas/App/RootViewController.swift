// The root: the scene and the controls panel, placed by the fold (docs/NATIVE.md §5). The fold's division
// regions are read on EVERY layout pass: the read is what subscribes this view to the next fold (18-0's
// FoldModule: "skipping it because nothing changed would stop the passes that tell us something did").
// The hinge angle drives effects only (here: the stage light warms as the phone opens), never layout.
import UIKit
import SwiftUI
import ColdGasLayout
import ColdGasCore

final class RootViewController: UIViewController {
    private let stage = StageView()
    private let container = UIView()
    private let controls = ControlsPanel()
    private let layoutModel = LayoutModel()
    private lazy var ui = UIHostingController(rootView: RootUI(layout: layoutModel))
    /// The bench, the shots of a recorded run and the haptics demo keep the spike's panel; everything else is the game.
    private let tool = (Launch.bench && !Launch.freedrive) || Launch.value("-replay") != nil || Launch.args.contains("-haptics")
    private let foldBand = UIView()
    private var hingeInteraction: AnyObject?
    private(set) var layoutNow: FoldLayout?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    /// The controls live in the bottom corners. Without this iOS holds every touch near an edge while it decides whether it's a
    /// swipe for Home or Control Center, and a press arrives late. A swipe from the edge now takes two, as games do.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

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
        controls.isUserInteractionEnabled = true
        controls.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(cycleHaptics)))
        if !tool {
            controls.isHidden = true
            addChild(ui)
            ui.view.backgroundColor = .clear
            ui.safeAreaRegions = []   // the fold layout already placed every panel inside the safe area
            container.addSubview(ui.view)
            ui.didMove(toParent: self)
            setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
            Game.shared.stage = stage
            Game.shared.showTitleLoop()
            if Launch.args.contains("-play") { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { Game.shared.play() } }
            if Launch.freedrive { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { Game.shared.startDrive() } }
        }
    }

    #if DEBUG
    /// `-orient landscape|portrait`: turn the simulator's screen for a shot (simctl can't rotate a device).
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard let o = Launch.value("-orient"), let scene = view.window?.windowScene else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: o == "landscape" ? .landscapeRight : .portrait)) { print("ORIENT failed: \($0)") }
    }
    #endif

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
        var folded = false
        if #available(iOS 27.1, *) {
            for r in view.reservedRegions(kind: .division, options: .includeInactive) {
                let f = view.convert(r.frame, to: view)
                regions.append(LRect(x: f.minX, y: f.minY, w: f.width, h: f.height))
            }
            // Active regions only: the phone is bent (tabletop, a half-open book), not lying or held flat.
            folded = !view.reservedRegions(kind: .division).isEmpty
        }
        if regions.isEmpty, let pose = Launch.pose {
            regions = Fold.emulatedRegions(pose: pose, width: size.width, height: size.height)
            folded = pose == "tabletop" || pose == "book"
        }
        // The HUD editor's shape (0221): a device that has ever reported a fold (or a debug pose, or the Duo simulator) is a
        // Duo, closed or open; the bend tells a book from a flat screen. Set before the layout below is compared.
        if !regions.isEmpty || Launch.pose != nil || (ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.contains("Duo") ?? false) {
            DeckGeometry.foldable = true
        }
        if DeckGeometry.bent != folded { DeckGeometry.bent = folded; layoutModel.objectWillChange.send() }
        let l = Fold.layout(width: size.width, height: size.height,
                            safe: LInsets(top: safe.top, left: safe.left, bottom: safe.bottom, right: safe.right), regions: regions, folded: folded)
        if l != layoutNow {
            layoutNow = l
            stage.frame = l.scene.cg
            controls.frame = l.controls.cg
            controls.spread = l.spread
            foldBand.frame = l.fold?.cg ?? .zero
            foldBand.isHidden = l.spread != .rows   // open (full): the crease is screen; tabletop: the band between screen and controller
            ui.view.frame = CGRect(origin: .zero, size: size)
            layoutModel.spread = l.spread
            layoutModel.scene = l.scene.cg
            layoutModel.controls = l.controls.cg
            layoutModel.fold = l.fold?.cg
            layoutModel.safe = EdgeInsets(top: safe.top, leading: safe.left, bottom: safe.bottom, trailing: safe.right)
            // The flight deck's shape (0210): set before the camera's framing reads it.
            DeckGeometry.spread = l.spread
            DeckGeometry.fold = l.fold.map { LRect(x: $0.x - l.controls.x, y: $0.y - l.controls.y, w: $0.w, h: $0.h) }
            stage.setCameraLayout(rows: l.spread == .rows, scene: l.scene.cg, controls: l.controls.cg, safeTop: safe.top)
            print("LAYOUT \(Int(size.width))x\(Int(size.height)) \(l.spread.rawValue)\(folded ? " bent" : " flat") regions \(regions.count) scene \(l.scene) controls \(l.controls) fold \(l.fold.map(\.description) ?? "-")")
        }
    }

    /// The Duo's measured insets for a `-window` pose (18-0's numbers), so a shot matches the device.
    private func emulatedInsets(_ s: CGSize) -> UIEdgeInsets {
        if s == CGSize(width: 951, height: 669) { return UIEdgeInsets(top: 0, left: 0, bottom: 34, right: 84) }
        if s == CGSize(width: 669, height: 951) { return UIEdgeInsets(top: 82, left: 0, bottom: 34, right: 0) }
        if s == CGSize(width: 466, height: 678) { return UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 84) }
        return view.safeAreaInsets
    }

    private let selection = UISelectionFeedbackGenerator()
    @objc private func cycleHaptics() {
        HapticPlayer.shared.cycleLevel()
        selection.selectionChanged()
        controls.note("Haptics: \(HapticPlayer.shared.level.rawValue)")
    }

    private func attachHinge() {
        if #available(iOS 27.1, *) {
            var lastStatus: String?
            let i = UIHingeInteraction { [weak self] _, update in
                // Effect only: 0 closed … 1 flat. Layout never reads this.
                let open = update.hinge.map { min(1, max(0, $0.angle / .pi)) } ?? 1
                self?.stage.renderer?.hingeOpen = Float(open)
                // A light tick at each detent (closed, partly open, flat): an effect, never layout (§6).
                let status = update.hinge.map { "\($0.status)" }
                if let s = status, s != lastStatus, lastStatus != nil {
                    HapticPlayer.shared.play(HapticEvent(kind: .detent, tick: 0, channel: 5, intensity: 0.3, sharpness: 0.6))
                }
                lastStatus = status
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
    func note(_ s: String) { title.text = "COLD GAS · \(s)" }
    override func layoutSubviews() {
        super.layoutSubviews()
        let pad: CGFloat = 20
        title.frame = CGRect(x: pad, y: pad, width: bounds.width - 2 * pad, height: 28)
        stats.frame = CGRect(x: pad, y: pad + 34, width: bounds.width - 2 * pad, height: 60)
    }
}

extension Notification.Name { static let frameStats = Notification.Name("coldgas.frameStats") }
extension LRect { var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) } }
