// The flight controls on raw UIKit touches. No gesture recogniser and no SwiftUI between the glass and the sim: a press reaches
// the controls inside touchesBegan, and its highlight is in the same frame (no implicit animations). Touches the system cancels
// release what they held, and so does the view going away, so a thruster can't stick on. Dead zones and shaping stay in the sim's
// InputSampler (Hands.swift), the web's, so scores don't change. Layouts match CameraFraming's numbers: ThumbPad.size, ClassicPad.
import UIKit
import SwiftUI
import QuartzCore
import ColdGasCore
import ColdGasPhysics

/// The press's tick on the glass: generators kept prepared, because an unprepared one is late and costs the touch thread.
enum PressHaptics {
    private static let soft = UIImpactFeedbackGenerator(style: .soft), tick = UISelectionFeedbackGenerator()
    static func prepare() { soft.prepare(); tick.prepare() }
    static func press() { soft.impactOccurred(intensity: 0.5); soft.prepare() }
    static func slide() { tick.selectionChanged(); tick.prepare() }
}

/// `-input-log`: how late each press is, from the event's own timestamp. Off, this is one Bool read per press and per frame.
enum InputLag {
    static let on = Launch.args.contains("-input-log")
    private static var event: TimeInterval = 0, handled: TimeInterval = 0
    static func note(_ e: UIEvent?) {
        guard on, let e else { return }
        event = e.timestamp; handled = CACurrentMediaTime()
        setvbuf(stdout, nil, _IOLBF, 0)
    }
    /// From the display link, after the frame that carries the press is encoded.
    static func frame(target: CFTimeInterval) {
        guard on, event > 0 else { return }
        print(String(format: "INPUT delivered %.1f ms, on glass %.1f ms", (handled - event) * 1000, (target - event) * 1000))
        event = 0
    }
}

/// What both surfaces share: multi-touch, layers that change at once, one label's drawing.
class ControlSurface: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isOpaque = false
        backgroundColor = .clear
    }
    required init?(coder: NSCoder) { nil }
    override func didMoveToWindow() { super.didMoveToWindow(); if window != nil { PressHaptics.prepare() } }
    func instantly(_ body: () -> Void) {
        CATransaction.begin(); CATransaction.setDisableActions(true); body(); CATransaction.commit()
    }
    func makeLabel(_ size: CGFloat) -> CATextLayer {
        let t = CATextLayer()
        t.contentsScale = UIScreen.main.scale
        t.alignmentMode = .center
        t.font = UIFont(name: "Geist", size: size)
        t.fontSize = size
        t.actions = ["contents": NSNull(), "foregroundColor": NSNull(), "string": NSNull()]
        return t
    }
    /// A label centred on `c`, one line.
    func place(_ t: CATextLayer, at c: CGPoint, width: CGFloat) {
        let h = t.fontSize * 1.3
        t.frame = CGRect(x: c.x - width / 2, y: c.y - h / 2, width: width, height: h)
    }
    func element(_ label: String, _ frame: CGRect, hint: String? = nil) -> UIAccessibilityElement {
        let e = UIAccessibilityElement(accessibilityContainer: self)
        e.accessibilityLabel = label
        e.accessibilityHint = hint
        e.accessibilityFrameInContainerSpace = frame
        e.accessibilityTraits = [.staticText, .allowsDirectInteraction]
        return e
    }
    static let glass = UIColor(red: 0.039, green: 0.051, blue: 0.078, alpha: 0.62).cgColor
    static let ink = UIColor(red: 0.961, green: 0.965, blue: 0.973, alpha: 1)
    static let hair = ink.withAlphaComponent(0.22).cgColor
    static let bg = UIColor(red: 0.020, green: 0.027, blue: 0.047, alpha: 1)
}

// MARK: - One thumb

