// src/sim/vehicle.js, line for line (physics v3: the tyres, the suspension, the suction fan, the ten cold-gas
// nozzles, the mixer and the flight computer, as forces on the car's engine body). The JS module's scratch and
// state (`roofBelow`, `behind`, `hitN`…) are file globals here too, so what a call leaves behind for the next one
// behaves the same. Every JS number is a Double; a value crosses into the engine as Float, as wasm-bindgen does.
#if canImport(CRapier)
import CRapier
import ColdGasCore

public let DT = 1.0 / 240
public let G = 9.81
let RHO = 1.2
let K_SPRING = 150000.0, C_DAMP = 9500.0, BUMP = 600000.0, TRAVEL = 0.16
let WHEEL_I = 1.35
let STATIC_LOAD = ((SPEC.dryMass + SPEC.gasMass) * G) / 4
let MOUNT_TO_CENTRE = 0.24
let REST_LEN = MOUNT_TO_CENTRE + STATIC_LOAD / K_SPRING
let FRONT_SHARE = (SPEC.wheelbase - SPEC.comFromFront) / SPEC.wheelbase
let AXLE_K: [Double] = (0..<4).map { 2 * ($0 < 2 ? FRONT_SHARE : 1 - FRONT_SHARE) }
let RW: [Double] = (0..<4).map(wheelRadiusOf)
let BX = 11.5, CX = 1.65, BY = 16.0, CY = 1.35
@inline(__always) func tyreFx(_ D: Double, _ kappa: Double) -> Double { D * DMath.dsin(CX * DMath.datan(BX * kappa)) }
@inline(__always) func tyreFy(_ D: Double, _ alpha: Double, _ B: Double = BY) -> Double { -D * DMath.dsin(CY * DMath.datan(B * alpha)) }
let LS = SPEC.tyreLoadSens, KYL = SPEC.tyreKyLoad
let X_DMAX = (1 - LS) / (-2 * LS)
@inline(__always) func tyreMuLoad(_ x: Double) -> Double { x <= X_DMAX ? 1 + LS * (x - 1) : ((1 + LS * (X_DMAX - 1)) * X_DMAX) / x }
let KY_NOM = DMath.dsin(2 * DMath.datan(1 / KYL))
@inline(__always) func tyreKyRatio(_ x: Double) -> Double { DMath.dsin(2 * DMath.datan(x / KYL)) / KY_NOM }
@inline(__always) func tyreBy(_ x: Double) -> Double { let xc = jsMax(0.05, x); return (BY * tyreKyRatio(xc)) / (xc * tyreMuLoad(xc)) }
let RELAX_VMIN = 1.5, RELAX_FADE = 3.0
@inline(__always) func relaxWeight(_ vx: Double) -> Double { M3.clamp((abs(vx) - RELAX_VMIN) / RELAX_FADE, 0, 1) }
@inline(__always) func relaxLength(_ sigma0: Double, _ Fz: Double, _ Fz0: Double) -> Double { sigma0 * M3.clamp(jsSqrt(jsMax(0, Fz) / Fz0), 0.5, 1.5) }
@inline(__always) func relaxSlip(_ alphaLag: Double, _ alpha: Double, _ vx: Double, _ sigma: Double, _ dt: Double) -> Double {
    let x = (jsMax(abs(vx), RELAX_VMIN) * dt) / sigma
    return alphaLag + (alpha - alphaLag) * (1 - 1 / (1 + x + 0.5 * x * x))
}

public enum CAR {
    public static let dryMass = SPEC.dryMass, airMass = SPEC.gasMass, isp = SPEC.ispFull
    public static let halfW = SPEC.width / 2, halfL = SPEC.length / 2
    public static let maxTravel = TRAVEL, restLen = REST_LEN, wheelR = SPEC.wheelRadius, mountToCentre = MOUNT_TO_CENTRE
}

public final class NozzleV { public let spec: Nozzle; public let pos: V3, dir: V3, torque: V3; public var group: String { spec.group }; public var max: Double { spec.max }
    init(_ n: Nozzle) { spec = n; pos = V3(n.pos.0, n.pos.1, n.pos.2); dir = V3(n.dir.0, n.dir.1, n.dir.2); torque = M3.cross(V3(), pos, dir) } }
public let NOZZLES: [NozzleV] = NOZZLE_SPEC.map(NozzleV.init)
public let WHEELS: [V3] = wheelAnchors().map { V3($0.0, $0.1, $0.2) }
public let TRIM: [Double] = {
    let lift = NOZZLE_SPEC.filter { $0.group == "lift" }
    let f = lift.first { $0.pos.2 > 0 }!, b = lift.first { $0.pos.2 < 0 }!
    let mf = f.max * f.pos.2, mr = -b.max * b.pos.2
    return NOZZLE_SPEC.map { n in n.group != "lift" ? 1 : n.pos.2 > 0 ? jsMin(1, mr / mf) : jsMin(1, mf / mr) }
}()
let ROT_DRAG: (x: Double, y: Double, z: Double) = {
    let rho = 1.2, cd = 1.2, hl = SPEC.length / 2, hw = SPEC.width / 2
    let hl4 = hl * hl * hl * hl, hw4 = hw * hw * hw * hw
    return ((rho * cd * SPEC.width * hl4) / 4, (rho * cd * SPEC.height * hl4) / 4, (rho * cd * SPEC.length * hw4) / 4)
}()
let LIFT_MAX: Double = NOZZLE_SPEC.indices.reduce(0) { $0 + (NOZZLE_SPEC[$1].group == "lift" ? NOZZLE_SPEC[$1].max * TRIM[$1] : 0) }
let DRIVEN = [false, false, true, true]

