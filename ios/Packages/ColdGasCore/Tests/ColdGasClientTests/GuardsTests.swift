// 0301: what the app takes from outside the sim is held to what it may be. A stored setting this build doesn't know goes
// back to its default (and says so), a number that isn't one becomes the safe value, a frame clock that jumped is no step
// at all, and a list that only grows is trimmed with its readers' cursors following it.
import Foundation
import Testing
@testable import ColdGasClient

@Suite struct GuardsTests {
    @Test func aStoredChoiceIsOneOfItsValuesOrTheDefault() {
        let looks = ["real", "anime", "pixel"]
        #expect(Guard.oneOf("anime", looks, fallback: "real") == ("anime", false))
        #expect(Guard.oneOf(nil, looks, fallback: "real") == ("real", false))          // a fresh install: not a repair
        for junk in ["", "ANIME", "vapor", "real ", "8-bit", "🚀", String(repeating: "x", count: 10_000)] {
            #expect(Guard.oneOf(junk, looks, fallback: "real") == ("real", true), "\(junk.prefix(12))")
        }
        #expect(Guard.oneOf("moon", ["show", "wall", "lineup"], fallback: "show") == ("show", true))
    }
    @Test func aStoredNumberIsFiniteAndInRange() {
        #expect(Guard.number(0.6, in: 0.5...0.8, fallback: 0.62) == (0.6, false))
        #expect(Guard.number(nil, in: 0.5...0.8, fallback: 0.62) == (0.62, false))
        #expect(Guard.number(.nan, in: 0.5...0.8, fallback: 0.62) == (0.62, true))
        #expect(Guard.number(.infinity, in: 0.5...0.8, fallback: 0.62) == (0.62, true))
        #expect(Guard.number(-.infinity, in: 0.5...0.8, fallback: 0.62) == (0.62, true))
        #expect(Guard.number(9, in: 0.5...0.8, fallback: 0.62) == (0.8, true))
        #expect(Guard.number(-3, in: 0.5...0.8, fallback: 0.62) == (0.5, true))
    }
    @Test func aFramesStepAndRateAreAlwaysUsable() {
        #expect(Guard.step(1.0 / 120) == 1.0 / 120)   // a real frame is untouched, to the bit
        #expect(Guard.step(0) == 0)
        #expect(Guard.step(.nan) == 0); #expect(Guard.step(.infinity) == 0); #expect(Guard.step(-.infinity) == 0)
        #expect(Guard.step(-0.5) == 0)                // the clock ran backwards
        #expect(Guard.step(3600) == 1)                // the app was away an hour
        #expect(Guard.rate(0.25) == 0.25); #expect(Guard.rate(1) == 1)
        #expect(Guard.rate(.nan) == 1); #expect(Guard.rate(-.infinity) == 1); #expect(Guard.rate(.infinity) == 1); #expect(Guard.rate(-2) == 0)
        #expect(Guard.rate(99) == 4)
        // The point of it: an index from a guarded clock never traps.
        var t = 0.0
        for dt in [Double.nan, .infinity, -1, 1.0 / 60] { t += Guard.step(dt) * Guard.rate(.nan) }
        #expect(t.isFinite); #expect(Int(t * 240) == 4)
        #expect(Guard.finite(Double.nan) == 0); #expect(Guard.finite(Float.infinity, 1) == 1); #expect(Guard.finite(2.5) == 2.5)
    }
    @Test func aGrowingListIsTrimmedAndItsCursorsFollow() {
        #expect(Guard.overflow(count: 4096, max: 4096, keep: 2048) == 0)
        #expect(Guard.overflow(count: 4097, max: 4096, keep: 2048) == 2049)
        #expect(Guard.overflow(count: 10, max: 4096, keep: -5) == 0)
        // A list of ticks, a cursor at 4000 of 4097; the oldest 2049 go: the cursor lands on the same element.
        var list = Array(0..<4097)
        let cur = 4000, d = Guard.overflow(count: list.count, max: 4096, keep: 2048)
        list.removeFirst(d)
        let now = Guard.cursor(cur, count: list.count, dropped: d)
        #expect(list[now] == 4000)
        // A cursor behind what was dropped starts at the front; a nonsense drop never moves it past the end.
        #expect(Guard.cursor(10, count: list.count, dropped: d) == 0)
        #expect(Guard.cursor(5000, count: 100, dropped: 0) == 100)
        #expect(Guard.cursor(50, count: 100, dropped: -7) == 50)
        // Bounded however long it runs: a drive's worth of impacts never holds more than the cap.
        var n = 0, peak = 0
        for _ in 0..<1_000_000 { n += 1; n -= Guard.overflow(count: n, max: 4096, keep: 2048); peak = max(peak, n) }
        #expect(peak <= 4096)
    }
}
