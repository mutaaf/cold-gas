// src/sim/courses.js, the parts the scored sim reads: the Wall's profile, the Lineup and the Show, the parked
// vehicles' physics, the stage's fixtures, the materials, roofUnder. (`surface()` is for the renderer and the HUD;
// it comes with them.) Same arithmetic, same order.

let D2R = DMath.PI / 180
// The Wall
let R1 = 13.5, TURN = 170 * D2R, LEDGE = 5.5
let A_END = -DMath.PI / 2 + TURN
let P_END_Z = R1 * DMath.dcos(A_END), P_END_Y = R1 + R1 * DMath.dsin(A_END)
let T_LEDGE_Z = -DMath.dsin(A_END), T_LEDGE_Y = DMath.dcos(A_END)
let N_LEDGE_Z = -DMath.dcos(A_END), N_LEDGE_Y = -DMath.dsin(A_END)
let ARC_LEN = R1 * TURN

public enum WALL {
    public static let r1 = R1, turn = TURN, ledge = LEDGE, arcLength = ARC_LEN
    public static let width = 3.7, slab = 0.9
    public static let lipZ = P_END_Z + T_LEDGE_Z * LEDGE, lipY = P_END_Y + T_LEDGE_Y * LEDGE
    public static let length = ARC_LEN + LEDGE
    public static var topHeight: Double { lipY }
}

public final class Profile { public var z = 0.0, y = 0.0, nz = 0.0, ny = 0.0, tz = 0.0, ty = 0.0; public init() {} }
/// Point, normal (toward free space) and tangent (up the curl) at arc length s along the profile.
@discardableResult public func wallProfile(_ s: Double, _ out: Profile) -> Profile {
    if s <= ARC_LEN {
        let th = -DMath.PI / 2 + s / R1, c = DMath.dcos(th), sn = DMath.dsin(th)
        out.z = R1 * c; out.y = R1 + R1 * sn
        out.nz = -c; out.ny = -sn
        out.tz = -sn; out.ty = c
    } else {
        let u = jsMin(LEDGE, s - ARC_LEN)
        out.z = P_END_Z + T_LEDGE_Z * u; out.y = P_END_Y + T_LEDGE_Y * u
        out.nz = N_LEDGE_Z; out.ny = N_LEDGE_Y
        out.tz = T_LEDGE_Z; out.ty = T_LEDGE_Y
    }
    return out
}
/// Arc length along the profile of the nearest point to (z, y), clamped to [0, length].
public func wallArcLength(_ z: Double, _ y: Double) -> Double {
    if y < R1 && z < 0.5 { return 0 }
    let th = DMath.datan2(y - R1, z)
    let onArc = th >= -DMath.PI / 2 && th <= A_END
    let u = (z - P_END_Z) * T_LEDGE_Z + (y - P_END_Y) * T_LEDGE_Y
    if u > 0 && (!onArc || th > A_END - 0.35) { return jsMin(WALL.length, ARC_LEN + u) }
    return jsMax(0, jsMin(ARC_LEN, R1 * (th + DMath.PI / 2)))
}

// The Lineup and the parked vehicles
public enum RAMP { public static let z0 = -12.0, z1 = 0.0, height = 1.2, halfWidth = 3.2 }