// Hull probes
var HULL: [V3] = [], HULL_PART: [UInt8] = []
let hullBuilt: Bool = {
    let hw = SPEC.width / 2 - 0.04
    let zf = AXLE_F + SPEC.overhangFront - 0.05
    let zr = zf - SPEC.length + 0.1
    let yb = -(SPEC.comHeight - SPEC.rideHeight) + 0.05, yt = SPEC.height - SPEC.comHeight - 0.05
    let yNose = yb + 0.15, yTail = yb + 0.2
    for x in [-hw, hw] {
        HULL += [V3(x, yNose, zf), V3(x, yb, (zf + zr) / 2), V3(x, yTail, zr), V3(x, yb, zf - 0.9), V3(x, yb, zr + 0.9)]
        HULL_PART += [PART.nose, PART.floor, PART.tail, PART.floor, PART.floor]
        for z in [zf, (zf + zr) / 2, zr] { HULL.append(V3(x * 0.8, yt * 0.55, z * 0.9)); HULL_PART.append(PART.side) }
    }
    HULL += [V3(0, yt, -0.2), V3(0, yNose, zf), V3(0, yTail, zr), V3(0, yt * 0.4, zf + 0.04), V3(0, yt * 0.6, zr - 0.02)]
    HULL_PART += [PART.roof, PART.nose, PART.tail, PART.nose, PART.tail]
    return true
}()
public let HULL_SHAPE: [Float] = {
    let hw = SPEC.width / 2 - 0.04, zf = AXLE_F + SPEC.overhangFront - 0.05, zr = zf - SPEC.length + 0.1
    let yb = -(SPEC.comHeight - SPEC.rideHeight) + 0.05, yt = SPEC.height - SPEC.comHeight - 0.05
    let yPan = yb + 0.06, yNose = yb + 0.15, yTail = yb + 0.2, yBelt = yt * 0.55
    var pts: [Double] = []
    for x in [-hw, hw] {
        pts += [x, yNose, zf, x, yPan, zf - 0.9, x, yPan, zr + 0.9, x, yTail, zr]
        pts += [x * 0.9, yt * 0.4, zf, x * 0.9, yt * 0.6, zr]
        for z in [zf * 0.9, ((zf + zr) / 2) * 0.9, zr * 0.9] { pts += [x, yBelt, z] }
        pts += [x * 0.36, yt, 0.2, x * 0.36, yt, -0.6]
    }
    pts += [0, yt * 0.4, zf + 0.04, 0, yt * 0.6, zr - 0.02]
    return pts.map { Float($0) }
}()
var FLOOR_PROBES: [Int] { _ = hullBuilt; return HULL_PART.indices.filter { HULL_PART[$0] == PART.floor } }
let SKIRT_UP = 0.3
let HULL_K = 1.2e6, HULL_C = 16000.0, HULL_YIELD = 1.0e5, CRUSH_MAX = 0.35
let FLOOR_K = 300000.0, FLOOR_C = 11000.0
let E_ELASTIC = (0.5 * HULL_YIELD * HULL_YIELD) / HULL_K
let FLOOR = V3(0, -(SPEC.comHeight - SPEC.rideHeight), 0)
let SEAL: [V3] = [0.75, 0.25, -0.25, -0.75].flatMap { z in [V3(0.375, FLOOR.y, z), V3(-0.375, FLOOR.y, z)] }

/// The sim's input: the channels of the input log (run.js KEYS), each already quantised to hundredths.
public final class Input {
    public var throttle = 0.0, brake = 0.0, steer = 0.0, pitch = 0.0, roll = 0.0, yaw = 0.0, lift = 0.0, thrust = 0.0
    public var retro = 0.0, level = 0.0, fan = 0.0, assist = 1.0, manual = 0.0
    public var v = [Double](repeating: 0, count: 10)
    public init() {}
}
@inline(__always) func truthy(_ x: Double) -> Bool { !(x == 0 || x.isNaN) }

public let ASSIST_CRAWL = 8.0, ASSIST_CARRY = 10.0
let TC_CAP = 1.0
let LOCK_MARGIN = 0.04
@inline(__always) func rackLock(_ vSq: Double, _ aGrip: Double = SPEC.tyreMu * G) -> Double { jsMin(SPEC.steerLock, (SPEC.wheelbase * aGrip) / jsMax(1, vSq) + LOCK_MARGIN) }
let COUNTER_DB = 0.035
let RACK_T0 = 0.1, RACK_TV = 0.005
let ESC_TAU = 0.12, ESC_KB = 3.0, ESC_KBD = 0.3

public final class Wheel {
    public var contact = true, compression = REST_LEN - MOUNT_TO_CENTRE, prevCompression = REST_LEN - MOUNT_TO_CENTRE
    public var omega = 0.0, spin = 0.0, steer = 0.0, slip = 0.0, slipAngle = 0.0, slipAngleKin = 0.0, relax = 0.0, load = STATIC_LOAD
    public var nx = 0.0, ny = 1.0, nz = 0.0
}

public final class Vehicle {
    public let course: Course
    public var tick = 0
    public let world: World
    public let pos: V3, vel = V3(), quat: Q4, angVel = V3(), angMom = V3()
    public var air = CAR.airMass
    public var throttles = [Double](repeating: 0, count: NOZZLES.count)
    public let wheels: [Wheel] = (0..<4).map { _ in Wheel() }
    public var fan = 0.0, fanDemand = 0.0, fanForce = 0.0, gripSat = 0.0, fanLat = 0.0, floorGap = SPEC.rideHeight
    public var hullContact = false, hullGround = false, obstacleContact = false, obstacleSpeed = 0.0, hullImpulse = 0.0
    public var steer = 0.0, grounded = 4, onWall = false, onSlope = false, wheelForce = 0.0, tcActive = false
    public var crush: [Double], crushShown: [Double], touch: [UInt8]
    public let impacts = Impacts()
    public var crushE: [Double], touchNow: [UInt8]
    public var engineMass = 0.0
    public var fallPeak = 0.0, autoLand = 0, carryUp = 0
    // LAND's line hold through the set-down (0190): 1 once LAND's roll-out has run from upside down this flight.
    public var lineArm = 0
    // LAND's brake, once begun: the most sink it may still want (m/s, 0 = not braking; 0169).
    public var landCap = 0.0
    public let crawl: Bool
    public var esc = 0.0, escBrake = [Double](repeating: 0, count: 4), escBeta = 0.0
    public var tcOff = false, tcSport = false, absOff = false, handbrake = 0.0
    public var engineHeld = false
    init(_ course: Course) {
        _ = hullBuilt
        self.course = course
        world = createWorld(course)
        pos = V3(course.startX, SPEC.comHeight, course.startZ)
        quat = M3.quatFromYaw(Q4(), 0)
        crush = .init(repeating: 0, count: HULL.count); crushShown = crush; touch = .init(repeating: 0, count: HULL.count)
        crushE = crush; touchNow = touch
        crawl = course.id == "wall" || course.id == "show"
        engineMass = massOf(self)
        attachCar(world, HULL_SHAPE, engineMass, SPEC.inertiaPitch, SPEC.inertiaYaw, SPEC.inertiaRoll)
        world.carPos = pos; world.carVel = vel; world.carQuat = quat
    }
}
public func createVehicle(_ courseId: String = DEFAULT_COURSE) -> Vehicle { Vehicle(COURSES[courseId] ?? COURSES[DEFAULT_COURSE]!) }

