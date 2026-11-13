// FREE DRIVE's own car (0225): a road car's chassis under the same body, for Free Drive and Roam only. Unscored: the
// scored runs step the car with `step` (Vehicle.swift, the web's vehicle.js line for line, held to the JS's bits by the
// 52 run vectors), and nothing here is called from it. A drive calls `driveStep` instead, which keeps everything the
// world sees of the car (the same engine body and hull, the same contacts and impacts, the fan, the ten jets, the flight
// computer) and replaces what's under it:
//   suspension  per-corner springs soft enough to see (≈1.5 Hz ride), asymmetric dampers, anti-roll bars, bump stops:
//               the body rolls, pitches and dives on its own wheels, and each wheel's travel is drawn.
//   tyres       one combined-slip curve (a Magic-Formula shape over the slip vector normalised by its peaks), so braking
//               or driving while cornering takes grip from the cornering (the friction circle); load sensitivity (a
//               tyre's grip per newton falls as it's pressed harder, and its cornering stiffness grows more slowly than
//               its load); relaxation length; looser surfaces peak later and flatter.
//   motors      the two rear motors, each on its own wheel: torque vectoring toward the yaw rate the steering asks for,
//               per-wheel traction control (or, off, a coupling that acts as a limited-slip differential), lift-off regen.
//   brakes      60/40, ABS cycling each wheel round its peak slip, and each disc's temperature (heat in from its torque ×
//               speed, out to the air faster at speed): the renderer makes a hot disc glow.
//   aero        drag as the scored car; downforce at each axle (so it trims the car at speed), not through the centre.
// Every number below is an ESTIMATE for a low two-seat EV of the car's size and mass (SPEC: 2.45 t loaded, 2.83 m
// wheelbase, 0.40 m centre of mass), with what it was taken from. Foundation's sin/atan are fine here: nothing is scored.
#if canImport(CRapier)
import Foundation
import CRapier
import ColdGasCore

public enum DriveSpec {
    /// Wheel rates (N/m) front, rear. ESTIMATE: road sports cars run 30–70 kN/m at the wheel; these give a 1.6 Hz front
    /// and 1.5 Hz rear ride on the car's corner masses (≈ 520 / 700 kg), a sports car's (1.5–2 Hz).
    public static let k: [Double] = [52_000, 52_000, 60_000, 60_000]
    /// Damping ratios in bump and rebound (ESTIMATE: 0.25–0.35 bump, 0.4–0.6 rebound on a road car).
    public static let zetaBump = 0.3, zetaRebound = 0.48
    /// Anti-roll bars (N per metre of left–right travel difference, at the wheel) front, rear. With the springs, ≈ 2.2° of
    /// roll at 1.25 g (ESTIMATE: 1.5–3°/g is a sports car's).
    public static let arb: [Double] = [30_000, 18_000]
    /// Compression travel from static to the bump stop (m), and the stop's rate (progressive).
    public static let bumpTravel = 0.065, bumpK = 600_000.0
    /// The tyres: peak friction longitudinal and lateral at the nominal load (ESTIMATE: a performance summer tyre on dry
    /// asphalt, 1.2–1.45), load sensitivity (μ falls ≈ 12 % per nominal load added), the slips where each peaks (κ 0.11;
    /// α 6° front, 5.2° rear: the rears are wider), the curve's shape (C 1.65 paved; 1.3 loose, a flatter, later peak).
    public static let muX = 1.30, muY = 1.38, loadSens = 0.12
    public static let kappaPeak = 0.11, alphaPeak: [Double] = [0.105, 0.105, 0.09, 0.09]
    public static let shapePaved = 1.65, shapeLoose = 1.3
    /// Brake balance (front share 0.6, ESTIMATE: a mid/rear-heavy EV's) over SPEC.brakeTorque's per-wheel figure.
    public static let brakeFront = 1.2, brakeRear = 0.8
    /// ABS: the slip it holds each wheel under, and how fast it releases and reapplies (≈ 12 Hz cycling).
    public static let absSlip = 0.13, absRelease = 30.0, absApply = 9.0
    /// Traction control's slip target (sport: more), and the coupling across the rear axle with it off (N·m per rad/s:
    /// the two motors' controller acting as a limited-slip differential).
    public static let tcSlip = 0.12, tcSlipSport = 0.24, lsdK = 260.0
    /// Torque vectoring: how hard the split chases the yaw rate the steering asks for, and how much of a motor's torque
    /// it may move across (ESTIMATE: production twin-motor axles move up to ≈ 30–40 %). `vch`: the characteristic speed
    /// of the reference model (a little understeer).
    public static let tvGain = 2_600.0, tvShare = 0.35, vch = 30.0
    /// Lift-off regen as a deceleration (g; ESTIMATE: EVs' one-pedal-light settings, 0.05–0.15 g).
    public static let regenG = 0.08
    /// Rolling resistance (ESTIMATE: a low-rolling-resistance performance tyre, 0.009–0.013).
    public static let crr = 0.011
    /// Downforce ½ρ·ClA·v² (0224's ClA), front share at the axles.
    public static let clA = 0.35, aeroFront = 0.42
    /// Brake discs: mass (kg) front, rear (ESTIMATE: ventilated iron, 380 / 360 mm), iron's heat capacity, the air's
    /// cooling (W/K at rest + per m/s: ≈ a minute's time constant at 30 m/s), and the ambient (°C).
    public static let discMass: [Double] = [9, 9, 7, 7], discC = 460.0, coolRest = 8.0, coolPerMs = 2.2, ambient = 12.0
    /// Static load on a wheel at the car's full mass (N).
    public static func staticLoad(_ i: Int) -> Double {
        let m = SPEC.dryMass + SPEC.gasMass, front = (SPEC.wheelbase - SPEC.comFromFront) / SPEC.wheelbase
        return m * G * (i < 2 ? front : 1 - front) / 2
    }
    /// The spring's free length (mount to wheel centre at full droop), chosen so the car stands at the scored car's ride
    /// height: at the static load the wheel sits MOUNT_TO_CENTRE under its mount, as the scored car's does.
    public static func freeLength(_ i: Int) -> Double { MOUNT_TO_CENTRE + staticLoad(i) / k[i] }
}