public struct Axle: Sendable { public let at, track, r, w: Double; public let dual: Bool; public let rimR: Double? }
public struct VehicleSpec: Sendable {
    public let id, name: String
    public let w, l, h, wMirrors, clearance, wheelbase, tyreR, tyreW, rimR: Double
    public let axles: [Axle]
    public let mass, cgHeight, cgAt: Double
    public let inertiaRoll, inertiaPitch, inertiaYaw: Double
}
public let LINEUP_SPEC: [VehicleSpec] = [
    VehicleSpec(id: "sedan", name: "Sedan", w: 1.85, l: 4.72, h: 1.44, wMirrors: 2.089, clearance: 0.138, wheelbase: 2.875, tyreR: 0.335, tyreW: 0.235, rimR: 0.229,
                axles: [Axle(at: 1.492, track: 1.584, r: 0.335, w: 0.235, dual: false, rimR: nil), Axle(at: -1.383, track: 1.584, r: 0.335, w: 0.235, dual: false, rimR: nil)],
                mass: 1705, cgHeight: 0.46, cgAt: -0.032, inertiaRoll: 620, inertiaPitch: 2770, inertiaYaw: 2920),
    VehicleSpec(id: "suv", name: "Crossover", w: 1.92, l: 4.79, h: 1.624, wMirrors: 2.129, clearance: 0.167, wheelbase: 2.89, tyreR: 0.356, tyreW: 0.255, rimR: 0.241,
                axles: [Axle(at: 1.502, track: 1.636, r: 0.356, w: 0.255, dual: false, rimR: nil), Axle(at: -1.388, track: 1.636, r: 0.356, w: 0.255, dual: false, rimR: nil)],
                mass: 1842, cgHeight: 0.53, cgAt: -0.03, inertiaRoll: 780, inertiaPitch: 3140, inertiaYaw: 3270),
    VehicleSpec(id: "semi", name: "Semi", w: 2.59, l: 6.32, h: 4.11, wMirrors: 2.95, clearance: 0.26, wheelbase: 3.96, tyreR: 0.507, tyreW: 0.295, rimR: 0.286,
                axles: [Axle(at: 1.91, track: 2.05, r: 0.507, w: 0.295, dual: false, rimR: nil), Axle(at: -1.39, track: 1.86, r: 0.507, w: 0.295, dual: true, rimR: nil),
                        Axle(at: -2.71, track: 1.86, r: 0.507, w: 0.295, dual: true, rimR: nil)],
                mass: 10433, cgHeight: 1.1, cgAt: -0.268, inertiaRoll: 14360, inertiaPitch: 34590, inertiaYaw: 28390),
    VehicleSpec(id: "pickup", name: "Pickup", w: 2.032, l: 5.683, h: 1.794, wMirrors: 2.413, clearance: 0.257, wheelbase: 3.635, tyreR: 0.439, tyreW: 0.285, rimR: 0.254,
                axles: [Axle(at: 1.964, track: 1.772, r: 0.439, w: 0.285, dual: false, rimR: nil), Axle(at: -1.672, track: 1.772, r: 0.439, w: 0.285, dual: false, rimR: nil)],
                mass: 3009, cgHeight: 0.8, cgAt: 0.128, inertiaRoll: 1470, inertiaPitch: 7120, inertiaYaw: 7310),
    VehicleSpec(id: "cab", name: "Cab", w: 1.753, l: 4.445, h: 1.407, wMirrors: 1.753, clearance: 0.145, wheelbase: 2.7, tyreR: 0.358, tyreW: 0.215, rimR: 0.229,
                axles: [Axle(at: 1.423, track: 1.53, r: 0.358, w: 0.215, dual: false, rimR: nil), Axle(at: -1.277, track: 1.53, r: 0.402, w: 0.225, dual: false, rimR: 0.267)],
                mass: 1412, cgHeight: 0.48, cgAt: 0.127, inertiaRoll: 480, inertiaPitch: 2050, inertiaYaw: 2150),
]
/// A parked vehicle where a course puts it (`{ ...v, minX…cz }` in the JS).
public struct ParkedBox: Sendable {
    public let spec: VehicleSpec
    public let minX, maxX, minY, maxY, minZ, maxZ, cz: Double
}
let GAP = 0.62, LINEUP_Z0 = 7.0
public let LINEUP_BOXES: [ParkedBox] = {
    var z = LINEUP_Z0
    return LINEUP_SPEC.map { v in
        let b = ParkedBox(spec: v, minX: -v.l / 2, maxX: v.l / 2, minY: 0, maxY: v.h, minZ: z, maxZ: z + v.w, cz: z + v.w / 2)
        z += v.w + GAP
        return b
    }
}()
let SHOW_ROW_NEAR = -10.0
public let SHOW_BOXES: [ParkedBox] = {
    var z = SHOW_ROW_NEAR
    return LINEUP_SPEC.map { v in
        let b = ParkedBox(spec: v, minX: -v.l / 2, maxX: v.l / 2, minY: 0, maxY: v.h, minZ: z - v.w, maxZ: z, cz: z - v.w / 2)
        z -= v.w + GAP
        return b
    }
}()

