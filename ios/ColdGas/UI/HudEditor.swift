// The HUD layout editor (0221): every on-screen control dragged anywhere, pinched (or slid) to size, faded to taste, for each
// control tier on the shape of screen in the hand. Snap guides to the middle, the margins and the other controls (a haptic
// tick on each), the safe area as the canvas's edge, the Duo's fold kept clear (a control dropped on it lands beside it),
// overlaps flagged, undo, presets, a left-handed mirror, reset. Opened from Settings → Controls and from the pause sheet.
//
// The geometry is ColdGasLayout's HudLayout (pure, tested); this is its glass. It draws its own picture of each control, not
// the live deck, and nothing it does reaches the sim: Save writes the layout to the save, and the surfaces lay themselves
// out again from it.
import SwiftUI
import UIKit
import ColdGasLayout

final class HudEditorModel: ObservableObject {
    @Published var tier: HudTier { didSet { if tier != oldValue { selected = nil; group = 0 } } }
    /// 0: the classic deck (stick and buttons); 1: what replaces it (Advanced's valves in the air, Assist's thumb pad).
    @Published var group = 0 { didSet { if group != oldValue { selected = nil } } }
    @Published var selected: HudControl?
    @Published private(set) var guides: [HudGuide] = []
    @Published private(set) var drafts: [HudTier: HudCustom?] = [:]
    @Published var size: CGSize = .zero { didSet { if shape(size) != shape(oldValue) { drafts = [:]; undo = []; selected = nil } } }
    private var undo: [(HudTier, HudCustom?)] = []
    private let tick = UISelectionFeedbackGenerator()

    init(tier: HudTier) { self.tier = tier }

    func shape(_ s: CGSize) -> HudShape { DeckGeometry.shape(s) }
    var shapeNow: HudShape { shape(size) }
    var base: DeckLayout { DeckGeometry.factory(size) }
    var custom: HudCustom? {
        get { drafts[tier] ?? HudStore.shared.custom(tier, shapeNow) }
        set { drafts[tier] = .some(newValue) }
    }
    var layout: DeckLayout { DeckGeometry.layout(size, tier: tier, custom: .some(custom)) }
    var valvesSplit: Bool { base.valves.count == 2 }
    /// Has a second group to show (Advanced's valves, Assist's thumb pad).
    var groupName: String? { tier == .advanced ? "Valves" : tier == .assist && base.form != .tabletop ? "One thumb" : nil }
    var controls: [HudControl] {
        tier.controls(form: base.form, valvesSplit: valvesSplit).filter { group == 0 ? $0.group == 0 : $0.group != 0 }
    }
    var overlaps: [(HudControl, HudControl)] { HudLayout.overlaps(layout, controls: controls) }
    var dirty: Bool { !drafts.isEmpty }
    var canUndo: Bool { !undo.isEmpty }

    /// The control's place now (its preset's or the player's, else where the factory has it).
    func placement(_ c: HudControl) -> HudPlacement {
        if let cu = custom, let p = HudLayout.effective(cu, base: base)[c] { return p }
        let f = base.frame(c) ?? LRect(x: 0, y: 0, w: 0, h: 0)
        return HudPlacement(x: (f.x + f.w / 2) / max(1, size.width), y: (f.y + f.h / 2) / max(1, size.height))
    }
    private func put(_ c: HudControl, _ p: HudPlacement) {
        var cu = custom ?? HudCustom()
        cu.placements[c] = p
        custom = cu
    }

