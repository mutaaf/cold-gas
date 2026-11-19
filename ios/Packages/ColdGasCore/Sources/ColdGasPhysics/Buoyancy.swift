// FREE DRIVE in the water (0320). Unscored: `driveStep` calls `wade` once a tick, and only a drive has water (a scored run
// never reaches this file; the 52 run vectors prove the scored car). What the sea does to the car, and the car to the sea:
//
//   buoyancy   the body as 3 × 4 columns of its box, each pushed up by the water it displaces (Archimedes: ρ·g·V) at the
//              middle of its own wet part, so a car nose-first in the water pitches, a tipped one rights or rolls, and a
//              car on the swell bobs with it. The box isn't all air: a sealed car displaces ≈ 43 % of its envelope.
//   flooding   the cabin fills through its seals and vents once the sills are under (≈ 50 s to fill), taking that air's
//              lift away: a car floats nose-down for a while, then settles and sinks. Out of the water it drains (≈ 8 s).
//   drag       each column's wet faces against the water (quadratic, ρ_water ≈ 850 × the air's), so driving in at 40 km/h
//              is a wall of water and wading has a speed the motors can hold; the wheels push their own wet section.
//   tyres      a tyre in water grips as a wet tyre does (≈ 80 %), and in a film of water at speed it aquaplanes: the
//              grip falls away from ≈ 55 % of the NASA hydroplaning speed (6.36·√p km/h, p in kPa) to its floor at it.
//   motors     an EV's drive unit is sealed for ≈ 0.5 m of wading. Held deeper than that, the inverter trips and the
//              motors cut; they come back once it's been out of the water a few seconds.
//   wet        how wet the car is (0…1) and how high the water reached on it (0 sills … 1 roof): the renderer's to shade,
//              and it dries with time and speed.
//   events     a splash when a part of the body meets the water fast (the app's spray, sound and hands), the wheels'
//              depth (their spray), the bow's push (its wave and wake).
// Loose things float too (`floatLoose`): timber, drums, cases and tyres bob; steel and concrete settle on the bottom.
// Every number is an ESTIMATE with what it was taken from. Foundation's sin/cos are fine: nothing here is scored.
#if canImport(CRapier)
import Foundation
import CRapier
import ColdGasCore

public enum WaterCar {
    /// Sea water's density (kg/m³).
    public static let rho = 1025.0
    /// The body's box in the car's frame (m): the hull's floor to its roof, the nose to the tail, side to side.
    public static let x0 = -SPEC.width / 2 + 0.02, x1 = SPEC.width / 2 - 0.02
    public static let y0 = SPEC.rideHeight - SPEC.comHeight, y1 = SPEC.height - SPEC.comHeight
    public static let z1 = AXLE_F + SPEC.overhangFront, z0 = AXLE_F + SPEC.overhangFront - SPEC.length
    public static let cols = 3, rows = 4
    /// The share of the box that displaces water while it's sealed (ESTIMATE: a 2.4 t two-seater floats with its sills
    /// ≈ 0.6 m under, as cars filmed in floods do: ≈ 3.9 m³ of a 9.1 m³ envelope).
    public static let fill = 0.43
    /// Of that, the cabin's air (the share flooding takes away; the rest is the sealed battery, tyres, structure).
    public static let cabin = 0.62
    /// Seconds to fill the cabin with the body under, and to drain it once out (ESTIMATE: cars sink in ≈ 30–120 s).
    public static let floodTime = 50.0, drainTime = 8.0
    /// Drag coefficients of the body's wet section: along, across, up and down (ESTIMATE: a bluff box, 0.9–1.2).
    public static let cdAlong = 0.9, cdAcross = 1.1, cdUp = 1.2
    /// A wheel's wet section (m: the tyre's width) and its drag coefficient.
    public static let tyreWidth = 0.255, cdTyre = 1.0
    /// Tyre pressure (kPa) and the grip a wet tyre keeps (ESTIMATE: 240 kPa; wet asphalt μ ≈ 0.75–0.85 of dry).
    public static let tyreKPa = 240.0, wetGrip = 0.8
    /// The NASA dynamic hydroplaning speed, 6.36·√p km/h (p in kPa), in m/s.
    public static var hydroplaneSpeed: Double { 6.36 * tyreKPa.squareRoot() / 3.6 }
    /// Grip left at full aquaplaning (the tyre's shoulders still touch).
    public static let hydroFloor = 0.12
    /// The drive unit's wading depth: the water this far above the ground under the rear axle for `stallAfter` s cuts the
    /// motors; they restart `restartAfter` s after it's clear (ESTIMATE: EVs are rated for 0.3–0.6 m of wading).
    public static let wadeDepth = 0.5, stallAfter = 1.5, restartAfter = 3.0
    /// Drying (wet share per second): at rest, and per m/s of air over the body (ESTIMATE: ≈ 80 s still, ≈ 20 s at 15 m/s).
    public static let dryRest = 0.0125, dryPerMs = 0.0028