public struct Pad: Sendable { public let z, x: Double; public let rings: [Double] }
public final class Course: @unchecked Sendable {
    public let id, name: String
    public let startZ, startX: Double
    public let pad: Pad?
    public let boxes: [ParkedBox]
    public let ramp: Bool
    public let runoutMin, runoutMax: Double
    // The Lineup's and the Show's own numbers (NaN where a course hasn't got one).
    public let liftOffZ, lineupZ0, lineupEnd, rowNear, rowFar, tallest: Double
    init(id: String, name: String, startZ: Double, startX: Double, pad: Pad?, boxes: [ParkedBox], ramp: Bool, runout: (Double, Double),
         liftOffZ: Double = .nan, lineupZ0: Double = .nan, lineupEnd: Double = .nan, rowNear: Double = .nan, rowFar: Double = .nan, tallest: Double = .nan) {
        self.id = id; self.name = name; self.startZ = startZ; self.startX = startX; self.pad = pad; self.boxes = boxes; self.ramp = ramp
        runoutMin = runout.0; runoutMax = runout.1
        self.liftOffZ = liftOffZ; self.lineupZ0 = lineupZ0; self.lineupEnd = lineupEnd; self.rowNear = rowNear; self.rowFar = rowFar; self.tallest = tallest
    }
}
public let WALL_COURSE = Course(id: "wall", name: "The Wall", startZ: -6, startX: 0, pad: Pad(z: -9, x: 0, rings: [2, 4, 7]), boxes: [], ramp: false, runout: (-260, 40))
public let LINEUP = Course(id: "lineup", name: "The Lineup", startZ: -70, startX: 0, pad: Pad(z: 28, x: 0, rings: [2, 4, 7]), boxes: LINEUP_BOXES, ramp: false,
                           runout: (-120, 190), liftOffZ: 0, lineupZ0: LINEUP_Z0, lineupEnd: LINEUP_BOXES[LINEUP_BOXES.count - 1].maxZ,
                           tallest: LINEUP_BOXES.map { $0.spec.h }.reduce(-.infinity, jsMax))
public let SHOW = Course(id: "show", name: "The Show", startZ: -6, startX: 0, pad: Pad(z: -30, x: 0, rings: [2, 4, 7]), boxes: SHOW_BOXES, ramp: false,
                         runout: (-140, 40), rowNear: SHOW_ROW_NEAR, rowFar: SHOW_BOXES[SHOW_BOXES.count - 1].minZ,
                         tallest: SHOW_BOXES.map { $0.spec.h }.reduce(-.infinity, jsMax))
public let COURSES: [String: Course] = ["show": SHOW, "wall": WALL_COURSE, "lineup": LINEUP]
public let DEFAULT_COURSE = "show"

// The stage's fixtures
public struct Fixture: Sendable { public let box: Bool; public let x, y, z, hx, hy, hz, hh, r: Double }
public func fixturesOf(_ courseId: String) -> [Fixture] {
    var out: [Fixture] = []
    if courseId == "wall" || courseId == "show" {
        let w = 0.8, h = 0.3, d = 0.5
        for (x, z) in [(-2.4, -5.7), (2.4, -5.7)] { out.append(Fixture(box: true, x: x, y: h / 2, z: z, hx: w / 2, hy: h / 2, hz: d / 2, hh: .nan, r: .nan)) }
        let at: [(Double, Double)] = [(-9, 15), (-13, 20), (-18, 25), (-24, 18), (9, 15), (13, 20), (18, 25), (24, 18)]
        for (x, z) in at { out.append(Fixture(box: false, x: x, y: 0.3, z: z, hx: .nan, hy: .nan, hz: .nan, hh: 0.5 / 2, r: 0.65)) }
    } else if courseId == "lineup" {
        let px = 13.0, z0 = LINEUP.startZ + 10, z1 = 80.0, step = 24.0, h = 9.0, r0 = 0.09, r1 = 0.06
        var z = z0
        while z < z1 { for sx in [-1.0, 1.0] { out.append(Fixture(box: false, x: sx * px, y: h / 2, z: z, hx: .nan, hy: .nan, hz: .nan, hh: h / 2, r: (r0 + r1) / 2)) }; z += step }
    }
    return out
}

