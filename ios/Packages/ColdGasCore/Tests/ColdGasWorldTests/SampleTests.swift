// 0310: asking the land (docs/NATIVE-FREEDRIVE.md §9.2). One sample agrees with the ground the car drives on and with the tiles
// the GPU bakes from; the water is where the sea is; snow lies on the high mountain ground and wetness at the shore.
import Testing
@testable import ColdGasWorld
import ColdGasCore

@Suite("Asking the land (0310)")
struct SampleTests {
    @Test func aSampleIsTheGroundTheCarDrivesOn() {
        let w = FreeWorld(seed: "cold gas")
        for (x, z) in [(4321.5, -2987.25), (-6100.0, 7300.0), (12_000.0, 800.0), (0.0, 0.0), (-1499.0, 600.0)] {
            let s = w.sample(x, z), g = w.ground(x, z)
            #expect(s.y == g.y)
            #expect(s.road == g.road)
            #expect(s.floor == g.floor)
            let n = s.normal
            #expect(abs(n.0 * n.0 + n.1 * n.1 + n.2 * n.2 - 1) < 1e-9)
            #expect(s.slope >= 0 && s.slope < 1)
            #expect(s.surface == FreeWorld.surface(g, slope: s.slope))
            #expect(s.wetness >= 0 && s.wetness <= 1 && s.snow >= 0 && s.snow <= 1)
        }
        // The same answer in any order, on another instance of the same seed.
        let a = FreeWorld(seed: "order").sample(5555, -4444), other = FreeWorld(seed: "order")
        _ = other.sample(-9000, 9000); _ = other.tile(TileKey(2, 3, -4))
        let b = other.sample(5555, -4444)
        #expect(a.y.bitPattern == b.y.bitPattern && a.wetness == b.wetness && a.snow == b.snow)
    }

    @Test func theSeaIsWhereTheGroundFallsUnderIt() {
        let w = FreeWorld(seed: "cold gas")
        // Search a coast for a point under the sea and one on dry land.
        var under: LandSample?, dry: LandSample?
        outer: for j in 0..<160 { for i in 0..<160 {
            let s = w.sample(-30_000 + Double(i) * 375, -30_000 + Double(j) * 375)
            if s.water.wet && under == nil { under = s }
            if !s.water.wet && s.y > SEA + 20 && dry == nil { dry = s }
            if under != nil && dry != nil { break outer }
        } }
        guard let u = under, let d = dry else { Issue.record("no sea within 30 km of the centre"); return }
        #expect(u.water.level == SEA && u.water.depth > 0 && u.wetness == 1)
        #expect(d.water.depth < 0 && d.wetness < 1)
        // The slab is never sea.
        #expect(!w.sample(10, 10).water.wet)
    }

    @Test func snowLiesHighAndWetnessAtTheShore() {
        #expect(LandLook.snow(mountain: 1, y: 1200, slope: 0.1) == 1)
        #expect(LandLook.snow(mountain: 1, y: 600, slope: 0.1) == 0)
        #expect(LandLook.snow(mountain: 1, y: 1200, slope: 0.8) == 0)
        #expect(LandLook.snow(mountain: 0, y: 1200, slope: 0.1) == 0)
        #expect(LandLook.wetness(y: SEA + 0.1, waterLevel: SEA, snow: 0) > 0.9)
        #expect(LandLook.wetness(y: SEA + 10, waterLevel: SEA, snow: 0) == 0)
        #expect(LandLook.wetness(y: SEA - 1, waterLevel: SEA, snow: 0) == 1)
    }

    @Test func theTilesCarryTheSameMaterial() {
        // A tile's material float (§9.3) holds `sample`'s snow, wetness and road distance at its vertices.
        let w = FreeWorld(seed: "cold gas")
        let key = TileKey(0, 4321 / 128, -2987 / 128)
        let t = w.tile(key), W = TileSpec.n + 1, s = TileSpec.stride
        for (i, j) in [(0, 0), (16, 9), (32, 32), (5, 27)] {
            let bits = t.vertices[(j * W + i) * s + 8].bitPattern
            let x = key.x0 + Double(i) * key.size / Double(TileSpec.n), z = key.z0 + Double(j) * key.size / Double(TileSpec.n)
            let sm = w.sample(x, z)
            #expect(abs(Double(bits & 255) / 255 - sm.snow) < 0.01)
            if !sm.water.wet { #expect(abs(Double((bits >> 8) & 255) / 255 - sm.wetness) < 0.01) }
            #expect(abs(Double((bits >> 16) & 255) / 8 - Swift.min(31.875, sm.road)) < 0.2)
        }
        // A seabed tile keeps the ground's real height under the sea.
        var deepAt: (Double, Double)?
        outer: for j in 0..<160 { for i in 0..<160 {
            let x = -30_000 + Double(i) * 375, z = -30_000 + Double(j) * 375
            if w.sample(x, z).water.depth > 3 { deepAt = (x, z); break outer }
        } }
        guard let (x, z) = deepAt else { Issue.record("no sea"); return }
        let k = TileKey(0, Int((x / 128).rounded(.down)), Int((z / 128).rounded(.down)))
        let flat = w.tile(k), deep = w.tile(k, seabed: true)
        #expect(deep.minY < flat.minY - 1)
        #expect(flat.minY >= SEA - 6.01)   // (the skirts hang 1.5 steps, 6 m, under the flat sea)
    }
}
