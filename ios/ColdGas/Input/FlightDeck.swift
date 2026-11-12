// The classic flight deck (0210): Pro, Advanced on the ground, and Assist when classic is chosen. The stick under the left
// thumb, and a fan of three slots on the arc the right thumb sweeps, placed for the shape of the screen (ColdGasLayout's
// Deck: phone, phone sideways, the Duo open, the Duo's tabletop console, an iPad's side grips).
//
// What it shows morphs with the flight, by the web's rule (Deck.buttons = main.js syncTouchPhase): GO and BRAKE on the
// ground and the curl, RELEASE once on the ledge, LIFT (or LAND on Assist) and BOOST in the air, BRAKE once down.
// A ghost ring breathes round the control the cue line names. Every press is the same call as before:
// TouchControls.press / release / stick. The deck changes nothing the sim reads but where the fingers go.
//
// Latency (0167): raw UIKit touches, no gesture recogniser; a press reaches the controls inside touchesBegan and its
// highlight is in the same frame (no implicit animations on it). Only a slot appearing or leaving animates.
import UIKit
import SwiftUI
import QuartzCore
import ColdGasLayout
import ColdGasPhysics

/// The fold layout as the deck and the camera read it: set by the root on every layout change.
enum DeckGeometry {
    static var spread: Spread = .single
    /// The fold band in the controls rect's coordinates.
    static var fold: LRect?
    static func layout(_ size: CGSize) -> DeckLayout {
        let f = Deck.form(spread: spread, width: Double(size.width), height: Double(size.height))
        return Deck.layout(form: f, width: Double(size.width), height: Double(size.height), fold: fold)
    }
}

extension LPoint { var cg: CGPoint { CGPoint(x: x, y: y) } }

/// What the deck shows this moment (from the HUD state, a few times a second).
struct DeckShow: Equatable {
    var buttons: [DeckButton?] = [DeckButton(.go, "GO"), DeckButton(.brake, "BRAKE"), nil]
    var stickLabel: String? = "STEER"
    var hint: String?
    var gas = 1.0
    var strip = 0, stripNames = Deck.stripNames(course: "show")
}

final class FlightDeckView: ControlSurface {
    private struct Slot {
        let disc = CAShapeLayer(), tank = CAShapeLayer(), ghost = CAShapeLayer(), text: CATextLayer
        var button: DeckButton?
        var geo = DeckSlot(c: LPoint(x: 0, y: 0), d: 0)
    }
    private enum Hold: Equatable { case stick, key(DeckKey) }

    private var deck = Deck.layout(form: .phone, width: 1, height: 1)
    private var show = DeckShow()
    private var slots: [Slot] = []
    private let chrome = DeckChrome()
    private let fanArc = CAShapeLayer()
    private let ring = CAShapeLayer(), dead = CAShapeLayer(), knob = CAShapeLayer(), homeGhost = CAShapeLayer(), stickGhost = CAShapeLayer()
    private let stickText: CATextLayer
    private var holds: [ObjectIdentifier: Hold] = [:]
    private var down = Set<DeckKey>()
    private var stickTouch: UITouch?
    private var stickOrigin = CGPoint.zero
    private var stickWas = (out: false, rim: false)
    private let reduced = UIAccessibility.isReduceMotionEnabled

    override init(frame: CGRect) {
        stickText = CATextLayer()
        super.init(frame: frame)
        chrome.install(in: layer)
        fanArc.fillColor = nil; fanArc.strokeColor = ControlSurface.ink.withAlphaComponent(0.13).cgColor
        fanArc.lineWidth = 1; fanArc.lineDashPattern = [1, 5]; fanArc.lineCap = .round
        layer.addSublayer(fanArc)
        homeGhost.fillColor = nil; homeGhost.strokeColor = ControlSurface.ink.withAlphaComponent(0.12).cgColor; homeGhost.lineDashPattern = [2, 4]; homeGhost.isHidden = true
        ring.fillColor = ControlSurface.glass; ring.strokeColor = ControlSurface.hair
        dead.fillColor = nil; dead.strokeColor = ControlSurface.ink.withAlphaComponent(0.14).cgColor; dead.lineWidth = 1
        knob.fillColor = ControlSurface.ink.withAlphaComponent(0.9).cgColor
        stickGhost.fillColor = nil; stickGhost.strokeColor = FlightDeckView.ice.cgColor; stickGhost.lineWidth = 1.5; stickGhost.opacity = 0
        for l in [homeGhost, ring, dead, stickGhost, knob] { l.actions = FlightDeckView.still; layer.addSublayer(l) }
        stickText.contentsScale = UIScreen.main.scale; stickText.alignmentMode = .center; stickText.actions = FlightDeckView.still
        layer.addSublayer(stickText)
        for _ in 0..<3 {
            let s = Slot(text: makeLabel(13))
            s.tank.fillColor = nil; s.tank.lineWidth = 2; s.tank.lineCap = .round; s.tank.strokeColor = FlightDeckView.ice.withAlphaComponent(0.85).cgColor
            s.ghost.fillColor = nil; s.ghost.lineWidth = 1.5; s.ghost.strokeColor = FlightDeckView.ice.cgColor; s.ghost.opacity = 0
            for l in [s.ghost, s.disc, s.tank] { l.actions = FlightDeckView.still; l.opacity = 0; layer.addSublayer(l) }
            s.text.actions = FlightDeckView.still; s.text.opacity = 0
            layer.addSublayer(s.text)
            slots.append(s)
        }
    }
    required init?(coder: NSCoder) { nil }

