// src/sim/surfaces.js and courses.js `surfaces` (0340): a set's water and mud as the physics reads them. Same data, same
// arithmetic, same order: only + − × ÷ and comparisons, so the bits match the JS's.

/// A splash tank: concrete walls standing on the slab round the water (x0…x1, z0…z1 inside them), `wall` thick, `top`
/// high, holding water to `level` over the slab.
public struct Tank: Sendable { public let x0, x1, z0, z1, wall, top, level: Double }
/// Soft ground on the slab: an ellipse (centre x, z; radii rx, rz) a tyre settles up to `sink` into.
public struct MudPatch: Sendable { public let x, z, rx, rz, sink: Double }
public struct Surfaces: Sendable {
    public let tanks: [Tank]
    public let mud: [MudPatch]
}

// The Show: a splash tank off the landing's left, a mud pit well past the pad.
public let SHOW_SURFACES = Surfaces(tanks: [Tank(x0: 10, x1: 18, z0: -40, z1: -24, wall: 0.4, top: 1.1, level: 0.95)],
                                    mud: [MudPatch(x: 0, z: -55, rx: 9, rz: 4.5, sink: 0.05)])
// The Lineup: a mud pit past the pad, a splash tank off the landing's right, a soft patch beside the run-up.
public let LINEUP_SURFACES = Surfaces(tanks: [Tank(x0: 10, x1: 18, z0: 16, z1: 32, wall: 0.4, top: 1.1, level: 0.95)],
                                      mud: [MudPatch(x: 0, z: 44, rx: 7, rz: 5, sink: 0.06), MudPatch(x: -7.5, z: -42, rx: 3.2, rz: 10, sink: 0.04)])

/// No water here: the level a point outside every tank reads.
public let NO_WATER = -1e9

/// The water's level (m over the slab) at (x, z), or NO_WATER outside every tank.
@inline(__always) public func waterLevel(_ surf: Surfaces, _ x: Double, _ z: Double) -> Double {
    for k in surf.tanks where x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1 { return k.level }
    return NO_WATER
}

/// How far a tyre settles into mud at (x, z) (m, ≥ 0), or −1 off every patch. The deepest patch wins.
@inline(__always) public func mudSink(_ surf: Surfaces, _ x: Double, _ z: Double) -> Double {
    var best = -1.0
    for m in surf.mud {
        let ex = (x - m.x) / m.rx, ez = (z - m.z) / m.rz, e = ex * ex + ez * ez
        if e >= 1 { continue }
        let k = (1 - e) * 4, s = m.sink * (k < 1 ? k : 1)
        if s > best { best = s }
    }
    return best
}

/// A tank's walls as boxes (x0, y0, z0, x1, y1, z1): the four sides, outside the water.
public func tankWalls(_ k: Tank) -> [(Double, Double, Double, Double, Double, Double)] {
    let t = k.wall, h = k.top
    return [
        (k.x0 - t, 0, k.z0 - t, k.x1 + t, h, k.z0),
        (k.x0 - t, 0, k.z1, k.x1 + t, h, k.z1 + t),
        (k.x0 - t, 0, k.z0, k.x0, h, k.z1),
        (k.x1, 0, k.z0, k.x1 + t, h, k.z1),
    ]
}
