// Loose things for Free Drive and Roam (0223): cones, plastic barriers and A-frame signs as free rigid bodies with their
// real masses, so the car shoves, tips and rolls them with impulses the engine works out from the masses. Unscored:
// only a drive course ever adds one (World.loose is empty on the Show, the Wall and the Lineup, whose vectors prove it).
// The car's wheels never ride on them (World.rayFilter leaves their group out), and the hull hits them as it hits
// anything. They live at the centre of the world (the sets), so a move of the engine's origin carries them with it.
#if canImport(CRapier)
import Foundation
import CRapier
import ColdGasCore

public enum LooseKind: UInt8, CaseIterable, Sendable {
    case cone, barrier, sign
    /// The roadside's pieces once broken loose (0227): a fence bay, a bend sign on its post, a guard rail section.
    case fence, signpost, rail
    /// Half extents (m) of the collider's box, its mass (kg) and how far its centre of mass sits below the box's middle.
    /// Sources (ESTIMATE where marked): a 750 mm road cone (EN 13422 class) with its rubber base weighs 3.5–4.5 kg, most
    /// of it in the base, and we take 4.2 kg (2.8 kg of base, 1.4 kg of PVC shell). A 1 m polyethylene water-fill
    /// barrier, 0.8 m tall, is ≈ 15 kg empty and holds ≈ 185 L (its tapered body ≈ 55 % of its box): ≈ 200 kg standing
    /// on the road, as they're deployed (0269; it stood there empty at 15 kg, and flew). The 500–900 kg ones are the 1.8–2 m
    /// sections; ours are 1 m. A folding A-frame pavement sign is 6–9 kg (ESTIMATE 7.5).
    public var half: (Double, Double, Double) {
        switch self {
        case .cone: return (0.17, 0.375, 0.17); case .barrier: return (0.5, 0.4, 0.22); case .sign: return (0.3, 0.45, 0.25)
        case .fence: return (0.07, 0.575, 2.0); case .signpost: return (0.06, 1.15, 0.45); case .rail: return (0.18, 0.4, 2.0)
        }
    }
    /// The roadside's (ESTIMATE): a 4 m bay of sawn post-and-rail, two 100 mm posts and two rails, ≈ 45 kg; a bend marker,
    /// a 2.3 m galvanised post with its aluminium board, ≈ 14 kg; 4 m of W-beam (≈ 13 kg/m) on two posts with spacers, ≈ 110 kg.
    public var mass: Double { switch self { case .cone: return 4.2; case .barrier: return 200; case .sign: return 7.5; case .fence: return 45; case .signpost: return 14; case .rail: return 110 } }
    /// The sign's board sits up top (its centre of mass above the middle: a negative drop). The cone's is its base's
    /// (2.8 kg 15 mm off the ground) with its shell's (1.4 kg, its surface's centroid 0.3 m up): 0.11 m off the ground. The
    /// barrier's water sits low in its tapered body.
    public var comDrop: Double { switch self { case .cone: return 0.264; case .barrier: return 0.1; case .sign: return 0.05; case .fence: return 0.05; case .signpost: return -0.4; case .rail: return 0.0 } }
    /// Principal moments of inertia about the centre of mass (kg·m²; x, y up, z). The cone's from its two parts (0269: the
    /// solid box it was given made it 1.6× harder to tip than a real one); the rest as solid boxes of their mass (the
    /// barrier's water, a fence bay's posts and rails and a W-beam spread along their length are near enough to that).
    public var inertia: (Double, Double, Double) {
        if self == .cone { return (0.157, 0.081, 0.157) }
        let (hx, hy, hz) = half, m = mass
        return (m / 3 * (hy * hy + hz * hz), m / 3 * (hx * hx + hz * hz), m / 3 * (hx * hx + hy * hy))
    }
    var material: Material {
        switch self {
        case .fence: return MATERIALS.wood
        case .signpost, .rail: return MATERIALS.steel
        case .cone: return MATERIALS.rubber
        case .barrier: return MATERIALS.hdpe
        case .sign: return MATERIALS.paint
        }
    }
    /// Air drag as the engine's damping (1/s): a light, bluff thing slows in the air (a 4 kg cone at 10 m/s meets ≈ 3 N,
    /// 0.07/s); a heavy one barely. Angular: the cone's is a touch more, for the rolling resistance the engine doesn't have
    /// (a cone on its side rolls round its tip and stops in a turn or two).
    var damping: (linear: Float, angular: Float) {
        switch self {
        case .cone: return (0.07, 0.2)
        case .sign, .signpost: return (0.05, 0.1)
        default: return (0.01, 0.05)
        }
    }
    /// The knock a hit is felt and heard as (0…1), from the impulse the thing took (its mass × its change of speed, N·s), or
    /// nil for none: a cone flicked away at 15 m/s is ≈ 100 N·s, a light tick; a barrier shoved at 5 m/s ≈ 1,000, a thud;
    /// 2,500 or more, the full blow. A nudge under 6 N·s (a cone rocked) isn't felt.
    public static func knock(_ k: LooseKind, dv: Double) -> Double? {
        let J = k.mass * dv
        guard dv > 0.4, J > 6 else { return nil }
        return Swift.min(1, (J / 2500).squareRoot())
    }
    /// The cone's collider: a square rubber base under a tapered body, as it's drawn (LooseView), so it tips over its
    /// base's edge and rolls round its tip on its side (a cylinder rolled away in a straight line forever).
    static let coneHull: [Float] = {
        var p: [Float] = []
        let y0: Float = -0.375
        for (x, z) in [(-0.19, -0.19), (0.19, -0.19), (0.19, 0.19), (-0.19, 0.19)] as [(Float, Float)] { p += [x, y0, z, x, y0 + 0.03, z] }
        for j in 0..<8 {
            let a = Float(j) / 8 * 2 * Float.pi
            p += [0.155 * cos(a), y0 + 0.03, 0.155 * sin(a), 0.025 * cos(a), 0.375, 0.025 * sin(a)]
        }
        return p
    }()
}