    // --- Edits -----------------------------------------------------------------------------------------------------
    /// Before a gesture or a button: one undo step.
    func checkpoint() {
        undo.append((tier, custom))
        if undo.count > 60 { undo.removeFirst() }
    }
    func undoLast() {
        guard let (t, c) = undo.popLast() else { return }
        tier = t
        drafts[t] = .some(c)
        guides = []
    }
    /// A drag: the control's centre to `p` (controls-rect points), snapped and kept legal.
    func move(_ c: HudControl, to p: CGPoint) {
        let l = layout
        guard let f = l.frame(c) else { return }
        let half = (f.w / 2, f.h / 2)
        let others = controls.filter { $0 != c }.compactMap { l.frame($0) }
        let (sp, g) = HudSnap.snap(LPoint(x: p.x, y: p.y), half: half, w: size.width, h: size.height, others: others)
        let lp = HudLayout.legal(sp, half: half, w: size.width, h: size.height, fold: DeckGeometry.fold)
        if !g.isEmpty && g != guides { feelSnap() }
        guides = g
        let old = placement(c)
        put(c, HudPlacement(x: lp.x / size.width, y: lp.y / size.height, scale: old.scale, alpha: old.alpha))
    }
    func endGesture() { guides = [] }
    func setScale(_ c: HudControl, _ s: Double) {
        var p = placement(c); p.scale = HudPlacement.scales.clamp(s); put(c, p)
    }
    func setAlpha(_ c: HudControl, _ a: Double) {
        var p = placement(c); p.alpha = HudPlacement.alphas.clamp(a); put(c, p)
    }
    func nudge(_ c: HudControl, dx: Double, dy: Double) {
        guard let f = layout.frame(c) else { return }
        checkpoint()
        move(c, to: CGPoint(x: f.x + f.w / 2 + dx * size.width, y: f.y + f.h / 2 + dy * size.height))
        guides = []
    }
    func resetControl(_ c: HudControl) {
        checkpoint()
        var cu = custom ?? HudCustom()
        cu.placements[c] = nil
        if cu.preset != nil, let f = base.frame(c), HudLayout.preset(cu.preset ?? .thumbs, base)[c] != nil {
            // A preset moved it: back to the factory place means saying so.
            cu.placements[c] = HudPlacement(x: (f.x + f.w / 2) / size.width, y: (f.y + f.h / 2) / size.height)
        }
        custom = cu
    }
    func apply(_ p: HudPreset) { checkpoint(); custom = HudCustom(preset: p); selected = nil; feelSnap() }
    func mirror() { checkpoint(); custom = HudLayout.mirrored(custom ?? HudCustom(), base: base, fold: DeckGeometry.fold); feelSnap() }
    func resetAll() { checkpoint(); custom = nil; selected = nil }
    func save() {
        for (t, c) in drafts { HudStore.shared.save(c, t, shapeNow) }
        drafts = [:]
    }
    func feelSnap() {
        guard HapticPlayer.shared.level != .off else { return }
        tick.selectionChanged(); tick.prepare()
    }

    /// The words a control carries on this tier (the editor's label under its tag).
    func words(_ c: HudControl) -> String {
        switch c {
        case .stick: return tier == .drive ? "STEER" : "STEER · ROLL"
        case .slotA: return tier == .assist ? "GO · LAND" : "GO · LIFT"
        case .slotB: return "BRAKE"
        case .slotC: return tier == .drive ? "LIFT · BOOST" : "RELEASE · BOOST"
        case .valves0: return valvesSplit ? "CAR LEFT" : "TEN VALVES"
        case .valves1: return "CAR RIGHT"
        case .thumb: return "HOLD · TAP"
        }
    }
    func name(_ c: HudControl) -> String { c.name(tier: tier, valvesSplit: valvesSplit) }
}

// MARK: - The canvas

