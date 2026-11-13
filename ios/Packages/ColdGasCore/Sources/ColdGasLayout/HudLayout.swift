// The player's own HUD layout (0221): every on-screen control can be moved, sized and faded, per control tier and per shape
// of screen, with a few presets, a left-handed mirror, snap guides and the fold kept clear. Pure: no UIKit, tested by
// HudLayoutTests. It changes only where the controls are drawn and where a touch lands; what a press sends the sim is
// FlightDeck's, unchanged.
//
// A placement is the control's centre as a fraction of the controls rect (so a layout survives a resize, a status bar, a
// rotation of the same shape) plus a size multiplier over the factory size and an opacity. A control with no placement
// sits where Deck puts it. The factory layout is Deck's (0210); a layout is only the changes to it.

import Foundation

/// Every control the editor can move. The fan's three slots are A (under the thumb), B and C; the valve deck's frames are
/// the whole car (an upright phone) or its two halves; the one-thumb pad is Assist's.
public enum HudControl: String, Codable, CaseIterable, Sendable {
    case stick, slotA, slotB, slotC, valves0, valves1, thumb
    /// What VoiceOver and the editor's inspector call it.
    public func name(tier: HudTier, valvesSplit: Bool) -> String {
        switch self {
        case .stick: return "Stick"
        case .slotA: return tier == .assist ? "Main button: GO, LAND" : "Main button: GO, LIFT"
        case .slotB: return "Second button: BRAKE"
        case .slotC: return tier == .drive ? "Third button: LIFT, BOOST" : "Third button: RELEASE, BOOST"
        case .valves0: return valvesSplit ? "Valves, the car\u{2019}s left" : "Valve deck"
        case .valves1: return "Valves, the car\u{2019}s right"
        case .thumb: return "Thrust pad"
        }
    }
    /// The editor's short tag on the control.
    public var tag: String {
        switch self {
        case .stick: return "STICK"
        case .slotA: return "A"
        case .slotB: return "B"
        case .slotC: return "C"
        case .valves0, .valves1: return "VALVES"
        case .thumb: return "PAD"
        }
    }
    /// Controls that are on the glass at the same time (only these can overlap): the classic deck, the valve deck (in the
    /// air on Advanced), the one-thumb pad.
    public var group: Int {
        switch self {
        case .stick, .slotA, .slotB, .slotC: return 0
        case .valves0, .valves1: return 1
        case .thumb: return 2
        }
    }
}

/// A layout is kept per control tier: Assist, Pro and Advanced fly; Free Drive drives.
public enum HudTier: String, Codable, CaseIterable, Sendable {
    case assist, pro, advanced, drive
    public init(tier: String) { self = HudTier(rawValue: tier) ?? .assist }
    public var title: String {
        switch self { case .assist: return "Assist"; case .pro: return "Pro"; case .advanced: return "Advanced"; case .drive: return "Free Drive" }
    }
    /// What this tier puts on the glass on this shape. A tabletop's one-thumb pad is the whole lower panel (not movable).
    public func controls(form: DeckForm, valvesSplit: Bool) -> [HudControl] {
        var c: [HudControl] = [.stick, .slotA, .slotB, .slotC]
        switch self {
        case .advanced: c += valvesSplit ? [.valves0, .valves1] : [.valves0]
        case .assist: if form != .tabletop { c.append(.thumb) }
        case .pro, .drive: break
        }
        return c
    }
}