// Materials
public struct Material: Sendable, Equatable { public let id: String; public let grip, slide, bounce: Double; public let loose: Bool; public let roll: Double }
public enum MATERIALS {
    public static let concrete = Material(id: "concrete", grip: 1, slide: 0.5, bounce: 0.1, loose: false, roll: 0)
    public static let deck = Material(id: "deck", grip: 1, slide: 0.5, bounce: 0.1, loose: false, roll: 0)
    public static let pad = Material(id: "pad", grip: 0.85, slide: 0.45, bounce: 0.1, loose: false, roll: 0)
    public static let paint = Material(id: "paint", grip: 0.55, slide: 0.35, bounce: 0.15, loose: false, roll: 0)
    public static let steel = Material(id: "steel", grip: 0.6, slide: 0.4, bounce: 0.2, loose: false, roll: 0)
    public static let body = Material(id: "body", grip: 0.55, slide: 0.5, bounce: 0.12, loose: false, roll: 0)
}

// The parked vehicles as physical objects
public let PARK_MU = 0.8
let G0 = 9.81
public struct Corner: Sendable { public let x, z, r, load: Double }
public struct ParkedPhysics: Sendable {
    public let mass, wheelbase, track, wheelR, cgx: Double
    public let corners: [Corner]
    public let cgh, clearance, rideHz, damping: Double
    public let roll, yaw, pitch: Double
}
public func parkedPhysics(_ v: VehicleSpec) -> ParkedPhysics {
    let mass = v.mass, cgx = v.cgAt
    let axles = v.axles
    let front = axles[0], rear = Array(axles.dropFirst())
    let rearAt = rear.reduce(0) { $0 + $1.at } / Double(rear.count)
    let span = front.at - rearAt, frontShare = span > 0 ? (cgx - rearAt) / span : 0.5
    var corners: [Corner] = []
    for (i, ax) in axles.enumerated() {
        let share = i == 0 ? frontShare : (1 - frontShare) / Double(rear.count)
        for side in [1.0, -1.0] { corners.append(Corner(x: ax.at, z: (side * ax.track) / 2, r: ax.r, load: (mass * G0 * share) / 2)) }
    }
    let truck = v.h > 3
    return ParkedPhysics(mass: mass, wheelbase: v.wheelbase, track: v.w - 0.28, wheelR: v.tyreR, cgx: cgx, corners: corners,
                         cgh: v.cgHeight, clearance: v.clearance, rideHz: truck ? 1.8 : 1.3, damping: 0.3,
                         roll: v.inertiaRoll, yaw: v.inertiaYaw, pitch: v.inertiaPitch)
}

/// A parked vehicle's state as everything outside the engine sees it (parkedMirror), plus the engine's handles and the
/// suspension world.js adds (addParked).
public final class ParkedBody {
    public let id: String, spec: ParkedBox, phys: ParkedPhysics, mass: Double, mat: Material
    public let hx, hz, h, clr: Double
    public var cx: Double, cy = 0.0, cz: Double
    public var qx = 0.0, qy = 0.0, qz = 0.0, qw = 1.0, yaw = 0.0
    public var vx = 0.0, vy = 0.0, vz = 0.0, wx = 0.0, wy = 0.0, wz = 0.0
    public var pvx = 0.0, pvy = 0.0, pvz = 0.0, pwx = 0.0, pwy = 0.0, pwz = 0.0
    public var moved = false, asleep = true
    public var rb: UInt64 = UInt64.max, collider: UInt64 = UInt64.max
    public var index = 0
    public var susp = ParkedSusp(mount: 0, rest: 0, travel: 0, mu: 0)
    public var wheels: [ParkedWheel] = []
    public init(_ b: ParkedBox) {
        let ph = parkedPhysics(b.spec)
        id = b.spec.id; spec = b; phys = ph; mass = ph.mass; mat = MATERIALS.paint
        hx = (b.maxX - b.minX) / 2; hz = (b.maxZ - b.minZ) / 2; h = b.maxY; clr = ph.clearance
        cx = (b.minX + b.maxX) / 2; cz = (b.minZ + b.maxZ) / 2
    }
}
public struct ParkedSusp { public var mount, rest, travel, mu: Double
    public init(mount: Double, rest: Double, travel: Double, mu: Double) { self.mount = mount; self.rest = rest; self.travel = travel; self.mu = mu } }