final class HudCanvasView: UIView {
    var model: HudEditorModel?
    private var drag: (control: HudControl, offset: CGPoint, touch: UITouch)?
    private var pinch: (control: HudControl, d0: CGFloat, s0: Double)?
    private var touches: [UITouch] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true; isOpaque = false; backgroundColor = .clear; contentMode = .redraw
        isAccessibilityElement = false
    }
    required init?(coder: NSCoder) { nil }

    private static let ice = UIColor(red: 0.749, green: 0.902, blue: 1, alpha: 1)
    private static let signal = UIColor(red: 0.910, green: 0.196, blue: 0.235, alpha: 1)
    private static let ink = ControlSurface.ink

    override func draw(_ rect: CGRect) {
        guard let m = model, m.size.width >= 10, m.size.height >= 10, let g = UIGraphicsGetCurrentContext() else { return }
        let l = m.layout
        // The safe area: the canvas's own edge, a dashed hairline.
        g.setStrokeColor(Self.ink.withAlphaComponent(0.25).cgColor); g.setLineWidth(1); g.setLineDash(phase: 0, lengths: [3, 5])
        g.stroke(bounds.insetBy(dx: CGFloat(Deck.margin) - 0.5, dy: CGFloat(Deck.margin) - 0.5))
        g.setLineDash(phase: 0, lengths: [])
        // The fold: hatched, nothing goes there.
        if let f = DeckGeometry.fold?.cgRect.intersection(bounds), !f.isNull, f.width > 0, f.height > 0 {
            g.saveGState(); g.clip(to: f)
            g.setFillColor(Self.signal.withAlphaComponent(0.12).cgColor); g.fill(f)
            g.setStrokeColor(Self.signal.withAlphaComponent(0.45).cgColor); g.setLineWidth(1)
            var x = f.minX - f.height
            while x < f.maxX { g.move(to: CGPoint(x: x, y: f.maxY)); g.addLine(to: CGPoint(x: x + f.height, y: f.minY)); x += 9 }
            g.strokePath(); g.restoreGState()
            text("FOLD", at: CGPoint(x: f.midX, y: f.height > f.width ? bounds.midY : f.midY), size: 9, color: Self.signal.withAlphaComponent(0.9), font: "Michroma-Regular", rotate: f.height > f.width)
        }
        // Guides.
        g.setStrokeColor(Self.ice.withAlphaComponent(0.85).cgColor); g.setLineWidth(1)
        for gd in m.guides {
            if gd.vertical { g.move(to: CGPoint(x: gd.at, y: 0)); g.addLine(to: CGPoint(x: gd.at, y: bounds.height)) }
            else { g.move(to: CGPoint(x: 0, y: gd.at)); g.addLine(to: CGPoint(x: bounds.width, y: gd.at)) }
        }
        g.strokePath()
        let bad = Set(m.overlaps.flatMap { [$0.0, $0.1] })
        for c in m.controls { draw(c, l, g, m, overlapping: bad.contains(c)) }
    }

    private func draw(_ c: HudControl, _ l: DeckLayout, _ g: CGContext, _ m: HudEditorModel, overlapping: Bool) {
        guard let f = l.frame(c)?.cgRect else { return }
        let a = CGFloat(l.alpha(c)), sel = m.selected == c
        let ink = Self.ink
        let shape: UIBezierPath = (c == .valves0 || c == .valves1) ? UIBezierPath(roundedRect: f, cornerRadius: 22) : UIBezierPath(ovalIn: f)
        // The body at the control's own opacity, as the run will draw it.
        g.saveGState(); g.setAlpha(a)
        UIColor(cgColor: ControlSurface.glass).setFill(); shape.fill()
        ink.withAlphaComponent(c == .slotA || c == .thumb ? 0.5 : 0.32).setStroke(); shape.lineWidth = c == .slotA ? 1.5 : 1; shape.stroke()
        if c == .stick {
            let k = f.width * 0.18
            ink.withAlphaComponent(0.85).setFill()
            UIBezierPath(ovalIn: CGRect(x: f.midX - k, y: f.midY - k, width: k * 2, height: k * 2)).fill()
        }
        if c == .valves0 || c == .valves1 {
            // The car's spine and its valves as dots: a picture, not the pad.
            ink.withAlphaComponent(0.3).setStroke()
            let spine = UIBezierPath(); let sx = c == .valves0 && m.valvesSplit ? f.maxX - 14 : c == .valves1 ? f.minX + 14 : f.midX
            spine.move(to: CGPoint(x: sx, y: f.minY + 18)); spine.addLine(to: CGPoint(x: sx, y: f.maxY - 18)); spine.lineWidth = 1; spine.stroke()
            ink.withAlphaComponent(0.4).setFill()
            for i in 0..<5 {
                let y = f.minY + f.height * (0.18 + 0.16 * CGFloat(i))
                for x in (m.valvesSplit ? [c == .valves0 ? f.minX + f.width * 0.3 : f.maxX - f.width * 0.3] : [f.minX + f.width * 0.25, f.maxX - f.width * 0.25]) {
                    UIBezierPath(ovalIn: CGRect(x: x - 5, y: y - 5, width: 10, height: 10)).fill()
                }
            }
        }
        g.restoreGState()
        // The editor's marks at full strength: the tag, the words, selection and trouble.
        let tagY = c == .stick ? f.midY + f.height * 0.32 : f.midY - 7
        text(c.tag, at: CGPoint(x: f.midX, y: tagY), size: c == .stick ? 9 : 12, color: ink, font: "Michroma-Regular")
        if c != .stick { text(m.words(c), at: CGPoint(x: f.midX, y: f.midY + 9), size: 9, color: ink.withAlphaComponent(0.7), font: "Geist-Medium") }
        if overlapping {
            let o = UIBezierPath(cgPath: shape.cgPath); o.lineWidth = 2; o.setLineDash([5, 4], count: 2, phase: 0)
            Self.signal.setStroke(); o.stroke()
        }
        if sel {
            let r = f.insetBy(dx: -7, dy: -7)
            let o = (c == .valves0 || c == .valves1) ? UIBezierPath(roundedRect: r, cornerRadius: 28) : UIBezierPath(ovalIn: r)
            o.lineWidth = 2; Self.ice.setStroke(); o.stroke()
            // The size grip: bottom right, a reminder that two fingers resize.
            let gp = CGPoint(x: r.maxX - r.width * 0.146, y: r.maxY - r.height * 0.146)
            Self.ice.setFill(); UIBezierPath(ovalIn: CGRect(x: gp.x - 6, y: gp.y - 6, width: 12, height: 12)).fill()
        }
    }

    private func text(_ s: String, at c: CGPoint, size: CGFloat, color: UIColor, font: String, rotate: Bool = false) {
        let f = UIFont(name: font, size: size) ?? .systemFont(ofSize: size, weight: .medium)
        let a = NSAttributedString(string: s, attributes: [.font: f, .foregroundColor: color, .kern: 1.2])
        let sz = a.size()
        guard let g = UIGraphicsGetCurrentContext() else { return }
        g.saveGState()
        g.translateBy(x: c.x, y: c.y)
        if rotate { g.rotate(by: -.pi / 2) }
        a.draw(at: CGPoint(x: -sz.width / 2, y: -sz.height / 2))
        g.restoreGState()
    }

    // --- Touches ---------------------------------------------------------------------------------------------------
    private func hit(_ p: CGPoint) -> HudControl? {
        guard let m = model else { return nil }
        let l = m.layout
        var best: (HudControl, CGFloat)?
        // The smallest control under the finger wins (a button on top of the valve deck's picture), with 12 pt of slop.
        for c in m.controls {
            guard let f = l.frame(c)?.cgRect, f.insetBy(dx: -12, dy: -12).contains(p) else { continue }
            let area = f.width * f.height
            if area < (best?.1 ?? .infinity) { best = (c, area) }
        }
        return best?.0
    }
    override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) {
        guard let m = model else { return }
        for t in ts { touches.append(t) }
        if touches.count == 1, let t = touches.first {
            let p = t.location(in: self)
            if let c = hit(p), let f = m.layout.frame(c)?.cgRect {
                m.checkpoint()
                m.selected = c
                drag = (c, CGPoint(x: f.midX - p.x, y: f.midY - p.y), t)
            } else { m.selected = nil }
        } else if touches.count >= 2, let c = m.selected ?? drag?.control {
            // Two fingers: resize the selected control.
            drag = nil
            m.endGesture()
            if pinch == nil { m.checkpoint() }
            let a = touches[0].location(in: self), b = touches[1].location(in: self)
            pinch = (c, max(20, hypot(a.x - b.x, a.y - b.y)), m.placement(c).scale)
        }
        setNeedsDisplay()
    }
    override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) {
        guard let m = model else { return }
        if let pz = pinch, touches.count >= 2 {
            let a = touches[0].location(in: self), b = touches[1].location(in: self)
            let k = Double(hypot(a.x - b.x, a.y - b.y) / pz.d0)
            let s = HudPlacement.scales.clamp(pz.s0 * k)
            let was = m.placement(pz.control).scale
            m.setScale(pz.control, s)
            // A tick at each tenth of a size, so a pinch can be felt.
            if Int(was * 10) != Int(s * 10) { m.feelSnap() }
        } else if let d = drag, ts.contains(d.touch) {
            let p = d.touch.location(in: self)
            m.move(d.control, to: CGPoint(x: p.x + d.offset.x, y: p.y + d.offset.y))
        }
        setNeedsDisplay()
    }
    override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) {
        touches.removeAll { ts.contains($0) }
        if let d = drag, ts.contains(d.touch) { drag = nil }
        if touches.count < 2 { pinch = nil }
        if touches.isEmpty { drag = nil; model?.endGesture() }
        setNeedsDisplay()
        refreshAccessibility()
    }
    override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) { touchesEnded(ts, with: e) }

    // --- VoiceOver: every control a named element, moved and sized by its actions ---------------------------------
    func refreshAccessibility() {
        guard let m = model, m.size.width >= 10, m.size.height >= 10 else { accessibilityElements = []; return }
        let l = m.layout
        accessibilityElements = m.controls.compactMap { c -> UIAccessibilityElement? in
            guard let f = l.frame(c) else { return nil }
            let e = UIAccessibilityElement(accessibilityContainer: self)
            e.accessibilityLabel = m.name(c)
            e.accessibilityIdentifier = "hud-\(c.rawValue)"
            let p = m.placement(c)
            e.accessibilityValue = String(format: "%d%% across, %d%% down, size %d%%, opacity %d%%", Int(p.x * 100), Int(p.y * 100), Int(p.scale * 100), Int(p.alpha * 100))
            e.accessibilityFrameInContainerSpace = f.cgRect
            e.accessibilityTraits = [.button]
            e.accessibilityHint = "Drag to move, pinch to resize. Actions move it, size it and fade it."
            func act(_ name: String, _ f: @escaping () -> Void) -> UIAccessibilityCustomAction {
                UIAccessibilityCustomAction(name: name) { [weak self] _ in f(); self?.setNeedsDisplay(); self?.refreshAccessibility(); return true }
            }
            e.accessibilityCustomActions = [
                act("Move left") { m.nudge(c, dx: -0.05, dy: 0) }, act("Move right") { m.nudge(c, dx: 0.05, dy: 0) },
                act("Move up") { m.nudge(c, dx: 0, dy: -0.05) }, act("Move down") { m.nudge(c, dx: 0, dy: 0.05) },
                act("Bigger") { m.checkpoint(); m.setScale(c, p.scale + 0.1) }, act("Smaller") { m.checkpoint(); m.setScale(c, p.scale - 0.1) },
                act("More solid") { m.checkpoint(); m.setAlpha(c, p.alpha + 0.15) }, act("Fainter") { m.checkpoint(); m.setAlpha(c, p.alpha - 0.15) },
                act("Select") { m.selected = c },
            ]
            return e
        }
    }
}

