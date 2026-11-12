// 0214: Free Drive's world is a pure function of its seed (docs/NATIVE-FREEDRIVE.md §4): the same land, roads and props
// whatever order they're asked in, the Show's floor flat and bare, the land continuous where tiles meet, the roads held
// to their grade and agreeing at their junctions.
import Testing
@testable import ColdGasWorld
import ColdGasCore

@Suite("Free Drive's world")
struct WorldTests {
    @Test func theNoiseIsTheWebsNoise() {
        // src/sim/noise.js, as Node prints it: the same seed, hash, value noise and fractals, to the bit.
        #expect(WNoise.seedOf("coldgas") == 398382648)
        #expect(WNoise.hash2(12345, 7, -3) == 0.26903041428886354)
        #expect(WNoise.vnoise(99, 0.3, -2.7) == -0.3475429592283803)
        #expect(WNoise.fbm(WNoise.seedOf("blue"), 1234.5, -987.25, 700, 3) == -0.5035133992596081)
        #expect(WNoise.ridged(WNoise.seedOf("blue"), -4321.5, 77.25, 2600, 5) == 0.700981592031922)
    }

    @Test func theSameSeedBuildsTheSameWorldInAnyOrder() {
        let keys = [TileKey(0, 14, 3), TileKey(2, -5, 9), TileKey(4, 1, -2), TileKey(0, -13, -12)]
        let a = FreeWorld(seed: "blue hour"), b = FreeWorld(seed: "blue hour")
        let ta = keys.map { a.tile($0).vertices }
        // b asks for everything else first, in the other order.
        _ = b.props(30, -7); _ = b.tile(TileKey(3, 2, 2))
        let tb = keys.reversed().map { b.tile($0).vertices }.reversed()
        for (x, y) in zip(ta, tb) { #expect(x.map(\.bitPattern) == y.map(\.bitPattern)) }
        let pa = a.props(14, 9).instances, pb = b.props(14, 9).instances
        #expect(pa.count == pb.count)
        for (x, y) in zip(pa, pb) { #expect(x.x == y.x && x.z == y.z && x.y == y.y && x.kind == y.kind) }
        let other = FreeWorld(seed: "another").tile(keys[0]).vertices
        #expect(other.map(\.bitPattern) != ta[0].map(\.bitPattern))
    }

    @Test func theFloorIsFlatAndBare() {
        let w = FreeWorld(seed: "floor")
        for (x, z) in [(0.0, 0.0), (-265, -8), (1400, -1400), (-1499, 600), (300, 1450)] {
            let g = w.ground(x, z)
            #expect(g.y == 0 && g.floor)
        }
        for cz in -10...9 { for cx in -10...9 where abs(Double(cx) * 128 + 64) < Site.half - 128 && abs(Double(cz) * 128 + 64) < Site.half - 128 {
            #expect(w.props(cx, cz).instances.isEmpty)
        } }
        // And out past it, land.
        var rise = 0.0
        for k in 0..<40 { rise = max(rise, abs(w.ground(4500 + Double(k) * 97, -3800 + Double(k) * 61).y)) }
        #expect(rise > 20)
    }

    @Test func theLandIsContinuousWhereTilesMeet() {
        let w = FreeWorld(seed: "seams")
        // Two neighbours at level 1: the shared edge's vertices have the same height (same ground at the same points).
        let a = w.tile(TileKey(1, 20, 4)), b = w.tile(TileKey(1, 21, 4))
        let W = TileSpec.n + 1, s = TileSpec.stride
        for j in 0..<W {
            let ya = a.vertices[(j * W + TileSpec.n) * s + 1], yb = b.vertices[(j * W) * s + 1]
            #expect(ya == yb)
        }
        // A tile and its parent agree at every parent vertex (the geomorph's end state is the parent's surface).
        let p = w.tile(TileKey(2, 10, 2)), c = w.tile(TileKey(1, 20, 4))
        for j in stride(from: 0, through: TileSpec.n, by: 2) { for i in stride(from: 0, through: TileSpec.n, by: 2) {
            let yc = c.vertices[(j * W + i) * s + 1], yp = p.vertices[((j / 2) * W + i / 2) * s + 1]
            #expect(abs(yc - yp) < 0.01)
        } }
    }

    @Test func roadsHoldTheirGradeAndMeetAtJunctions() {
        let w = FreeWorld(seed: "roads")
        var checked = 0
        for j in 2...6 { for i in -4...3 {
            for north in [false, true] {
                guard let l = w.roads.link(i, j, north: north) else { continue }
                let p = w.roads.profile(l)
                // The design grade, or what the junctions ask for (a pass), and a little for the vertical curves.
                let need = max(RoadSpec.grade, abs(p.y[l.n - 1] - p.y[0]) / l.length + 0.01)
                for k in 1..<l.n { #expect(abs(p.y[k] - p.y[k - 1]) / l.len[k - 1] <= need + 0.006) }
                #expect(p.y[0] == w.roads.junctionY(i, j))
                let end = north ? w.roads.junctionY(i, j + 1) : w.roads.junctionY(i + 1, j)
                #expect(abs(p.y[l.n - 1] - end) < 1e-9)
                for k in 0..<l.n { #expect(abs(p.bank[k]) <= 0.06 + 1e-12) }
                checked += 1
            }
        } }
        #expect(checked > 60)
        // The ground on a road is the road.
        let l = w.roads.link(1, 3, north: true) ?? w.roads.link(1, 3, north: false)
        if let l {
            let k = l.n / 2, p = w.roads.profile(l), g = w.ground(l.x[k], l.z[k])
            #expect(abs(g.y - p.y[k]) < 0.2)
            #expect(g.surface == .asphalt)
        }
    }

    @Test func propsStandOffTheRoads() {
        let w = FreeWorld(seed: "props")
        var n = 0
        for cz in 24...27 { for cx in -2...1 {
            let cell = w.props(cx, cz)
            let q = w.roads.query(minX: Double(cx) * 128, minZ: Double(cz) * 128, maxX: Double(cx + 1) * 128, maxZ: Double(cz + 1) * 128)
            for p in cell.instances where p.kind != .post {
                let x = Double(cx) * 128 + Double(p.x), z = Double(cz) * 128 + Double(p.z)
                #expect(q.nearest(x, z).d >= RoadSpec.hw + 3 - 1e-6)
                #expect(!Site.onFloor(x, z, margin: 30))
                n += 1
            }
        } }
        #expect(n > 50)
    }

    @Test func aWalkerKeepsToTheRoadsThroughJunctions() {
        let w = FreeWorld(seed: "walk")
        guard let r = RoadWalker(world: w, nearX: 3000, z: 2500, headingX: 0.7, z: 0.7) else { Issue.record("no road"); return }
        var last = r.pose()
        for _ in 0..<1200 {
            r.advance(5)
            let p = r.pose()
            // Continuous (no jump at a junction) and on the road.
            #expect(((p.x - last.x) * (p.x - last.x) + (p.z - last.z) * (p.z - last.z)).squareRoot() < 5.5)
            last = p
        }
        #expect(r.travelled == 6000)
        let g = w.ground(last.x, last.z)
        #expect(abs(g.y - last.y) < 0.3)
    }

    @Test func precisionHoldsFarOut() {
        // 40 km out a tile's vertices are relative to its own corner: they stay as fine as they are at the centre.
        let w = FreeWorld(seed: "far")
        let t = w.tile(TileKey(0, 40_000 / 128, -35_000 / 128))
        let step = Float(TileSpec.leaf / Double(TileSpec.n))
        #expect(t.vertices[TileSpec.stride] == step)
        #expect(t.minY.isFinite && t.maxY.isFinite)
    }
}