    static let ice = UIColor(red: 0.749, green: 0.902, blue: 1, alpha: 1)
    static let amber = UIColor(red: 1, green: 0.749, blue: 0.353, alpha: 1)
    static let still: [String: CAAction] = ["position": NSNull(), "bounds": NSNull(), "path": NSNull(), "hidden": NSNull(), "opacity": NSNull(),
                                             "fillColor": NSNull(), "strokeColor": NSNull(), "contents": NSNull(), "string": NSNull(),
                                             "transform": NSNull(), "strokeEnd": NSNull(), "lineWidth": NSNull(), "foregroundColor": NSNull()]

    // --- Layout ----------------------------------------------------------------------------------------------------
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 10, bounds.height > 10 else { return }
        deck = DeckGeometry.layout(bounds.size)
        instantly {
            chrome.layout(deck, bounds: bounds)
            let rad = CGFloat.pi / 180
            fanArc.path = UIBezierPath(arcCenter: deck.pivot.cg, radius: deck.reach, startAngle: -CGFloat(deck.arc.to) * rad, endAngle: -CGFloat(deck.arc.from) * rad, clockwise: true).cgPath
            let st = deck.stick
            ring.lineWidth = deck.form == .phone ? 1 : 1.25
            if stickTouch == nil { placeRing(at: st.home.cg) }
            homeGhost.path = circle(st.home.cg, st.ring)
            let kr = st.travel * 0.36
            knob.bounds = CGRect(x: 0, y: 0, width: kr * 2, height: kr * 2)
            knob.path = UIBezierPath(ovalIn: knob.bounds).cgPath
            if stickTouch == nil { knob.position = st.home.cg }
            for i in slots.indices {
                slots[i].geo = deck.slots[i]
                let g = deck.slots[i], c = g.c.cg
                slots[i].disc.path = circle(c, g.r)
                slots[i].ghost.path = circle(.zero, g.r + 7); slots[i].ghost.position = c
                slots[i].tank.path = UIBezierPath(arcCenter: c, radius: g.r + 4, startAngle: .pi * 0.75, endAngle: .pi * 2.25, clockwise: true).cgPath
                slots[i].text.fontSize = i == 0 ? (deck.form == .phone ? 14 : 16) : (deck.form == .phone ? 12 : 13)
            }
        }
        paint(animated: false)
        accessibility()
    }
    private func circle(_ c: CGPoint, _ r: CGFloat) -> CGPath { UIBezierPath(ovalIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)).cgPath }
    private func placeRing(at c: CGPoint) {
        let st = deck.stick
        ring.path = circle(c, st.ring)
        dead.path = circle(c, st.travel * 0.15 + st.travel * 0.36)   // where the knob's edge sits at the dead zone's edge
        stickGhost.path = chevrons(c, st.ring)
        stickOrigin = c
        let fs: CGFloat = deck.form == .phone ? 10 : 11
        stickText.fontSize = fs
        stickText.frame = CGRect(x: c.x - st.ring, y: c.y + st.ring + 6, width: st.ring * 2, height: fs * 1.4)
    }
    /// The stick's ghost: ‹ › just outside the ring (the cue asks for a sideways stick).
    private func chevrons(_ c: CGPoint, _ r: CGFloat) -> CGPath {
        let p = UIBezierPath(), s: CGFloat = 7
        for side in [-1.0, 1.0] as [CGFloat] {
            let x = c.x + side * (r + 10)
            p.move(to: CGPoint(x: x - side * s * 0.6, y: c.y - s)); p.addLine(to: CGPoint(x: x + side * s * 0.4, y: c.y)); p.addLine(to: CGPoint(x: x - side * s * 0.6, y: c.y + s))
        }
        return p.cgPath
    }

    // --- What it shows ---------------------------------------------------------------------------------------------
    func update(_ s: DeckShow) {
        guard s != show else { return }
        let old = show
        show = s
        chrome.strip(names: s.stripNames, at: s.strip)
        paint(animated: old.buttons != s.buttons || old.stickLabel != s.stickLabel)
        if old.hint != s.hint || old.buttons != s.buttons { ghost() }
        if old.buttons != s.buttons { accessibility() }
    }

    /// Pressed is the inverse, at once. A slot arriving or leaving eases (scale and fade, or fade alone under Reduce Motion).
    private func paint(animated: Bool) {
        let heldStick = stickTouch != nil
        for i in slots.indices {
            let b = show.buttons[i], was = slots[i].button
            let changed = b != was
            slots[i].button = b
            let s = slots[i]
            let on = b.map { down.contains($0.key) } ?? false
            let vis = b != nil
            instantly {
                let ink = ControlSurface.ink
                s.disc.fillColor = on ? ink.cgColor : ControlSurface.glass
                let edge: UIColor = b?.amber == true ? FlightDeckView.amber.withAlphaComponent(0.8) : ink.withAlphaComponent(i == 0 ? 0.42 : 0.24)
                s.disc.strokeColor = on ? UIColor.clear.cgColor : edge.cgColor
                s.disc.lineWidth = i == 0 ? 1.5 : 1
                if let b {
                    let font = UIFont(name: "Geist-Medium", size: s.text.fontSize) ?? UIFont(name: "Geist", size: s.text.fontSize) ?? .systemFont(ofSize: s.text.fontSize, weight: .medium)
                    let color: UIColor = on ? ControlSurface.bg : b.amber ? FlightDeckView.amber : ink
                    s.text.string = NSAttributedString(string: b.label, attributes: [.font: font, .foregroundColor: color, .kern: 1.4])
                    place(s.text, at: s.geo.c.cg, width: s.geo.d)
                }
                // The tank round slot A when what it holds spends gas (LIFT in the air): the N₂ left, as the HUD's bar.
                let spends = i == 0 && (b.map { ($0.key == .lift || ($0.key == .go && $0.label == "BOOST")) } ?? false)
                s.tank.isHidden = !spends
                s.tank.strokeEnd = CGFloat(max(0, min(1, show.gas)))
                s.tank.strokeColor = (show.gas < 0.15 ? UIColor(red: 1, green: 0.353, blue: 0.384, alpha: 1) : FlightDeckView.ice.withAlphaComponent(0.85)).cgColor
            }
            if changed {
                appear(s, visible: vis, animated: animated)
            }
        }
        let stickOn = show.stickLabel != nil
        instantly {
            ring.fillColor = heldStick ? ControlSurface.ink.withAlphaComponent(0.12).cgColor : ControlSurface.glass
            ring.strokeColor = heldStick ? ControlSurface.ink.withAlphaComponent(0.55).cgColor : ControlSurface.hair
            if let w = show.stickLabel {
                stickText.string = NSAttributedString(string: w, attributes: [.font: UIFont(name: "Geist-Medium", size: stickText.fontSize) ?? .systemFont(ofSize: stickText.fontSize), .foregroundColor: ControlSurface.ink.withAlphaComponent(0.55), .kern: 1.6])
            }
        }
        let stickLayers: [CALayer] = [ring, dead, knob, stickText]
        if stickLayers[0].opacity != (stickOn ? 1 : 0) {
            CATransaction.begin(); CATransaction.setAnimationDuration(animated ? 0.18 : 0)
            for l in stickLayers { l.opacity = stickOn ? 1 : 0 }
            CATransaction.commit()
        }
    }
    private func appear(_ s: Slot, visible: Bool, animated: Bool) {
        let layers: [CALayer] = [s.disc, s.text, s.tank]
        if !animated {
            instantly { for l in layers { l.opacity = visible ? 1 : 0; l.transform = CATransform3DIdentity } }
            return
        }
        for l in layers {
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = l.opacity; fade.toValue = visible ? 1 : 0
            fade.duration = visible ? 0.18 : 0.12
            fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
            l.add(fade, forKey: "appear")
            if visible && !reduced {
                // Grow from the slot's own centre (the disc's path is in the view's space, so scale about it).
                let c = s.geo.c.cg
                let k = CABasicAnimation(keyPath: "transform")
                var t = CATransform3DMakeTranslation(c.x, c.y, 0); t = CATransform3DScale(t, 0.7, 0.7, 1); t = CATransform3DTranslate(t, -c.x, -c.y, 0)
                k.fromValue = t; k.toValue = CATransform3DIdentity
                k.duration = 0.2; k.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.3, 1)
                l.add(k, forKey: "grow")
            }
        }
        instantly { for l in layers { l.opacity = visible ? 1 : 0 } }
    }

    /// The ghost: a slow hairline ring breathing round the control the cue names, until a finger is on it.
    private func ghost() {
        for (i, s) in slots.enumerated() {
            let named = show.hint != nil && s.button.map { $0.key.rawValue == show.hint } == true
            // Only the first slot carrying the named key (LIFT can't be in two at once, but be sure).
            let first = named && slots.prefix(i).allSatisfy { $0.button?.key.rawValue != show.hint }
            breathe(s.ghost, on: first && !(s.button.map { down.contains($0.key) } ?? false))
        }
        breathe(stickGhost, on: show.hint == "stick" && show.stickLabel != nil && stickTouch == nil)
    }
    private func breathe(_ l: CAShapeLayer, on: Bool) {
        let running = l.animation(forKey: "breathe") != nil || (reduced && l.opacity > 0)
        guard on != running else { return }
        l.removeAnimation(forKey: "breathe")
        guard on else { instantly { l.opacity = 0 }; return }
        if reduced { instantly { l.opacity = 0.5 }; return }
        let a = CABasicAnimation(keyPath: "opacity"); a.fromValue = 0.7; a.toValue = 0
        let g = CAAnimationGroup()
        if l !== stickGhost {
            let k = CABasicAnimation(keyPath: "transform.scale"); k.fromValue = 0.94; k.toValue = 1.22
            g.animations = [a, k]
        } else { g.animations = [a] }
        g.duration = 1.6; g.repeatCount = .infinity; g.timingFunction = CAMediaTimingFunction(name: .easeOut)
        l.add(g, forKey: "breathe")
    }

    private func accessibility() {
        var els: [UIAccessibilityElement] = []
        if show.stickLabel != nil { els.append(element(show.stickLabel == "STEER" ? "Steering stick" : "Attitude stick, roll and pitch", deck.stick.frame.cgRect)) }
        for s in slots { if let b = s.button { els.append(element(b.label.capitalized, s.geo.frame.cgRect)) } }
        accessibilityElements = els
    }

    // --- Touches -----------------------------------------------------------------------------------------------------
    /// The visible slot under a finger: the nearest within its radius and 14 pt more, so nothing between them is dead.
    private func slotAt(_ p: CGPoint, strict: Bool = false) -> Int? {
        var best: Int?, bestD = CGFloat.infinity
        for (i, s) in slots.enumerated() where s.button != nil {
            let d = hypot(p.x - s.geo.c.x, p.y - s.geo.c.y)
            if d <= s.geo.r + (strict ? -6 : 14), d < bestD { best = i; bestD = d }
        }
        return best
    }
    private var stickUp: Bool { show.stickLabel != nil }
    private func inZone(_ p: CGPoint) -> Bool { stickUp && deck.stick.zone.cgRect.contains(p) }
    override func point(inside p: CGPoint, with e: UIEvent?) -> Bool { slotAt(p) != nil || inZone(p) }

    private func moveStick(_ t: UITouch) {
        let p = t.location(in: self), st = deck.stick
        let v = TouchControls.stickXY(dx: Double(p.x - stickOrigin.x), dy: Double(p.y - stickOrigin.y), radius: st.travel)
        Game.shared.controls.stick(x: v.x, y: v.y)
        let out = abs(v.x) > 0.15 || abs(v.y) > 0.15, rim = v.x * v.x + v.y * v.y > 0.96
        if out && !stickWas.out { PressHaptics.feel(.stickEdge) }
        if rim && !stickWas.rim { PressHaptics.feel(.stickRim) }
        stickWas = (out, rim)
        instantly { knob.position = CGPoint(x: stickOrigin.x + CGFloat(v.x) * st.travel, y: stickOrigin.y + CGFloat(v.y) * st.travel) }
    }
    /// Presses and releases what changed. Two fingers on one control hold it until both have left.
    private func sync(slid: Bool = false) {
        var now = Set<DeckKey>()
        for h in holds.values { if case let .key(k) = h { now.insert(k) } }
        guard now != down else { return }
        let pressed = now.subtracting(down)
        for k in pressed { Game.shared.controls.press(k.control, true) }
        for k in down.subtracting(now) { Game.shared.controls.press(k.control, false) }
        down = now
        paint(animated: false)
        ghost()
        if let k = pressed.first {
            if slid { PressHaptics.slide() } else { PressHaptics.feel(feel(k)) }
        }
    }
    private func feel(_ k: DeckKey) -> PressHaptics.Feel {
        let b = slots.compactMap(\.button).first { $0.key == k }
        switch k {
        case .go: return b?.label == "BOOST" ? .boost : .go
        case .brake: return .brake
        case .lift: return b?.amber == true ? .release : .lift
        case .land: return .land
        }
    }
    override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) {
        InputLag.note(e)
        for t in ts {
            let p = t.location(in: self)
            if let i = slotAt(p), let b = slots[i].button { holds[ObjectIdentifier(t)] = .key(b.key) }
            else if inZone(p), stickTouch == nil {
                holds[ObjectIdentifier(t)] = .stick; stickTouch = t
                let st = deck.stick
                // Inside the ring: the web's fixed stick, the offset from its centre. Outside it: the ring comes to the thumb.
                if hypot(p.x - st.home.x, p.y - st.home.y) > st.ring + 16 {
                    instantly { placeRing(at: p); homeGhost.isHidden = false; knob.position = p }
                } else if stickOrigin != st.home.cg { instantly { placeRing(at: st.home.cg) } }
                moveStick(t)
                paint(animated: false); ghost()
            }
        }
        sync()
    }
    override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) {
        var slid = false
        for t in ts {
            switch holds[ObjectIdentifier(t)] {
            case .stick: moveStick(t)
            case .key(let k):
                // Only clearly onto another control: a drifting thumb keeps what it holds.
                if let j = slotAt(t.location(in: self), strict: true), let b = slots[j].button, b.key != k { holds[ObjectIdentifier(t)] = .key(b.key); slid = true }
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
        stickTouch = nil; stickWas = (false, false)
        Game.shared.controls.stick(x: 0, y: 0)
        let home = deck.stick.home.cg
        instantly { placeRing(at: home); knob.position = home; homeGhost.isHidden = true }
        paint(animated: false); ghost()
    }
    func letGo() {
        if stickTouch != nil { centreStick() }
        holds.removeAll()
        sync()
    }
}

extension DeckKey {
    var control: Controls.Key { switch self { case .go: return .go; case .brake: return .brake; case .lift: return .lift; case .land: return .land } }
}
extension LRect { var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) } }