    /// One column's footprint (m²) and height (m).
    public static var colArea: Double { (x1 - x0) / Double(cols) * (z1 - z0) / Double(rows) }
    public static var height: Double { y1 - y0 }
    /// The whole box's sealed displacement (m³).
    public static var volume: Double { (x1 - x0) * height * (z1 - z0) * fill }

    /// The share of a column under water: its two ends' heights (any order) against the level. NaN anywhere → 0.
    @inline(__always) public static func submerged(_ a: Double, _ b: Double, level: Double) -> Double {
        guard a.isFinite, b.isFinite, level.isFinite else { return 0 }
        let lo = jsMin(a, b), hi = jsMax(a, b)
        if hi - lo < 1e-6 { return level > lo ? 1 : 0 }
        return M3.clamp((level - lo) / (hi - lo), 0, 1)
    }
    /// A tyre's grip in `depth` metres of water at `speed` m/s along it (1 dry). Wet grip, and aquaplaning in a film
    /// (from 3 mm, the tread's depth, to ≈ 25 cm, past which the tyre ploughs instead of riding up). NaN → dry.
    @inline(__always) public static func tyreGrip(depth: Double, speed: Double) -> Double {
        guard depth.isFinite, speed.isFinite, depth > 0.0005 else { return 1 }
        let film = smooth(0.003, 0.02, depth) * (1 - smooth(0.12, 0.3, depth))
        let vp = hydroplaneSpeed
        let lift = film * smooth(0.55 * vp, vp, abs(speed))
        return wetGrip * (1 - (1 - hydroFloor) * lift)
    }
    @inline(__always) static func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let t = M3.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
    }
}

/// The car's water state, beside the DriveModel (one per drive). `level` is the water's surface at (x, z) (the swell
/// included) or −∞ where there's none; nil means no water anywhere (every scored course, a test without a sea).
public final class Wading {
    public var level: ((Double, Double) -> Double)?
    /// A film of water on paved ground (m): rain's (0: dry roads).
    public var film = 0.0
    /// The water's own velocity at (x, z) (m/s, x and z): a river's current (0310's `flow`), nil or 0 on still water. The drag
    /// works on the car's speed through the water, so a car afloat on a river drifts downstream with it.
    public var current: ((Double, Double) -> (Double, Double))?
    /// The share of the body's sealed volume under water (0…1), and of its box's height (the waterline, 0 sills … 1 roof).
    public internal(set) var submerged = 0.0, waterline = 0.0
    /// The cabin's water (0…1).
    public var flood = 0.0
    /// How wet the car is (0…1) and the highest the water reached on it while it dries (0 sills … 1 roof).
    public internal(set) var wet = 0.0, wetLine = 0.0
    /// The motors cut by a drowned drive unit.
    public internal(set) var stalled = false
    /// On the water with no wheel on the bottom.
    public internal(set) var floating = false
    /// Each wheel's grip factor from the water this tick (the tyre loop reads it next tick) and its contact's depth (m).
    public internal(set) var grip = [Double](repeating: 1, count: 4), wheelDepth = [Double](repeating: 0, count: 4)
    /// The water's drag on the car this tick (N), and the bow's push (frontal wet area × speed², a wake's size).
    public internal(set) var drag = 0.0, bow = 0.0
    /// The water under the car's centre above the ground there (m), or 0.
    public internal(set) var depth = 0.0
    /// The splash since the app last drained it (0…1) and where (world m).
    public internal(set) var splash = 0.0, splashX = 0.0, splashY = 0.0, splashZ = 0.0
    var prev = [Double](repeating: 0, count: WaterCar.cols * WaterCar.rows)
    var stallT = 0.0, clearT = 0.0
    let b = V3(), t = V3(), p = V3(), v = V3(), rr = V3(), f = V3(), loc = V3(), w = V3()
    public init() {}
    public var motor: Double { stalled ? 0 : 1 }
    public var any: Bool { submerged > 0 || wheelDepth.contains { $0 > 0 } }
    /// The splash since the last call (the app reads it once a frame), and where.
    public func drainSplash() -> (k: Double, x: Double, y: Double, z: Double) {
        defer { splash = 0 }
        return (splash, splashX, splashY, splashZ)
    }
    /// Towed out (a reset): the cabin pumped out and the drive unit dried, the car still as wet as it was.
    public func tow() {
        let w = wet, l = wetLine
        clear()
        wet = w; wetLine = l
    }
    /// Out of the water and dry.
    public func clear() {
        submerged = 0; waterline = 0; flood = 0; wet = 0; wetLine = 0; stalled = false; floating = false
        drag = 0; bow = 0; depth = 0; splash = 0; stallT = 0; clearT = 0
        for i in 0..<4 { grip[i] = 1; wheelDepth[i] = 0 }
        for i in prev.indices { prev[i] = 0 }
    }
}