/// The shapes a layout is kept for. The Duo's closed screen is a phone of its own (its side bar, its size); open it's a
/// book (bent) or flat; half open it's the tabletop console. Worked out from the fold layout, never the device model.
public enum HudShape: String, Codable, CaseIterable, Sendable {
    case phone, phoneWide, duoClosed, duoBook, duoFlat, duoTabletop, tablet
    public var title: String {
        switch self {
        case .phone: return "Phone upright"
        case .phoneWide: return "Phone sideways"
        case .duoClosed: return "Duo closed"
        case .duoBook: return "Duo book"
        case .duoFlat: return "Duo open flat"
        case .duoTabletop: return "Duo tabletop"
        case .tablet: return "iPad"
        }
    }
    /// `foldable`: this device has a fold (it has reported one, or a debug pose says so). `bent`: the fold is bent.
    public static func of(spread: Spread, width: Double, height: Double, foldable: Bool, bent: Bool) -> HudShape {
        switch Deck.form(spread: spread, width: width, height: height) {
        case .tabletop: return .duoTabletop
        case .duoOpen: return bent ? .duoBook : .duoFlat
        case .tablet: return .tablet
        case .phoneWide: return foldable ? .duoClosed : .phoneWide
        case .phone: return foldable ? .duoClosed : .phone
        }
    }
}

/// One control's place: centre as a fraction of the controls rect, size over the factory size, opacity.
public struct HudPlacement: Codable, Equatable, Sendable {
    public var x, y, scale, alpha: Double
    public init(x: Double, y: Double, scale: Double = 1, alpha: Double = 1) { self.x = x; self.y = y; self.scale = scale; self.alpha = alpha }
    public static let scales: ClosedRange<Double> = 0.6...1.8
    public static let alphas: ClosedRange<Double> = 0.15...1
    enum CodingKeys: String, CodingKey { case x, y, scale, alpha }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func num(_ k: CodingKeys) -> Double? { (try? c.decodeIfPresent(Double.self, forKey: k)).flatMap { $0 }.flatMap { $0.isFinite ? $0 : nil } }
        // A damaged number falls back to the middle of the screen, the factory size, fully drawn: never off the glass.
        x = min(1, max(0, num(.x) ?? 0.5)); y = min(1, max(0, num(.y) ?? 0.5))
        scale = HudPlacement.scales.clamp(num(.scale) ?? 1); alpha = HudPlacement.alphas.clamp(num(.alpha) ?? 1)
    }
}

/// The player's changes to one tier on one shape. Empty: the factory layout.
public struct HudCustom: Codable, Equatable, Sendable {
    public var placements: [HudControl: HudPlacement]
    /// The preset it started from (shown in the editor), if any.
    public var preset: HudPreset?
    public init(_ placements: [HudControl: HudPlacement] = [:], preset: HudPreset? = nil) { self.placements = placements; self.preset = preset }
    public var isFactory: Bool { placements.isEmpty }
    enum CodingKeys: String, CodingKey { case placements, preset }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Keyed by the control's name, read one by one: a control a later version drops, or a junk entry, costs only itself.
        var p: [HudControl: HudPlacement] = [:]
        if let raw = try? c.decodeIfPresent([String: HudPlacementOrJunk].self, forKey: .placements) {
            for (k, v) in raw { if let ctl = HudControl(rawValue: k), let pl = v.value { p[ctl] = pl } }
        }
        placements = p
        preset = (try? c.decodeIfPresent(String.self, forKey: .preset)).flatMap { $0 }.flatMap(HudPreset.init(rawValue:))
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(Dictionary(uniqueKeysWithValues: placements.map { ($0.key.rawValue, $0.value) }), forKey: .placements)
        try c.encodeIfPresent(preset?.rawValue, forKey: .preset)
    }
}
private struct HudPlacementOrJunk: Decodable {
    let value: HudPlacement?
    init(from decoder: Decoder) throws { value = try? HudPlacement(from: decoder) }
}

public enum StickMode: String, Codable, CaseIterable, Sendable {
    /// The ring stays put; only a thumb on it steers.
    case fixed
    /// The ring stays put, and a thumb that lands beside it, in its corner, brings the ring to itself (0210's stick).
    case floating
    /// The ring comes to the thumb anywhere on its side of the screen, and follows it past the rim.
    case dynamic
    public var title: String { switch self { case .fixed: return "Fixed"; case .floating: return "Floating"; case .dynamic: return "Follows the thumb" } }
}