/// The drive's chassis state, beside the Vehicle (one per drive).
public final class DriveModel {
    /// Traction control: on (Standard), sport (a slide allowed), off (the motors' coupling only).
    public enum TC: Int, Sendable { case on, sport, off }
    public var tc: TC = .on
    public var abs = true
    /// Torque vectoring on.
    public var vectoring = true
    /// Each disc's temperature (°C).
    public var discT = [Double](repeating: DriveSpec.ambient, count: 4)
    /// Each caliper.s pressure (share of full), cycled by ABS.
    public var press = [Double](repeating: 0, count: 4)
    public fileprivate(set) var absActive = false, tcActive = false
    /// This tick's drive torque on each rear wheel (N·m; [2], [3]) and the brake torque each wheel took (N·m).
    public var driveT = [Double](repeating: 0, count: 4), brakeT = [Double](repeating: 0, count: 4)
    /// This tick's tyre forces (N): along and across each wheel, and the load on it.
    public var fx = [Double](repeating: 0, count: 4), fy = [Double](repeating: 0, count: 4), fz = [Double](repeating: 0, count: 4)
    /// Each spring's compression from full droop (m), and last tick's.
    public var c2 = [Double](repeating: 0, count: 4)
    fileprivate var c2Prev = [Double](repeating: 0, count: 4)
    /// Torque vectoring this tick: the yaw rate the steering asks for (rad/s, + about +y) and the torque moved toward the
    /// −x rear wheel (N·m).
    public fileprivate(set) var yawRef = 0.0, tvShift = 0.0
    /// The downforce this tick (N).
    public fileprivate(set) var downforce = 0.0
    // This tick's wheel contacts (rays first, all four, then the forces: the anti-roll bars need both sides).
    fileprivate var hit = [Bool](repeating: false, count: 4), tHit = [Double](repeating: 0, count: 4)
    fileprivate var nX = [Double](repeating: 0, count: 4), nY = [Double](repeating: 1, count: 4), nZ = [Double](repeating: 0, count: 4)
    fileprivate var body = [ParkedBody?](repeating: nil, count: 4)
    fileprivate var mat = [Material](repeating: MATERIALS.concrete, count: 4)
    public init() { for i in 0..<4 { c2[i] = DriveSpec.staticLoad(i) / DriveSpec.k[i]; c2Prev[i] = c2[i] } }
    /// After a placement: springs at static, brakes released, discs as they were (they don't cool by teleport).
    public func settle() { for i in 0..<4 { c2[i] = DriveSpec.staticLoad(i) / DriveSpec.k[i]; c2Prev[i] = c2[i]; press[i] = 0 } }
    /// The hottest disc front and rear (°C).
    public var hottest: (front: Double, rear: Double) { (max(discT[0], discT[1]), max(discT[2], discT[3])) }
}

@inline(__always) private func sgn(_ x: Double) -> Double { x > 0 ? 1 : x < 0 ? -1 : 0 }
/// The combined-slip curve: sin(C·atan(B·s)), its peak at s = 1.
@inline(__always) func driveCurve(_ s: Double, _ C: Double) -> Double { let B = tan(Double.pi / (2 * C)); return sin(C * atan(B * s)) }

