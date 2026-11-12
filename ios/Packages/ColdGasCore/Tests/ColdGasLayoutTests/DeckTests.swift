// 0210: the flight deck on every shape it's drawn on. The controls rects come from the fold layout on the Duo's measured
// poses (docs/NATIVE.md §5) and the reference phone and iPad sizes, so a change to either side shows up here.
import Testing
import Foundation
@testable import ColdGasLayout

@Suite("The flight deck on every screen shape")
struct DeckTests {
    struct Case { let name: String; let fold: FoldLayout; let form: DeckForm }
    static let cases: [Case] = {
        func f(_ w: Double, _ h: Double, _ s: LInsets, _ r: [LRect] = [], folded: Bool = true) -> FoldLayout {
            Fold.layout(width: w, height: h, safe: s, regions: r, folded: folded)
        }
        return [
            Case(name: "Pro Max upright", fold: f(440, 956, LInsets(top: 62, bottom: 34)), form: .phone),
            Case(name: "Pro Max sideways", fold: f(956, 440, LInsets(bottom: 21, right: 62)), form: .phoneWide),
            Case(name: "a 6.1-inch phone upright", fold: f(402, 874, LInsets(top: 62, bottom: 34)), form: .phone),
            Case(name: "a 6.1-inch phone sideways", fold: f(874, 402, LInsets(left: 62, bottom: 21, right: 62)), form: .phoneWide),
            Case(name: "Duo closed", fold: f(466, 678, LInsets(right: 84)), form: .phone),
            Case(name: "Duo book", fold: f(951, 669, LInsets(bottom: 34, right: 84), [LRect(x: 455.5, y: 0, w: 40, h: 669)]), form: .duoOpen),
            Case(name: "Duo flat, upright", fold: f(669, 951, LInsets(top: 82, bottom: 34), [LRect(x: 0, y: 455.5, w: 669, h: 40)], folded: false), form: .duoOpen),
            Case(name: "Duo tabletop", fold: f(669, 951, LInsets(top: 82, bottom: 34), [LRect(x: 0, y: 455.5, w: 669, h: 40)]), form: .tabletop),
            Case(name: "iPad 13 upright", fold: f(1032, 1376, LInsets(top: 24, bottom: 20)), form: .tablet),
            Case(name: "iPad 13 sideways", fold: f(1376, 1032, LInsets(top: 24, bottom: 20)), form: .tablet),
            Case(name: "iPad mini upright", fold: f(744, 1133, LInsets(top: 24, bottom: 20)), form: .tablet),
        ]
    }()

    private func deck(_ c: Case) -> (DeckLayout, LRect, LRect?) {
        let r = c.fold.controls
        let form = Deck.form(spread: c.fold.spread, width: r.w, height: r.h)
        // The fold band in the controls rect's own coordinates.
        let fold = c.fold.fold.map { LRect(x: $0.x - r.x, y: $0.y - r.y, w: $0.w, h: $0.h) }
        return (Deck.layout(form: form, width: r.w, height: r.h, fold: fold), LRect(x: 0, y: 0, w: r.w, h: r.h), fold)
    }

    @Test(arguments: cases.map(\.name)) func formIsTheShape(_ name: String) throws {
        let c = try #require(Self.cases.first { $0.name == name })
        #expect(deck(c).0.form == c.form)
    }