public enum HudPreset: String, Codable, CaseIterable, Sendable {
    /// Two thumbs: the factory layout.
    case thumbs
    /// Three or four fingers: the second and third buttons go up where the index fingers rest.
    case claw
    /// The factory layout mirrored: the stick under the right thumb, the buttons under the left.
    case leftHanded
    /// Smaller and fainter, out of the way of the view.
    case minimal
    public var title: String { switch self { case .thumbs: return "Thumbs"; case .claw: return "Claw"; case .leftHanded: return "Left-handed"; case .minimal: return "Minimal" } }
    public var line: String {
        switch self {
        case .thumbs: return "Two thumbs, the stick left, the buttons right."
        case .claw: return "Index fingers on the upper buttons, thumbs on the stick and the main button."
        case .leftHanded: return "Mirrored: the stick right, the buttons left."
        case .minimal: return "Smaller and fainter, more of the view."
        }
    }
}

/// Everything the player sets about the touch controls, in the save (ColdGasClient's SaveData.hud). Every field optional,
/// read on its own: an old save has none of it and gets the factory controls.
public struct HudPrefs: Codable, Equatable, Sendable {
    public static let version = 1
    public var v: Int?
    /// "tier/shape" → the changes.
    public var layouts: [String: HudCustom]?
    public var stickMode: StickMode?
    /// Added on the glass before the sim's own (the sampler's 15 %, unchanged): 0 … 0.4 of the stick's travel.
    public var deadZone: Double?
    /// The knob's travel over the factory's: 2 is full deflection in half the distance.
    public var sensitivity: Double?
    /// Free Drive's swipe-to-look camera.
    public var lookSensitivity: Double?, lookInvertY: Bool?
    /// Tap once to hold, tap again to let go (instead of holding the finger down).
    public var brakeToggle: Bool?, boostToggle: Bool?
    /// RELEASE lets go of the Wall when the finger lifts, not when it lands (rest a finger on it, lift on the moment).
    public var releaseOnLift: Bool?
    public init() {}

    enum CodingKeys: String, CodingKey { case v, layouts, stickMode, deadZone, sensitivity, lookSensitivity, lookInvertY, brakeToggle, boostToggle, releaseOnLift }
    public init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
        func num(_ k: CodingKeys) -> Double? { (try? c.decodeIfPresent(Double.self, forKey: k)).flatMap { $0 }.flatMap { $0.isFinite ? $0 : nil } }
        func flag(_ k: CodingKeys) -> Bool? { (try? c.decodeIfPresent(Bool.self, forKey: k)).flatMap { $0 } }
        v = (try? c.decodeIfPresent(Int.self, forKey: .v)).flatMap { $0 }
        if let raw = try? c.decodeIfPresent([String: HudCustomOrJunk].self, forKey: .layouts) {
            var l: [String: HudCustom] = [:]
            for (k, x) in raw { if HudPrefs.parse(k) != nil, let cu = x.value { l[k] = cu } }
            layouts = l
        }
        stickMode = (try? c.decodeIfPresent(String.self, forKey: .stickMode)).flatMap { $0 }.flatMap(StickMode.init(rawValue:))
        deadZone = num(.deadZone); sensitivity = num(.sensitivity); lookSensitivity = num(.lookSensitivity)
        lookInvertY = flag(.lookInvertY); brakeToggle = flag(.brakeToggle); boostToggle = flag(.boostToggle); releaseOnLift = flag(.releaseOnLift)
    }

    public static func key(_ t: HudTier, _ s: HudShape) -> String { "\(t.rawValue)/\(s.rawValue)" }
    static func parse(_ k: String) -> (HudTier, HudShape)? {
        let p = k.split(separator: "/")
        guard p.count == 2, let t = HudTier(rawValue: String(p[0])), let s = HudShape(rawValue: String(p[1])) else { return nil }
        return (t, s)
    }

    // Values with their defaults (the factory: the 0210 controls, bit for bit).
    public static let deadZones: ClosedRange<Double> = 0...0.4, sensitivities: ClosedRange<Double> = 0.5...2, lookSensitivities: ClosedRange<Double> = 0.25...3
    public var stick: StickMode { stickMode ?? .floating }
    public var dead: Double { HudPrefs.deadZones.clamp(deadZone ?? 0) }
    public var sens: Double { HudPrefs.sensitivities.clamp(sensitivity ?? 1) }
    public var lookSens: Double { HudPrefs.lookSensitivities.clamp(lookSensitivity ?? 1) }
    public var lookInvert: Bool { lookInvertY ?? false }
    public var brakeToggles: Bool { brakeToggle ?? false }
    public var boostToggles: Bool { boostToggle ?? false }
    public var releasesOnLift: Bool { releaseOnLift ?? false }

    /// The layout for this tier on this shape. `leftHanded`: the save's older hand setting, which (with nothing saved for
    /// the shape) starts the mirror, so a left-handed player's choice carries over.
    public func custom(_ t: HudTier, _ s: HudShape, leftHanded: Bool = false) -> HudCustom? {
        if let c = layouts?[HudPrefs.key(t, s)] { return c }
        return leftHanded ? HudCustom(preset: .leftHanded) : nil
    }
    public mutating func set(_ c: HudCustom?, _ t: HudTier, _ s: HudShape) {
        var l = layouts ?? [:]
        l[HudPrefs.key(t, s)] = c
        layouts = l
        v = HudPrefs.version
    }
}
private struct HudCustomOrJunk: Decodable {
    let value: HudCustom?
    init(from decoder: Decoder) throws { value = try? HudCustom(from: decoder) }
}

