// 0221: the player's own HUD layout on every shape DeckTests measures. The factory is Deck's, untouched; every preset and
// every drag stays inside the controls rect, off the Duo's fold, at least 44 pt; the stick's shaping is the identity until
// the player changes it.
import Testing
import Foundation
@testable import ColdGasLayout

@Suite("The HUD layout editor's geometry")
struct HudLayoutTests {
    private func base(_ c: DeckTests.Case) -> (DeckLayout, LRect?) {
        let r = c.fold.controls
        let form = Deck.form(spread: c.fold.spread, width: r.w, height: r.h)
        let fold = c.fold.fold.map { LRect(x: $0.x - r.x, y: $0.y - r.y, w: $0.w, h: $0.h) }
        return (Deck.layout(form: form, width: r.w, height: r.h, fold: fold), fold)
    }
    static let names = DeckTests.cases.map(\.name)

    @Test(arguments: names) func theFactoryIsDecksOwn(_ name: String) throws {
        let c = try #require(DeckTests.cases.first { $0.name == name })
        let (b, fold) = base(c)
        #expect(HudLayout.apply(b, nil, fold: fold) == b)
        #expect(HudLayout.apply(b, HudCustom(), fold: fold) == b)
        #expect(HudLayout.apply(b, HudCustom(preset: .thumbs), fold: fold) == b)
    }

