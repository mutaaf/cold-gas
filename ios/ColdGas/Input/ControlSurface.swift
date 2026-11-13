// The flight controls on raw UIKit touches. No gesture recogniser and no SwiftUI between the glass and the sim: a press reaches
// the controls inside touchesBegan, and its highlight is in the same frame (no implicit animations). Touches the system cancels
// release what they held, and so does the view going away, so a thruster can't stick on. Dead zones and shaping stay in the sim's
// InputSampler (Hands.swift), the web's, so scores don't change. Layouts match CameraFraming's numbers: ThumbPad.size, Deck.
// The classic deck is FlightDeck.swift; Advanced's valves are NozzlePad.swift.
import UIKit
import SwiftUI
import QuartzCore
import ColdGasCore
import ColdGasLayout
import ColdGasPhysics

/// The press's feel on the glass, one per control (0210): GO soft, BRAKE rigid, LIFT and LAND heavier, RELEASE the heaviest,
/// BOOST sharp; each valve group its own weight; the stick ticks leaving its dead zone and at its rim. Generators are made
/// once and kept prepared (an unprepared one is late and costs the touch thread). Settings' Haptics: Off silences these
/// too, Subtle halves them (docs/NATIVE.md §6). They only echo what the press already shows.
enum PressHaptics {
    enum Feel { case go, brake, lift, release, land, boost, valveLift, valveRear, valveYaw, chord, stickEdge, stickRim }
    private static let soft = UIImpactFeedbackGenerator(style: .soft), rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let medium = UIImpactFeedbackGenerator(style: .medium), heavy = UIImpactFeedbackGenerator(style: .heavy)
    private static let light = UIImpactFeedbackGenerator(style: .light), tick = UISelectionFeedbackGenerator()
    private static var k: CGFloat {
        switch HapticPlayer.shared.level { case .off: return 0; case .subtle: return 0.5; case .full: return 1 }
    }
    static func prepare() { for g in [soft, rigid, medium, heavy, light] { g.prepare() }; tick.prepare() }
    /// The one-thumb pad's press.
    static func press() { feel(.go) }
    static func slide() { guard k > 0 else { return }; tick.selectionChanged(); tick.prepare() }
    static func feel(_ f: Feel) {
        let k = self.k
        guard k > 0 else { return }
        let (g, i): (UIImpactFeedbackGenerator, CGFloat)
        switch f {
        case .go: (g, i) = (soft, 0.5)
        case .brake: (g, i) = (rigid, 0.6)
        case .lift: (g, i) = (medium, 0.75)
        case .release: (g, i) = (heavy, 1.0)
        case .land: (g, i) = (medium, 0.6)
        case .boost: (g, i) = (rigid, 0.9)
        case .valveLift: (g, i) = (medium, 0.55)
        case .valveRear: (g, i) = (rigid, 0.6)
        case .valveYaw: (g, i) = (light, 0.6)
        case .chord: (g, i) = (heavy, 0.7)
        case .stickEdge: slide(); return
        case .stickRim: (g, i) = (light, 0.45)
        }
        g.impactOccurred(intensity: i * k)
        g.prepare()
    }
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
    /// Where the deck's layout puts the pad (Deck's bottom right, or the player's place for it: HudLayout).
    private var spot = DeckSlot(c: LPoint(x: 0, y: 0), d: 0)
    private var size: CGFloat { panel ? min(bounds.width, bounds.height) * 0.78 : spot.d }
    private var center0: CGPoint { panel ? CGPoint(x: bounds.midX, y: bounds.midY) : spot.c.cg }
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
        let l = DeckGeometry.layout(bounds.size)
        spot = l.thumb
        let alpha = panel ? 1 : Float(l.alpha(.thumb))
        instantly {
            for x in [disc, aim, mark, label] as [CALayer] { x.opacity = alpha }
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
    @ObservedObject var hud = HudStore.shared
    func makeUIView(context: Context) -> ThumbSurfaceView { ThumbSurfaceView() }
    func updateUIView(_ v: ThumbSurfaceView, context: Context) {
        if v.tag != hud.revision { v.tag = hud.revision; v.setNeedsLayout() }
        v.panel = panel
        v.update(word: word, aimLive: aimLive, hasMark: hasMark, markX: markX, markY: markY)
    }
    static func dismantleUIView(_ v: ThumbSurfaceView, coordinator: ()) { v.letGo() }
}