extension ClosedRange where Bound == Double {
    public func clamp(_ v: Double) -> Double { Swift.min(upperBound, Swift.max(lowerBound, v)) }
}

// MARK: - Applying a layout

extension DeckLayout {
    /// The frame a control is drawn in (the stick's ring, a slot's disc, a valve frame, the thumb pad).
    public func frame(_ c: HudControl) -> LRect? {
        switch c {
        case .stick: return stick.frame
        case .slotA: return slots[0].frame
        case .slotB: return slots[1].frame
        case .slotC: return slots[2].frame
        case .valves0: return valves.first
        case .valves1: return valves.count > 1 ? valves[1] : nil
        case .thumb: return thumb.frame
        }
    }
    public func alpha(_ c: HudControl) -> Double { alphas[c] ?? 1 }
}

public enum HudLayout {
    /// The smallest a control may be drawn (and touched): Apple's 44 pt, the stick's ring and the thumb pad bigger.
    public static let minSlot = 44.0, minRing = 34.0, minThumb = 96.0
    /// Kept this far from the fold band.
    public static let foldGap = 6.0

    /// `base` with the player's changes. Every control stays inside the rect (by `Deck.margin`) and off the fold.
    public static func apply(_ base: DeckLayout, _ custom: HudCustom?, fold: LRect? = nil, stickMode: StickMode = .floating) -> DeckLayout {
        var l = base
        l.stickMode = stickMode
        guard let custom else { return dynamicZone(l, stickMode) }
        let expanded = effective(custom, base: base)
        guard !expanded.isEmpty, base.width >= 1, base.height >= 1 else { return dynamicZone(l, stickMode) }
        l.custom = true
        let w = base.width, h = base.height
        func centre(_ p: HudPlacement) -> LPoint { LPoint(x: p.x * w, y: p.y * h) }
        for (c, p) in expanded {
            l.alphas[c] = HudPlacement.alphas.clamp(p.alpha)
            let s = HudPlacement.scales.clamp(p.scale)
            switch c {
            case .stick:
                let ring = max(minRing, base.stick.ring * s), k = ring / base.stick.ring
                let home = legal(centre(p), half: (ring, ring), w: w, h: h, fold: fold)
                let reach = ring * 2.2
                l.stick = DeckStick(home: home, travel: base.stick.travel * k, ring: ring,
                                    zone: clip(LRect(x: home.x - reach, y: home.y - reach, w: reach * 2, h: reach * 2), w: w, h: h))
            case .slotA, .slotB, .slotC:
                let i = c == .slotA ? 0 : c == .slotB ? 1 : 2
                let d = max(minSlot, base.slots[i].d * s)
                l.slots[i] = DeckSlot(c: legal(centre(p), half: (d / 2, d / 2), w: w, h: h, fold: fold), d: d)
            case .valves0, .valves1:
                let i = c == .valves0 ? 0 : 1
                guard i < base.valves.count else { continue }
                let r = base.valves[i]
                // Never past the rect: a valve frame is big, so its scale is capped where it would no longer fit.
                let fit = min(s, (w - 2 * Deck.margin) / r.w, (h - 2 * Deck.margin) / r.h)
                let vw = r.w * fit, vh = r.h * fit
                let cc = legal(centre(p), half: (vw / 2, vh / 2), w: w, h: h, fold: fold)
                l.valves[i] = LRect(x: cc.x - vw / 2, y: cc.y - vh / 2, w: vw, h: vh)
                l.valveKs[i] = base.valveKs[i] * fit
            case .thumb:
                let d = max(minThumb, base.thumb.d * s)
                l.thumb = DeckSlot(c: legal(centre(p), half: (d / 2, d / 2), w: w, h: h, fold: fold), d: d)
            }
        }
        if l.valveKs.count > 0 { l.valveK = l.valveKs[0] }
        return dynamicZone(l, stickMode)
    }