/// One tick of the water on the car (driveStep, after the wheels): buoyancy and drag into the tick's force and torque, the
/// tyres' grip for the next, the drive unit, the cabin, the wet, the splash.
func wade(_ s: Vehicle, _ dm: DriveModel, _ m: Double, _ dt: Double) {
    let wd = dm.water
    guard let level = wd.level else { return }
    let C = WaterCar.self
    let q = s.quat
    // Water speed past the air: the drying's.
    let speed = DMath.dhypot(s.vel.x, s.vel.y, s.vel.z)
    // A quick out: the whole box above the water near the car (the box's lowest corner can't be under a level it's 3 m over).
    let here = level(s.pos.x, s.pos.z)
    let reach = DMath.dhypot(C.x1, C.y1 - C.y0, C.z1 - C.z0)
    if !here.isFinite || s.pos.y - reach > here + 1.5 {
        if wd.submerged > 0 || wd.wheelDepth.contains(where: { $0 > 0 }) { wd.submerged = 0; wd.waterline = 0; wd.drag = 0; wd.bow = 0; wd.floating = false; wd.depth = 0
            for i in 0..<4 { wd.grip[i] = film(wd, s, i); wd.wheelDepth[i] = 0 }
            for i in wd.prev.indices { wd.prev[i] = 0 } }
        else { for i in 0..<4 { wd.grip[i] = film(wd, s, i) } }
        dry(wd, speed, dt)
        drain(wd, dt)
        motors(wd, s, dt, under: -1)
        return
    }
    let A = C.colArea, H = C.height, colW = (C.x1 - C.x0) / Double(C.cols), colL = (C.z1 - C.z0) / Double(C.rows)
    let n = Double(C.cols * C.rows)
    let sealed = 1 - C.cabin * wd.flood
    var subV = 0.0, line = 0.0, dragSum = 0.0, bow = 0.0, splashE = 0.0
    var sx = 0.0, sy = 0.0, sz = 0.0, sBest = 0.0
    let cur = wd.current?(s.pos.x, s.pos.z) ?? (0, 0)
    let cx = cur.0.isFinite ? cur.0 : 0, cz = cur.1.isFinite ? cur.1 : 0
    for j in 0..<C.rows { for i in 0..<C.cols {
        let k = j * C.cols + i
        let xc = C.x0 + (Double(i) + 0.5) * colW, zc = C.z0 + (Double(j) + 0.5) * colL
        M3.rotate(wd.b, q, M3.set(wd.loc, xc, C.y0, zc)); M3.add(wd.b, wd.b, s.pos)
        M3.rotate(wd.t, q, M3.set(wd.loc, xc, C.y1, zc)); M3.add(wd.t, wd.t, s.pos)
        let lvl = level(0.5 * (wd.b.x + wd.t.x), 0.5 * (wd.b.z + wd.t.z))
        let fr = C.submerged(wd.b.y, wd.t.y, level: lvl)
        let was = wd.prev[k]
        wd.prev[k] = fr
        if fr <= 0 { continue }
        // The wet part's middle: from the lower end, half the wet length along the column.
        let lowB = wd.b.y <= wd.t.y
        let from = lowB ? wd.b : wd.t, to = lowB ? wd.t : wd.b
        M3.sub(wd.p, to, from); M3.addScaled(wd.p, from, wd.p, 0.5 * fr)
        M3.sub(wd.rr, wd.p, s.pos)
        // Archimedes, at the wet part's middle.
        let V = A * H * C.fill * sealed * fr
        subV += V
        line = jsMax(line, fr)
        M3.set(wd.f, 0, C.rho * G * V, 0)
        applyAt(wd.rr, wd.f)
        // The water's drag on the wet faces, in the car's frame (the column's share of the wet section each way).
        M3.cross(wd.v, s.angVel, wd.rr); M3.add(wd.v, wd.v, s.vel)
        wd.v.x -= cx; wd.v.z -= cz   // through the water: a river's current carries what floats on it
        M3.rotateInv(wd.loc, q, wd.v)
        let hw = H * fr
        let ax = (C.z1 - C.z0) * hw / n, ay = A * jsMin(1, fr * 5), az = (C.x1 - C.x0) * hw / n
        let mShare = m / n
        func d(_ vel: Double, _ cd: Double, _ area: Double) -> Double {
            let fd = -0.5 * C.rho * cd * area * abs(vel) * vel
            // Never more than stops this column's share of the car within the tick (explicit drag can't reverse a velocity).
            let cap = mShare * abs(vel) / dt
            return M3.clamp(fd, -cap, cap)
        }
        let fx = d(wd.loc.x, C.cdAcross, ax), fy = d(wd.loc.y, C.cdUp, ay), fz = d(wd.loc.z, C.cdAlong, az)
        M3.rotate(wd.f, q, M3.set(wd.w, fx, fy, fz))
        applyAt(wd.rr, wd.f)
        dragSum += DMath.dhypot(fx, fy, fz)
        if wd.loc.z > 0 { bow += az * wd.loc.z * wd.loc.z }
        // A splash: a column meeting the water fast (into it, or ploughing in along the surface).
        if was <= 0.02 {
            let into = jsMax(0, -wd.v.y), along = DMath.dhypot(wd.v.x, 0, wd.v.z)
            // (a column bobbing back in on the swell is no splash: it has to meet the water at a walking pace or more)
            let e = into > 1.2 || along > 2.5 ? (into * into + 0.35 * along * along) * A : 0
            splashE += e
            if e > sBest { sBest = e; sx = wd.p.x; sy = lvl; sz = wd.p.z }
        }
    } }
    wd.submerged = M3.clamp(subV / (C.volume * jsMax(1e-6, sealed)), 0, 1)
    wd.waterline = line
    wd.drag = dragSum
    wd.bow = bow
    if splashE > 0 {
        let k = jsMin(1, (splashE / 40).squareRoot())
        if k > wd.splash { wd.splash = k; wd.splashX = sx; wd.splashY = sy; wd.splashZ = sz }
    }
    // The wheels: each contact patch's depth, its tyre's grip next tick, and the water it pushes.
    var onBottom = false
    for i in 0..<4 {
        guard dm.hit[i] else { wd.wheelDepth[i] = 0; wd.grip[i] = 1; continue }
        M3.rotate(wd.rr, q, WHEELS[i])
        M3.rotate(wd.w, q, M3.set(wd.loc, 0, -1, 0))
        M3.addScaled(wd.rr, wd.rr, wd.w, dm.tHit[i])
        let cy = s.pos.y + wd.rr.y
        let dep = jsMax(0, level(s.pos.x + wd.rr.x, s.pos.z + wd.rr.z) - cy)
        let was = wd.wheelDepth[i]
        wd.wheelDepth[i] = dep.isFinite ? dep : 0
        onBottom = true
        pointVel(wd.v, s, wd.rr)
        M3.rotateInv(wd.loc, q, wd.v)
        let along = wd.loc.z
        wd.grip[i] = dep > 0 ? C.tyreGrip(depth: dep, speed: along) : film(wd, s, i)
        if dep > 0.01 {
            // The tyre's wet section pushing through the water, along the car.
            let area = C.tyreWidth * jsMin(dep, 2 * RW[i])
            var fd = -0.5 * C.rho * C.cdTyre * area * abs(along) * along
            let cap = 0.25 * m * abs(along) / dt
            fd = M3.clamp(fd, -cap, cap)
            M3.rotate(wd.f, q, M3.set(wd.w, 0, 0, fd))
            applyAt(wd.rr, wd.f)
            wd.drag += abs(fd)
            // A wheel running into water at speed throws a sheet of it.
            if was <= 0.005 && abs(along) > 3 {
                let k = jsMin(1, abs(along) * jsMin(dep, 0.3) / 6)
                if k > wd.splash { wd.splash = k; wd.splashX = s.pos.x + wd.rr.x; wd.splashY = cy + dep; wd.splashZ = s.pos.z + wd.rr.z }
            }
        }
    }
    wd.floating = !onBottom && wd.submerged > 0.15
    wd.depth = jsMax(0, here - (s.pos.y + C.y0 - SPEC.rideHeight))
    // The cabin fills while the sills are under (a third of the body down, whichever way up it is), and drains when not.
    let sills = M3.clamp((wd.submerged - 0.3) / 0.3, 0, 1)
    if sills > 0 { wd.flood = jsMin(1, wd.flood + sills * dt / C.floodTime) } else { drain(wd, dt) }
    // Wet up to where the water reached; drying where it doesn't reach.
    if wd.submerged > 0 || line > 0 { wd.wet = 1; wd.wetLine = jsMax(wd.wetLine, line) }
    else { dry(wd, speed, dt) }
    // The drive unit: the water over the ground under the rear axle.
    M3.rotate(wd.rr, q, M3.set(wd.loc, 0, C.y0, AXLE_R))
    let under = level(s.pos.x + wd.rr.x, s.pos.z + wd.rr.z) - (s.pos.y + wd.rr.y - SPEC.rideHeight)
    motors(wd, s, dt, under: under)
}