/// The deck's surroundings, where the form has room: the tabletop's faceplate and wells, the phase strip (tabletop and
/// iPad). Layers only; nothing here takes a touch.
final class DeckChrome {
    private let plate = CAGradientLayer(), plateEdge = CAShapeLayer(), wells = CAShapeLayer(), vents = CAShapeLayer()
    private let stripLine = CAShapeLayer(), stripDot = CAShapeLayer()
    private var words: [CATextLayer] = []
    private var stripRect: CGRect?
    private var names: [String] = [], at = -1

    func install(in root: CALayer) {
        plate.colors = [UIColor(red: 0.047, green: 0.063, blue: 0.098, alpha: 1).cgColor, UIColor(red: 0.020, green: 0.027, blue: 0.047, alpha: 1).cgColor]
        plate.cornerRadius = 30; plate.cornerCurve = .continuous
        plateEdge.fillColor = nil; plateEdge.strokeColor = ControlSurface.ink.withAlphaComponent(0.12).cgColor; plateEdge.lineWidth = 1
        wells.fillColor = nil; wells.strokeColor = ControlSurface.ink.withAlphaComponent(0.07).cgColor; wells.lineWidth = 1
        vents.fillColor = nil; vents.strokeColor = ControlSurface.ink.withAlphaComponent(0.16).cgColor; vents.lineWidth = 1; vents.lineCap = .round
        stripLine.fillColor = nil; stripLine.strokeColor = ControlSurface.ink.withAlphaComponent(0.16).cgColor; stripLine.lineWidth = 1
        stripDot.fillColor = UIColor(red: 0.910, green: 0.196, blue: 0.235, alpha: 1).cgColor   // the one signal red: where you are
        for l in [plate, plateEdge, wells, vents, stripLine, stripDot] as [CALayer] { l.actions = FlightDeckView.still; root.addSublayer(l) }
        for _ in 0..<5 {
            let t = CATextLayer()
            t.contentsScale = UIScreen.main.scale; t.alignmentMode = .center; t.actions = FlightDeckView.still
            root.addSublayer(t); words.append(t)
        }
    }