final class ThumbSurfaceView: ControlSurface {
    var panel = false { didSet { if panel != oldValue { setNeedsLayout() } } }
    private let disc = CAShapeLayer(), aim = CAShapeLayer(), mark = CAShapeLayer(), label: CATextLayer
    private var thumb: UITouch?, start = CGPoint.zero, word = ""
    private var size: CGFloat { panel ? min(bounds.width, bounds.height) * 0.78 : ThumbPad.size(bounds.width) }
    private var center0: CGPoint {
        panel ? CGPoint(x: bounds.midX, y: bounds.midY) : CGPoint(x: bounds.width - size / 2 - 8, y: bounds.height - size / 2 - 8)
    }
    override init(frame: CGRect) {
        label = CATextLayer()
        super.init(frame: frame)
        aim.fillColor = nil; aim.strokeColor = UIColor(red: 0.749, green: 0.902, blue: 1, alpha: 0.4).cgColor; aim.isHidden = true
        mark.fillColor = UIColor(red: 0.749, green: 0.902, blue: 1, alpha: 1).cgColor; mark.isHidden = true
        layer.addSublayer(disc); layer.addSublayer(aim); layer.addSublayer(mark)
        layer.addSublayer(label)
        label.contentsScale = UIScreen.main.scale; label.alignmentMode = .center
        label.font = UIFont(name: "Geist", size: 13); label.fontSize = 13
        label.actions = ["contents": NSNull(), "string": NSNull()]
        mark.actions = ["position": NSNull(), "hidden": NSNull()]
        paint()
    }
    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        instantly {
            let s = size, c = center0
            disc.path = UIBezierPath(ovalIn: CGRect(x: c.x - s / 2, y: c.y - s / 2, width: s, height: s)).cgPath
            let a = s * 0.56
            aim.path = UIBezierPath(ovalIn: CGRect(x: c.x - a / 2, y: c.y - a / 2, width: a, height: a)).cgPath
            mark.bounds = CGRect(x: 0, y: 0, width: 8, height: 8)
            mark.path = UIBezierPath(ovalIn: mark.bounds).cgPath
            label.fontSize = panel ? 16 : 13
            place(label, at: c, width: s)
        }
        accessibilityElements = [element("Thrust pad", CGRect(x: center0.x - size / 2, y: center0.y - size / 2, width: size, height: size), hint: word)]
    }
    func update(word: String, aimLive: Bool, hasMark: Bool, markX: CGFloat, markY: CGFloat) {
        instantly {
            if word != self.word {
                self.word = word
                label.string = NSAttributedString(string: word.uppercased(), attributes: [.font: UIFont(name: "Geist-Medium", size: label.fontSize) ?? UIFont(name: "Geist", size: label.fontSize) ?? .systemFont(ofSize: label.fontSize, weight: .medium), .foregroundColor: ControlSurface.ink, .kern: 1.6])
                place(label, at: center0, width: size)
            }
            aim.isHidden = !aimLive
            mark.isHidden = !hasMark
            if hasMark { mark.position = CGPoint(x: center0.x + markX, y: center0.y + markY) }
        }
    }
    private func paint() {
        let on = thumb != nil
        instantly {
            disc.fillColor = on ? ControlSurface.ink.withAlphaComponent(0.22).cgColor : ControlSurface.glass
            disc.strokeColor = on ? ControlSurface.ink.withAlphaComponent(0.8).cgColor : ControlSurface.hair
            disc.lineWidth = on ? 2 : 1
        }
    }
    /// A thumb that lands a little off the disc still means the pad: on a tabletop panel, anywhere.
    override func point(inside p: CGPoint, with e: UIEvent?) -> Bool {
        if panel { return bounds.contains(p) }
        return hypot(p.x - center0.x, p.y - center0.y) <= size / 2 + 28
    }
    override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) {
        guard thumb == nil, let t = ts.first else { return }
        InputLag.note(e)
        thumb = t; start = t.location(in: self)
        Game.shared.controls.thumbDown()
        paint()
        PressHaptics.press()
    }
    override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) {
        guard let t = thumb, ts.contains(t) else { return }
        let p = t.location(in: self)
        Game.shared.controls.thumbMove(dx: p.x - start.x, dy: start.y - p.y)
    }
    override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) { if let t = thumb, ts.contains(t) { letGo() } }
    override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) { touchesEnded(ts, with: e) }
    func letGo() {
        guard thumb != nil else { return }
        thumb = nil
        Game.shared.controls.thumbUp()
        paint()
    }
}