@inline(__always) public func massOf(_ s: Vehicle) -> Double { CAR.dryMass + jsMax(0, s.air) }
@inline(__always) func feedPressure(_ s: Vehicle) -> Double { pressureOf(s.air) }
@inline(__always) public func pressureOf(_ air: Double) -> Double {
    let rG = jsMax(0, air) / CAR.airMass
    let tank = rG * jsSqrt(jsSqrt(rG)) * jsSqrt(jsSqrt(jsSqrt(rG)))
    return jsMin(1, tank / SPEC.regulatedFraction)
}

// Scratch (never reallocated), as the JS module's.
let tmp = V3(), tmp2 = V3(), r = V3(), pw = V3(), vp = V3(), force = V3(), fwd = V3(), right = V3(), upW = V3(),
    fTot = V3(), tTot = V3(), wb = V3(), Lb = V3(), cmdT = V3(), dn = V3(), hitN = V3(), wf = V3(), wl = V3(), worldUpB = V3(), rp = V3(),
    impV = V3(), vPre = V3(), wPre = V3(), nb = V3(), lc = V3(), vo = V3(), vb = V3()
var hitBody: ParkedBody? = nil, hitMat = MATERIALS.concrete, hitCar = false
var target = [Double](repeating: 0, count: NOZZLES.count)
var evHit = [Double](repeating: 0, count: 10), evScr = [Double](repeating: 0, count: 10), evWheel = [Double](repeating: 0, count: 10)
@inline(__always) func keep(_ ev: inout [Double], _ speed: Double, _ p: V3, _ n: V3, _ probe: Int, _ body: Int, _ crush: Double) {
    ev[0] = speed; ev[1] = p.x; ev[2] = p.y; ev[3] = p.z; ev[4] = n.x; ev[5] = n.y; ev[6] = n.z; ev[7] = Double(probe); ev[8] = Double(body); ev[9] = crush
}
@inline(__always) func bodyIndex(_ b: ParkedBody?) -> Int { b?.index ?? -1 }
var effLift = 0.0, effThrust = 0.0

@inline(__always) func pointVel(_ out: V3, _ s: Vehicle, _ rw: V3) { M3.cross(out, s.angVel, rw); M3.add(out, out, s.vel) }
@inline(__always) func applyAt(_ rw: V3, _ f: V3) { M3.add(fTot, fTot, f); M3.cross(tmp2, rw, f); M3.add(tTot, tTot, tmp2) }
@inline(__always) func reactOn(_ w: World, _ body: ParkedBody?, _ p: V3, _ f: V3, _ dt: Double) {
    guard let body, body.rb != CG_NONE else { return }
    impV.x = -f.x * dt; impV.y = -f.y * dt; impV.z = -f.z * dt
    cg_body_apply_impulse_at_point(w.rw, body.rb, Float(impV.x), Float(impV.y), Float(impV.z), Float(p.x - w.ox), Float(p.y - w.oy), Float(p.z - w.oz), true)
}
@inline(__always) func rayV(_ s: Vehicle, _ o: V3, _ d: V3, _ maxT: Double) -> Double {
    let w = s.world
    let t = raycast(w, o.x, o.y, o.z, d.x, d.y, d.z, maxT, w.carRb)
    if t < 0 { return -1 }
    let h = w.hit
    M3.set(hitN, h.nx, h.ny, h.nz); hitBody = h.body; hitMat = h.mat; hitCar = h.car
    return t
}
/// Mixer: pilot command → valve targets. Attitude has priority over lift.
@discardableResult public func mix(_ lift: Double, _ thrust: Double, _ torqueCmd: V3, _ out: inout [Double]) -> [Double] {
    var maxDelta = 0.0
    for i in 0..<NOZZLES.count {
        let t = NOZZLES[i].torque
        let d = (t.x * torqueCmd.x + t.y * torqueCmd.y + t.z * torqueCmd.z) * 2.0
        out[i] = d
        if NOZZLES[i].group == "lift" && d > maxDelta { maxDelta = d }
    }
    let liftBase = jsMin(lift, 1 - jsMin(1, maxDelta))
    for i in 0..<NOZZLES.count {
        let g = NOZZLES[i].group
        let base = g == "lift" ? liftBase * TRIM[i] : g == "rear" ? thrust : 0
        out[i] = M3.clamp(base + out[i], 0, 1)
    }
    return out
}

