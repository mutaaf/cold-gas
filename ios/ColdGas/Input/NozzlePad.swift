// Advanced's valve deck (0210): the touch nozzle pad (src/valves.js bindNozzlePad), ten pads plus LIFT, BOOST and FRONTS,
// on the car seen from above, nose up. The pads keep the web's places (the same hands on the web and the phone).
//   - The car is drawn to its true plan (SPEC), and a hairline runs from each pad to where its nozzle really is (NOZZLE_SPEC).
//   - An open valve is drawn as its jet: a line out of the nozzle the way the gas leaves it, or a ring for a down jet.
//   - On an upright phone it's the whole car under both thumbs. Everywhere else (ColdGasLayout's Deck) it's split down the
//     spine, one half under each thumb: the car's left valves under the left thumb. The chords on the spine are in both.
// Multi-touch, and a finger can slide from pad to pad. A Pencil's pressure scales a valve, as the web's pen does
// (`step5(v · max(0.15, pressure))`); a finger is full. What reaches the sim is `nozzleValves`, as before.
import SwiftUI
import UIKit
import ColdGasCore
import ColdGasLayout
import ColdGasPhysics

final class NozzlePadView: UIView {
    struct Target { let x, y, r: CGFloat; let label: String; let valves: [(Int, Double)]; let chord: Bool; let group: String }
    /// A target drawn in one frame: its centre and radius on the glass.
    private struct Placed { let target: Int; let frame: Int; let c: CGPoint; let r: CGFloat }
    private let targets: [Target]
    private var placed: [Placed] = []
    private var frames: [(rect: CGRect, x0: CGFloat, k: CGFloat)] = []
    private var touchesOn: [ObjectIdentifier: (pad: Int, pressure: Double)] = [:]
    private var deck = Deck.layout(form: .phone, width: 1, height: 1)
    var onValves: (([Double]) -> Void)?
    var throttles = [Double](repeating: 0, count: 10) { didSet { if throttles != oldValue { setNeedsDisplay() } } }
    private var lastHeld = Set<Int>()

    private static let UI: [String: (String, CGFloat, CGFloat)] = [
        "yaw-l": ("1", 44, 34), "yaw-r": ("3", 256, 34), "down-fl": ("FL", 58, 116), "down-fr": ("FR", 242, 116),
        "down-rl": ("RL", 58, 250), "down-rr": ("RR", 242, 250), "rear-4": ("V", 36, 342), "rear-3": ("B", 96, 342), "rear-2": ("N", 204, 342), "rear-1": ("M", 264, 342),
    ]
    /// The car's true plan in the pad's 300 × 380 frame: its length over the web's 330, nose at y 20.
    private static let S = 330 / SPEC.length
    private static let NOSE = AXLE_F + SPEC.overhangFront
    private static func plan(_ x: Double, _ z: Double) -> CGPoint { CGPoint(x: 150 - x * S, y: 20 + (NOSE - z) * S) }

    override init(frame: CGRect) {
        var t: [Target] = []
        var idx: [String: Int] = [:]
        for (i, n) in NOZZLE_SPEC.enumerated() {
            idx[n.id] = i
            guard let u = NozzlePadView.UI[n.id] else { continue }
            t.append(Target(x: u.1, y: u.2, r: n.group == "lift" ? 28 : 24, label: u.0, valves: [(i, 1)], chord: false, group: n.group))
        }
        func i(_ id: String) -> Int { idx[id] ?? 0 }
        let downs = ["down-fl", "down-fr", "down-rl", "down-rr"].map(i)
        t.append(Target(x: 150, y: 183, r: 34, label: "LIFT", valves: downs.map { ($0, TRIM[$0]) }, chord: true, group: "chord"))
        t.append(Target(x: 150, y: 342, r: 28, label: "BOOST", valves: ["rear-4", "rear-3", "rear-2", "rear-1"].map { (i($0), 1) }, chord: true, group: "chord"))
        t.append(Target(x: 150, y: 60, r: 28, label: "FRONTS", valves: [(i("down-fl"), 1), (i("down-fr"), 1)], chord: true, group: "chord"))
        targets = t
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 10 else { return }
        deck = DeckGeometry.layout(bounds.size)
        frames = []; placed = []
        let k = CGFloat(deck.valveK)
        if deck.valves.count == 1, let r = deck.valves.first {
            frames.append((r.cgRect, 0, k))
        } else if deck.valves.count == 2 {
            frames.append((deck.valves[0].cgRect, 0, k))                                  // the car's left: x 0…190
            frames.append((deck.valves[1].cgRect, CGFloat(Deck.padW - Deck.halfW), k))     // its right: x 110…300
        }
        for (fi, f) in frames.enumerated() {
            for (ti, t) in targets.enumerated() {
                let side: CGFloat = t.x < 150 ? -1 : t.x > 150 ? 1 : 0
                if frames.count == 2 && ((fi == 0 && side > 0) || (fi == 1 && side < 0)) { continue }
                placed.append(Placed(target: ti, frame: fi, c: point(t.x, t.y, in: fi), r: t.r * f.k))
            }
        }
        accessibilityLabel = frames.count == 2 ? "Nozzle pad, split: the car's left valves on the left, its right on the right" : "Nozzle pad, ten valves"
        setNeedsDisplay()
    }
    private func point(_ x: CGFloat, _ y: CGFloat, in fi: Int) -> CGPoint {
        let f = frames[fi]
        return CGPoint(x: f.rect.minX + (x - f.x0) * f.k, y: f.rect.minY + y * f.k)
    }

