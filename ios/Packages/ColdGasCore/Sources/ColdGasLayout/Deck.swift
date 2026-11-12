// Where the classic flight controls and Advanced's valve deck go, for each shape of screen (0210). Pure: no UIKit, tested
// by DeckTests. Everything is in the controls rect's own coordinates (origin at its top-left, +y down).
//
// One idea, exaggerated per shape: the stick sits under the left thumb, and the right thumb gets a fan of three slots on
// the arc its tip sweeps (slot A under the thumb at rest, B up the arc, C down it; the web's A/B/C, src/styles.css).
//   phone      upright: both clusters low in the corners, the fan opening up the right edge.
//   phoneWide  sideways: the thumbs come in from the sides, so the clusters climb the side edges.
//   duoOpen    the Duo open (book or flat, edge to edge): held like a small tablet, bigger, higher, off the crease.
//   tabletop   the Duo half open: the whole lower panel is a controller. Two wells either side of a phase strip.
//   tablet     an iPad: thumbs at the side grips, at mid height, never the bottom corners.
// Advanced's valve deck is the car seen from above: whole under both thumbs on an upright phone, split down its spine
// (one half under each thumb) everywhere else. The form comes from the fold layout's spread and the rect, never the
// device model (docs/NATIVE.md §2.8).

import Foundation

public struct LPoint: Equatable, Sendable {
    public var x, y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public enum DeckForm: String, Sendable, CaseIterable { case phone, phoneWide, duoOpen, tabletop, tablet }

/// A round control: its centre and diameter.
public struct DeckSlot: Equatable, Sendable {
    public var c: LPoint, d: Double
    public init(c: LPoint, d: Double) { self.c = c; self.d = d }
    public var r: Double { d / 2 }
    public var frame: LRect { LRect(x: c.x - r, y: c.y - r, w: d, h: d) }
}

public struct DeckStick: Equatable, Sendable {
    /// The ring's home centre.
    public var home: LPoint
    /// The knob's travel (points to full deflection): `TouchControls.stickXY`'s radius.
    public var travel: Double
    /// The ring drawn (and a touch inside it reads as an offset from `home`, the web's fixed stick).
    public var ring: Double
    /// Where a thumb takes the stick: outside the ring it floats the ring to itself and starts from zero.
    public var zone: LRect
    public var frame: LRect { LRect(x: home.x - ring, y: home.y - ring, w: ring * 2, h: ring * 2) }
}

public struct DeckLayout: Equatable, Sendable {
    public var form: DeckForm
    public var width, height: Double
    public var stick: DeckStick
    /// A (under the thumb), B (up the arc), C (down the arc).
    public var slots: [DeckSlot]
    /// The arc the fan lies on (drawn as a hairline: the thumb's own sweep), and its mirror for the stick's thumb.
    public var pivot: LPoint, reach: Double, arc: (from: Double, to: Double)
    /// The valve deck's frames: one (the whole car) or two (the left half, the right half), in the web's 300 × 380 units
    /// scaled by `valveK`.
    public var valves: [LRect], valveK: Double
    /// The phase strip (DRIVE · CLIMB · HANG · AIR · LAND), where the form has room for one.
    public var strip: LRect?
    /// What the classic deck puts over the scene (the camera's carry check, the cue's lift).
    public var covers: [LRect] { form == .tabletop ? [] : [stick.frame, slots.dropFirst().reduce(slots[0].frame) { $0.union($1.frame) }] }
    public var valveCovers: [LRect] { form == .tabletop ? [] : valves }
    public static func == (a: DeckLayout, b: DeckLayout) -> Bool {
        a.form == b.form && a.width == b.width && a.height == b.height && a.stick == b.stick && a.slots == b.slots
            && a.pivot == b.pivot && a.reach == b.reach && a.arc.from == b.arc.from && a.arc.to == b.arc.to && a.valves == b.valves
            && a.valveK == b.valveK && a.strip == b.strip
    }
}

extension DeckLayout {
    mutating func shift(dy: Double, height h: Double) {
        func m(_ p: LPoint) -> LPoint { LPoint(x: p.x, y: p.y + dy) }
        func m(_ r: LRect) -> LRect { LRect(x: r.x, y: r.y + dy, w: r.w, h: r.h) }
        stick.home = m(stick.home); stick.zone = m(stick.zone)
        for i in slots.indices { slots[i].c = m(slots[i].c) }
        pivot = m(pivot); valves = valves.map(m); strip = strip.map(m); height = h
    }
}

extension LRect {
    public func union(_ o: LRect) -> LRect {
        let x0 = min(x, o.x), y0 = min(y, o.y)
        return LRect(x: x0, y: y0, w: max(maxX, o.maxX) - x0, h: max(maxY, o.maxY) - y0)
    }
    public func intersects(_ o: LRect) -> Bool { x < o.maxX && o.x < maxX && y < o.maxY && o.y < maxY }
    public func contains(_ o: LRect, slack: Double = 0.001) -> Bool {
        o.x >= x - slack && o.y >= y - slack && o.maxX <= maxX + slack && o.maxY <= maxY + slack
    }
}

public enum Deck {
    /// The web's nozzle pad is drawn in a 300 × 380 frame; a half is the car's side plus the spine's chord column.
    public static let padW = 300.0, padH = 380.0, halfW = 190.0
    /// Never closer to an edge of the controls rect than this.
    public static let margin = 10.0

