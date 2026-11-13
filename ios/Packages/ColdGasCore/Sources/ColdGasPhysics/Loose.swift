// Loose things for Free Drive and Roam (0221): cones, plastic barriers and A-frame signs as free rigid bodies with their
// real masses, so the car shoves, tips and rolls them with impulses the engine works out from the masses. Unscored:
// only a drive course ever adds one (World.loose is empty on the Show, the Wall and the Lineup, whose vectors prove it).
// The car's wheels never ride on them (World.rayFilter leaves their group out), and the hull hits them as it hits
// anything. They live at the centre of the world (the sets), so a move of the engine's origin carries them with it.
#if canImport(CRapier)
import CRapier
import ColdGasCore

public enum LooseKind: UInt8, CaseIterable, Sendable {
    case cone, barrier, sign
    /// Half extents (m) of the collider, its mass (kg) and how far its centre of mass sits below the box's middle.
    /// Sources (ESTIMATE where marked): a 750 mm road cone (EN 13422 class) with its rubber base weighs 3.5–4.5 kg, most
    /// of it in the base, and we take 4.2 kg. An empty 1 m polyethylene water-fill barrier is 13–18 kg (ESTIMATE 15). A
    /// folding A-frame pavement sign is 6–9 kg (ESTIMATE 7.5).
    public var half: (Double, Double, Double) {
        switch self { case .cone: return (0.17, 0.375, 0.17); case .barrier: return (0.5, 0.4, 0.22); case .sign: return (0.3, 0.45, 0.25) }
    }
    public var mass: Double { switch self { case .cone: return 4.2; case .barrier: return 15; case .sign: return 7.5 } }
    public var comDrop: Double { switch self { case .cone: return 0.22; case .barrier: return 0.08; case .sign: return 0.05 } }
}

public final class LooseBody {
    public let kind: LooseKind
    public var rb: UInt64 = CG_NONE, col: UInt64 = CG_NONE
    /// Pose in world metres (the engine's origin added back), read after each step.
    public var x = 0.0, y = 0.0, z = 0.0, qx = 0.0, qy = 0.0, qz = 0.0, qw = 1.0
    public var speed = 0.0
    public var asleep = true
    init(kind: LooseKind) { self.kind = kind }
}

public extension GROUP { static let loose: UInt32 = 32 }

/// A loose thing standing at (x, y, z) facing `yaw` (y is the ground under its base).
@discardableResult
public func addLoose(_ w: World, _ kind: LooseKind, x: Double, y: Double, z: Double, yaw: Double) -> LooseBody {
    let b = LooseBody(kind: kind)
    let (hx, hy, hz) = kind.half
    var bd = cg_body_desc_default(0)
    bd.translation = (Float(x - w.ox), Float(y + hy - w.oy), Float(z - w.oz))
    let h = yaw / 2
    bd.rotation = (0, Float(DMath.dsin(h)), 0, Float(DMath.dcos(h)))
    bd.sleeping = true; bd.can_sleep = true
    bd.linear_damping = 0.05; bd.angular_damping = 0.4
    let rb = cg_body_create(w.rw, &bd)
    // A solid box's inertia about its centre of mass, with the mass lowered (a cone is mostly base).
    let m = kind.mass
    let ix = m / 3 * (hy * hy + hz * hz), iy = m / 3 * (hx * hx + hz * hz), iz = m / 3 * (hx * hx + hy * hy)
    cg_body_set_additional_mass_properties(w.rw, rb, Float(m), 0, Float(-kind.comDrop), 0, Float(ix), Float(iy), Float(iz), 0, 0, 0, 1, false)
    b.rb = rb
    let shape: ShapeDesc = kind == .cone ? .cylinder(hy, hx) : .cuboid(hx, hy, hz)
    let mat = MATERIALS.paint   // painted plastic: slides on concrete as the parked bodies' paint does
    b.col = colliderFor(w, shape, DescOpts(density: 0), mat, GROUP.loose, extra: rb)
    b.x = x; b.y = y + hy; b.z = z
    b.qy = DMath.dsin(h); b.qw = DMath.dcos(h)
    w.loose.append(b)
    if w.rayFilter == RAY_ALL { w.rayFilter = groupsOf(0xffff, 0xffff & ~GROUP.loose) }
    return b
}