/// A paved tyre in rain's film (none yet: `film` is 0 until rain falls).
@inline(__always) private func film(_ wd: Wading, _ s: Vehicle, _ i: Int) -> Double {
    if wd.film <= 0 { return 1 }
    let w = s.wheels[i]
    let v = w.omega * RW[i]
    return WaterCar.tyreGrip(depth: wd.film, speed: v)
}
@inline(__always) private func dry(_ wd: Wading, _ speed: Double, _ dt: Double) {
    if wd.wet <= 0 { wd.wetLine = 0; return }
    wd.wet = jsMax(0, wd.wet - (WaterCar.dryRest + WaterCar.dryPerMs * (speed.isFinite ? speed : 0)) * dt)
    if wd.wet == 0 { wd.wetLine = 0 }
}
@inline(__always) private func drain(_ wd: Wading, _ dt: Double) {
    if wd.flood > 0 { wd.flood = jsMax(0, wd.flood - dt / WaterCar.drainTime) }
}
@inline(__always) private func motors(_ wd: Wading, _ s: Vehicle, _ dt: Double, under: Double) {
    let deep = under.isFinite && under > WaterCar.wadeDepth
    if deep { wd.stallT += dt; wd.clearT = 0 } else { wd.stallT = 0; if wd.stalled { wd.clearT += dt } }
    if !wd.stalled && wd.stallT >= WaterCar.stallAfter { wd.stalled = true; wd.clearT = 0 }
    if wd.stalled && wd.clearT >= WaterCar.restartAfter && wd.flood < 0.3 { wd.stalled = false }
}

