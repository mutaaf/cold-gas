// 0320: the sea is a pure function of the seed, a position and a time. Its waves tile (the GPU bakes one period), carry
// the sea state they were made for, never fold over, calm toward a shore, and are the same on every call; the maps the
// app draws the water from read the same ground the car drives on.
import Testing
import Foundation
@testable import ColdGasWorld
import ColdGasCore

@Suite("Free Drive's water")
struct WaterTests {
    let seed = WNoise.seedOf(FreeWorldSeed.text)

    @Test func eachCascadeTilesItsSquareExactly() {
        for (waves, L) in [(Waves.swell(seed: seed), WaterSpec.swellL), (Waves.chop(seed: seed), WaterSpec.chopL)] {
            for (x, z, t) in [(3.5, -17.25, 0.0), (101.0, 55.5, 12.75), (-640.0, 2048.5, 301.0)] {
                let a = Waves.height(waves, x, z, t), b = Waves.height(waves, x + L, z - 3 * L, t)
                #expect(abs(a.y - b.y) < 1e-9 && abs(a.dx - b.dx) < 1e-9 && abs(a.dz - b.dz) < 1e-9)
            }
            // Every wave vector is a whole number of cycles across the tile.
            for w in waves {
                let mx = w.kx * L / (2 * .pi), mz = w.kz * L / (2 * .pi)
                #expect(abs(mx - mx.rounded()) < 1e-9 && abs(mz - mz.rounded()) < 1e-9)
            }
        }
    }