/// Each loose thing's pose after a step (asleep ones keep theirs).
public func readLoose(_ w: World) {
    var f = [Float](repeating: 0, count: 4)
    for b in w.loose where b.rb != CG_NONE {
        if cg_body_is_sleeping(w.rw, b.rb) { b.asleep = true; b.speed = 0; continue }
        b.asleep = false
        cg_body_translation(w.rw, b.rb, &f); b.x = Double(f[0]) + w.ox; b.y = Double(f[1]) + w.oy; b.z = Double(f[2]) + w.oz
        cg_body_rotation(w.rw, b.rb, &f); b.qx = Double(f[0]); b.qy = Double(f[1]); b.qz = Double(f[2]); b.qw = Double(f[3])
        cg_body_linvel(w.rw, b.rb, &f); b.speed = Double((f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).squareRoot())
    }
}

/// Every loose thing back where it was put (a fresh start); `at` gives each its spot.
public func resetLoose(_ w: World, _ at: (Int) -> (x: Double, y: Double, z: Double, yaw: Double)) {
    for (i, b) in w.loose.enumerated() where b.rb != CG_NONE {
        let p = at(i), hy = b.kind.half.1, h = p.yaw / 2
        cg_body_set_translation(w.rw, b.rb, Float(p.x - w.ox), Float(p.y + hy - w.oy), Float(p.z - w.oz), false)
        cg_body_set_rotation(w.rw, b.rb, 0, Float(DMath.dsin(h)), 0, Float(DMath.dcos(h)), false)
        cg_body_set_linvel(w.rw, b.rb, 0, 0, 0, false); cg_body_set_angvel(w.rw, b.rb, 0, 0, 0, false)
        b.x = p.x; b.y = p.y + hy; b.z = p.z; b.qx = 0; b.qy = DMath.dsin(h); b.qz = 0; b.qw = DMath.dcos(h); b.speed = 0
    }
}

/// Where a set's loose things stand, by the scored course whose set it is. Ground level is the stage's floor (0).
public struct LooseSpot: Sendable { public let kind: LooseKind; public let x, z, yaw: Double }
public func looseSet(_ stage: String) -> [LooseSpot] {
    var out: [LooseSpot] = []
    func cone(_ x: Double, _ z: Double) { out.append(LooseSpot(kind: .cone, x: x, z: z, yaw: 0)) }
    // A slalom down the apron, away from the set: every 12 m, weaving 1.5 m either side.
    func slalom(from z0: Double, n: Int) { for k in 0..<n { cone(k % 2 == 0 ? 1.5 : -1.5, z0 - Double(k) * 12) } }
    let half = Double.pi / 2
    switch stage {
    case "lineup":
        var z = -64.0
        while z <= -4 { cone(-3.6, z); cone(3.6, z); z += 6 }
        for k in 0..<8 { out.append(LooseSpot(kind: .barrier, x: -3.85 + Double(k) * 1.1, z: 38, yaw: 0)) }
        out.append(LooseSpot(kind: .sign, x: 5, z: -74, yaw: 0.3))
        slalom(from: -100, n: 7)
    case "wall":
        var z = -30.0
        while z <= -8 { cone(-2.6, z); cone(2.6, z); z += 5 }
        for z in [-6.0, -9.5, -13.0] { out.append(LooseSpot(kind: .barrier, x: -9, z: z, yaw: half)); out.append(LooseSpot(kind: .barrier, x: 9, z: z, yaw: half)) }
        out.append(LooseSpot(kind: .sign, x: 4, z: -44, yaw: 0.4))
        slalom(from: -52, n: 7)
    default:   // the Show (and plain Free Drive, on its set)
        for a in stride(from: -80.0, through: 80.0, by: 20.0) { let r = a * DMath.PI / 180; cone(8.5 * DMath.dsin(r), -30 - 8.5 * DMath.dcos(r)) }
        for z in [-12.0, -16.0, -20.0] { out.append(LooseSpot(kind: .barrier, x: -6, z: z, yaw: half)); out.append(LooseSpot(kind: .barrier, x: 6, z: z, yaw: half)) }
        out.append(LooseSpot(kind: .sign, x: 4, z: -44, yaw: 0.4))
        slalom(from: -52, n: 7)
    }
    return out
}
#endif
