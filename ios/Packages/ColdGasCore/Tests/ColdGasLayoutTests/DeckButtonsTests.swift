// 0210: the fan shows only what the moment uses, by the web's own rule (src/main.js syncTouchPhase, src/styles.css).
import Testing
@testable import ColdGasLayout

@Suite("The fan shows only what the moment uses")
struct DeckButtonsTests {
    private func keys(_ b: [DeckButton?]) -> [String] { b.map { $0.map { "\($0.key.rawValue):\($0.label)" } ?? "-" } }

    @Test func theWebsRule() {
        #expect(keys(Deck.buttons(.ground, assist: false, course: "show", ledge: false, rowDone: false)) == ["go:GO", "brake:BRAKE", "-"])
        #expect(keys(Deck.buttons(.ground, assist: false, course: "lineup", ledge: false, rowDone: false)) == ["go:GO", "brake:BRAKE", "lift:LIFT"])
        #expect(keys(Deck.buttons(.ramp, assist: false, course: "wall", ledge: false, rowDone: false)) == ["go:GO", "brake:BRAKE", "-"])
        let ledge = Deck.buttons(.ramp, assist: false, course: "wall", ledge: true, rowDone: false)
        #expect(keys(ledge) == ["go:GO", "brake:BRAKE", "lift:RELEASE"])
        #expect(ledge[2]?.amber == true)
        #expect(keys(Deck.buttons(.air, assist: false, course: "show", ledge: false, rowDone: false)) == ["lift:LIFT", "-", "go:BOOST"])
        #expect(keys(Deck.buttons(.air, assist: false, course: "show", ledge: false, rowDone: true)) == ["lift:LIFT", "-", "-"])
        #expect(keys(Deck.buttons(.air, assist: true, course: "show", ledge: false, rowDone: false)) == ["land:LAND", "-", "go:BOOST"])
        #expect(keys(Deck.buttons(.air, assist: true, course: "lineup", ledge: false, rowDone: false)) == ["land:LAND", "lift:LIFT", "go:BOOST"])
        #expect(keys(Deck.buttons(.landed, assist: false, course: "show", ledge: false, rowDone: true)) == ["brake:BRAKE", "-", "-"])
        #expect(Deck.stickLabel(.landed) == nil)
        #expect(Deck.stickLabel(.air) == "ROLL · PITCH")
        #expect(Deck.stickLabel(.ground) == "STEER")
    }

    @Test func theGhostFollowsTheCue() {
        #expect(Deck.hint(cue: "Hold GO to drive") == "go")
        #expect(Deck.hint(cue: "Upside down on the ledge · RELEASE to let go") == "lift")
        #expect(Deck.hint(cue: "Brake: hold LIFT at the BRAKE line") == "lift")
        #expect(Deck.hint(cue: "BOOST · carry about 10 m/s over the row") == "go")
        #expect(Deck.hint(cue: "Hold BOOST + LAND · over the row") == "go")
        #expect(Deck.hint(cue: "Stick sideways to roll") == "stick")
        #expect(Deck.hint(cue: "Hold LAND") == "land")
        #expect(Deck.hint(cue: "Onto the ledge, then stop") == nil)
    }

    @Test func theStrip() {
        #expect(Deck.stripNames(course: "wall").count == 5)
        #expect(Deck.stripIndex(.ramp, course: "show", ledge: true) == 2)
        #expect(Deck.stripIndex(.air, course: "lineup", ledge: false) == 1)
        #expect(Deck.stripIndex(.landed, course: "wall", ledge: false) == 4)
    }
}