public final class ParkedWheel {
    public let x, y, z, R, mc, k, c, bump: Double
    public var comp: Double, contact = true, load: Double
    public init(x: Double, y: Double, z: Double, R: Double, mc: Double, k: Double, c: Double, bump: Double, comp: Double, load: Double) {
        self.x = x; self.y = y; self.z = z; self.R = R; self.mc = mc; self.k = k; self.c = c; self.bump = bump; self.comp = comp; self.load = load
    }
}

/// refreshBounds: the parked row's bounding box (by each body's bounding sphere).
public final class Bounds { public var minX = 0.0, maxX = 0.0, minZ = 0.0, maxZ = 0.0, maxY = 0.0; public init() {} }
public func refreshBounds(_ w: Bounds, _ bodies: [ParkedBody]) {
    w.minX = .infinity; w.maxX = -.infinity; w.minZ = .infinity; w.maxZ = -.infinity; w.maxY = -.infinity
    for b in bodies {
        let r = jsSqrt(b.hx * b.hx + b.hz * b.hz + b.h * b.h)
        w.minX = jsMin(w.minX, b.cx - r); w.maxX = jsMax(w.maxX, b.cx + r)
        w.minZ = jsMin(w.minZ, b.cz - r); w.maxZ = jsMax(w.maxZ, b.cz + r); w.maxY = jsMax(w.maxY, b.cy + r)
    }
}

// World point → body frame (by the conjugate of the body's rotation).
@inline(__always) func toLocal(_ b: ParkedBody, _ x: Double, _ y: Double, _ z: Double) -> (Double, Double, Double) {
    let vx = x - b.cx, vy = y - b.cy, vz = z - b.cz
    let qx = -b.qx, qy = -b.qy, qz = -b.qz, qw = b.qw
    let tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx)
    return (vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx))
}
@inline(__always) func slabClip(_ o0: Double, _ d0: Double, _ lo: Double, _ hi: Double, _ t0: inout Double, _ t1: inout Double) -> Bool {
    if d0 > -1e-12 && d0 < 1e-12 { return o0 >= lo && o0 <= hi }
    var a = (lo - o0) / d0, c = (hi - o0) / d0
    if a > c { let s = a; a = c; c = s }
    if a > t0 { t0 = a }
    if c < t1 { t1 = c }
    return t0 <= t1
}
/// Height of the tallest roof under (x, z), or −∞ (clearance telemetry).
public func roofUnder(_ bodies: [ParkedBody], _ x: Double, _ z: Double) -> Double {
    var top = -Double.infinity
    for b in bodies {
        let dx = x - b.cx, dz = z - b.cz
        if dx * dx + dz * dz > b.hx * b.hx + b.hz * b.hz + b.h * b.h { continue }
        let (ox, oy, oz) = toLocal(b, x, b.cy + 100, z)
        let (dx2, dy2, dz2) = toLocal(b, b.cx, b.cy - 1, b.cz)
        var t0 = -Double.infinity, t1 = Double.infinity
        // (a free function with inouts, not a nested one capturing t0/t1: a capture boxes them on the heap every call)
        if !slabClip(ox, dx2, -b.hx, b.hx, &t0, &t1) || !slabClip(oy, dy2, b.clr, b.h, &t0, &t1) || !slabClip(oz, dz2, -b.hz, b.hz, &t0, &t1) { continue }
        let y = b.cy + 100 - t0
        if t0 >= 0 && y > top { top = y }
    }
    return top
}
public let PAD_R = 7.8