    @Test(arguments: cases.map(\.name)) func everyControlFitsAndIsBigEnough(_ name: String) throws {
        let c = try #require(Self.cases.first { $0.name == name })
        let (d, bounds, fold) = deck(c)
        var all = d.slots.map(\.frame) + [d.stick.frame]
        all += d.valves
        for r in all {
            #expect(bounds.contains(r), "\(name): \(r) leaves \(bounds)")
            if let f = fold, c.fold.spread != .rows { #expect(!r.intersects(f), "\(name): \(r) crosses the fold \(f)") }
        }
        #expect(d.slots[0].d >= 84, "\(name): slot A is under the thumb, so it's the biggest")
        for s in d.slots { #expect(s.d >= 56) }
        #expect(d.stick.ring * 2 >= 120)
        // Touch targets over 44 pt on the valve deck: its smallest pad is r 24 in the web's units.
        #expect(24 * 2 * d.valveK >= 44, "\(name): valve pads \(48 * d.valveK) pt")
    }

    @Test(arguments: cases.map(\.name)) func nothingOverlaps(_ name: String) throws {
        let c = try #require(Self.cases.first { $0.name == name })
        let d = deck(c).0
        let s = d.slots
        for i in s.indices {
            for j in s.indices where j > i {
                let gap = hypot(s[i].c.x - s[j].c.x, s[i].c.y - s[j].c.y) - s[i].r - s[j].r
                #expect(gap >= 8, "\(name): slots \(i) and \(j) \(gap) pt apart")
            }
            let toStick = hypot(s[i].c.x - d.stick.home.x, s[i].c.y - d.stick.home.y) - s[i].r - d.stick.ring
            #expect(toStick >= 40, "\(name): slot \(i) crowds the stick")
            #expect(!d.stick.zone.contains(s[i].frame), "\(name): the stick's corner swallows slot \(i)")
        }
        if d.valves.count == 2 { #expect(d.valves[0].maxX + 40 <= d.valves[1].x) }
        if let st = d.strip {
            for r in d.covers + [d.stick.frame] + s.map(\.frame) { #expect(!st.intersects(r), "\(name): the strip crowds \(r)") }
        }
    }

    /// The fan is one arc: every slot the same distance from the pivot (the thumb's sweep), A between B and C.
    @Test(arguments: cases.map(\.name)) func theFanIsOneArc(_ name: String) throws {
        let c = try #require(Self.cases.first { $0.name == name })
        let d = deck(c).0
        for s in d.slots { #expect(abs(hypot(s.c.x - d.pivot.x, s.c.y - d.pivot.y) - d.reach) < 1e-6) }
        #expect(d.slots[1].c.y < d.slots[0].c.y, "B is up the arc")
        #expect(d.slots[2].c.x < d.slots[0].c.x || d.slots[2].c.y > d.slots[0].c.y, "C is down the arc, toward the middle or the floor")
    }

    /// The shape is exaggerated, not stretched: an upright phone keeps its clusters low, an iPad at its grips, the Duo's
    /// tabletop uses its panel's height, and every bigger shape gets bigger controls.
    @Test func eachShapeIsItsOwn() throws {
        func of(_ n: String) throws -> DeckLayout { try deck(#require(Self.cases.first { $0.name == n })).0 }
        let phone = try of("Pro Max upright"), wide = try of("Pro Max sideways"), duo = try of("Duo book")
        let table = try of("Duo tabletop"), pad = try of("iPad 13 upright"), padWide = try of("iPad 13 sideways")
        #expect(phone.slots[0].c.y > phone.height * 0.8)
        #expect(phone.valves.count == 1 && wide.valves.count == 2 && duo.valves.count == 2 && table.valves.count == 2 && pad.valves.count == 2)
        for p in [pad, padWide] {
            #expect(p.slots[0].c.y < p.height * 0.72 && p.slots[0].c.y > p.height * 0.45, "an iPad's fan is at the grip")
            #expect(p.stick.home.y < p.height * 0.72)
        }
        #expect(table.valves[0].h >= table.height - 2 * Deck.margin - 1, "tabletop's valve deck fills the panel")
        #expect(table.strip != nil)
        #expect(pad.strip != nil && duo.strip == nil && phone.strip == nil)
        #expect(phone.slots[0].d < wide.slots[0].d && wide.slots[0].d < duo.slots[0].d && duo.slots[0].d < table.slots[0].d && table.slots[0].d < pad.slots[0].d)
        #expect(phone.stick.travel < duo.stick.travel && duo.stick.travel < table.stick.travel && table.stick.travel < pad.stick.travel)
    }
}