    /// A preset's placements, worked out on this base (presets are recipes, so they fit every shape), with the player's
    /// own changes over them.
    public static func effective(_ c: HudCustom, base: DeckLayout) -> [HudControl: HudPlacement] {
        var out = c.preset.map { preset($0, base) } ?? [:]
        for (k, v) in c.placements { out[k] = v }
        return out
    }

    /// The stick that follows the thumb takes it anywhere on its side of the screen, from a little above the ring down.
    static func dynamicZone(_ l: DeckLayout, _ m: StickMode) -> DeckLayout {
        var l = l
        switch m {
        case .dynamic:
            let left = l.stick.home.x < l.width / 2
            let top = max(0, l.stick.home.y - l.stick.ring * 3)
            l.stick.zone = LRect(x: left ? 0 : l.width / 2, y: top, w: l.width / 2, h: l.height - top)
        case .fixed:
            l.stick.zone = l.stick.frame
        case .floating: break
        }
        return l
    }

    static func clip(_ r: LRect, w: Double, h: Double) -> LRect {
        let x0 = max(0, r.x), y0 = max(0, r.y), x1 = min(w, r.maxX), y1 = min(h, r.maxY)
        return LRect(x: x0, y: y0, w: max(0, x1 - x0), h: max(0, y1 - y0))
    }

    /// A centre that keeps a box of these half sizes inside the rect and off the fold band (moved to the side of the band
    /// it's already on, or the other side if that one has no room).
    public static func legal(_ c: LPoint, half: (Double, Double), w: Double, h: Double, fold: LRect?) -> LPoint {
        let m = Deck.margin
        func clampX(_ x: Double) -> Double { min(max(x, m + half.0), max(m + half.0, w - m - half.0)) }
        func clampY(_ y: Double) -> Double { min(max(y, m + half.1), max(m + half.1, h - m - half.1)) }
        var p = LPoint(x: clampX(c.x), y: clampY(c.y))
        guard let f = fold else { return p }
        let box = LRect(x: p.x - half.0, y: p.y - half.1, w: half.0 * 2, h: half.1 * 2)
        guard box.intersects(LRect(x: f.x - foldGap, y: f.y - foldGap, w: f.w + 2 * foldGap, h: f.h + 2 * foldGap)) else { return p }
        if f.h >= f.w {
            // A vertical band: left or right of it.
            let leftX = f.x - foldGap - half.0, rightX = f.maxX + foldGap + half.0
            let leftOK = leftX - half.0 >= m, rightOK = rightX + half.0 <= w - m
            let goLeft = (p.x <= f.x + f.w / 2 && leftOK) || !rightOK
            p.x = goLeft ? leftX : rightX
        } else {
            let upY = f.y - foldGap - half.1, downY = f.maxY + foldGap + half.1
            let upOK = upY - half.1 >= m, downOK = downY + half.1 <= h - m
            let goUp = (p.y <= f.y + f.h / 2 && upOK) || !downOK
            p.y = goUp ? upY : downY
        }
        return p
    }