let RATE = V3(2.4, 1.4, 4.6)
let LEVEL_K = 2.0, LEVEL_DAMP = 1.4
let UPPER_ROLL = 0.94, ROLL_ACC = 12.0
// 0190: armed by the roll-out from inverted, the line hold keeps taking the drift off down to HOLD_LOW_H m at ≤ HOLD_LOW_BANK
// rad (src/sim/vehicle.js says why).
let HOLD_LOW_H = 1.5, HOLD_LOW_BANK = 0.12
let ROLL_TAU: Double = NOZZLE_SPEC.reduce(0) { $0 + ($1.group == "lift" && $1.pos.0 > 0 ? 2 * $1.pos.0 * $1.pos.0 * $1.max : 0) }
@discardableResult func flightComputer(_ s: Vehicle, _ inp: Input, _ out: V3, _ envelope: Double, _ level: Double) -> V3 {
    M3.rotateInv(wb, s.quat, s.angVel)
    let kp = 1.6, k = envelope
    M3.set(out, kp * (inp.pitch * k * RATE.x - wb.x), kp * (-inp.yaw * RATE.y - wb.y), kp * (inp.roll * k * RATE.z - wb.z))
    if truthy(inp.assist) && truthy(level) {
        M3.rotateInv(worldUpB, s.quat, M3.set(tmp, 0, 1, 0))
        let ux = worldUpB.x, uy = worldUpB.y, uz = worldUpB.z
        var wantX = LEVEL_K * uz, wantZ = -LEVEL_K * ux
        let hh = s.pos.y - SPEC.comHeight
        let holdCap = hh > HOVER + 1.5 ? 0.2 : s.lineArm != 0 && hh > HOLD_LOW_H ? HOLD_LOW_BANK : 0
        if uy > 0.8 && abs(inp.roll) < 0.05 && holdCap > 0 {
            M3.rotateInv(tmp, s.quat, s.vel)
            wantZ = -LEVEL_K * (ux - M3.clamp(0.07 * tmp.x, -holdCap, holdCap))
        }
        var rollOut = false
        if (uy < -0.2 && abs(uz) < 0.7) || (uy < UPPER_ROLL && abs(ux) > abs(uz) && abs(inp.roll) < 0.05) {
            let bank = uy < -0.2 ? DMath.datan2(DMath.dhypot(ux, uz), uy) : DMath.datan2(abs(ux), uy)
            if uy < -0.2 { wantX = 0 }
            wantZ = (ux >= 0 ? -1 : 1) * jsMin(RATE.z, jsSqrt(1.6 * ROLL_ACC * bank))
            rollOut = abs(inp.roll) < 0.05
            if rollOut && uy < -0.2 { s.lineArm = 1 }
        }
        out.x += (kp + LEVEL_DAMP) * wantX - LEVEL_DAMP * wb.x
        out.z += (kp + LEVEL_DAMP) * wantZ - LEVEL_DAMP * wb.z
        if rollOut {
            let cap = (ROLL_ACC * SPEC.inertiaRoll) / (ROLL_TAU * jsMax(0.2, feedPressure(s)))
            out.z = M3.clamp(out.z, -cap, cap)
            if uy < 0 { out.x = M3.clamp(out.x, -cap / 2, cap / 2) }
        }
    }
    out.x = M3.clamp(out.x, -1, 1); out.y = M3.clamp(out.y, -1, 1); out.z = M3.clamp(out.z, -1, 1)
    return out
}
@inline(__always) func record(_ imp: Impacts, _ tick: Int, _ kind: UInt8, _ part: UInt8, _ ev: [Double]) {
    imp.push(Double(tick), kind, Double(part), ev[7], ev[8], ev[1], ev[2], ev[3], ev[4], ev[5], ev[6], ev[0], ev[9])
}

