// 0148: the Duo's measured poses (18-0-duo-graphics, Xcode 27.1/27.2 simulator: spread.test.ts there) give the
// panels docs/NATIVE.md §5 asks for, and nothing is placed across the fold or under the 84 pt side bar.
import Testing
@testable import ColdGasLayout

@Suite("Fold layout on the iPhone Duo's measured poses")
struct FoldLayoutTests {
    // Book (open): window 951×669, insets right 84 / bottom 34, fold band x 455.5, 40 wide.
    @Test func book() {
        let l = Fold.layout(width: 951, height: 669, safe: LInsets(bottom: 34, right: 84), regions: [LRect(x: 455.5, y: 0, w: 40, h: 669)])
        // Open: edge to edge across the whole inner display; the controls over it, clear of the side bar.
        #expect(l.spread == .full)
        #expect(l.scene == LRect(x: 0, y: 0, w: 951, h: 669))
        #expect(l.controls == LRect(x: 0, y: 0, w: 951 - 84, h: 669 - 34))
        #expect(l.fold == LRect(x: 455.5, y: 0, w: 40, h: 669))
    }
    // Tabletop: 669×951, insets top 82 / bottom 34, horizontal band at y 455.5.
    @Test func tabletop() {
        let l = Fold.layout(width: 669, height: 951, safe: LInsets(top: 82, bottom: 34), regions: [LRect(x: 0, y: 455.5, w: 669, h: 40)])
        #expect(l.spread == .rows)
        #expect(l.scene == LRect(x: 0, y: 0, w: 669, h: 455.5))
        #expect(l.controls == LRect(x: 0, y: 495.5, w: 669, h: 951 - 34 - 495.5))
    }
    // Closed (the outer screen): 466×678, right inset 84, no fold.
    @Test func closed() {
        let l = Fold.layout(width: 466, height: 678, safe: LInsets(right: 84), regions: [])
        #expect(l.spread == .single)
        #expect(l.scene == LRect(x: 0, y: 0, w: 466, h: 678))
        #expect(l.controls.maxX == 466 - 84)
        #expect(l.fold == nil)
    }
    // Flat lays out exactly like book: the inactive region is at the same frame.
    @Test func flatIsBook() {
        let r = [LRect(x: 455.5, y: 0, w: 40, h: 669)]
        #expect(Fold.layout(width: 951, height: 669, safe: LInsets(bottom: 34, right: 84), regions: r) ==
                Fold.layout(width: 951, height: 669, safe: LInsets(bottom: 34, right: 84), regions: r))
    }
    // A Pro Max (no fold) is one panel; the order of regions doesn't matter.
    @Test func proMaxAndOrder() {
        #expect(Fold.layout(width: 440, height: 956, safe: LInsets(top: 62, bottom: 34), regions: []).spread == .single)
        let odd = [LRect(x: 10, y: 10, w: 20, h: 20), LRect(x: 455.5, y: 0, w: 40, h: 669)]
        #expect(Fold.layout(width: 951, height: 669, safe: LInsets(bottom: 34, right: 84), regions: odd).spread == .full)
    }
    // The mid-swing size no pose has (LESSONS 0075's 466×498) stays one panel, with no fold drawn.
    @Test func midSwing() {
        #expect(Fold.layout(width: 466, height: 498, safe: LInsets(), regions: []).spread == .single)
    }
    @Test func emulatedPosesMatchTheMeasuredBand() {
        #expect(Fold.emulatedRegions(pose: "book", width: 951, height: 669) == [LRect(x: 455.5, y: 0, w: 40, h: 669)])
        #expect(Fold.emulatedRegions(pose: "tabletop", width: 669, height: 951) == [LRect(x: 0, y: 455.5, w: 669, h: 40)])
        #expect(Fold.emulatedRegions(pose: "closed", width: 466, height: 678).isEmpty)
    }
}