    private func padAt(_ p: CGPoint) -> Int {
        var best = -1, bestD = CGFloat.infinity
        for (i, pl) in placed.enumerated() {
            let d = hypot(p.x - pl.c.x, p.y - pl.c.y)
            if d < pl.r + 6 * frames[pl.frame].k && d < bestD { best = i; bestD = d }
        }
        return best
    }
    private func recompute() {
        var v = [Double](repeating: 0, count: 10)
        for on in touchesOn.values where on.pad >= 0 {
            for (i, x) in targets[placed[on.pad].target].valves { v[i] = max(v[i], (max(0, min(1, x * on.pressure)) * 20).rounded() / 20) }
        }
        onValves?(v)
        // A press's feel, once per newly held target, by what it fires.
        let held = Set(touchesOn.values.compactMap { $0.pad >= 0 ? placed[$0.pad].target : nil })
        if let t = held.subtracting(lastHeld).first {
            switch targets[t].group {
            case "lift": PressHaptics.feel(.valveLift)
            case "rear": PressHaptics.feel(.valveRear)
            case "yaw": PressHaptics.feel(.valveYaw)
            default: PressHaptics.feel(.chord)
            }
        }
        lastHeld = held
        setNeedsDisplay()
    }
    /// The web's `realPressure`: a pen's pressure counts; a finger's doesn't (it presses the whole valve).
    private func pressure(_ t: UITouch) -> Double {
        guard t.type == .pencil, t.maximumPossibleForce > 0 else { return 1 }
        return max(0.15, Double(t.force / t.maximumPossibleForce))
    }
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { padAt(point) >= 0 }
    override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) {
        InputLag.note(e)
        for t in ts { touchesOn[ObjectIdentifier(t)] = (padAt(t.location(in: self)), pressure(t)) }
        recompute()
    }
    override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) {
        for t in ts { touchesOn[ObjectIdentifier(t)] = (padAt(t.location(in: self)), pressure(t)) }
        recompute()
    }
    override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) { for t in ts { touchesOn[ObjectIdentifier(t)] = nil }; recompute() }
    override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) { touchesEnded(ts, with: e) }
    func letGo() { touchesOn.removeAll(); recompute() }

    // --- Drawing ---------------------------------------------------------------------------------------------------
    override func draw(_ rect: CGRect) {
        guard let g = UIGraphicsGetCurrentContext() else { return }
        let ink = UIColor(red: 0.961, green: 0.965, blue: 0.973, alpha: 1), ice = UIColor(red: 0.749, green: 0.902, blue: 1, alpha: 1)
        let held = Set(touchesOn.values.compactMap { $0.pad >= 0 ? placed[$0.pad].target : nil })
        for (fi, f) in frames.enumerated() {
            g.saveGState()
            // The half's own car: clipped at the spine, which is drawn as the cut (a dashed hairline).
            if frames.count == 2 {
                let spine = point(150, 0, in: fi).x
                let clip = fi == 0 ? CGRect(x: f.rect.minX - 40, y: f.rect.minY - 40, width: spine - f.rect.minX + 40, height: f.rect.height + 80)
                                   : CGRect(x: spine, y: f.rect.minY - 40, width: f.rect.maxX - spine + 40, height: f.rect.height + 80)
                g.saveGState(); g.clip(to: clip); outline(g, fi, ink); g.restoreGState()
                g.setStrokeColor(ink.withAlphaComponent(0.18).cgColor); g.setLineWidth(1); g.setLineDash(phase: 0, lengths: [3, 5])
                g.move(to: point(150, 14, in: fi)); g.addLine(to: point(150, 356, in: fi)); g.strokePath()
                g.setLineDash(phase: 0, lengths: [])
            } else { outline(g, fi, ink) }
            // Leaders and jets: from each pad in this frame to its nozzle's true place.
            for pl in placed where pl.frame == fi {
                let t = targets[pl.target]
                guard !t.chord, let (vi, _) = t.valves.first else { continue }
                let n = NOZZLE_SPEC[vi], tp = NozzlePadView.plan(n.pos.0, n.pos.2), at = point(tp.x, tp.y, in: fi)
                let dx = at.x - pl.c.x, dy = at.y - pl.c.y, d = hypot(dx, dy)
                if d > pl.r + 2 {
                    g.setStrokeColor(ink.withAlphaComponent(0.2).cgColor); g.setLineWidth(0.75)
                    g.move(to: CGPoint(x: pl.c.x + dx / d * pl.r, y: pl.c.y + dy / d * pl.r)); g.addLine(to: at); g.strokePath()
                }
                let v = CGFloat(min(1, max(0, throttles[vi])))
                g.setFillColor(ink.withAlphaComponent(v > 0.01 ? 0.95 : 0.5).cgColor)
                g.fillEllipse(in: CGRect(x: at.x - 2, y: at.y - 2, width: 4, height: 4))
                guard v > 0.01 else { continue }
                g.setStrokeColor(ice.withAlphaComponent(0.9).cgColor); g.setLineWidth(2); g.setLineCap(.round)
                if n.group == "lift" {
                    let r = (5 + 12 * v) * f.k
                    g.strokeEllipse(in: CGRect(x: at.x - r, y: at.y - r, width: r * 2, height: r * 2))
                } else {
                    // The gas leaves against the thrust: on the glass, nose up, a rear jet points down, a yaw jet out sideways.
                    let len = (10 + 30 * v) * f.k
                    g.move(to: at); g.addLine(to: CGPoint(x: at.x + CGFloat(n.dir.0) * len, y: at.y + CGFloat(n.dir.2) * len)); g.strokePath()
                }
            }
            g.restoreGState()
        }
        for pl in placed {
            let t = targets[pl.target], c = pl.c, r = pl.r, on = held.contains(pl.target)
            g.setFillColor((on ? ink.withAlphaComponent(0.88) : UIColor(red: 0.04, green: 0.05, blue: 0.08, alpha: 0.66)).cgColor)
            g.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            g.setStrokeColor(ink.withAlphaComponent(on ? 0 : t.chord ? 0.5 : 0.22).cgColor); g.setLineWidth(1)
            g.strokeEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
            if !t.chord, let v = t.valves.first.map({ throttles[$0.0] }), v > 0.01 {   // the live valve
                g.setStrokeColor(ice.cgColor); g.setLineWidth(3); g.setLineCap(.butt)
                g.addArc(center: c, radius: r - 3, startAngle: -.pi / 2, endAngle: -.pi / 2 + .pi * 2 * CGFloat(min(1, v)), clockwise: false)
                g.strokePath()
            }
            let k = frames[pl.frame].k
            let fs = (t.chord ? 10.5 : 11.5) * max(k, 0.85)
            let font = UIFont(name: "Geist-Medium", size: t.chord ? fs * 0.92 : fs) ?? .systemFont(ofSize: fs)
            let a: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: on ? UIColor.black : ink, .kern: t.chord ? 1.1 : 0.4]
            let s = NSAttributedString(string: t.label, attributes: a), z = s.size()
            s.draw(at: CGPoint(x: c.x - z.width / 2, y: c.y - z.height / 2))
        }
    }
    /// The car's true plan: 4.33 m by 2.0 m, the wheels' four marks at their tracks and axles.
    private func outline(_ g: CGContext, _ fi: Int, _ ink: UIColor) {
        let tl = point(NozzlePadView.plan(SPEC.width / 2, 0).x, 20, in: fi), br = point(NozzlePadView.plan(-SPEC.width / 2, 0).x, 350, in: fi)
        let body = CGRect(x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y)
        g.setStrokeColor(ink.withAlphaComponent(0.16).cgColor); g.setLineWidth(1)
        g.addPath(UIBezierPath(roundedRect: body, cornerRadius: body.width * 0.22).cgPath); g.strokePath()
        g.setStrokeColor(ink.withAlphaComponent(0.1).cgColor)
        for (track, z, w) in [(SPEC.trackFront, AXLE_F, SPEC.tyreWidthFront), (SPEC.trackRear, AXLE_R, SPEC.tyreWidthRear)] {
            for side in [-1.0, 1.0] {
                let c = NozzlePadView.plan(side * track / 2, z), p = point(c.x, c.y, in: fi)
                let ww = CGFloat(w * NozzlePadView.S) * frames[fi].k, hh = CGFloat(SPEC.wheelRadius * 2 * NozzlePadView.S) * frames[fi].k
                g.stroke(CGRect(x: p.x - ww / 2, y: p.y - hh / 2, width: ww, height: hh))
            }
        }
    }
}

struct NozzlePad: UIViewRepresentable {
    @ObservedObject var game = Game.shared
    let layoutKey: String
    func makeUIView(context: Context) -> NozzlePadView {
        let v = NozzlePadView()
        v.onValves = { vals in MainActor.assumeIsolated { Game.shared.live?.sampler.nozzleValves = vals } }
        return v
    }
    func updateUIView(_ v: NozzlePadView, context: Context) {
        if v.accessibilityIdentifier != layoutKey { v.accessibilityIdentifier = layoutKey; v.setNeedsLayout() }
        v.throttles = game.hud.throttles
    }
    static func dismantleUIView(_ v: NozzlePadView, coordinator: ()) { v.letGo(); v.onValves?([Double](repeating: 0, count: 10)) }
}