    func layout(_ d: DeckLayout, bounds: CGRect) {
        let console = d.form == .tabletop
        plate.isHidden = !console; plateEdge.isHidden = !console; wells.isHidden = !console; vents.isHidden = !console
        if console {
            let r = bounds.insetBy(dx: 4, dy: 4)
            plate.frame = r
            plateEdge.path = UIBezierPath(roundedRect: r, cornerRadius: 30).cgPath
            // Two wells: the stick's, the fan's (round its arc).
            let w = UIBezierPath()
            let st = d.stick
            w.append(UIBezierPath(ovalIn: CGRect(x: st.home.x - st.ring - 16, y: st.home.y - st.ring - 16, width: (st.ring + 16) * 2, height: (st.ring + 16) * 2)))
            let fan = d.slots.dropFirst().reduce(d.slots[0].frame) { $0.union($1.frame) }.cgRect.insetBy(dx: -18, dy: -18)
            w.append(UIBezierPath(roundedRect: fan, cornerRadius: fan.width / 2.4))
            wells.path = w.cgPath
            // A console's vent along the top edge: eight short hairlines, centred.
            let v = UIBezierPath()
            for i in 0..<8 { let x = bounds.midX - 42 + CGFloat(i) * 12; v.move(to: CGPoint(x: x, y: 16)); v.addLine(to: CGPoint(x: x, y: 24)) }
            vents.path = v.cgPath
        }
        stripRect = d.strip?.cgRect
        let n = names, a = at
        names = []; at = -1
        strip(names: n.isEmpty ? Deck.stripNames(course: "show") : n, at: max(0, a))
    }