public let HOVER = 2.5, SETDOWN = 0.8, SETDOWN_K = 0.5
let FALL_LOW = 8.0, FALL_HIGH = 14.0, TOP_MIN = 0.1
@inline(__always) func setdownTop(_ s: Vehicle) -> Double { TOP_MIN + (HOVER - TOP_MIN) * M3.clamp((s.fallPeak - FALL_LOW) / (FALL_HIGH - FALL_LOW), 0, 1) }
@inline(__always) func vTop(_ top: Double) -> Double { SETDOWN + SETDOWN_K * top }
func profileVy(_ h: Double, _ aPlan: Double, _ top: Double = HOVER) -> Double {
    if h <= top { return -(SETDOWN + SETDOWN_K * jsMax(0, h)) }
    let v = vTop(top)
    return -jsMin(25, jsSqrt(v * v + 2 * aPlan * (h - top)))
}
let CARRY_ROW = 7.0, CARRY_LOW = 5.0
var behind = 0.0
// LAND's one burn (0169): see vehicle.js.
let LAND_CAP_ON = 5.0, LAND_CAP_MIN = 4.0, LAND_CAP_ACC = 4.8, LAND_CAP_FLOOR = 0.3
let ROOF_FALL = 11.0
func governor(_ s: Vehicle, _ inp: Input, _ grounded: Int, _ m: Double, _ level: Double) {
    effLift = inp.lift; effThrust = inp.thrust
    behind = 0
    if !truthy(inp.assist) || grounded > 0 { s.landCap = 0; return }
    if effThrust > 0 {
        let vh = DMath.dhypot(s.vel.x, s.vel.z)
        effThrust *= M3.clamp((ASSIST_CARRY - vh) / 1.5, 0, 1)
    }
    if !truthy(level) || s.air <= 0 { s.landCap = 0; return }
    let h = landHeight(s)
    var wantVy = landWant(s, m)
    // One burn from the onset to the wheels (0169): once LAND brakes, the sink it lifts for never grows
    // again (but back up to LAND_CAP_MIN at LAND_CAP_ACC); a car stopped over a roof keeps it too, and comes
    // down off the roof's end on the jets (SIM_VERSION 30).
    var liftVy = wantVy
    if s.landCap > 0 { liftVy = jsMax(wantVy, -s.landCap) }
    else if wantVy > s.vel.y && s.vel.y < -LAND_CAP_ON { s.landCap = -wantVy }
    if s.landCap > 0 { s.landCap = jsMax(-liftVy, jsMin(LAND_CAP_MIN, jsMax(0, -liftVy) + LAND_CAP_ACC * DT)) }
    if s.landCap > 0 && roofBelow > 0 && s.vel.y > -0.5 { s.fallPeak = jsMin(s.fallPeak, ROOF_FALL) }
    if h < 1.2 && upW.y < 0.99 { wantVy = jsMax(wantVy, -0.25); liftVy = jsMax(liftVy, -0.25) }
    behind = wantVy - s.vel.y
    if behind > 0 || h < 8 { effThrust = 0 }
    let vh = DMath.dhypot(s.vel.x, s.vel.z)
    if roofBelow <= 0 || vh >= CARRY_ROW { s.carryUp = 0 }
    else if vh < CARRY_LOW { s.carryUp = 1 }
    if s.carryUp != 0 && upW.y > 0.9 && behind < 0.5 { effThrust = jsMax(effThrust, M3.clamp((CARRY_ROW - vh) / 3, 0, 0.5)) }
    if s.vel.y < liftVy && upW.y > 0.55 { effLift = jsMax(effLift, M3.clamp((liftVy - s.vel.y) * 0.8 + 0.55, 0, 1)) }
    if s.landCap > 0 && s.vel.y < -LAND_CAP_FLOOR && upW.y > 0.55 { effLift = jsMax(effLift, M3.clamp(((G - LAND_CAP_ACC) * m) / (LIFT_MAX * jsMax(0.2, feedPressure(s))), 0, 1)) }
}
func landWant(_ s: Vehicle, _ m: Double) -> Double {
    let h = landHeight(s)
    return landWantAt(h, roofBelow, DMath.dhypot(s.vel.x, s.vel.z), brakePlan(s, m), setdownTop(s))
}
func landWantAt(_ h: Double, _ roof: Double, _ vh: Double, _ a: Double, _ top: Double) -> Double {
    if roof <= 0 || vh <= 2 { return profileVy(h, a, top) }
    let hRoof = h, hGround = h + roof
    if hRoof < ROOF_HOLD { return M3.clamp(ROOF_HOLD - hRoof, 0, 1) }
    return jsMax(profileVy(hGround, a, top), -jsMin(25, jsSqrt(2 * a * (hRoof - ROOF_HOLD))))
}
var roofBelow = 0.0
let hdg = V3()
let ROOF_HOLD = 1.2
public func landHeight(_ s: Vehicle) -> Double {
    let vh = DMath.dhypot(s.vel.x, s.vel.z)
    var dx = 0.0, dz = 1.0
    if vh > 0.5 { dx = s.vel.x / vh; dz = s.vel.z / vh }
    else {
        M3.rotate(hdg, s.quat, M3.set(hdg, 0, 0, 1))
        let l = DMath.dhypot(hdg.x, hdg.z)
        if l > 0.1 { dx = hdg.x / l; dz = hdg.z / l }
    }
    let back = CAR.halfL, len = back + vh * 0.6 + CAR.halfL
    let n = Int(jsMin(24, jsCeil(len / 0.5)))
    roofBelow = 0
    let bodies = s.world.bodies
    for i in 0...max(0, n) {
        let d = (len * Double(i)) / Double(n) - back, x = s.pos.x + dx * d, z = s.pos.z + dz * d
        for k in -1...1 { let kk = Double(k); roofBelow = jsMax(roofBelow, roofUnder(bodies, x - dz * kk * CAR.halfW, z + dx * kk * CAR.halfW)) }
    }
    return jsMax(0, s.pos.y - SPEC.comHeight - 0.05 - roofBelow)
}
@inline(__always) func brakeAvail(_ s: Vehicle, _ m: Double) -> Double { (LIFT_MAX * feedPressure(s)) / m - G }
let BRAKE_SHARE = 0.8
func brakePlan(_ s: Vehicle, _ m: Double) -> Double {
    let v = jsMax(0, -s.vel.y), vt = vTop(setdownTop(s))
    if v < vt + 0.5 { return M3.clamp(brakeAvail(s, m) * BRAKE_SHARE, 0.6, 30) }
    return M3.clamp((v * v - vt * vt) / (2 * stopFull(s.air, m, v, vt)), 0.6, 30)
}
func stopFull(_ air0: Double, _ m0: Double, _ v0: Double, _ vEnd: Double = 0) -> Double {
    let dt = 0.05
    var d = 0.0, air = air0, m = m0, v = v0
    var i = 0
    while i < 80 && v > vEnd {
        let pr = pressureOf(air), F = LIFT_MAX * BRAKE_SHARE * pr
        let a = F / m - G
        let dv = jsMin(v - vEnd, jsMax(0, a) * dt)
        d += (v - dv / 2) * dt
        v -= dv
        let used = (F / (SPEC.ispFull * (0.7 + 0.3 * pr) * G)) * dt
        air -= used; m -= used
        if a <= 0.3 { return d + (v * v - vEnd * vEnd) / 0.6 }
        i += 1
    }
    return jsMax(d, 0.01)
}
let AUTO_LEAD = 0.4, AUTO_SINK = 7.0
func autoLand(_ s: Vehicle, _ inp: Input, _ grounded: Int, _ m: Double) {
    if !truthy(inp.assist) || grounded >= 2 { s.autoLand = 0; return }
    if grounded > 0 { return }   // 0190: …but it never starts with a wheel down
    if s.autoLand != 0 || truthy(inp.level) || s.air <= 0.5 || s.vel.y >= 0 { return }
    let h = landHeight(s), vy = s.vel.y
    if vy * vy + 2 * G * h <= AUTO_SINK * AUTO_SINK { return }
    M3.rotate(upW, s.quat, M3.set(tmp, 0, 1, 0))
    let tilt = DMath.datan2(DMath.dhypot(upW.x, upW.z), upW.y)
    let T = AUTO_LEAD + (tilt > 1.05 && abs(inp.roll) < 0.05 ? 0.15 + (tilt - 0.7) / 3.5 : 0)
    let hF = h + vy * T - 0.5 * G * T * T, vyF = vy - G * T
    let wF = landWantAt(hF, roofBelow, DMath.dhypot(s.vel.x, s.vel.z), brakePlan(s, m), setdownTop(s))
    if hF <= 0 || vyF < wF { s.autoLand = 1 }
}
func computerTargets(_ s: Vehicle, _ inp: Input, _ grounded: Int, _ m: Double, _ out: inout [Double]) {
    if grounded > 0 { s.lineArm = 0 }
    let level: Double = truthy(inp.level) || (truthy(inp.assist) && s.autoLand != 0) ? 1 : 0
    governor(s, inp, grounded, m, level)
    let envelope = truthy(inp.assist) && truthy(level) && grounded == 0 ? M3.clamp(1 - (behind - 0.5) / 2, 0.25, 1) : 1
    flightComputer(s, inp, cmdT, envelope, level)
    if grounded >= 2 { cmdT.x = 0; cmdT.y = 0; cmdT.z = 0 }
    else if envelope < 1 { cmdT.x *= envelope; cmdT.y *= envelope; cmdT.z *= envelope }
    mix(effLift, effThrust, cmdT, &out)
}