// MARK: - Loose things in the water

extension LooseKind {
    /// The water a loose thing displaces when under (m³; ESTIMATE, from each one's make and mass): a PVC cone (1.35 t/m³,
    /// sinks), a water-filled barrier (≈ its own weight: it settles), a timber fence bay (≈ 520 kg/m³: floats), steel
    /// posts and rails (sink), a tyre with its air (floats low), a sealed 208 L drum (floats high), a flight case (floats),
    /// a precast barrier (2.4 t/m³) and a generator's housing (both sink).
    public var floatVolume: Double {
        switch self {
        case .cone: return 0.0031; case .barrier: return 0.19; case .sign: return 0.0055
        case .fence: return 0.087; case .signpost: return 0.0018; case .rail: return 0.014
        case .tyre: return 0.03; case .drum: return 0.21; case .roadCase: return 0.4
        case .kRail: return 0.4; case .generator: return 1.1
        }
    }
}

private var loosePt = [Float](repeating: 0, count: 4), looseV = [Float](repeating: 0, count: 4), looseW = [Float](repeating: 0, count: 4)

/// The water on the loose things near it, before the engine's tick: buoyancy at each of a box's eight corners (each an
/// eighth of what it displaces), so a timber bay floats flat and a drum bobs upright, and the water's drag on its faces.
/// A thing that sinks and has gone to sleep stays asleep on the bottom; one that floats is kept on the water. Returns how
/// many it touched.
@discardableResult
public func floatLoose(_ w: World, level: (Double, Double) -> Double, dt: Double = DT) -> Int {
    var touched = 0
    for b in w.loose where b.rb != CG_NONE && !b.parked && !(b.asleep && b.kind.floatVolume * WaterCar.rho < b.kind.mass) {
        let (hx, hy, hz) = b.kind.half
        let r = (hx * hx + hy * hy + hz * hz).squareRoot()
        let lv = level(b.x, b.z)
        guard lv.isFinite, b.y - r < lv else { continue }
        touched += 1
        cg_body_linvel(w.rw, b.rb, &looseV)
        cg_body_angvel(w.rw, b.rb, &looseW)
        let qx = b.qx, qy = b.qy, qz = b.qz, qw = b.qw
        let V8 = b.kind.floatVolume / 8, m8 = b.kind.mass / 8
        let face = (4 * hx * hz + 4 * hy * hz + 4 * hx * hy) / 3 / 8
        for c in 0..<8 {
            let lx = c & 1 == 0 ? -hx : hx, ly = c & 2 == 0 ? -hy : hy, lz = c & 4 == 0 ? -hz : hz
            // The corner in the world (the body's rotation).
            let tx = 2 * (qy * lz - qz * ly), ty = 2 * (qz * lx - qx * lz), tz = 2 * (qx * ly - qy * lx)
            let ox = lx + qw * tx + (qy * tz - qz * ty), oy = ly + qw * ty + (qz * tx - qx * tz), oz = lz + qw * tz + (qx * ty - qy * tx)
            // Each corner stands for the eighth of the box between it and the middle: a slab hy tall, centred halfway.
            let py = b.y + oy, mid = b.y + 0.5 * oy
            let sub = M3.clamp((lv - (mid - hy * 0.5)) / hy, 0, 1)
            if sub <= 0 { continue }
            // The corner's velocity: v + ω × r.
            let wx = Double(looseW[0]), wy = Double(looseW[1]), wz = Double(looseW[2])
            let vx = Double(looseV[0]) + wy * oz - wz * oy, vy = Double(looseV[1]) + wz * ox - wx * oz, vz = Double(looseV[2]) + wx * oy - wy * ox
            let sp = (vx * vx + vy * vy + vz * vz).squareRoot()
            var dragK = 0.5 * WaterCar.rho * 1.0 * face * sp * sub
            dragK = jsMin(dragK, m8 / dt)   // never reverses the corner's motion in a tick
            let ix = -dragK * vx * dt, iy = (WaterCar.rho * G * V8 * sub - dragK * vy) * dt, iz = -dragK * vz * dt
            cg_body_apply_impulse_at_point(w.rw, b.rb, Float(ix), Float(iy), Float(iz), Float(b.x + ox - w.ox), Float(py - w.oy), Float(b.z + oz - w.oz), true)
        }
    }
    return touched
}
#endif
