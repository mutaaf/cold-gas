// 0310 (for 0320): the land's lakes and rivers. Deterministic per seed, carved into the ground under their level, held by
// their shores, never over a road; FreeWorld.water reports them.
import Testing
@testable import ColdGasWorld
import ColdGasCore
import Foundation

@Suite("Lakes and rivers (0310)")
struct WatersTests {
    @Test func lakesAreSeededHeldAndOffTheRoads() throws {
        let w = FreeWorld(seed: "cold gas")
        let lakes = w.lakes(nearX: 0, z: 0, r: 24_000)
        #expect(lakes.count >= 3)
        // The same lakes from another instance, asked in another order.
        let o = FreeWorld(seed: "cold gas")
        _ = o.ground(9000, -9000)
        let again = o.lakes(nearX: 0, z: 0, r: 24_000)
        #expect(again.count == lakes.count)
        for (a, b) in zip(lakes, again) { #expect(a.x == b.x && a.z == b.z && a.level == b.level && a.r == b.r) }
        for l in lakes.prefix(6) {
            // The middle is under water, at the lake's level, its bed below it.
            let g = w.ground(l.x, l.z)
            #expect(g.waterKind == .lake && g.water == l.level)
            #expect(g.y < l.level - 2)
            let s = w.water(l.x, l.z, groundY: g.y)
            #expect(s.wet && s.kind == .lake && abs(s.depth - (l.level - g.y)) < 1e-9)
            // Far round it, dry land above the level (the shore holds it).
            for k in 0..<8 {
                let a = Double(k) * .pi / 4, x = l.x + cos(a) * l.r * 2.0, z = l.z + sin(a) * l.r * 2.0
                #expect(w.ground(x, z).y > l.level - 0.5)
            }
            // No road within its clearance.
            let hit = w.roads.query(minX: l.x, minZ: l.z, maxX: l.x, maxZ: l.z, margin: 600).nearest(l.x, l.z, maxD: 600)
            #expect(hit.d > l.r + 100)
        }
    }

    @Test func riversRunInChannelsAndNeverOverTheRoad() {
        let w = FreeWorld(seed: "cold gas")
        var wet = 0, seen = 0
        for j in 0..<220 { for i in 0..<220 {
            let x = 3000 + Double(i) * 37, z = -6000 + Double(j) * 41
            let g = w.ground(x, z)
            if g.waterKind == .river {
                seen += 1
                if g.y < g.water { wet += 1; #expect(abs((g.flow.0 * g.flow.0 + g.flow.1 * g.flow.1) - 1) < 1e-6) }
            }
            // On a road's paving the water is always under the road.
            if g.road < RoadSpec.hw { #expect(g.y > g.water || g.waterKind == .sea) }
        } }
        #expect(seen > 10 && wet > 5)
    }
}