    // MARK: Presets

    /// A preset's placements on this base.
    public static func preset(_ p: HudPreset, _ base: DeckLayout) -> [HudControl: HudPlacement] {
        let w = base.width, h = base.height
        // A rect with no size yet (a view before its first layout) has no fractions: the factory, never NaN.
        guard w >= 1, h >= 1 else { return [:] }
        func at(_ c: LPoint, _ s: Double = 1, _ a: Double = 1) -> HudPlacement { HudPlacement(x: c.x / w, y: c.y / h, scale: s, alpha: a) }
        func centre(_ r: LRect) -> LPoint { LPoint(x: r.x + r.w / 2, y: r.y + r.h / 2) }
        switch p {
        case .thumbs:
            return [:]
        case .leftHanded:
            // The classic deck and the thumb pad, mirrored across the screen. The valve deck stays the car's own way round:
            // its left valves are the car's left, under the left hand, whichever hand is stronger.
            var out: [HudControl: HudPlacement] = [:]
            out[.stick] = at(LPoint(x: w - base.stick.home.x, y: base.stick.home.y))
            for (i, c) in [HudControl.slotA, .slotB, .slotC].enumerated() { out[c] = at(LPoint(x: w - base.slots[i].c.x, y: base.slots[i].c.y)) }
            out[.thumb] = at(LPoint(x: w - base.thumb.c.x, y: base.thumb.c.y))
            return out
        case .claw:
            // B and C lift off the thumbs' arcs to where the index fingers rest: B above the main button, C above the stick.
            let a = base.slots[0], b = base.slots[1], st = base.stick
            let rise = min(h * 0.42, a.d + b.d + 40)
            return [
                .slotB: at(LPoint(x: a.c.x, y: a.c.y - rise)),
                .slotC: at(LPoint(x: st.home.x + st.ring * 0.4, y: st.home.y - st.ring - rise * 0.75)),
            ]
        case .minimal:
            var out: [HudControl: HudPlacement] = [:]
            out[.stick] = at(base.stick.home, 0.85, 0.5)
            for (i, c) in [HudControl.slotA, .slotB, .slotC].enumerated() { out[c] = at(base.slots[i].c, 0.85, 0.5) }
            for (i, c) in [HudControl.valves0, .valves1].enumerated() where i < base.valves.count { out[c] = at(centre(base.valves[i]), 1, 0.55) }
            out[.thumb] = at(base.thumb.c, 0.85, 0.5)
            return out
        }
    }

    /// The layout mirrored across the screen (the Left-handed button in the editor): every control of the classic deck and
    /// the thumb pad goes to the other side, its size and opacity kept.
    public static func mirrored(_ c: HudCustom, base: DeckLayout, fold: LRect? = nil) -> HudCustom {
        let l = apply(base, c, fold: fold)
        var out = effective(c, base: base)
        for ctl in [HudControl.stick, .slotA, .slotB, .slotC, .thumb] {
            guard let f = l.frame(ctl) else { continue }
            out[ctl] = HudPlacement(x: 1 - (f.x + f.w / 2) / base.width, y: (f.y + f.h / 2) / base.height,
                                    scale: out[ctl]?.scale ?? 1, alpha: out[ctl]?.alpha ?? 1)
        }
        return HudCustom(out)
    }