// Contacts of the rigid hull, as the engine solved them
var PART_PROBES: [[Int]] = {
    _ = hullBuilt
    var a = [[Int]](repeating: [], count: 6)
    for p in [PART.floor, PART.nose, PART.tail, PART.side, PART.roof] { a[Int(p)] = HULL_PART.indices.filter { HULL_PART[$0] == p } }
    return a
}()
func probeFor(_ nbx: Double, _ nby: Double, _ nbz: Double, _ lx: Double, _ ly: Double, _ lz: Double) -> Int {
    let part = nby > 0.6 ? PART.roof : nby < -0.6 ? PART.floor : abs(nbz) > abs(nbx) ? (nbz > 0 ? PART.nose : PART.tail) : PART.side
    let list = PART_PROBES[Int(part)]
    var best = list[0], bd = Double.infinity
    for i in list {
        let p = HULL[i], dx = p.x - lx, dy = p.y - ly, dz = p.z - lz, d = dx * dx + dy * dy + dz * dz
        if d < bd { bd = d; best = i }
    }
    return best
}
var cTouched = false
let TOUCH_SKIN = 0.01
var mN = [Float](repeating: 0, count: 3)
var contactScratch = CgContact()
func onManifold(_ s: Vehicle, _ other: UInt64, _ m: Int, _ flipped: Bool) {
    let w = s.world
    guard let info = w.info[other] else { return }
    let nContacts = cg_manifold(w.rw, w.carCol, other, m, &mN)
    if nContacts < 0 { return }
    let sg: Double = flipped ? 1 : -1
    let nx = Double(mN[0]) * sg, ny = Double(mN[1]) * sg, nz = Double(mN[2]) * sg
    for k in 0..<Int(nContacts) {
        guard cg_manifold_contact(w.rw, w.carCol, other, m, k, &contactScratch) else { continue }
        let J = Double(contactScratch.impulse)
        if !(J > 0) && !(Double(contactScratch.dist) < TOUCH_SKIN) { continue }
        let lp = flipped ? contactScratch.p2 : contactScratch.p1
        cTouched = true
        M3.set(lc, Double(lp.0), Double(lp.1), Double(lp.2))
        M3.rotate(r, s.quat, lc); M3.add(pw, s.pos, r)
        M3.cross(vp, wPre, r); M3.add(vp, vp, vPre)
        vo.x = 0; vo.y = 0; vo.z = 0
        let b = info.body
        if let b {
            let h = b.phys.cgh, q = b
            let cx = b.cx + 2 * (q.qx * q.qy - q.qw * q.qz) * h, cy = b.cy + (1 - 2 * (q.qx * q.qx + q.qz * q.qz)) * h, cz = b.cz + 2 * (q.qy * q.qz + q.qw * q.qx) * h
            let rx = pw.x - cx, ry = pw.y - cy, rz = pw.z - cz
            M3.set(vo, b.pvx + b.pwy * rz - b.pwz * ry, b.pvy + b.pwz * rx - b.pwx * rz, b.pvz + b.pwx * ry - b.pwy * rx)
        }
        M3.sub(vp, vp, vo)
        M3.set(hitN, nx, ny, nz)
        M3.rotateInv(nb, s.quat, M3.set(tmp, -nx, -ny, -nz))
        let i = probeFor(nb.x, nb.y, nb.z, lc.x, lc.y, lc.z)
        let vn = M3.dot(vp, hitN)
        if info.body != nil { s.obstacleContact = true; s.obstacleSpeed = jsMax(s.obstacleSpeed, DMath.dhypot(vp.x + vo.x, vp.y + vo.y, vp.z + vo.z)) }
        else { s.hullGround = true }
        s.hullContact = true
        s.hullImpulse = jsMax(s.hullImpulse, -vn)
        M3.addScaled(tmp, vp, hitN, -vn)
        let vt = DMath.dhypot(tmp.x, tmp.y, tmp.z)
        let bi = bodyIndex(info.body)
        if s.touch[i] == 0 && s.touchNow[i] == 0 && -vn > HIT_MIN && -vn > evHit[0] { keep(&evHit, -vn, pw, hitN, i, bi, s.crush[i]) }
        if vt > SCRAPE_MIN && vt > evScr[0] { keep(&evScr, vt, pw, hitN, i, bi, s.crush[i]) }
        s.touchNow[i] = 1
        let yieldF = HULL_PART[i] == PART.floor ? Double.infinity : HULL_YIELD
        if yieldF < .infinity && vn < 0 && J > 0 {
            s.crushE[i] += 0.5 * J * -vn
            let d = jsMin(CRUSH_MAX, (s.crushE[i] - E_ELASTIC) / yieldF)
            if d > s.crush[i] { s.crush[i] = d }
            if s.crush[i] - s.crushShown[i] >= CRUSH_STEP {
                s.crushShown[i] = s.crush[i]
                s.impacts.push(Double(s.tick + 1), ImpactKind.CRUSH, Double(HULL_PART[i]), Double(i), Double(bi), pw.x, pw.y, pw.z, hitN.x, hitN.y, hitN.z, -vn, s.crush[i])
            }
        }
    }
}
var pairScratch = [UInt64](repeating: 0, count: 32)
func readContacts(_ s: Vehicle) {
    let w = s.world
    var n = cg_contact_pairs_with(w.rw, w.carCol, &pairScratch, pairScratch.count)
    if n > pairScratch.count { pairScratch = .init(repeating: 0, count: n * 2); n = cg_contact_pairs_with(w.rw, w.carCol, &pairScratch, pairScratch.count) }
    for j in 0..<n {
        let other = pairScratch[j]
        var flipped = false
        let mc = cg_contact_pair(w.rw, w.carCol, other, &flipped)
        if mc < 0 { continue }
        for m in 0..<Int(mc) { onManifold(s, other, m, flipped) }
    }
}
func inertiaTimes(_ out: V3, _ q: Q4, _ v: V3) {
    M3.rotateInv(out, q, v)
    out.x *= SPEC.inertiaPitch; out.y *= SPEC.inertiaYaw; out.z *= SPEC.inertiaRoll
    M3.rotate(out, q, out)
}
let qOld = Q4(), pOld = V3()
var ePt = [Float](repeating: 0, count: 4)
@inline(__always) func bodyVelAt(_ w: World, _ rb: UInt64, _ x: Double, _ y: Double, _ z: Double) -> (Double, Double, Double) {
    cg_body_velocity_at_point(w.rw, rb, Float(x), Float(y), Float(z), &ePt); return (Double(ePt[0]), Double(ePt[1]), Double(ePt[2]))
}