    @Test(arguments: names) func everyPresetFitsTheShape(_ name: String) throws {
        let c = try #require(DeckTests.cases.first { $0.name == name })
        let (b, fold) = base(c)
        let rect = LRect(x: 0, y: 0, w: b.width, h: b.height)
        for p in HudPreset.allCases {
            let l = HudLayout.apply(b, HudCustom(preset: p), fold: fold)
            for t in HudTier.allCases {
                for ctl in t.controls(form: b.form, valvesSplit: b.valves.count == 2) {
                    let f = try #require(l.frame(ctl))
                    #expect(rect.contains(f, slack: 0.01), "\(p) \(ctl) on \(name) runs off the rect: \(f)")
                    if b.form != .tabletop && ctl != .valves0 && ctl != .valves1 {
                        #expect(!HudLayout.crossesFold(f, fold: fold), "\(p) \(ctl) on \(name) crosses the fold")
                    }
                    if ctl != .valves0 && ctl != .valves1 { #expect(f.w >= 44, "\(p) \(ctl) on \(name) is under 44 pt") }
                }
            }
            if p != .thumbs {
                #expect(HudLayout.overlaps(l, controls: HudTier.pro.controls(form: b.form, valvesSplit: false)).isEmpty, "\(p) overlaps on \(name)")
            }
        }
    }

    @Test(arguments: names) func leftHandedMirrorsTheDeck(_ name: String) throws {
        let c = try #require(DeckTests.cases.first { $0.name == name })
        let (b, fold) = base(c)
        let l = HudLayout.apply(b, HudCustom(preset: .leftHanded), fold: fold)
        #expect(l.stick.home.x > b.width / 2, "the stick should be under the right thumb")
        #expect(l.slots[0].c.x < b.width / 2, "the main button should be under the left thumb")
        // The valve deck keeps the car's left on the left.
        #expect(l.valves == b.valves)
        // Mirroring the mirror gives the factory back (within a point: the legal clamp).
        let back = HudLayout.apply(b, HudLayout.mirrored(HudCustom(preset: .leftHanded), base: b, fold: fold), fold: fold)
        #expect(abs(back.stick.home.x - b.stick.home.x) < 1 && abs(back.slots[0].c.x - b.slots[0].c.x) < 1)
    }

    @Test func nothingIsPlacedAcrossTheCrease() throws {
        let c = try #require(DeckTests.cases.first { $0.name == "Duo book" })
        let (b, fold) = base(c)
        let f = try #require(fold)
        // Drop the main button right on the crease, then the stick: both land beside it.
        let x = (f.x + f.w / 2) / b.width
        let l = HudLayout.apply(b, HudCustom([.slotA: HudPlacement(x: x, y: 0.5), .stick: HudPlacement(x: x + 0.005, y: 0.5, scale: 1.6)]), fold: fold)
        #expect(!HudLayout.crossesFold(l.slots[0].frame, fold: fold))
        #expect(!HudLayout.crossesFold(l.stick.frame, fold: fold))
        #expect(l.stick.home.x > f.maxX, "the stick, dropped just right of the crease's middle, goes right of it")
    }

    @Test func aDragSnapsToTheMiddleAndToAnotherControl() {
        let (p, g) = HudSnap.snap(LPoint(x: 223, y: 300), half: (40, 40), w: 440, h: 900, others: [])
        #expect(p.x == 220 && g.contains(HudGuide(vertical: true, at: 220)))
        let other = LRect(x: 300, y: 500, w: 80, h: 80)
        let (q, h) = HudSnap.snap(LPoint(x: 100, y: 545), half: (30, 30), w: 440, h: 900, others: [other])
        #expect(q.y == 540 && h.contains(HudGuide(vertical: false, at: 540)), "centre to the other's centre")
        let (far, none) = HudSnap.snap(LPoint(x: 130, y: 300), half: (20, 20), w: 440, h: 900, others: [])
        #expect(far == LPoint(x: 130, y: 300) && none.isEmpty)
    }

    @Test func overlapsAreFoundOnlyAmongWhatsShownTogether() throws {
        let c = try #require(DeckTests.cases.first { $0.name == "Pro Max upright" })
        let (b, _) = base(c)
        let a = b.slots[0].c
        let l = HudLayout.apply(b, HudCustom([.slotB: HudPlacement(x: a.x / b.width, y: a.y / b.height)]))
        let o = HudLayout.overlaps(l, controls: HudTier.assist.controls(form: b.form, valvesSplit: false))
        #expect(o.contains { $0 == (.slotA, .slotB) })
        // The thumb pad and the fan are never on the glass together.
        #expect(!o.contains { $0.0 == .thumb || $0.1 == .thumb })
        #expect(HudLayout.overlaps(b, controls: HudTier.pro.controls(form: b.form, valvesSplit: false)).isEmpty)
    }

    @Test func sizesAndOpacityAreKeptInRange() throws {
        let c = try #require(DeckTests.cases.first { $0.name == "Pro Max sideways" })
        let (b, _) = base(c)
        let l = HudLayout.apply(b, HudCustom([.slotB: HudPlacement(x: 0.5, y: 0.5, scale: 0.01, alpha: 0)]))
        #expect(l.slots[1].d >= 44)
        #expect(l.alpha(.slotB) == HudPlacement.alphas.lowerBound)
        #expect(l.alpha(.slotA) == 1)
        let big = HudLayout.apply(b, HudCustom([.valves0: HudPlacement(x: 0.5, y: 0.5, scale: 1.8)]))
        #expect(LRect(x: 0, y: 0, w: b.width, h: b.height).contains(big.valves[0], slack: 0.01))
        #expect(big.valveKs[0] >= b.valveKs[0] && big.valveKs[1] == b.valveKs[1])
    }

    @Test func theStickModesShapeWhereAThumbTakesIt() throws {
        let c = try #require(DeckTests.cases.first { $0.name == "Pro Max sideways" })
        let (b, _) = base(c)
        #expect(HudLayout.apply(b, nil, stickMode: .floating).stick.zone == b.stick.zone)
        #expect(HudLayout.apply(b, nil, stickMode: .fixed).stick.zone == b.stick.frame)
        let dyn = HudLayout.apply(b, nil, stickMode: .dynamic).stick.zone
        #expect(dyn.x == 0 && dyn.w == b.width / 2 && dyn.maxY == b.height)
        let left = HudLayout.apply(b, HudCustom(preset: .leftHanded), stickMode: .dynamic).stick.zone
        #expect(left.x == b.width / 2, "mirrored, the stick's side is the right")
    }

    @Test func theStickIsUnchangedUntilThePlayerChangesIt() {
        for (x, y) in [(0.0, 0.0), (0.1, -0.05), (0.7071, 0.7071), (-1.0, 0.0), (0.333, 0.25)] {
            let v = StickShape.apply(x: x, y: y, dead: 0, sensitivity: 1)
            #expect(v.x.bitPattern == x.bitPattern && v.y.bitPattern == y.bitPattern)
        }
        #expect(StickShape.apply(x: 0.1, y: 0, dead: 0.2, sensitivity: 1) == (x: 0, y: 0))
        let r = StickShape.apply(x: 0.6, y: 0, dead: 0.2, sensitivity: 1)
        #expect(abs(r.x - 0.5) < 1e-12 && r.y == 0)
        let s = StickShape.apply(x: 0.6, y: 0.8, dead: 0, sensitivity: 2)
        #expect(abs((s.x * s.x + s.y * s.y).squareRoot() - 1) < 1e-12, "never past the rim")
    }

    @Test func prefsRoundTripAndShrugOffJunk() throws {
        var p = HudPrefs()
        p.set(HudCustom([.stick: HudPlacement(x: 0.8, y: 0.7, scale: 1.2, alpha: 0.6)], preset: .claw), .pro, .phoneWide)
        p.stickMode = .dynamic; p.deadZone = 0.1; p.brakeToggle = true; p.lookInvertY = true
        let d = try JSONEncoder().encode(p)
        let back = try JSONDecoder().decode(HudPrefs.self, from: d)
        #expect(back == p)
        #expect(back.custom(.pro, .phoneWide)?.preset == .claw)
        #expect(back.custom(.pro, .phone) == nil)
        #expect(back.custom(.pro, .phone, leftHanded: true)?.preset == .leftHanded, "the old hand setting starts the mirror")
        let junk = #"{"stickMode":"sideways","deadZone":"lots","layouts":{"pro/phone":{"placements":{"stick":{"x":2,"y":"no"},"wing":{"x":0.1,"y":0.1}},"preset":"other"},"nope/phone":{},"pro/phoneWide":7},"brakeToggle":true}"#
        let j = try JSONDecoder().decode(HudPrefs.self, from: Data(junk.utf8))
        #expect(j.stick == .floating && j.dead == 0 && j.brakeToggles)
        let pl = try #require(j.layouts?["pro/phone"]?.placements[.stick])
        #expect(pl.x == 1 && pl.y == 0.5, "clamped, and the unreadable y is the middle")
        #expect(j.layouts?["pro/phone"]?.placements.count == 1 && j.layouts?["pro/phone"]?.preset == nil)
        #expect(j.layouts?.count == 1)
    }

    @Test func aRectWithNoSizeYetIsNeverNaN() {
        // A view before its first layout: the editor crashed turning a preset's NaN into an Int.
        let z = Deck.layout(form: .phone, width: 0, height: 0)
        for p in HudPreset.allCases {
            #expect(HudLayout.preset(p, z).values.allSatisfy { $0.x.isFinite && $0.y.isFinite })
            let l = HudLayout.apply(z, HudCustom(preset: p))
            #expect(l.stick.home.x.isFinite && l.slots.allSatisfy { $0.c.x.isFinite && $0.c.y.isFinite })
        }
    }

    @Test func theShapesAreTold() {
        #expect(HudShape.of(spread: .single, width: 440, height: 860, foldable: false, bent: false) == .phone)
        #expect(HudShape.of(spread: .single, width: 900, height: 400, foldable: false, bent: false) == .phoneWide)
        #expect(HudShape.of(spread: .single, width: 382, height: 644, foldable: true, bent: false) == .duoClosed)
        #expect(HudShape.of(spread: .full, width: 867, height: 635, foldable: true, bent: true) == .duoBook)
        #expect(HudShape.of(spread: .full, width: 669, height: 835, foldable: true, bent: false) == .duoFlat)
        #expect(HudShape.of(spread: .rows, width: 669, height: 461, foldable: true, bent: true) == .duoTabletop)
        #expect(HudShape.of(spread: .single, width: 1032, height: 1332, foldable: false, bent: false) == .tablet)
    }

    @Test func theDrivesMapIsShownUntilThePlayerHidesItAndRemembers() throws {
        var p = HudPrefs()
        #expect(p.mapShown)
        p.driveMap = false
        let back = try JSONDecoder().decode(HudPrefs.self, from: try JSONEncoder().encode(p))
        #expect(!back.mapShown)
        // An old save (no field) and a junk value both show it.
        #expect(try JSONDecoder().decode(HudPrefs.self, from: Data("{}".utf8)).mapShown)
        #expect(try JSONDecoder().decode(HudPrefs.self, from: Data(#"{"driveMap":"x"}"#.utf8)).mapShown)
    }
}
