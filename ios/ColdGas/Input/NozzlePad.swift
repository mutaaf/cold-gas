// Advanced's touch nozzle pad (src/valves.js bindNozzlePad): ten pads on a car outline, nose up, plus LIFT, BOOST and FRONTS.
// Multi-touch, and a finger can slide from pad to pad (a thumb rolled from front-left to front-right). Each nozzle's live valve
// is a ring around its pad. Coordinates are the web's 300 × 380 car, scaled to fit.
import SwiftUI
import UIKit
import ColdGasCore
import ColdGasPhysics

final class NozzlePadView: UIView {
    struct Target { let x, y, r: CGFloat; let label: String; let valves: [(Int, Double)]; let chord: Bool }
    private let targets: [Target]
    private var touchesOn: [ObjectIdentifier: Int] = [:]
    var onValves: (([Double]) -> Void)?
    var throttles = [Double](repeating: 0, count: 10) { didSet { if throttles != oldValue { setNeedsDisplay() } } }

    private static let UI: [String: (String, CGFloat, CGFloat)] = [
        "yaw-l": ("1", 44, 34), "yaw-r": ("3", 256, 34), "down-fl": ("FL", 58, 116), "down-fr": ("FR", 242, 116),
        "down-rl": ("RL", 58, 250), "down-rr": ("RR", 242, 250), "rear-4": ("V", 36, 342), "rear-3": ("B", 96, 342), "rear-2": ("N", 204, 342), "rear-1": ("M", 264, 342),
    ]
    override init(frame: CGRect) {
        var t: [Target] = []
        var idx: [String: Int] = [:]
        for (i, n) in NOZZLE_SPEC.enumerated() {
            idx[n.id] = i
            guard let u = NozzlePadView.UI[n.id] else { continue }
            t.append(Target(x: u.1, y: u.2, r: n.group == "lift" ? 28 : 24, label: u.0, valves: [(i, 1)], chord: false))
        }
        func i(_ id: String) -> Int { idx[id] ?? 0 }
        let downs = ["down-fl", "down-fr", "down-rl", "down-rr"].map(i)
        t.append(Target(x: 150, y: 183, r: 34, label: "LIFT", valves: downs.map { ($0, TRIM[$0]) }, chord: true))
        t.append(Target(x: 150, y: 342, r: 28, label: "BOOST", valves: ["rear-4", "rear-3", "rear-2", "rear-1"].map { (i($0), 1) }, chord: true))
        t.append(Target(x: 150, y: 60, r: 28, label: "FRONTS", valves: [(i("down-fl"), 1), (i("down-fr"), 1)], chord: true))
        targets = t
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { nil }

    /// The web's `width: min(330px, 92vw)`: a bigger pad covers the car it steers.
    private var k: CGFloat { min(330 / 300, min(bounds.width / 300, bounds.height / 380)) }
    private var origin: CGPoint { CGPoint(x: (bounds.width - 300 * k) / 2, y: bounds.height - 380 * k) }
    private func center(_ t: Target) -> CGPoint { CGPoint(x: origin.x + t.x * k, y: origin.y + t.y * k) }
    private func padAt(_ p: CGPoint) -> Int {
        var best = -1, bestD = CGFloat.infinity
        for (i, t) in targets.enumerated() {
            let c = center(t), d = hypot(p.x - c.x, p.y - c.y)
            if d < (t.r + 6) * k && d < bestD { best = i; bestD = d }
        }
        return best
    }
    private func recompute() {
        var v = [Double](repeating: 0, count: 10)
        for pad in touchesOn.values where pad >= 0 { for (i, x) in targets[pad].valves { v[i] = max(v[i], (x * 20).rounded() / 20) } }
        onValves?(v)
        setNeedsDisplay()
    }
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { padAt(point) >= 0 || !touchesOn.isEmpty }
    override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) {
        for t in ts { touchesOn[ObjectIdentifier(t)] = padAt(t.location(in: self)) }
        UISelectionFeedbackGenerator().selectionChanged()
        recompute()
    }
    override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) {
        for t in ts { touchesOn[ObjectIdentifier(t)] = padAt(t.location(in: self)) }
        recompute()
    }
    override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) { for t in ts { touchesOn[ObjectIdentifier(t)] = nil }; recompute() }
    override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) { touchesEnded(ts, with: e) }

    override func draw(_ rect: CGRect) {
        guard let g = UIGraphicsGetCurrentContext() else { return }
        let ink = UIColor(red: 0.961, green: 0.965, blue: 0.973, alpha: 1), ice = UIColor(red: 0.749, green: 0.902, blue: 1, alpha: 1)
        let held = Set(touchesOn.values)
        for (i, t) in targets.enumerated() {
            let c = center(t), r = t.r * k
            g.setFillColor((held.contains(i) ? ink.withAlphaComponent(0.85) : UIColor(red: 0.04, green: 0.05, blue: 0.08, alpha: 0.62)).cgColor)
            g.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            g.setStrokeColor(ink.withAlphaComponent(t.chord ? 0.5 : 0.2).cgColor); g.setLineWidth(1)
            g.strokeEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            if !t.chord, let v = t.valves.first.map({ throttles[$0.0] }), v > 0.01 {   // the live valve
                g.setStrokeColor(ice.cgColor); g.setLineWidth(3)
                g.addArc(center: c, radius: r - 3, startAngle: -.pi / 2, endAngle: -.pi / 2 + .pi * 2 * CGFloat(min(1, v)), clockwise: false)
                g.strokePath()
            }
            let a: [NSAttributedString.Key: Any] = [.font: UIFont(name: "Geist", size: 11 * max(k, 0.8)) ?? UIFont.systemFont(ofSize: 11), .foregroundColor: held.contains(i) ? UIColor.black : ink]
            let s = NSAttributedString(string: t.label, attributes: a), z = s.size()
            s.draw(at: CGPoint(x: c.x - z.width / 2, y: c.y - z.height / 2))
        }
    }
}

struct NozzlePad: UIViewRepresentable {
    @ObservedObject var game = Game.shared
    func makeUIView(context: Context) -> NozzlePadView {
        let v = NozzlePadView()
        v.accessibilityLabel = "Nozzle pad, ten valves"
        v.onValves = { vals in MainActor.assumeIsolated { Game.shared.live?.sampler.nozzleValves = vals } }
        return v
    }
    func updateUIView(_ v: NozzlePadView, context: Context) { v.throttles = game.hud.throttles }
    static func dismantleUIView(_ v: NozzlePadView, coordinator: ()) { v.onValves?([Double](repeating: 0, count: 10)) }
}