    @Test func theSeaHasTheStateItWasMadeForAndNeverFolds() {
        let swell = Waves.swell(seed: seed), chop = Waves.chop(seed: seed)
        let rms = { (w: [Wave]) in (w.reduce(0) { $0 + $1.amp * $1.amp / 2 }).squareRoot() }
        #expect(abs(rms(swell) - WaterSpec.swellRMS) < 1e-9)
        #expect(abs(rms(chop) - WaterSpec.chopRMS) < 1e-9)
        // Σ q·k·A ≤ 0.8: crests sharpen, the surface never loops over itself.
        for w in [swell, chop] { #expect(w.reduce(0) { $0 + $1.q * $1.k * $1.amp } <= 0.8 + 1e-9) }
        // Deep-water dispersion: ω² = g·k.
        for w in swell + chop { #expect(abs(w.omega * w.omega - WaterSpec.g * w.k) < 1e-9) }
        // Sampled over a few periods, the surface stays within a sea state 3's range (≈ ±1.5 m).
        var lo = 0.0, hi = 0.0
        for i in 0..<400 { let h = Waves.height(swell, Double(i) * 7.3, Double(i) * -3.1, Double(i) * 0.37).y; lo = min(lo, h); hi = max(hi, h) }
        #expect(hi > 0.3 && hi < 1.6 && lo < -0.3 && lo > -1.6)
    }

    @Test func theSameSeedRaisesTheSameSeaAndNaNIsCalm() {
        let a = Waves.swell(seed: seed), b = Waves.swell(seed: seed), c = Waves.swell(seed: WNoise.seedOf("another"))
        #expect(a == b)
        #expect(a != c)
        let h = Waves.height(a, .nan, 3, 4), g = Waves.height(a, 1, 2, .infinity), k = Waves.height(a, 1, 2, 3, calm: .nan)
        #expect(h.y == 0 && h.dx == 0 && g.y == 0 && k.y == 0)
        #expect(Waves.calm(depth: 0) == 0 && Waves.calm(depth: 50) == 1 && Waves.calm(depth: .nan) == 0)
        #expect(Waves.height(a, 10, 10, 5, calm: 0).y == 0)
    }

    @Test func theFloatingHeightIsTheDrawnSurfaces() {
        // Displace a grid point as the GPU does (Gerstner: sideways and up); the surface height asked at where it lands is
        // its height, to a few millimetres.
        let w = Waves.swell(seed: seed)
        for (x0, z0, t) in [(10.0, 20.0, 3.0), (-77.5, 140.25, 41.0), (500.0, -12.0, 100.5)] {
            var X = x0, Z = z0, Y = 0.0
            for wv in w {
                let th = wv.kx * x0 + wv.kz * z0 - wv.omega * t + wv.phase
                X -= wv.q * wv.amp * wv.kx / wv.k * sin(th); Z -= wv.q * wv.amp * wv.kz / wv.k * sin(th); Y += wv.amp * cos(th)
            }
            #expect(abs(Waves.surface(w, X, Z, t) - Y) < 0.01)
        }
        #expect(Waves.surface(w, .nan, 0, 0) == 0 && Waves.surface(w, 1, 1, 1, calm: 0) == 0)
    }

    @Test func theDepthMapReadsTheGroundTheCarDrivesOn() throws {
        let w = FreeWorld(seed: FreeWorldSeed.text)
        let sea = try #require(w.nearestSea(0, 0))
        let m = WaterMap.build(w, cx: sea.x, cz: sea.z, cell: 8, n: 32, exact: true)
        #expect(m.wet)
        // Cell centres are the ground's own height above the sea.
        for (i, j) in [(0, 0), (5, 17), (31, 31), (16, 3)] {
            let x = m.x0 + (Double(i) + 0.5) * 8, z = m.z0 + (Double(j) + 0.5) * 8
            #expect(abs(Double(m.h[j * 32 + i]) - (w.ground(x, z).y - SEA)) < 1e-3)
            #expect(abs((m.at(x, z) ?? 99) - Double(m.h[j * 32 + i])) < 1e-3)
        }
        #expect(m.at(m.x0 - 50, m.z0) == nil)
        // The apron is never wet.
        #expect(!WaterMap.build(w, cx: 0, cz: 0, cell: 16, n: 16, exact: false).wet)
    }

    @Test func theHorizonIsTheLandsSkyline() {
        // A flat sea with a 40 m wall 1 km to the east (+x): east, the wall at ≈ 40/1000; west, nothing.
        var h = [Float](repeating: -5, count: 128 * 128)
        for j in 0..<128 { for i in 0..<128 where (Double(i) + 0.5) * 32 - 2048 > 1000 { h[j * 128 + i] = 40 } }
        let map = WaterMap(cx: 0, cz: 0, cell: 32, n: 128, h: h)
        let hz = Horizon.build(eyeX: 0, eyeY: WaterSpec.level, eyeZ: 0, maps: [map], n: 64, reach: 2000)
        #expect(hz.tan[0] > 0.02 && hz.tan[0] < 0.045)
        #expect(hz.dist[0] > 950 && hz.dist[0] < 1100)
        #expect(hz.tan[32] == Horizon.none)
        // A NaN eye builds no skyline.
        #expect(Horizon.build(eyeX: .nan, eyeY: 0, eyeZ: 0, maps: [map], n: 8).tan.allSatisfy { $0 == Horizon.none })
    }

    @Test func theDefaultWorldHasASeaToDriveInto() throws {
        let w = FreeWorld(seed: FreeWorldSeed.text)
        let sea = try #require(w.nearestSea(0, 0))
        #expect(w.underSea(sea.x, sea.z))
        print(String(format: "WATER nearest sea to the apron: (%.0f, %.0f), %.1f km out", sea.x, sea.z, (sea.x * sea.x + sea.z * sea.z).squareRoot() / 1000))
        // The shore on the way there (shots, the bench: -fd-at): the last dry metre walking from the apron to the sea.
        let d = (sea.x * sea.x + sea.z * sea.z).squareRoot(), ux = sea.x / d, uz = sea.z / d
        var r = d
        while r > 0 && w.ground(ux * r, uz * r).y < SEA + 0.5 { r -= 1 }
        print(String(format: "WATER shore at (%.1f, %.1f), heading %.0f° (yaw: 0 = +z)", ux * (r - 25), uz * (r - 25), atan2(ux, uz) * 180 / .pi))
        for k in stride(from: -30.0, through: 60, by: 10) { let g = w.ground(ux * (r + k), uz * (r + k)); print(String(format: "WATER  %+.0f m: ground %.2f %@ road %.0f", k, g.y, "\(FreeWorld.surface(g, slope: 0))", g.road)) }
    }
}

/// FreeDrive.seedDefault, which lives in the app.
enum FreeWorldSeed { static let text = "cold gas" }