    // MARK: The editor's checks

    /// Pairs of controls on the glass at the same time that overlap (the editor warns; nothing stops it).
    public static func overlaps(_ l: DeckLayout, controls: [HudControl]) -> [(HudControl, HudControl)] {
        var out: [(HudControl, HudControl)] = []
        for (i, a) in controls.enumerated() {
            for b in controls[(i + 1)...] where a.group == b.group {
                guard let fa = l.frame(a), let fb = l.frame(b) else { continue }
                if round(a) && round(b) {
                    let ra = fa.w / 2, rb = fb.w / 2
                    let dx = (fa.x + ra) - (fb.x + rb), dy = (fa.y + fa.h / 2) - (fb.y + fb.h / 2)
                    if (dx * dx + dy * dy).squareRoot() < ra + rb - 0.5 { out.append((a, b)) }
                } else if fa.intersects(fb) { out.append((a, b)) }
            }
        }
        return out
    }
    static func round(_ c: HudControl) -> Bool { c != .valves0 && c != .valves1 }

    /// Something that crosses the fold band (should never happen once `legal` has placed it; the editor and the tests ask).
    public static func crossesFold(_ r: LRect, fold: LRect?) -> Bool { fold.map { r.intersects($0) } ?? false }
}

// MARK: - Snapping

public struct HudGuide: Equatable, Sendable {
    /// A vertical line at x (true), or a horizontal one at y.
    public var vertical: Bool, at: Double
    public init(vertical: Bool, at: Double) { self.vertical = vertical; self.at = at }
}

public enum HudSnap {
    public static let reach = 8.0
    /// Where a control dragged to `c` (a box of half sizes `half`) settles: its centre or edges onto the rect's middle,
    /// its margins, or another control's centre or edges, within `reach` points. Returns the guides it snapped to.
    public static func snap(_ c: LPoint, half: (Double, Double), w: Double, h: Double, others: [LRect], reach r: Double = reach) -> (LPoint, [HudGuide]) {
        let m = Deck.margin
        var xs: [Double] = [w / 2, m, w - m], ys: [Double] = [h / 2, m, h - m]
        for o in others { xs += [o.x, o.x + o.w / 2, o.maxX]; ys += [o.y, o.y + o.h / 2, o.maxY] }
        func best(_ v: Double, _ hs: Double, _ lines: [Double]) -> (Double, Double)? {
            // The box's centre, its leading edge and its trailing edge, each against every line.
            var pick: (d: Double, v: Double, line: Double)?
            for line in lines {
                for (off) in [0, -hs, hs] {
                    let d = abs(v + off - line)
                    if d <= r, d < (pick?.d ?? .infinity) { pick = (d, line - off, line) }
                }
            }
            return pick.map { ($0.v, $0.line) }
        }
        var p = c, g: [HudGuide] = []
        if let (x, line) = best(c.x, half.0, xs) { p.x = x; g.append(HudGuide(vertical: true, at: line)) }
        if let (y, line) = best(c.y, half.1, ys) { p.y = y; g.append(HudGuide(vertical: false, at: line)) }
        return (p, g)
    }
}

// MARK: - The stick on the glass

public enum StickShape {
    /// The knob after the player's dead zone and sensitivity, still inside the unit disc. The factory settings (0, 1) give
    /// back exactly what came in, so a player who never touches them sends the sim the same numbers as before.
    public static func apply(x: Double, y: Double, dead: Double, sensitivity: Double) -> (x: Double, y: Double) {
        if dead == 0 && sensitivity == 1 { return (x, y) }
        let l = (x * x + y * y).squareRoot()
        guard l > dead, l > 0 else { return (0, 0) }
        let out = min(1, (l - dead) / (1 - dead) * sensitivity)
        return (x / l * out, y / l * out)
    }
}