public final class LooseBody {
    public let kind: LooseKind
    public var rb: UInt64 = CG_NONE, col: UInt64 = CG_NONE
    /// Pose in world metres (the engine's origin added back), read after each step.
    public var x = 0.0, y = 0.0, z = 0.0, qx = 0.0, qy = 0.0, qz = 0.0, qw = 1.0
    public var speed = 0.0
    public var asleep = true
    /// A roadside piece put away (0227): no collider, held still out of sight until a break reuses it.
    public internal(set) var parked = false
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
    (bd.linear_damping, bd.angular_damping) = kind.damping
    // A light thing flung fast keeps its contacts (no tunnelling through the ground or a rail in a tick).
    bd.ccd_enabled = kind.mass < 20
    let rb = cg_body_create(w.rw, &bd)
    let m = kind.mass, (ix, iy, iz) = kind.inertia
    cg_body_set_additional_mass_properties(w.rw, rb, Float(m), 0, Float(-kind.comDrop), 0, Float(ix), Float(iy), Float(iz), 0, 0, 0, 1, false)
    b.rb = rb
    let shape: ShapeDesc = kind == .cone ? .hull(LooseKind.coneHull) : .cuboid(hx, hy, hz)
    // rubber grips, polyethylene slides, the roadside's timber and steel as theirs
    b.col = colliderFor(w, shape, DescOpts(density: 0), kind.material, GROUP.loose, extra: rb)
    b.x = x; b.y = y + hy; b.z = z
    b.qy = DMath.dsin(h); b.qw = DMath.dcos(h)
    w.loose.append(b)
    if w.rayFilter == RAY_ALL { w.rayFilter = groupsOf(0xffff, 0xffff & ~GROUP.loose) }
    return b
}

/// Each loose thing's pose after a step (asleep ones keep theirs).
public func readLoose(_ w: World) {
    var f = [Float](repeating: 0, count: 4)
    for b in w.loose where b.rb != CG_NONE && !b.parked {
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