struct ThumbSurface: UIViewRepresentable {
    let panel: Bool, word: String, aimLive: Bool, hasMark: Bool, markX: Double, markY: Double
    func makeUIView(context: Context) -> ThumbSurfaceView { ThumbSurfaceView() }
    func updateUIView(_ v: ThumbSurfaceView, context: Context) {
        v.panel = panel
        v.update(word: word, aimLive: aimLive, hasMark: hasMark, markX: markX, markY: markY)
    }
    static func dismantleUIView(_ v: ThumbSurfaceView, coordinator: ()) { v.letGo() }
}

// MARK: - Classic: the stick on the left, four buttons on the right

final class ClassicSurfaceView: ControlSurface {
    private struct Pad { let key: Controls.Key; let shape = CAShapeLayer(); let text: CATextLayer; var rect = CGRect.zero; var label = "" }
    private enum Hold: Equatable { case stick, pad(Int) }
    var panel = false { didSet { if panel != oldValue { setNeedsLayout() } } }
    private var pads: [Pad] = []
    private let ring = CAShapeLayer(), knob = CAShapeLayer()
    private var holds: [ObjectIdentifier: Hold] = [:]
    private var down = Set<Int>()
    private var stickTouch: UITouch?
    private var unit: CGFloat { panel ? min(bounds.height * 0.42, 150) : ClassicPad.unit }
    private var margin: CGFloat { panel ? 20 : ClassicPad.margin }
    private var radius: CGFloat { unit * 0.5 }
    private var stickCentre: CGPoint { CGPoint(x: margin + radius * 1.2, y: bounds.height - margin - radius * 1.2) }

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(ring); layer.addSublayer(knob)
        ring.fillColor = ControlSurface.glass; ring.strokeColor = ControlSurface.hair
        knob.fillColor = ControlSurface.ink.withAlphaComponent(0.9).cgColor
        knob.actions = ["position": NSNull()]
        for k in [Controls.Key.lift, .land, .brake, .go] {
            let p = Pad(key: k, text: makeLabel(13))
            p.shape.lineWidth = 1
            layer.addSublayer(p.shape); layer.addSublayer(p.text)
            pads.append(p)
        }
        paint()
    }
    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = unit * 0.62, gap: CGFloat = 10, right = bounds.width - margin, bottom = bounds.height - margin
        for i in pads.indices {
            let col = CGFloat(i % 2), row = CGFloat(i / 2)
            pads[i].rect = CGRect(x: right - 2 * s - gap + col * (s + gap), y: bottom - 2 * s - gap + row * (s + gap), width: s, height: s)
        }
        instantly {
            let r = radius * 1.2, c = stickCentre
            ring.path = UIBezierPath(ovalIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)).cgPath
            let k = radius * 0.35
            knob.bounds = CGRect(x: 0, y: 0, width: k * 2, height: k * 2)
            knob.path = UIBezierPath(ovalIn: knob.bounds).cgPath
            if stickTouch == nil { knob.position = c }
            for p in pads {
                p.shape.path = UIBezierPath(roundedRect: p.rect, cornerRadius: 16).cgPath
                place(p.text, at: CGPoint(x: p.rect.midX, y: p.rect.midY), width: s)
            }
        }
        var els = [element("Steering stick", CGRect(x: stickCentre.x - radius * 1.2, y: stickCentre.y - radius * 1.2, width: radius * 2.4, height: radius * 2.4))]
        els += pads.map { element($0.label, $0.rect) }
        accessibilityElements = els
    }
    func update(air: Bool) {
        let names = ["LIFT", "LAND", "BRAKE", air ? "BOOST" : "GO"]
        guard names != pads.map(\.label) else { return }
        for i in pads.indices { pads[i].label = names[i] }
        paint()
        setNeedsLayout()
    }
    /// Pressed is the inverse, at once: the highlight is the first thing a thumb reads.
    private func paint() {
        instantly {
            for (i, p) in pads.enumerated() {
                let on = down.contains(i)
                p.shape.fillColor = on ? ControlSurface.ink.cgColor : ControlSurface.glass
                p.shape.strokeColor = on ? UIColor.clear.cgColor : ControlSurface.hair
                p.text.string = NSAttributedString(string: p.label, attributes: [.font: UIFont(name: "Geist-Medium", size: 13) ?? UIFont(name: "Geist", size: 13) ?? .systemFont(ofSize: 13, weight: .medium), .foregroundColor: on ? ControlSurface.bg : ControlSurface.ink, .kern: 1.2])
            }
        }
    }
    /// The pad under a finger. Each pad's zone runs to the middle of the gaps and 12 pt past the block, so nothing between pads is dead.
    private func padAt(_ p: CGPoint, strict: Bool = false) -> Int? {
        guard !pads.isEmpty else { return nil }
        if strict { return pads.firstIndex { $0.rect.insetBy(dx: 6, dy: 6).contains(p) } }
        let block = pads.reduce(pads[0].rect) { $0.union($1.rect) }.insetBy(dx: -12, dy: -12)
        guard block.contains(p) else { return nil }
        return pads.indices.min { hypot(pads[$0].rect.midX - p.x, pads[$0].rect.midY - p.y) < hypot(pads[$1].rect.midX - p.x, pads[$1].rect.midY - p.y) }
    }
    private func inStick(_ p: CGPoint) -> Bool { hypot(p.x - stickCentre.x, p.y - stickCentre.y) <= radius * 1.2 + 24 }
    override func point(inside p: CGPoint, with e: UIEvent?) -> Bool { inStick(p) || padAt(p) != nil }

    private func moveStick(_ t: UITouch) {
        let p = t.location(in: self), dx = Double(p.x - stickCentre.x), dy = Double(p.y - stickCentre.y)
        let v = TouchControls.stickXY(dx: dx, dy: dy, radius: Double(radius))
        Game.shared.controls.stick(x: v.x, y: v.y)
        instantly { knob.position = CGPoint(x: stickCentre.x + CGFloat(v.x) * radius, y: stickCentre.y + CGFloat(v.y) * radius) }
    }
    /// Presses and releases what changed. Two fingers on one pad hold it until both have left.
    private func sync(slid: Bool = false) {
        var now = Set<Int>()
        for h in holds.values { if case let .pad(i) = h { now.insert(i) } }
        guard now != down else { return }
        let pressed = now.subtracting(down)
        for i in pressed { Game.shared.controls.press(pads[i].key, true) }
        for i in down.subtracting(now) { Game.shared.controls.press(pads[i].key, false) }
        down = now
        paint()
        if !pressed.isEmpty { if slid { PressHaptics.slide() } else { PressHaptics.press() } }
    }
    override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) {
        InputLag.note(e)
        for t in ts {
            let p = t.location(in: self)
            if let i = padAt(p) { holds[ObjectIdentifier(t)] = .pad(i) }
            else if inStick(p), stickTouch == nil { holds[ObjectIdentifier(t)] = .stick; stickTouch = t; moveStick(t) }
        }
        sync()
    }
    override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) {
        var slid = false
        for t in ts {
            switch holds[ObjectIdentifier(t)] {
            case .stick: moveStick(t)
            case .pad(let i):
                // Only clearly onto another pad: a drifting thumb keeps what it holds.
                if let j = padAt(t.location(in: self), strict: true), j != i { holds[ObjectIdentifier(t)] = .pad(j); slid = true }
            default: break
            }
        }
        if slid { sync(slid: true) }
    }
    override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) {
        for t in ts {
            if holds.removeValue(forKey: ObjectIdentifier(t)) == .stick { centreStick() }
        }
        sync()
    }
    override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) { touchesEnded(ts, with: e) }
    private func centreStick() {
        stickTouch = nil
        Game.shared.controls.stick(x: 0, y: 0)
        instantly { knob.position = stickCentre }
    }
    func letGo() {
        if stickTouch != nil { centreStick() }
        holds.removeAll()
        sync()
    }
}

struct ClassicSurface: UIViewRepresentable {
    let panel: Bool, air: Bool
    func makeUIView(context: Context) -> ClassicSurfaceView { ClassicSurfaceView() }
    func updateUIView(_ v: ClassicSurfaceView, context: Context) { v.panel = panel; v.update(air: air) }
    static func dismantleUIView(_ v: ClassicSurfaceView, coordinator: ()) { v.letGo() }
}