    /// DRIVE · CLIMB · HANG · AIR · LAND, the moment lit and a red dot under it.
    func strip(names n: [String], at i: Int) {
        guard let r = stripRect else { for w in words { w.isHidden = true }; stripLine.isHidden = true; stripDot.isHidden = true; return }
        guard n != names || i != at else { return }
        names = n; at = i
        CATransaction.begin(); CATransaction.setDisableActions(true)
        stripLine.isHidden = false; stripDot.isHidden = false
        let y = r.midY
        stripLine.path = UIBezierPath(rect: CGRect(x: r.minX, y: y + 12, width: r.width, height: 0.5)).cgPath
        let step = r.width / CGFloat(max(1, n.count))
        for (k, w) in words.enumerated() {
            w.isHidden = k >= n.count
            guard k < n.count else { continue }
            let on = k == i
            let fs: CGFloat = r.width / CGFloat(n.count) > 90 ? 10 : 8.5
            w.string = NSAttributedString(string: n[k], attributes: [.font: UIFont(name: "Michroma-Regular", size: fs) ?? .systemFont(ofSize: fs), .foregroundColor: ControlSurface.ink.withAlphaComponent(on ? 0.95 : 0.34), .kern: 1.8])
            w.frame = CGRect(x: r.minX + CGFloat(k) * step, y: y - fs * 0.9, width: step, height: fs * 1.6)
            if on { stripDot.path = UIBezierPath(ovalIn: CGRect(x: r.minX + (CGFloat(k) + 0.5) * step - 2.5, y: y + 9.5, width: 5, height: 5)).cgPath }
        }
        CATransaction.commit()
    }
}

struct FlightDeck: UIViewRepresentable {
    let show: DeckShow
    /// Changes when the fold layout does, so the deck re-lays itself out.
    let layoutKey: String
    func makeUIView(context: Context) -> FlightDeckView { FlightDeckView() }
    func updateUIView(_ v: FlightDeckView, context: Context) {
        if v.accessibilityIdentifier != layoutKey { v.accessibilityIdentifier = layoutKey; v.setNeedsLayout() }
        v.update(show)
    }
    static func dismantleUIView(_ v: FlightDeckView, coordinator: ()) { v.letGo() }
}