    /// Which shape this is. `spread` is the fold layout's; `width`/`height` the controls rect's.
    public static func form(spread: Spread, width: Double, height: Double) -> DeckForm {
        switch spread {
        case .rows: return .tabletop
        case .full: return .duoOpen
        case .single:
            if min(width, height) >= 700 { return .tablet }
            return width > height ? .phoneWide : .phone
        }
    }

    private struct Params {
        var ax, ay: Double            // slot A's centre: from the right edge, from the bottom
        var reach, angle: Double      // the fan's radius and A's bearing from the pivot (degrees, +y up)
        var dA, dB, gap: Double
        var sx, sy, travel: Double    // the stick's home: from the left edge, from the bottom; its travel
    }

    private static func params(_ f: DeckForm, _ w: Double, _ h: Double) -> Params {
        switch f {
        case .phone:
            // A Pro Max's 440 pt; the Duo's outer screen (382) and smaller phones scale down, never under 44 pt.
            let k = max(0.92, min(1, w / 440))
            return Params(ax: 96 * k, ay: 120 * k, reach: 190 * k, angle: 146, dA: 92 * k, dB: 64 * k, gap: 12 * k,
                          sx: 100 * k, sy: 116 * k, travel: 56)
        case .phoneWide:
            return Params(ax: 96, ay: min(150, h * 0.36), reach: 170, angle: 165, dA: 96, dB: 70, gap: 12,
                          sx: 112, sy: min(138, h * 0.33), travel: 60)
        case .duoOpen:
            return Params(ax: 104, ay: h * 0.33, reach: 210, angle: 168, dA: 108, dB: 78, gap: 14,
                          sx: 124, sy: h * 0.31, travel: 68)
        case .tabletop:
            return Params(ax: 150, ay: h * 0.47, reach: 170, angle: 155, dA: 116, dB: 84, gap: 14,
                          sx: 150, sy: h * 0.5, travel: 76)
        case .tablet:
            return Params(ax: 112, ay: h * 0.40, reach: 240, angle: 170, dA: 120, dB: 86, gap: 16,
                          sx: 136, sy: h * 0.40, travel: 80)
        }
    }