struct HudCanvas: UIViewRepresentable {
    @ObservedObject var model: HudEditorModel
    func makeUIView(context: Context) -> HudCanvasView { let v = HudCanvasView(); v.model = model; return v }
    func updateUIView(_ v: HudCanvasView, context: Context) {
        v.model = model
        v.setNeedsDisplay()
        v.refreshAccessibility()
    }
}

// MARK: - The editor's screen

struct HudEditorView: View {
    @ObservedObject var layout: LayoutModel
    @StateObject private var m: HudEditorModel
    @State private var panelOpen = true
    @State private var askLeave = false
    let close: () -> Void

    init(layout: LayoutModel, tier: HudTier, close: @escaping () -> Void) {
        self.layout = layout; self.close = close
        _m = StateObject(wrappedValue: HudEditorModel(tier: tier))
    }

    var body: some View {
        let c = layout.controls
        let rows = layout.spread == .rows
        // The panels sit over the scene's middle (tabletop: the screen half), clear of where thumbs rest.
        let scene = rows ? layout.scene : c
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.84).ignoresSafeArea().accessibilityHidden(true)
            HudCanvas(model: m)
                .frame(width: c.width, height: c.height).offset(x: c.minX, y: c.minY)
                .accessibilityIdentifier("hud-canvas")
            VStack(spacing: 10) {
                panel.frame(maxWidth: min(460, scene.width - 32))
                if m.selected != nil { inspector.frame(maxWidth: min(420, scene.width - 32)).transition(.opacity) }
            }
            .frame(width: scene.width)
            .padding(.top, (rows ? scene.minY + layout.safe.top : c.minY) + 8)
            .offset(x: scene.minX)
        }
        .onAppear { m.size = c.size; DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { Ready.mark("hud-editor") } }
        .onChange(of: layout.controls) { _, v in m.size = v.size }
        .animation(.easeOut(duration: 0.18), value: m.selected)
        .preferredColorScheme(.dark)
        .confirmationDialog("Leave without saving?", isPresented: $askLeave, titleVisibility: .visible) {
            Button("Save and close") { m.save(); close() }
            Button("Discard changes", role: .destructive) { close() }
            Button("Keep editing", role: .cancel) {}
        }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("CONTROLS").font(Theme.display(12)).tracking(3).foregroundStyle(Theme.ink)
                    Text(m.shapeNow.title).font(Theme.text(11)).foregroundStyle(Theme.ink3).accessibilityIdentifier("hud-shape")
                }
                Spacer()
                Button { withAnimation(.easeOut(duration: 0.18)) { panelOpen.toggle() } } label: {
                    Image(systemName: panelOpen ? "chevron.up" : "chevron.down").font(.system(size: 13, weight: .medium)).frame(width: 44, height: 44)
                }.buttonStyle(.plain).foregroundStyle(Theme.ink2).accessibilityLabel(panelOpen ? "Fold the panel" : "Open the panel")
                Button("Cancel") { if m.dirty { askLeave = true } else { close() } }.buttonStyle(.plain).foregroundStyle(Theme.ink2).frame(minHeight: 44)
                    .padding(.horizontal, 6)
                Button("Save") { m.save(); close() }.buttonStyle(CGButton(primary: true)).accessibilityIdentifier("hud-save")
            }
            if panelOpen {
                Picker("Tier", selection: $m.tier) {
                    ForEach(HudTier.allCases, id: \.self) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented).accessibilityIdentifier("hud-tier")
                if let g = m.groupName {
                    Picker("Deck", selection: $m.group) {
                        Text(m.tier == .advanced ? "Ground" : "Classic").tag(0)
                        Text(g).tag(1)
                    }.pickerStyle(.segmented).accessibilityIdentifier("hud-group")
                }
                HStack(spacing: 8) {
                    Menu {
                        ForEach(HudPreset.allCases, id: \.self) { p in
                            Button { m.apply(p) } label: { Text(p.title); Text(p.line) }
                        }
                    } label: { chip("square.grid.2x2", (m.custom?.preset?.title ?? "Presets")) }
                    .accessibilityIdentifier("hud-presets")
                    Button { m.mirror() } label: { chip("arrow.left.and.right.righttriangle.left.righttriangle.right", "Mirror") }.accessibilityIdentifier("hud-mirror")
                    Button { m.undoLast() } label: { chip("arrow.uturn.backward", "Undo") }.disabled(!m.canUndo).accessibilityIdentifier("hud-undo")
                    Button { m.resetAll() } label: { chip("arrow.counterclockwise", "Reset") }.accessibilityIdentifier("hud-reset")
                }
                .buttonStyle(.plain)
                let o = m.overlaps
                Text(o.isEmpty ? "Drag a control. Two fingers resize it. Lines show where it snaps."
                     : "Overlapping: \(o.map { "\($0.0.tag) and \($0.1.tag)" }.joined(separator: ", ")). A touch goes to the nearer one.")
                    .font(Theme.text(12)).foregroundStyle(o.isEmpty ? Theme.ink2 : Theme.amber)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("hud-hint")
            }
        }
        .padding(14).glass(18)
    }

    private var inspector: some View {
        let c = m.selected ?? .stick
        let p = m.placement(c)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(m.name(c)).font(Theme.text(13, .medium)).foregroundStyle(Theme.ink)
                Spacer()
                Button("Reset") { m.resetControl(c) }.buttonStyle(.plain).foregroundStyle(Theme.ink2).frame(minHeight: 44)
                    .accessibilityLabel("Reset this control")
            }
            slider("Size", value: p.scale, range: HudPlacement.scales, id: "hud-size") { m.setScale(c, $0) }
            slider("Opacity", value: p.alpha, range: HudPlacement.alphas, id: "hud-opacity") { m.setAlpha(c, $0) }
        }
        .padding(14).glass(18)
    }

    private func slider(_ name: String, value: Double, range: ClosedRange<Double>, id: String, set: @escaping (Double) -> Void) -> some View {
        HStack(spacing: 10) {
            Text(name).font(Theme.text(12)).foregroundStyle(Theme.ink2).frame(width: 58, alignment: .leading)
            Slider(value: Binding(get: { value }, set: { set($0) }), in: range, onEditingChanged: { if $0 { m.checkpoint() } })
                .tint(Theme.ink).accessibilityIdentifier(id).accessibilityLabel(name)
            Text("\(Int((value * 100).rounded()))%").font(Theme.mono(11)).foregroundStyle(Theme.ink2).frame(width: 40, alignment: .trailing)
        }
    }

    private func chip(_ icon: String, _ word: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .medium))
            Text(word).font(Theme.text(12, .medium)).lineLimit(1)
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 10).frame(minHeight: 44)
        .overlay(Capsule().strokeBorder(Theme.hair, lineWidth: 1))
        .contentShape(Capsule())
    }
}