/// One 240 Hz tick of the drive's car. The same order as `step`: the world's streamer, steering, stability control, the
/// fan, the wheels (here: the drive's chassis), the hull, the jets, drag, then the engine's tick and the contacts.
public func driveStep(_ s: Vehicle, _ inp: Input, _ dm: DriveModel) throws {
    let dt = DT, w = s.world
    let m = massOf(s)
    w.tick = s.tick
    try preStep(w)
    M3.set(fTot, w.carF.x, w.carF.y - m * G, w.carF.z)
    M3.set(tTot, w.carT.x, w.carT.y, w.carT.z)
    M3.rotate(fwd, s.quat, M3.set(tmp, 0, 0, 1))
    M3.rotate(right, s.quat, M3.set(tmp, 1, 0, 0))
    M3.rotate(upW, s.quat, M3.set(tmp, 0, 1, 0))
    M3.scale(dn, upW, -1)

    // Steering: the scored car's rack (speed-sensitive lock, room to counter-steer a slide), so the hands are the same.
    let speed = DMath.dhypot(s.vel.x, s.vel.y, s.vel.z)
    let vSq = jsMax(1, s.vel.x * s.vel.x + s.vel.z * s.vel.z)
    let aGrip = DriveSpec.muY * (G + jsMin(s.fanForce, s.fanLat * SPEC.fanMaxForce) / m)
    let lock = rackLock(vSq, aGrip)
    M3.rotateInv(vb, s.quat, s.vel)
    M3.rotateInv(wb, s.quat, s.angVel)
    let vFwd = vb.z
    var slideR = 0.0
    if vFwd > 3 {
        let th = DMath.datan2(vb.x + wb.y * AXLE_R, vFwd)
        slideR = th > COUNTER_DB ? th - COUNTER_DB : th < -COUNTER_DB ? th + COUNTER_DB : 0
    }
    var steerTarget = -inp.steer * lock
    if steerTarget * slideR > 0 { steerTarget = -inp.steer * jsMin(SPEC.steerLock, lock + abs(slideR)) }
    let rackRate = jsMin(SPEC.steerRate, (lock + abs(slideR)) / (RACK_T0 + RACK_TV * abs(vFwd)))
    s.steer += M3.clamp(steerTarget - s.steer, -rackRate * dt, rackRate * dt)

    // Stability control (Assist), as the scored car's: a brake on one front wheel against a yaw rate past what the grip
    // allows, or a slip angle past its threshold.
    s.esc = 0; for i in 0..<4 { s.escBrake[i] = 0 }
    var escCut = 1.0
    do {
        let beta = vFwd > 0.5 ? DMath.datan2(vb.x + wb.y * AXLE_R, vFwd) : 0
        let dBeta = (beta - s.escBeta) / dt
        s.escBeta = beta
        if truthy(inp.assist) && !truthy(inp.manual) && s.grounded >= 3 && vFwd > 5 && dm.tc != .off {
            let rr = wb.y, rMax = (SPEC.escYaw * aGrip) / vFwd
            let slip = dm.tc == .sport ? SPEC.escSlip * 2.2 : SPEC.escSlip
            let bx = beta > slip ? beta - slip : beta < -slip ? beta + slip : 0
            var e = rr - M3.clamp(rr, -rMax, rMax) - ESC_KB * bx
            if bx != 0 && dBeta * bx > 0 { e -= ESC_KBD * dBeta }
            if e != 0 {
                let Mz = (SPEC.inertiaYaw * abs(e)) / ESC_TAU
                let i = e > 0 ? 0 : 1
                s.escBrake[i] = jsMin(SPEC.brakeTorque * 1.15, (Mz / (SPEC.trackFront / 2)) * RW[i])
                s.esc = jsMin(1, abs(e) * 4)
                escCut = 1 - s.esc
            }
        }
    }
    // Suction fan (unchanged: the Wall's curl is solid on a roam).
    M3.rotate(r, s.quat, FLOOR)
    M3.add(pw, s.pos, r)
    let gapT = rayV(s, pw, dn, 0.6)
    s.floorGap = gapT < 0 ? .infinity : gapT
    let armed = M3.clamp(inp.fan, 0, 1)
    if armed > 0 {
        if gapT >= 0 {
            let ny = M3.clamp(hitN.y, -1, 1), sinT = jsSqrt(1 - ny * ny)
            let need = M3.clamp(m * G * ((SPEC.fanGrip * sinT) / SPEC.tyreMu + SPEC.fanContact * (1 - ny) + SPEC.fanHang * jsMax(0, -ny)), SPEC.fanIdleForce, SPEC.fanMaxForce)
            s.fanDemand = jsMax(need / SPEC.fanMaxForce, s.fanDemand + (need / SPEC.fanMaxForce - s.fanDemand) * (dt / SPEC.fanHold))
        } else { s.fanDemand -= s.fanDemand * (dt / SPEC.fanHold) }
    } else { s.fanDemand = 0 }
    let allIn: Double = speed < SPEC.fanVoidSpeed && (inp.throttle >= 0.9 || (inp.brake >= 0.9 && speed > 2)) ? 1 : 0
    s.gripSat += (allIn - s.gripSat) * (dt / SPEC.fanGripTime)
    var latNeed = 0.0
    if armed > 0 && gapT >= 0 {
        let aWant = abs(inp.steer) * jsMin(SPEC.tyreMu * (G + SPEC.fanMaxForce / m), (SPEC.steerLock * vSq) / SPEC.wheelbase)
        latNeed = M3.clamp((m * aWant) / SPEC.tyreMu - m * G, SPEC.fanIdleForce, SPEC.fanMaxForce) / SPEC.fanMaxForce
    }
    s.fanLat += (latNeed - s.fanLat) * (dt / SPEC.fanGripTime)
    let fanTarget = armed * jsMax(jsMax(s.fanDemand, M3.clamp(2 * s.gripSat - 1, 0, 1)), s.fanLat)
    s.fan += (fanTarget - s.fan) * jsMin(1, dt / (fanTarget > s.fan ? SPEC.fanSpool / 2.302585092994046 : SPEC.fanDump))
    s.fanForce = 0
    var kq = 0
    while kq < SEAL.count && s.fan > 0 {
        defer { kq += 1 }
        M3.rotate(r, s.quat, SEAL[kq])
        M3.add(pw, s.pos, r)
        let gapQ = rayV(s, pw, dn, 0.6)
        if gapQ < 0 { continue }
        let leak = jsMax(0, gapQ - SPEC.fanSkirtReach) / SPEC.fanGapScale
        let f = (s.fan * SPEC.fanMaxForce / Double(SEAL.count)) / (1 + leak * leak)
        if f <= 0 { continue }
        s.fanForce += f
        M3.scale(force, dn, f); applyAt(r, force)
        if hitBody != nil { M3.addScaled(rp, pw, dn, gapQ); reactOn(w, hitBody, rp, force, dt) }
    }

    // --- The chassis ---------------------------------------------------------------------------------------------------
    // 1. Each wheel's ray down its strut, and the spring's compression from full droop.
    for i in 0..<4 {
        let L = DriveSpec.freeLength(i), R = RW[i]
        M3.rotate(r, s.quat, WHEELS[i]); M3.add(pw, s.pos, r)
        let t = rayV(s, pw, dn, L + R)
        dm.c2Prev[i] = dm.c2[i]
        if t < 0 {
            dm.hit[i] = false
            // An unloaded wheel drops to full droop over a few ticks (it has mass), not at once.
            dm.c2[i] = jsMax(0, dm.c2[i] - 2.5 * dt)
            continue
        }
        dm.hit[i] = true; dm.tHit[i] = t
        dm.nX[i] = hitN.x; dm.nY[i] = hitN.y; dm.nZ[i] = hitN.z; dm.body[i] = hitBody; dm.mat[i] = hitMat
        dm.c2[i] = L + R - t
    }
    // 2. The tyres' forces and the motors, brakes and spin of each wheel.
    var grounded = 0, wallContact = false, sloped = false, wheelForce = 0.0
    s.hullContact = false; s.hullGround = false; s.obstacleContact = false
    s.tcActive = false
    evHit[0] = 0; evScr[0] = 0; evWheel[0] = 0
    // Torque vectoring: the yaw rate a car with this steer and speed should have (a little understeer), against the one it
    // has; the difference moves torque across the rear axle, outside wheel up.
    var tvDelta = 0.0
    dm.yawRef = 0
    if vFwd > 4 {
        let delta = s.steer   // + = the wheels turned toward +x, a + yaw rate (about +y)
        var want = vFwd * delta / (SPEC.wheelbase * (1 + vFwd * vFwd / (DriveSpec.vch * DriveSpec.vch)))
        let lim = aGrip / jsMax(vFwd, 1)
        want = M3.clamp(want, -lim, lim)
        dm.yawRef = want
        if dm.vectoring && inp.throttle > 0.05 { tvDelta = DriveSpec.tvGain * (want - wb.y) }
    }
    dm.tvShift = 0
    var regen = 0.0
    if inp.throttle == 0 && vFwd > 2 { regen = DriveSpec.regenG * m * G * RW[2] / 2 }
    var absAny = false, tcAny = false
    for i in 0..<4 {
        let wh = s.wheels[i]
        let R = RW[i], k = DriveSpec.k[i], xs = DriveSpec.staticLoad(i) / k
        wh.prevCompression = wh.compression
        let wasContact = wh.contact
        // The renderer's convention (the scored car's): wheel centre = anchor − restLen + compression.
        wh.compression = REST_LEN - DriveSpec.freeLength(i) + dm.c2[i]
        if !dm.hit[i] {
            wh.contact = false; wh.load = 0; wh.slipAngle = 0
            dm.fx[i] = 0; dm.fy[i] = 0; dm.fz[i] = 0; dm.brakeT[i] = 0; dm.driveT[i] = 0
            if DRIVEN[i] { wh.omega += ((inp.throttle * 600) / WHEEL_I) * dt }
            if inp.brake > 0 { wh.omega *= 0.9 }
            wh.omega *= 0.999
            wh.spin += wh.omega * dt
            continue
        }
        wh.contact = true; grounded += 1
        M3.set(hitN, dm.nX[i], dm.nY[i], dm.nZ[i])
        let hb = dm.body[i], hm = dm.mat[i]
        if hb != nil { s.obstacleContact = true }
        if hitN.y < 0.85 { wallContact = true }
        if hitN.y < 0.995 { sloped = true }
        wh.nx = hitN.x; wh.ny = hitN.y; wh.nz = hitN.z
        // Spring, damper (bump / rebound), bump stop, anti-roll bar.
        let c = dm.c2[i], rate = (c - dm.c2Prev[i]) / dt
        let cm = DriveSpec.staticLoad(i) / G   // the corner's sprung mass
        let zeta = rate > 0 ? DriveSpec.zetaBump : DriveSpec.zetaRebound
        var fs = k * c + 2 * zeta * jsSqrt(k * cm) * rate
        let over = c - (xs + DriveSpec.bumpTravel)
        if over > 0 { fs += DriveSpec.bumpK * over * (1 + over / 0.02) }
        let o = i ^ 1   // the other wheel on this axle
        fs += DriveSpec.arb[i < 2 ? 0 : 1] * (c - dm.c2[o])
        fs = jsMax(0, fs)
        let Fz = fs * jsMax(0.3, -M3.dot(dn, hitN))
        wh.load = Fz; dm.fz[i] = Fz
        // The contact patch and its velocity (relative to a parked body under it).
        M3.rotate(r, s.quat, WHEELS[i])
        M3.addScaled(tmp, r, dn, dm.tHit[i])
        pointVel(vp, s, tmp)
        if let b = hb, b.rb != CG_NONE { M3.add(rp, s.pos, tmp); let e = bodyVelAt(w, b.rb, rp.x - w.ox, rp.y - w.oy, rp.z - w.oz); vp.x -= e.0; vp.y -= e.1; vp.z -= e.2 }
        if !wasContact {
            let close = -M3.dot(vp, hitN)
            if close > WHEEL_MIN && close > evWheel[0] { M3.add(rp, s.pos, tmp); keep(&evWheel, close, rp, hitN, i, bodyIndex(hb), 0) }
        }
        let steerA = i < 2 ? s.steer : 0
        wh.steer = steerA
        let csA = DMath.dcos(steerA), snA = DMath.dsin(steerA)
        M3.set(wf, fwd.x * csA + right.x * snA, fwd.y * csA + right.y * snA, fwd.z * csA + right.z * snA)
        M3.addScaled(wf, wf, hitN, -M3.dot(wf, hitN))
        let lf = jsOr(DMath.dhypot(wf.x, wf.y, wf.z), 1)
        M3.scale(wf, wf, 1 / lf)
        M3.cross(wl, hitN, wf)
        let vLong = M3.dot(vp, wf), vLat = M3.dot(vp, wl)
        let den = jsMax(abs(vLong), 3.0)
        // The tyre: load sensitivity, the slips where it peaks, the curve's shape by surface.
        let Fz0 = DriveSpec.staticLoad(i), xL = jsMax(0.05, Fz / Fz0)
        let lsK = jsMax(0.55, 1 - DriveSpec.loadSens * (xL - 1))
        let Dx = DriveSpec.muX * hm.grip * lsK * Fz, Dy = DriveSpec.muY * hm.grip * lsK * Fz
        let C = hm.loose ? DriveSpec.shapeLoose : DriveSpec.shapePaved
        let kp = DriveSpec.kappaPeak * (hm.loose ? 1.8 : 1)
        let ap = DriveSpec.alphaPeak[i] * pow(xL, 0.35) * (hm.loose ? 1.5 : 1)
        let alphaKin = DMath.datan2(vLat, jsMax(abs(vLong), 1.5))
        let sigma = relaxLength(i < 2 ? SPEC.tyreRelaxFront : SPEC.tyreRelaxRear, Fz, Fz0)
        let lag = relaxSlip(wh.slipAngle, alphaKin, vLong, sigma, dt)
        let alpha = alphaKin + (lag - alphaKin) * relaxWeight(vLong)
        // The motors (rear): each wheel's own, vectored, traction-controlled; lift-off regen.
        var T = 0.0
        if DRIVEN[i] {
            let motorT = jsMin(SPEC.maxWheelTorque, (SPEC.power / 2) / jsMax(abs(wh.omega), 8))
            T = inp.throttle * motorT
            if tvDelta != 0 && T > 0 {
                let side = WHEELS[i].x < 0 ? 1.0 : -1.0   // a push at −x yaws the car toward +x
                let sh = M3.clamp(tvDelta * side, -DriveSpec.tvShare * T, DriveSpec.tvShare * T)
                T += sh
                if side > 0 { dm.tvShift = sh }
            }
            T *= escCut
            if regen > 0 && inp.brake == 0 { T -= jsMin(regen, (SPEC.power / 2 * 0.3) / jsMax(abs(wh.omega), 8)) * sgn(wh.omega) }
            let kappaNow = (wh.omega * R - vLong) / den
            let kd = T >= 0 ? kappaNow : -kappaNow
            if dm.tc != .off && !s.tcOff {
                let target = (dm.tc == .sport ? DriveSpec.tcSlipSport : DriveSpec.tcSlip) * (hm.loose ? 1.6 : 1)
                if kd > target { T *= M3.clamp(1 - (kd - target) * 8, 0.1, 1); tcAny = true }
                // And no more torque than the grip left beside the cornering force can carry.
                let syN = alpha / ap
                let room = jsSqrt(jsMax(0.05, 1 - jsMin(1, syN * syN)))
                let cap = 1.1 * R * Dx * room
                if abs(T) > cap { T = sgn(T) * cap; tcAny = true }
            } else {
                // Off: the two motors' controller couples the rear wheels' speeds (a limited-slip differential).
                let other = s.wheels[i == 2 ? 3 : 2]
                T += M3.clamp(DriveSpec.lsdK * (other.omega - wh.omega), -0.5 * motorT, 0.5 * motorT)
            }
        }
        dm.driveT[i] = T
        // The combined slip: each slip over its peak; one curve along the vector (the friction circle).
        var kappa = (wh.omega * R - vLong) / den
        func forces(_ kap: Double) -> (Double, Double, Double) {
            let sx = kap / kp, sy = alpha / ap, sN = (sx * sx + sy * sy).squareRoot()
            if sN < 1e-6 { let B = tan(Double.pi / (2 * C)); return (Dx * B * C * sx, -Dy * B * C * sy, 1) }
            let f = driveCurve(sN, C)
            // The curve's slope there, for the wheel's implicit spin (a tyre stiff in κ, solved with the wheel).
            let B = tan(Double.pi / (2 * C)), q = B * sN
            let slope = jsMax(0.05, C * B * cos(C * atan(q)) / (1 + q * q))
            return (Dx * f * sx / sN, -Dy * f * sy / sN, slope)
        }
        var (Fx, Fy, slope) = forces(kappa)
        let kEff = jsMax(Dx * slope / kp, Dx * 2) / den
        var omega = wh.omega + ((dt / WHEEL_I) * (T - R * Fx)) / (1 + (dt / WHEEL_I) * R * R * kEff)
        // Brakes: the pedal × balance, ABS's pressure, ESC's; the handbrake on the rears.
        // The caliper's pressure (share of full) builds over ≈ 0.1 s and falls fast; ABS cycles it in three phases round
        // the tyre's peak: dump past the slip threshold, hold just under it, build again below.
        let want = M3.clamp(inp.brake, 0, 1), thr = DriveSpec.absSlip * (hm.loose ? 1.6 : 1)
        var p = dm.press[i]
        if dm.abs && !s.absOff && want > 0 && abs(vLong) > 2.5 && kappa < -0.6 * thr {
            if kappa < -thr { p -= DriveSpec.absRelease * dt }
            absAny = true
        } else if p < want { p += DriveSpec.absApply * dt } else { p -= DriveSpec.absRelease * dt }
        p = M3.clamp(p, 0, want)
        dm.press[i] = p
        var bT = p * SPEC.brakeTorque * (i < 2 ? DriveSpec.brakeFront : DriveSpec.brakeRear) + s.escBrake[i]
        if s.handbrake > 0 && i >= 2 { bT += s.handbrake * SPEC.brakeTorque }
        var applied = 0.0
        if bT > 0 {
            let db = (bT / WHEEL_I) * dt
            applied = abs(omega) <= db ? abs(omega) * WHEEL_I / dt : bT
            omega = abs(omega) <= db ? 0 : omega - jsSign(omega) * db
        }
        dm.brakeT[i] = applied
        // The disc: heat in from the work the brake does, out to the air (faster at speed).
        let cool = (DriveSpec.coolRest + DriveSpec.coolPerMs * abs(vFwd)) * (dm.discT[i] - DriveSpec.ambient)
        dm.discT[i] += (applied * abs(omega) - cool) * dt / (DriveSpec.discMass[i] * DriveSpec.discC)
        wh.omega = omega
        kappa = (wh.omega * R - vLong) / den
        (Fx, Fy, slope) = forces(kappa)
        _ = slope
        // Held still on a slope at a standstill (the scored car's stiction).
        let mEff = m * 0.25
        if abs(vLong) < 0.5 && wh.omega == 0 && T == 0 { Fx = M3.clamp(-mEff * (vLong / dt * 0.5 - G * wf.y), -Dx, Dx) }
        if abs(vLat) < 0.5 && abs(vLong) < 2 {
            let hold = M3.clamp(-mEff * (vLat / dt * 0.5 - G * wl.y), -Dy, Dy)
            if abs(hold) > abs(Fy) { Fy = hold }
        }
        // Rolling resistance and the surface's drag (sand, grass).
        Fx -= M3.clamp(vLong * 2, -1, 1) * (DriveSpec.crr * Fz + (truthy(hm.roll) ? hm.roll * Fz : 0))
        Fx -= vLong * 6
        wh.slip = kappa; wh.slipAngle = lag; wh.slipAngleKin = alphaKin; wh.relax = sigma
        dm.fx[i] = Fx; dm.fy[i] = Fy
        M3.scale(force, hitN, Fz)
        M3.addScaled(force, force, wf, Fx)
        M3.addScaled(force, force, wl, Fy)
        applyAt(tmp, force)
        if hb != nil { M3.add(rp, s.pos, tmp); reactOn(w, hb, rp, force, dt) }
        wheelForce += Fz
        wh.spin += wh.omega * dt
    }
    dm.absActive = absAny; dm.tcActive = tcAny
    s.tcActive = tcAny
    s.grounded = grounded
    s.fallPeak = grounded > 0 ? 0 : jsMax(s.fallPeak, -s.vel.y)
    s.onWall = wallContact
    s.onSlope = sloped
    s.wheelForce = wheelForce

    // Downforce at each axle, along the car's down (0224's ClA, split so it trims the car).
    let df = 0.5 * RHO * DriveSpec.clA * speed * speed
    dm.downforce = df
    if df > 0 {
        for (z, share) in [(AXLE_F, DriveSpec.aeroFront), (AXLE_R, 1 - DriveSpec.aeroFront)] {
            M3.rotate(r, s.quat, M3.set(tmp2, 0, 0, z))
            M3.scale(force, dn, df * share)
            applyAt(r, force)
        }
    }

    // --- The hull, the jets, drag and the engine's tick: as `step` ---------------------------------------------------
    for i in 0..<s.touchNow.count { s.touchNow[i] = 0 }
    for i in FLOOR_PROBES_LIST {
        M3.rotate(r, s.quat, HULL[i])
        M3.addScaled(r, r, upW, SKIRT_UP)
        M3.add(pw, s.pos, r)
        let t = rayV(s, pw, dn, SKIRT_UP)
        if t < 0 { continue }
        let pen = SKIRT_UP - t
        M3.addScaled(r, r, dn, SKIRT_UP)
        M3.add(pw, s.pos, r)
        pointVel(vp, s, r)
        if let hb = hitBody, hb.rb != CG_NONE { let e = bodyVelAt(w, hb.rb, pw.x - w.ox, pw.y - w.oy, pw.z - w.oz); vp.x -= e.0; vp.y -= e.1; vp.z -= e.2 }
        if hitBody != nil { s.obstacleContact = true; s.obstacleSpeed = jsMax(s.obstacleSpeed, DMath.dhypot(vp.x, vp.y, vp.z)) }
        else { s.hullGround = true }
        s.hullContact = true
        let vn = M3.dot(vp, hitN)
        let fn = jsMax(0, FLOOR_K * pen - FLOOR_C * vn)
        s.hullImpulse = jsMax(s.hullImpulse, -vn)
        M3.addScaled(tmp, vp, hitN, -vn)
        let vt = DMath.dhypot(tmp.x, tmp.y, tmp.z)
        if s.touch[i] == 0 && -vn > HIT_MIN && -vn > evHit[0] { keep(&evHit, -vn, pw, hitN, i, bodyIndex(hitBody), 0) }
        if vt > SCRAPE_MIN && vt > evScr[0] { keep(&evScr, vt, pw, hitN, i, bodyIndex(hitBody), 0) }
        s.touchNow[i] = 1
        M3.scale(force, hitN, fn)
        if vt > 1e-4 { M3.addScaled(force, force, tmp, -jsMin(hitMat.slide * fn, vt * 5000) / vt) }
        applyAt(r, force)
        reactOn(w, hitBody, pw, force, dt)
    }
    if truthy(inp.manual) && !truthy(inp.assist) {
        for i in 0..<NOZZLES.count { target[i] = M3.clamp(jsOr(inp.v[i], 0), 0, 1) }
    } else {
        autoLand(s, inp, grounded, m)
        computerTargets(s, inp, grounded, m, &target)
    }
    let pr = feedPressure(s)
    let isp = SPEC.ispFull * (0.7 + 0.3 * pr)
    var mdot = 0.0
    for i in 0..<NOZZLES.count {
        let nz = NOZZLES[i]
        let goal = s.air > 0.5 ? target[i] : 0
        s.throttles[i] += (goal - s.throttles[i]) * jsMin(1, dt / 0.03)
        let F = nz.max * s.throttles[i] * pr
        if F <= 0 { continue }
        M3.rotate(r, s.quat, nz.pos)
        M3.rotate(force, s.quat, nz.dir)
        M3.scale(force, force, F)
        applyAt(r, force)
        mdot += F / (isp * G)
    }
    s.air = jsMax(0, s.air - mdot * dt)
    let vmag = DMath.dhypot(s.vel.x, s.vel.y, s.vel.z)
    M3.addScaled(fTot, fTot, s.vel, -0.5 * RHO * SPEC.cdA * vmag)
    M3.addScaled(s.vel, s.vel, fTot, dt / m)
    let Ix = SPEC.inertiaPitch, Iy = SPEC.inertiaYaw, Iz = SPEC.inertiaRoll
    M3.rotateInv(wb, s.quat, s.angVel)
    M3.addScaled(s.angMom, s.angMom, tTot, dt)
    M3.rotateInv(Lb, s.quat, s.angMom)
    Lb.x -= M3.clamp(ROT_DRAG.x * wb.x * abs(wb.x) * dt, -abs(Lb.x), abs(Lb.x))
    Lb.y -= M3.clamp(ROT_DRAG.y * wb.y * abs(wb.y) * dt, -abs(Lb.y), abs(Lb.y))
    Lb.z -= M3.clamp(ROT_DRAG.z * wb.z * abs(wb.z) * dt, -abs(Lb.z), abs(Lb.z))
    let ad = grounded != 0 && !s.hullContact ? 0.9985 : 0.9996
    Lb.x *= ad; Lb.y *= ad; Lb.z *= ad
    M3.rotate(s.angMom, s.quat, Lb)
    M3.set(wb, Lb.x / Ix, Lb.y / Iy, Lb.z / Iz)
    M3.rotate(s.angVel, s.quat, wb)
    let rb = w.carRb
    if abs(m - s.engineMass) > 1 {
        s.engineMass = m
        cg_body_set_additional_mass_properties(w.rw, rb, Float(m), 0, 0, 0, Float(SPEC.inertiaPitch), Float(SPEC.inertiaYaw), Float(SPEC.inertiaRoll), 0, 0, 0, 1, false)
    }
    if !s.engineHeld {
        cg_body_set_translation(w.rw, rb, Float(s.pos.x - w.ox), Float(s.pos.y - w.oy), Float(s.pos.z - w.oz), false)
        cg_body_set_rotation(w.rw, rb, Float(s.quat.x), Float(s.quat.y), Float(s.quat.z), Float(s.quat.w), false)
    }
    cg_body_set_linvel(w.rw, rb, Float(s.vel.x), Float(s.vel.y), Float(s.vel.z), false)
    cg_body_set_angvel(w.rw, rb, Float(s.angVel.x), Float(s.angVel.y), Float(s.angVel.z), false)
    M3.copy(vPre, s.vel); M3.copy(wPre, s.angVel); qOld.x = s.quat.x; qOld.y = s.quat.y; qOld.z = s.quat.z; qOld.w = s.quat.w
    M3.copy(pOld, s.pos)
    if w.curl { gateCurl(w, curlReach(s), (jsSqrt(M3.dot(s.vel, s.vel)) + jsSqrt(M3.dot(s.angVel, s.angVel)) * HULL_R) * dt) }
    stepEngine(w)
    cTouched = false
    if w.carTouching > 0 { readContacts(s) }
    s.engineHeld = cTouched
    if cTouched {
        cg_body_translation(w.rw, rb, &ePt); M3.set(s.pos, Double(ePt[0]) + w.ox, Double(ePt[1]) + w.oy, Double(ePt[2]) + w.oz)
        cg_body_rotation(w.rw, rb, &ePt); s.quat.x = Double(ePt[0]); s.quat.y = Double(ePt[1]); s.quat.z = Double(ePt[2]); s.quat.w = Double(ePt[3])
        cg_body_linvel(w.rw, rb, &ePt); M3.set(s.vel, Double(ePt[0]), Double(ePt[1]), Double(ePt[2]))
        cg_body_angvel(w.rw, rb, &ePt); M3.set(s.angVel, Double(ePt[0]), Double(ePt[1]), Double(ePt[2]))
        inertiaTimes(s.angMom, qOld, s.angVel)
    } else {
        M3.addScaled(s.pos, s.pos, s.vel, dt)
        M3.integrateQuat(s.quat, s.angVel, dt)
    }
    for i in 0..<HULL.count { s.touch[i] = s.touchNow[i] }
    let evTick = s.tick + 1, imp2 = s.impacts
    if evHit[0] > 0 { record(imp2, evTick, ImpactKind.HIT, HULL_PART[Int(evHit[7])], evHit) }
    if evScr[0] > 0 && Double(evTick) - imp2.lastScrape >= Double(SCRAPE_EVERY) { imp2.lastScrape = Double(evTick); record(imp2, evTick, ImpactKind.SCRAPE, HULL_PART[Int(evScr[7])], evScr) }
    if evWheel[0] > 0 { record(imp2, evTick, ImpactKind.WHEEL, PART.wheel, evWheel) }
    s.tick += 1
}

/// The body's roll and pitch (rad) against the plane under its wheels: + roll = the car's left side up, + pitch = nose up.
public func bodyAttitude(_ s: Vehicle) -> (roll: Double, pitch: Double) {
    var nx = 0.0, ny = 0.0, nz = 0.0, n = 0
    for w in s.wheels where w.contact { nx += w.nx; ny += w.ny; nz += w.nz; n += 1 }
    if n == 0 { nx = 0; ny = 1; nz = 0 } else { let l = (nx * nx + ny * ny + nz * nz).squareRoot(); nx /= l; ny /= l; nz /= l }
    let q = s.quat
    let rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y)
    let fx = 2 * (q.x * q.z + q.w * q.y), fy = 2 * (q.y * q.z - q.w * q.x), fz = 1 - 2 * (q.x * q.x + q.y * q.y)
    return (asin(M3.clamp(rx * nx + ry * ny + rz * nz, -1, 1)), asin(M3.clamp(fx * nx + fy * ny + fz * nz, -1, 1)))
}
#endif