    /// `fold`: the fold band in the controls rect's coordinates. Nothing is placed across it: an open Duo held upright (its
    /// fold across the middle) gets its deck in the half below the crease.
    public static func layout(form f: DeckForm, width w: Double, height h: Double, fold: LRect? = nil) -> DeckLayout {
        if let b = fold, f == .duoOpen, b.w >= w - 1, b.maxY < h, h - b.maxY >= 300 {
            var l = layout(form: f, width: w, height: h - b.maxY)
            l.shift(dy: b.maxY, height: h)
            return l
        }
        let p = params(f, w, h)
        let rad = Double.pi / 180, t = p.angle * rad
        let a = LPoint(x: w - p.ax, y: h - p.ay)
        var pivot = LPoint(x: a.x - p.reach * cos(t), y: a.y + p.reach * sin(t))
        // B and C sit one chord from A: the two radii and the gap.
        let d = 2 * asin(min(1, (p.dA / 2 + p.dB / 2 + p.gap) / (2 * p.reach)))
        func on(_ th: Double) -> LPoint { LPoint(x: pivot.x + p.reach * cos(th), y: pivot.y - p.reach * sin(th)) }
        var slots = [DeckSlot(c: on(t), d: p.dA), DeckSlot(c: on(t - d), d: p.dB), DeckSlot(c: on(t + d), d: p.dB)]
        // Fit: a fan that runs past the right or bottom edge slides in, whole (it stays on its arc).
        let over = (x: slots.map { $0.c.x + $0.r }.max() ?? 0, y: slots.map { $0.c.y + $0.r }.max() ?? 0)
        let dx = min(0, w - margin - over.x), dy = min(0, h - margin - over.y)
        if dx != 0 || dy != 0 {
            pivot = LPoint(x: pivot.x + dx, y: pivot.y + dy)
            for i in slots.indices { slots[i].c = LPoint(x: slots[i].c.x + dx, y: slots[i].c.y + dy) }
        }
        let ringR = p.travel * 1.22
        let home = LPoint(x: max(margin + ringR, p.sx), y: min(h - margin - ringR, h - p.sy))
        // The stick's corner: the left of the screen, from a little above the ring down. A thumb anywhere in it flies.
        let zoneTop = max(0, home.y - ringR * 2.2)
        let zoneW = f == .phone ? w * 0.5 - 8 : min(w * 0.42, home.x + ringR * 2.4)
        let zone = LRect(x: 0, y: zoneTop, w: zoneW, h: h - zoneTop)
        let stick = DeckStick(home: home, travel: p.travel, ring: ringR, zone: zone)
        let arc = (from: (t - d) / rad - 14, to: (t + d) / rad + 14)

        // The valve deck.
        var valves: [LRect] = [], vk = 1.0
        switch f {
        case .phone:
            vk = min(350, w * 0.92) / padW
            vk = min(vk, (h * 0.52) / padH)
            let vw = padW * vk, vh = padH * vk
            valves = [LRect(x: (w - vw) / 2, y: h - vh - 4, w: vw, h: vh)]
        case .phoneWide, .duoOpen, .tablet, .tabletop:
            let cap: Double = f == .phoneWide ? 1.05 : f == .duoOpen ? 1.22 : f == .tablet ? 1.5 : 10
            let fill: Double = f == .tabletop ? 1 : f == .tablet ? 0.62 : f == .phoneWide ? 0.97 : 0.94
            vk = min(cap, (h * fill - (f == .tabletop ? 2 * margin : margin)) / padH)
            let vw = halfW * vk, vh = padH * vk
            let y: Double
            switch f {
            case .tablet: y = max(margin, min(h - margin - vh, h - p.ay - vh * 0.55))
            case .tabletop: y = (h - vh) / 2
            default: y = h - vh - margin
            }
            valves = [LRect(x: margin, y: y, w: vw, h: vh), LRect(x: w - margin - vw, y: y, w: vw, h: vh)]
        }

        // The phase strip: between the wells on tabletop, along the bottom on a tablet (the Duo open has its crease
        // there; a phone has no room).
        var strip: LRect?
        if f == .tabletop {
            let x0 = stick.frame.maxX + 12, x1 = (slots.map { $0.c.x - $0.r }.min() ?? w) - 12
            // Narrow and tall between the wells: the strip stands upright there (DeckChrome stacks the words).
            if x1 - x0 >= 72 { strip = LRect(x: x0, y: h / 2 - 95, w: x1 - x0, h: 190) }
        } else if f == .tablet {
            let sw = min(520, w * 0.44)
            strip = LRect(x: (w - sw) / 2, y: h - 40 - margin, w: sw, h: 40)
        }
        return DeckLayout(form: f, width: w, height: h, stick: stick, slots: slots, pivot: pivot, reach: p.reach,
                          arc: arc, valves: valves, valveK: vk, strip: strip)
    }
}