/// Debug: every value handed to the engine (tests set it; nil in the app).
public var engineTrace: ((Int, String, [Float]) -> Void)? = nil
/// One 240 Hz tick of the car (vehicle.js step).
public func step(_ s: Vehicle, _ inp: Input) throws {
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

    // Steering
    let speed = DMath.dhypot(s.vel.x, s.vel.y, s.vel.z)
    let vSq = jsMax(1, s.vel.x * s.vel.x + s.vel.z * s.vel.z)
    let aGrip = SPEC.tyreMu * (G + jsMin(s.fanForce, s.fanLat * SPEC.fanMaxForce) / m)
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

    // Stability control (Assist)
    s.esc = 0; for i in 0..<4 { s.escBrake[i] = 0 }
    var escCut = 1.0
    do {
        let beta = vFwd > 0.5 ? DMath.datan2(vb.x + wb.y * AXLE_R, vFwd) : 0
        let dBeta = (beta - s.escBeta) / dt
        s.escBeta = beta
        if truthy(inp.assist) && !truthy(inp.manual) && s.grounded >= 3 && vFwd > 5 {
            let rr = wb.y, rMax = (SPEC.escYaw * aGrip) / vFwd
            let bx = beta > SPEC.escSlip ? beta - SPEC.escSlip : beta < -SPEC.escSlip ? beta + SPEC.escSlip : 0
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
    // Suction fan
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

    // Wheels
    var grounded = 0, wallContact = false, sloped = false, wheelForce = 0.0
    s.hullContact = false; s.hullGround = false; s.obstacleContact = false
    s.tcActive = false
    evHit[0] = 0; evScr[0] = 0; evWheel[0] = 0
    for i in 0..<4 {
        let wh = s.wheels[i]
        M3.rotate(r, s.quat, WHEELS[i])
        M3.add(pw, s.pos, r)
        wh.prevCompression = wh.compression
        let wasContact = wh.contact
        wh.contact = false
        let R = RW[i]
        let maxT = REST_LEN + R
        let t = rayV(s, pw, dn, maxT)
        if t < 0 {
            wh.compression = 0; wh.load = 0
            wh.slipAngle = 0
            if DRIVEN[i] { wh.omega += ((inp.throttle * 600) / WHEEL_I) * dt }
            if inp.brake > 0 { wh.omega *= 0.9 }
            wh.omega *= 0.999
            wh.spin += wh.omega * dt
            continue
        }
        wh.contact = true; grounded += 1
        if hitBody != nil { s.obstacleContact = true }
        if hitN.y < 0.85 { wallContact = true }
        if hitN.y < 0.995 { sloped = true }
        wh.nx = hitN.x; wh.ny = hitN.y; wh.nz = hitN.z
        let comp = maxT - t
        wh.compression = jsMin(comp, REST_LEN + R)
        let compRate = (wh.compression - wh.prevCompression) / dt
        var fs = AXLE_K[i] * (K_SPRING * jsMin(comp, REST_LEN) + C_DAMP * compRate)
        let over = comp - (REST_LEN - MOUNT_TO_CENTRE + TRAVEL)
        if over > 0 { fs += BUMP * over }
        fs = jsMax(0, fs)
        let Fz = fs * jsMax(0.3, -M3.dot(dn, hitN))
        wh.load = Fz
        M3.addScaled(tmp, r, dn, t)
        pointVel(vp, s, tmp)
        if let hb = hitBody, hb.rb != CG_NONE { M3.add(rp, s.pos, tmp); let e = bodyVelAt(w, hb.rb, rp.x - w.ox, rp.y - w.oy, rp.z - w.oz); vp.x -= e.0; vp.y -= e.1; vp.z -= e.2 }
        if !wasContact {
            let close = -M3.dot(vp, hitN)
            if close > WHEEL_MIN && close > evWheel[0] { M3.add(rp, s.pos, tmp); keep(&evWheel, close, rp, hitN, i, bodyIndex(hitBody), 0) }
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
        var kappa = (wh.omega * R - vLong) / den
        let alphaKin = DMath.datan2(vLat, jsMax(abs(vLong), 1.5))
        let xLoad = Fz / (STATIC_LOAD * AXLE_K[i])
        let D = jsMax(0, SPEC.tyreMu * hitMat.grip * (1 - 0.07 * (xLoad - 1)) * Fz)
        let Dy = jsMax(0, SPEC.tyreMu0 * hitMat.grip * tyreMuLoad(xLoad) * Fz)
        let By = tyreBy(xLoad)
        let sigma = relaxLength(i < 2 ? SPEC.tyreRelaxFront : SPEC.tyreRelaxRear, Fz, STATIC_LOAD * AXLE_K[i])
        let lag = relaxSlip(wh.slipAngle, alphaKin, vLong, sigma, dt)
        let alpha = alphaKin + (lag - alphaKin) * relaxWeight(vLong)
        var T = 0.0
        if DRIVEN[i] {
            let motorT = jsMin(SPEC.maxWheelTorque, (SPEC.power / 2) / jsMax(abs(wh.omega), 8))
            T = inp.throttle * motorT
            if truthy(inp.assist) && s.crawl && s.onSlope { T *= M3.clamp(ASSIST_CRAWL + 1 - speed, 0, 1) }
            T *= escCut
            let loose = hitMat.loose == true
            let kd = T >= 0 ? kappa : -kappa
            if kd > 0.12 && !s.tcOff { T *= M3.clamp(1 - (kd - 0.12) * 9, loose ? 0.15 * hitMat.grip * hitMat.grip : 0.15, 1); s.tcActive = true }
            var cap = (loose ? 1.2 : TC_CAP) * R * D
            if !truthy(inp.manual) && !s.tcSport && abs(vLong) > 3 {
                let fy = Dy > 0 ? tyreFy(Dy, alpha, By) / Dy : 0
                cap = jsMin(cap, R * D * jsSqrt(jsMax(0, 1 - fy * fy)))
            }
            if s.tcOff { } else if T > cap { T = cap; s.tcActive = true } else if T < -cap { T = -cap; s.tcActive = true }
        }
        let brakeT = inp.brake * SPEC.brakeTorque * (i < 2 ? 1.15 : 0.85) + s.escBrake[i]
        var Fx = tyreFx(D, kappa)
        let Fy0 = tyreFy(Dy, alpha, By)
        let slope = (D * CX * BX * DMath.dcos(CX * DMath.datan(BX * kappa))) / (1 + (BX * kappa) * (BX * kappa))
        let kEff = jsMax(slope, D * 2) / den
        var omega = wh.omega + ((dt / WHEEL_I) * (T - R * Fx)) / (1 + (dt / WHEEL_I) * R * R * kEff)
        if brakeT > 0 {
            let absK = !s.absOff && kappa < -0.1 && abs(vLong) > 2 ? M3.clamp(1 - (-kappa - 0.1) * 10, 0.05, 1) : 1
            let db = ((brakeT * absK) / WHEEL_I) * dt
            omega = abs(omega) <= db ? 0 : omega - jsSign(omega) * db
        }
        if s.handbrake > 0 && i >= 2 {
            let db = ((s.handbrake * SPEC.brakeTorque) / WHEEL_I) * dt
            omega = abs(omega) <= db ? 0 : omega - jsSign(omega) * db
        }
        wh.omega = omega
        kappa = (wh.omega * R - vLong) / den
        Fx = tyreFx(D, kappa)
        var Fy = Fy0
        let mEff = m * 0.25
        if abs(vLong) < 0.5 && wh.omega == 0 && T == 0 { Fx = M3.clamp(-mEff * (vLong / dt * 0.5 - G * wf.y), -D, D) }
        if abs(vLat) < 0.5 && abs(vLong) < 2 {
            let hold = M3.clamp(-mEff * (vLat / dt * 0.5 - G * wl.y), -Dy, Dy)
            if abs(hold) > abs(Fy) { Fy = hold }
        }
        let ex = D > 0 ? Fx / D : 0, ey = Dy > 0 ? Fy / Dy : 0
        let ell = ex * ex + ey * ey
        if ell > 1 { let k = 1 / jsSqrt(ell); Fx *= k; Fy *= k }
        Fx -= vLong * 6
        if truthy(hitMat.roll) { Fx -= M3.clamp(vLong * 2, -1, 1) * hitMat.roll * Fz }
        wh.slip = kappa; wh.slipAngle = lag; wh.slipAngleKin = alphaKin; wh.relax = sigma
        M3.scale(force, hitN, Fz)
        M3.addScaled(force, force, wf, Fx)
        M3.addScaled(force, force, wl, Fy)
        applyAt(tmp, force)
        if hitBody != nil { M3.add(rp, s.pos, tmp); reactOn(w, hitBody, rp, force, dt) }
        wheelForce += Fz
        wh.spin += wh.omega * dt
    }
    s.grounded = grounded
    s.fallPeak = grounded > 0 ? 0 : jsMax(s.fallPeak, -s.vel.y)
    s.onWall = wallContact
    s.onSlope = sloped
    s.wheelForce = wheelForce

    // Skirts and floor pan
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

    // Thrusters
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

    // Aero drag
    let vmag = DMath.dhypot(s.vel.x, s.vel.y, s.vel.z)
    M3.addScaled(fTot, fTot, s.vel, -0.5 * RHO * SPEC.cdA * vmag)

    // Velocities from our forces
    M3.addScaled(s.vel, s.vel, fTot, dt / m)
    let Ix = SPEC.inertiaPitch, Iy = SPEC.inertiaYaw, Iz = SPEC.inertiaRoll
    M3.rotateInv(wb, s.quat, s.angVel)
    M3.addScaled(s.angMom, s.angMom, tTot, dt)
    M3.rotateInv(Lb, s.quat, s.angMom)
    Lb.x -= M3.clamp(ROT_DRAG.x * wb.x * abs(wb.x) * dt, -abs(Lb.x), abs(Lb.x))
    Lb.y -= M3.clamp(ROT_DRAG.y * wb.y * abs(wb.y) * dt, -abs(Lb.y), abs(Lb.y))
    Lb.z -= M3.clamp(ROT_DRAG.z * wb.z * abs(wb.z) * dt, -abs(Lb.z), abs(Lb.z))
    let ad = grounded != 0 && !s.hullContact ? 0.997 : 0.9996
    Lb.x *= ad; Lb.y *= ad; Lb.z *= ad
    M3.rotate(s.angMom, s.quat, Lb)
    M3.set(wb, Lb.x / Ix, Lb.y / Iy, Lb.z / Iz)
    M3.rotate(s.angVel, s.quat, wb)

    // The engine's tick
    let rb = w.carRb
    if abs(m - s.engineMass) > 1 {
        s.engineMass = m
        engineTrace?(s.tick, "mass", [Float(m)])
        cg_body_set_additional_mass_properties(w.rw, rb, Float(m), 0, 0, 0, Float(SPEC.inertiaPitch), Float(SPEC.inertiaYaw), Float(SPEC.inertiaRoll), 0, 0, 0, 1, false)
    }
    if let tr = engineTrace {
        if !s.engineHeld { tr(s.tick, "setTranslation", [Float(s.pos.x - w.ox), Float(s.pos.y - w.oy), Float(s.pos.z - w.oz)]); tr(s.tick, "setRotation", [Float(s.quat.x), Float(s.quat.y), Float(s.quat.z), Float(s.quat.w)]) }
        tr(s.tick, "setLinvel", [Float(s.vel.x), Float(s.vel.y), Float(s.vel.z)]); tr(s.tick, "setAngvel", [Float(s.angVel.x), Float(s.angVel.y), Float(s.angVel.z)])
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
    if let tr = engineTrace {
        var o = [Float](repeating: 0, count: 13), t4 = [Float](repeating: 0, count: 4)
        cg_body_translation(w.rw, rb, &t4); o[0] = t4[0]; o[1] = t4[1]; o[2] = t4[2]
        cg_body_rotation(w.rw, rb, &t4); o[3] = t4[0]; o[4] = t4[1]; o[5] = t4[2]; o[6] = t4[3]
        cg_body_linvel(w.rw, rb, &t4); o[7] = t4[0]; o[8] = t4[1]; o[9] = t4[2]
        cg_body_angvel(w.rw, rb, &t4); o[10] = t4[0]; o[11] = t4[1]; o[12] = t4[2]
        tr(s.tick + 1, "out", o)
    }
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
let FLOOR_PROBES_LIST: [Int] = FLOOR_PROBES
let HULL_R: Double = { var r = 0.0; var i = 0; while i < HULL_SHAPE.count { let x = Double(HULL_SHAPE[i]), y = Double(HULL_SHAPE[i + 1]), z = Double(HULL_SHAPE[i + 2]); r = jsMax(r, jsSqrt(x * x + y * y + z * z)); i += 3 }; return r }()
func curlReach(_ s: Vehicle) -> Double {
    let q = s.quat, cy = s.pos.y - WALL.r1, cz = s.pos.z
    var far = 0.0
    var i = 0
    while i < HULL_SHAPE.count {
        let x = Double(HULL_SHAPE[i]), y = Double(HULL_SHAPE[i + 1]), z = Double(HULL_SHAPE[i + 2])
        let tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x)
        let py = cy + y + q.w * ty + (q.z * tx - q.x * tz), pz = cz + z + q.w * tz + (q.x * ty - q.y * tx)
        let d = py * py + pz * pz
        if d > far { far = d }
        i += 3
    }
    return jsSqrt(far)
}
#endif
