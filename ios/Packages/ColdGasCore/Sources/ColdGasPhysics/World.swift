// src/sim/world.js for the scored courses (the Show, the Wall, the Lineup), call for call: the same colliders created in
// the same order (the engine's handles follow creation order), the same f32 crossings into the engine. Free Drive's
// streaming, props and the Sandbox are v2. The launch complex (complex.js: its solids join the world when the car
// comes within 150 m of the pad) and the static fire's jet (rocket.js) are here.
#if canImport(CRapier)
import CRapier
import ColdGasCore

public let WORLD_DT = 1.0 / 240
let G_W = 9.81
public enum GROUP { public static let staticG: UInt32 = 1, parked: UInt32 = 2, car: UInt32 = 4, approx: UInt32 = 8, curl: UInt32 = 16 }
@inline(__always) func groupsOf(_ member: UInt32, _ filter: UInt32 = 0xffff) -> UInt32 { (member << 16) | filter }
let RAY_ALL = groupsOf(0xffff, 0xffff)
let FIX_INTERNAL_EDGES: UInt32 = 0x90   // TS TriMeshFlags.FIX_INTERNAL_EDGES = 0x80 | MERGE_DUPLICATE_VERTICES

public struct SimUnsupported: Error, CustomStringConvertible { public let description: String }

final class ColInfo { let mat: Material; let body: ParkedBody?; var car = false; let approx: Bool; var pad: Pad?
    init(mat: Material, body: ParkedBody?, approx: Bool) { self.mat = mat; self.body = body; self.approx = approx } }
final class Solid { let b: (Double, Double, Double, Double, Double, Double); init(_ b: (Double, Double, Double, Double, Double, Double)) { self.b = b } }
public final class Hit { public var t = 0.0, nx = 0.0, ny = 1.0, nz = 0.0; public var mat = MATERIALS.concrete; public var body: ParkedBody?; public var car = false }
final class FixtureSlot { let f: Fixture; var col: UInt64 = CG_NONE; let box: Solid; let reach: Double
    init(f: Fixture, box: Solid, reach: Double) { self.f = f; self.box = box; self.reach = reach } }

public final class World {
    public let course: Course
    let rw: OpaquePointer
    var info: [UInt64: ColInfo] = [:]
    public var bodies: [ParkedBody] = []
    let ox = 0.0, oy = 0.0, oz = 0.0
    public var carRb: UInt64 = CG_NONE, carCol: UInt64 = CG_NONE
    public let carF = V3(), carT = V3()
    public var carPos: V3?, carVel: V3?, carQuat: Q4?
    public let bounds = Bounds()
    var solids: [Solid] = []
    var curl = false, curlOn = true
    public var tick = 0
    var fixtures: [FixtureSlot] = []
    var siteAt: Site?
    var siteCols: [UInt64] = []
    var siteSolid: Solid?
    var sitePush = 0.0
    public let hit = Hit()
    public var carTouching = 0
    var freed = false
    // Event scratch (no allocation per tick).
    var evA = [UInt64](repeating: 0, count: 64), evB = [UInt64](repeating: 0, count: 64), evS = [Bool](repeating: false, count: 64)

    init(_ course: Course) {
        self.course = course
        rw = cg_world_new(0, Float(-G_W), 0)
        cg_world_set_timestep(rw, Float(WORLD_DT))
    }
    deinit { if !freed { cg_world_free(rw) } }
    public func free() { if !freed { freed = true; cg_world_free(rw) } }
}

// --- Building --------------------------------------------------------------------------------------------
enum ShapeDesc { case cuboid(Double, Double, Double), cylinder(Double, Double), ball(Double), trimesh([Float], [UInt32]), hull([Float]) }
struct DescOpts { var t = (0.0, 0.0, 0.0); var q = (0.0, 0.0, 0.0, 1.0); var density: Double? = nil; var activeEvents: UInt32 = 0 }
@discardableResult
func colliderFor(_ w: World, _ shape: ShapeDesc, _ o: DescOpts, _ mat: Material, _ member: UInt32, body: ParkedBody? = nil, extra: UInt64? = nil) -> UInt64 {
    let sh: OpaquePointer? = {
        switch shape {
        case .cuboid(let x, let y, let z): return cg_shape_cuboid(Float(x), Float(y), Float(z))
        case .cylinder(let hh, let r): return cg_shape_cylinder(Float(hh), Float(r))
        case .ball(let r): return cg_shape_ball(Float(r))
        case .trimesh(let v, let i): return v.withUnsafeBufferPointer { vp in i.withUnsafeBufferPointer { ip in cg_shape_trimesh(vp.baseAddress, vp.count / 3, ip.baseAddress, ip.count, FIX_INTERNAL_EDGES) } }
        case .hull(let p): return p.withUnsafeBufferPointer { cg_shape_convex_hull($0.baseAddress, $0.count / 3) }
        }
    }()
    guard let sh else { return CG_NONE }
    defer { cg_shape_free(sh) }
    var d = cg_collider_desc_default()
    d.translation = (Float(o.t.0), Float(o.t.1), Float(o.t.2))
    d.rotation = (Float(o.q.0), Float(o.q.1), Float(o.q.2), Float(o.q.3))
    if let den = o.density { d.density = Float(den) }
    d.active_events = o.activeEvents
    d.friction = Float(mat.slide); d.restitution = Float(mat.bounce)
    d.friction_combine_rule = 1   // CoefficientCombineRule.Min
    d.collision_groups = groupsOf(member)
    let parent = body?.rb ?? extra ?? CG_NONE
    let col = cg_collider_create(w.rw, sh, &d, parent)
    w.info[col] = ColInfo(mat: mat, body: body, approx: member == GROUP.approx)
    return col
}

/// The Wall's deck as a closed slab, sampled every 20 cm along wallProfile (world.js wallMesh).
func wallMesh() -> (v: [Float], idx: [UInt32]) {
    let L = WALL.length, W = WALL.width / 2, T = WALL.slab
    var ss: [Double] = []
    var s = 0.0
    while s < WALL.arcLength { ss.append(s); s += 0.2 }
    var u = 0.0
    while u < WALL.ledge { ss.append(WALL.arcLength + u); u += 0.5 }
    ss.append(L)
    let n = ss.count
    var v = [Float](repeating: 0, count: n * 4 * 3)
    var mid: [(Double, Double, Double)] = []
    let p = Profile()
    for i in 0..<n {
        wallProfile(ss[i], p)
        let k = i * 12
        let vals = [-W, p.y, p.z, W, p.y, p.z, -W, p.y - p.ny * T, p.z - p.nz * T, W, p.y - p.ny * T, p.z - p.nz * T]
        for (j, x) in vals.enumerated() { v[k + j] = Float(x) }
        mid.append((0, p.y - p.ny * T / 2, p.z - p.nz * T / 2))
    }
    var idx: [UInt32] = []
    func tri(_ a: Int, _ b: Int, _ c: Int, _ inside: (Double, Double, Double)) {
        let ax = Double(v[a * 3]), ay = Double(v[a * 3 + 1]), az = Double(v[a * 3 + 2])
        let ux = Double(v[b * 3]) - ax, uy = Double(v[b * 3 + 1]) - ay, uz = Double(v[b * 3 + 2]) - az
        let wx = Double(v[c * 3]) - ax, wy = Double(v[c * 3 + 1]) - ay, wz = Double(v[c * 3 + 2]) - az
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
        let cx = (ax + Double(v[b * 3]) + Double(v[c * 3])) / 3 - inside.0, cy = (ay + Double(v[b * 3 + 1]) + Double(v[c * 3 + 1])) / 3 - inside.1
        let cz = (az + Double(v[b * 3 + 2]) + Double(v[c * 3 + 2])) / 3 - inside.2
        if nx * cx + ny * cy + nz * cz >= 0 { idx += [UInt32(a), UInt32(b), UInt32(c)] } else { idx += [UInt32(a), UInt32(c), UInt32(b)] }
    }
    func quad(_ a: Int, _ b: Int, _ c: Int, _ d: Int, _ inside: (Double, Double, Double)) { tri(a, b, c, inside); tri(b, d, c, inside) }
    for i in 0..<(n - 1) {
        let a = i * 4, b = (i + 1) * 4
        let m = ((mid[i].0 + mid[i + 1].0) / 2, (mid[i].1 + mid[i + 1].1) / 2, (mid[i].2 + mid[i + 1].2) / 2)
        quad(a, a + 1, b, b + 1, m)
        quad(a + 2, a + 3, b + 2, b + 3, m)
        quad(a, a + 2, b, b + 2, m)
        quad(a + 1, a + 3, b + 1, b + 3, m)
    }
    let e = (n - 1) * 4
    quad(0, 1, 2, 3, (mid[0].0, mid[0].1, mid[0].2 + 0.05))
    wallProfile(L, p)
    quad(e, e + 1, e + 2, e + 3, (0, mid[n - 1].1 - p.ty * 0.05, mid[n - 1].2 - p.tz * 0.05))
    return (v, idx)
}
let WALL_MESH = wallMesh()
func meshBox(_ v: [Float]) -> (Double, Double, Double, Double, Double, Double) {
    var b = [Double.infinity, .infinity, .infinity, -.infinity, -.infinity, -.infinity]
    var i = 0
    while i < v.count { for k in 0..<3 { b[k] = jsMin(b[k], Double(v[i + k])); b[k + 3] = jsMax(b[k + 3], Double(v[i + k])) }; i += 3 }
    return (b[0], b[1], b[2], b[3], b[4], b[5])
}

func wallSteel(_ w: World) {
    let T = WALL.slab, zA = WALL.r1 + T + 0.35, zB = zA + 3.0, top = WALL.lipY + T + 1.6
    for x in [-1.7, 1.7] { for z in [zA, zB] {
        colliderFor(w, .cuboid(0.15, top / 2, 0.15), DescOpts(t: (x, top / 2, z)), MATERIALS.steel, GROUP.staticG)
        w.solids.append(Solid((x - 0.15, 0, z - 0.15, x + 0.15, top, z + 0.15)))
    } }
    var z = 6.2
    while z <= WALL.r1 + 0.3 {
        let y = WALL.r1 - jsSqrt(jsMax(0, (WALL.r1 + T) * (WALL.r1 + T) - z * z))
        if !(y < 0.35) {
            for x in [-1.9, 1.9] {
                colliderFor(w, .cuboid(0.09, y / 2, 0.09), DescOpts(t: (x, y / 2, z)), MATERIALS.steel, GROUP.staticG)
                w.solids.append(Solid((x - 0.09, 0, z - 0.09, x + 0.09, y, z + 0.09)))
            }
        }
        z += 1.45
    }
}

func addParked(_ w: World, _ b: ParkedBox, _ index: Int) -> ParkedBody {
    let m = ParkedBody(b), ph = m.phys
    m.index = index
    var bd = cg_body_desc_default(0)
    bd.translation = (Float(m.cx - w.ox), Float(0 - w.oy), Float(m.cz - w.oz))
    bd.sleeping = true
    let rb = cg_body_create(w.rw, &bd)
    let mass = Float(ph.mass), cgx = Float(ph.cgx), cgh = Float(ph.cgh)
    let iRoll = Float(ph.roll), iYaw = Float(ph.yaw), iPitch = Float(ph.pitch)
    cg_body_set_additional_mass_properties(w.rw, rb, mass, cgx, cgh, 0, iRoll, iYaw, iPitch, 0, 0, 0, 1, false)
    m.rb = rb
    let hy = (m.h - m.clr) / 2
    m.collider = colliderFor(w, .cuboid(m.hx, hy, m.hz), DescOpts(t: (0, m.clr + hy, 0), density: 0), m.mat, GROUP.parked, body: m)
    let om = 2 * 3.141592653589793 * ph.rideHz
    let MOUNT = 0.25
    let sag = G_W / (om * om)
    m.susp = ParkedSusp(mount: MOUNT, rest: MOUNT + sag, travel: jsMin(0.12, 0.6 * ph.clearance), mu: PARK_MU)
    m.wheels = ph.corners.map { cn in
        let mc = cn.load / G_W, k = mc * om * om
        return ParkedWheel(x: cn.x, y: cn.r + MOUNT, z: cn.z, R: cn.r, mc: mc, k: k, c: 2 * ph.damping * jsSqrt(k * mc), bump: 20 * k, comp: sag, load: cn.load)
    }
    return m
}

let FIX_REACH = 3.0, FIX_DROP = 2.0

public func createWorld(_ course: Course) -> World {
    let w = World(course)
    let floor = colliderFor(w, .cuboid(1500, 1, 1500), DescOpts(t: (0, -1, 0)), MATERIALS.concrete, GROUP.staticG)
    if let pad = course.pad { w.info[floor]?.pad = pad }
    if course.id == "wall" || course.id == "show" {
        colliderFor(w, .trimesh(WALL_MESH.v, WALL_MESH.idx), DescOpts(), MATERIALS.deck, GROUP.curl)
        w.solids = [Solid(meshBox(WALL_MESH.v))]
        w.curl = true
        wallSteel(w)
    }
    // (no course in this port has a kicker: the Lineup's reveal used none)
    w.fixtures = fixturesOf(course.id).map { f in
        let hx = f.box ? f.hx : f.r, hz = f.box ? f.hz : f.r, hy = f.box ? f.hy : f.hh
        return FixtureSlot(f: f, box: Solid((f.x - hx, f.y - hy, f.z - hz, f.x + hx, f.y + hy, f.z + hz)), reach: jsSqrt(hx * hx + hy * hy + hz * hz) + FIX_REACH)
    }
    w.siteAt = siteOf(course.id)
    for (i, b) in course.boxes.enumerated() { w.bodies.append(addParked(w, b, i)) }
    refreshBounds(w.bounds, w.bodies)
    cg_world_set_timestep(w.rw, 0); cg_world_step(w.rw); cg_world_set_timestep(w.rw, Float(WORLD_DT))
    return w
}

/// The roadster's rigid hull (attachCar).
@discardableResult
public func attachCar(_ w: World, _ hullPoints: [Float], _ mass: Double, _ ix: Double, _ iy: Double, _ iz: Double) -> UInt64 {
    var bd = cg_body_desc_default(0)
    bd.gravity_scale = 0; bd.can_sleep = false; bd.ccd_enabled = false
    let rb = cg_body_create(w.rw, &bd)
    cg_body_set_additional_mass_properties(w.rw, rb, Float(mass), 0, 0, 0, Float(ix), Float(iy), Float(iz), 0, 0, 0, 1, false)
    let col = colliderFor(w, .hull(hullPoints), DescOpts(density: 0, activeEvents: 1), MATERIALS.body, GROUP.car, extra: rb)
    w.info[col]?.car = true
    w.carRb = rb; w.carCol = col
    return rb
}

let CURL_MARGIN = 0.02
public func gateCurl(_ w: World, _ far: Double, _ travel: Double) {
    if !w.curl || w.carCol == CG_NONE { return }
    let on = WALL.r1 - far <= CURL_MARGIN + travel
    if on == w.curlOn { return }
    w.curlOn = on
    cg_collider_set_collision_groups(w.rw, w.carCol, groupsOf(GROUP.car, on ? 0xffff : 0xffff & ~GROUP.curl))
}

// --- Queries -------------------------------------------------------------------------------------------
var rayHit = CgRayHit()
/// Cast a ray (unit direction) up to maxT; the distance to the first solid or −1; `w.hit` holds the rest.
public func raycast(_ w: World, _ ox: Double, _ oy: Double, _ oz: Double, _ dx: Double, _ dy: Double, _ dz: Double, _ maxT: Double, _ excludeRb: UInt64) -> Double {
    let h = w.hit
    if excludeRb == w.carRb && clear(w, ox, oy, oz, dx, dy, dz, maxT) { h.t = -1; return -1 }
    var t = -1.0
    if cg_cast_ray_and_get_normal(w.rw, Float(ox - w.ox), Float(oy - w.oy), Float(oz - w.oz), Float(dx), Float(dy), Float(dz), Float(maxT), true,
                                  0, UInt64(RAY_ALL), CG_NONE, excludeRb, &rayHit) {
        t = Double(rayHit.toi)
        let info = w.info[rayHit.collider]
        var nx = Double(rayHit.normal.0), ny = Double(rayHit.normal.1), nz = Double(rayHit.normal.2)
        if nx * nx + ny * ny + nz * nz < 0.25 { nx = -dx; ny = -dy; nz = -dz }
        h.nx = nx; h.ny = ny; h.nz = nz
        if let info { h.mat = info.mat; h.body = info.body; h.car = info.car
            if let pad = info.pad {
                let ex = ox + dx * t - pad.x, ez = oz + dz * t - pad.z
                if ex * ex + ez * ez <= PAD_R * PAD_R { h.mat = MATERIALS.pad }
            }
        }
    }
    h.t = t
    return t
}
let RAY_MARGIN = 0.1
func clear(_ w: World, _ ox: Double, _ oy: Double, _ oz: Double, _ dx: Double, _ dy: Double, _ dz: Double, _ maxT: Double) -> Bool {
    let ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT
    let x0 = jsMin(ox, ex) - RAY_MARGIN, x1 = jsMax(ox, ex) + RAY_MARGIN
    let y0 = jsMin(oy, ey) - RAY_MARGIN, y1 = jsMax(oy, ey) + RAY_MARGIN
    let z0 = jsMin(oz, ez) - RAY_MARGIN, z1 = jsMax(oz, ez) + RAY_MARGIN
    if y0 <= 0 { return false }
    for s in w.solids { let b = s.b; if x0 <= b.3 && x1 >= b.0 && y0 <= b.4 && y1 >= b.1 && z0 <= b.5 && z1 >= b.2 { return false } }
    for b in w.bodies {
        let r = jsSqrt(b.hx * b.hx + b.hz * b.hz + b.h * b.h)
        if x0 <= b.cx + r && x1 >= b.cx - r && y0 <= b.cy + r && y1 >= b.cy - r && z0 <= b.cz + r && z1 >= b.cz - r { return false }
    }
    return true
}

// --- Stepping ------------------------------------------------------------------------------------------
@inline(__always) func rot(_ q: (Double, Double, Double, Double), _ x: Double, _ y: Double, _ z: Double) -> (Double, Double, Double) {
    let (qx, qy, qz, qw) = q
    let tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x)
    return (x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx))
}
var f3 = [Float](repeating: 0, count: 4)
@inline(__always) func readRot(_ w: World, _ rb: UInt64) -> (Double, Double, Double, Double) { cg_body_rotation(w.rw, rb, &f3); return (Double(f3[0]), Double(f3[1]), Double(f3[2]), Double(f3[3])) }
@inline(__always) func readT(_ w: World, _ rb: UInt64) -> (Double, Double, Double) { cg_body_translation(w.rw, rb, &f3); return (Double(f3[0]), Double(f3[1]), Double(f3[2])) }
@inline(__always) func velAt(_ w: World, _ rb: UInt64, _ p: (Double, Double, Double)) -> (Double, Double, Double) {
    cg_body_velocity_at_point(w.rw, rb, Float(p.0), Float(p.1), Float(p.2), &f3); return (Double(f3[0]), Double(f3[1]), Double(f3[2]))
}

public func preStep(_ w: World) throws {
    w.carF.x = 0; w.carF.y = 0; w.carF.z = 0; w.carT.x = 0; w.carT.y = 0; w.carT.z = 0
    for b in w.bodies { parkedForces(w, b) }
    fixtureTick(w)
    if w.siteAt != nil { try siteTick(w) }
}
func fixtureTick(_ w: World) {
    guard let p = w.carPos else { return }
    for x in w.fixtures {
        let f = x.f, dx = p.x - f.x, dy = p.y - f.y, dz = p.z - f.z, d2 = dx * dx + dy * dy + dz * dz
        if x.col == CG_NONE {
            if d2 >= x.reach * x.reach { continue }
            x.col = colliderFor(w, f.box ? .cuboid(f.hx, f.hy, f.hz) : .cylinder(f.hh, f.r), DescOpts(t: (f.x, f.y, f.z)), MATERIALS.steel, GROUP.staticG)
            w.solids.append(x.box)
        } else if d2 > (x.reach + FIX_DROP) * (x.reach + FIX_DROP) {
            w.info[x.col] = nil; cg_world_remove_collider(w.rw, x.col, false); x.col = CG_NONE
            if let k = w.solids.firstIndex(where: { $0 === x.box }) { w.solids.remove(at: k) }
        }
    }
}
func parkedForces(_ w: World, _ b: ParkedBody) {
    let dt = WORLD_DT
    let rb = b.rb
    if rb == CG_NONE || cg_body_is_sleeping(w.rw, rb) { return }
    let q = readRot(w, rb), p = readT(w, rb)
    let up = rot(q, 0, -1, 0)
    let S = b.susp
    for wh in b.wheels {
        let anc = rot(q, wh.x, wh.y, wh.z)
        let ax = p.0 + anc.0 + w.ox, ay = p.1 + anc.1 + w.oy, az = p.2 + anc.2 + w.oz
        let maxT = S.rest + wh.R, mc = wh.mc
        let t = raycast(w, ax, ay, az, up.0, up.1, up.2, maxT, rb)
        let prev = wh.comp
        if t < 0 { wh.contact = false; wh.comp = 0; wh.load = 0; continue }
        let h = w.hit
        let comp = maxT - t
        wh.comp = comp; wh.contact = true
        var fs = wh.k * jsMin(comp, S.rest) + wh.c * ((comp - prev) / dt)
        let over = comp - (S.rest - S.mount + S.travel)
        if over > 0 { fs += wh.bump * over }
        if fs < 0 { fs = 0 }
        let cosn = -(up.0 * h.nx + up.1 * h.ny + up.2 * h.nz)
        let Fz = fs * (cosn > 0.3 ? cosn : 0.3)
        wh.load = Fz
        let pt = (ax + up.0 * t - w.ox, ay + up.1 * t - w.oy, az + up.2 * t - w.oz)
        let pv = velAt(w, rb, pt)
        var vo = (0.0, 0.0, 0.0)
        let hb = h.body
        if let hb, hb.rb != CG_NONE { vo = velAt(w, hb.rb, pt) }
        else if h.car && w.carRb != CG_NONE { vo = velAt(w, w.carRb, pt) }
        var rx = pv.0 - vo.0, ry = pv.1 - vo.1, rz = pv.2 - vo.2
        let rn = rx * h.nx + ry * h.ny + rz * h.nz
        rx -= h.nx * rn; ry -= h.ny * rn; rz -= h.nz * rn
        let gn = -G_W * h.ny
        let gx = -h.nx * gn, gy = -G_W - h.ny * gn, gz = -h.nz * gn
        var fx = -mc * (rx / dt * 0.5 + gx), fy = -mc * (ry / dt * 0.5 + gy), fz = -mc * (rz / dt * 0.5 + gz)
        let lim = S.mu * h.mat.grip * Fz, f = jsSqrt(fx * fx + fy * fy + fz * fz)
        if f > lim && f > 0 { fx *= lim / f; fy *= lim / f; fz *= lim / f }
        var ix = (h.nx * Fz + fx) * dt, iy = (h.ny * Fz + fy) * dt, iz = (h.nz * Fz + fz) * dt
        cg_body_apply_impulse_at_point(w.rw, rb, Float(ix), Float(iy), Float(iz), Float(pt.0), Float(pt.1), Float(pt.2), false)
        ix = -ix; iy = -iy; iz = -iz
        if let hb, hb.rb != CG_NONE { cg_body_apply_impulse_at_point(w.rw, hb.rb, Float(ix), Float(iy), Float(iz), Float(pt.0), Float(pt.1), Float(pt.2), true) }
        else if h.car, let cp = w.carPos {
            let Fx = ix / dt, Fy = iy / dt, Fz2 = iz / dt
            let r0 = pt.0 + w.ox - cp.x, r1 = pt.1 + w.oy - cp.y, r2 = pt.2 + w.oz - cp.z
            w.carF.x += Fx; w.carF.y += Fy; w.carF.z += Fz2
            w.carT.x += r1 * Fz2 - r2 * Fy; w.carT.y += r2 * Fx - r0 * Fz2; w.carT.z += r0 * Fy - r1 * Fx
        }
    }
}

// --- The launch complex: where it is, and the static fire's jet (the solids themselves: not yet) -----------
public struct Site { public let x, z, yaw, c, s: Double }
let PAD_Y = 3.0, SITE_RADIUS = 90.0, TRENCH_TO = 48.0, TRENCH_W = 9.0
let PLUME_EXIT = (0.0, PAD_Y + 2, -TRENCH_TO), PLUME_HALF = TRENCH_W / 2
public func siteOf(_ courseId: String) -> Site? {
    let p: (Double, Double, Double, Double)
    if courseId == "lineup" { p = (-260, 520, 0, 30) } else if courseId == "show" || courseId == "wall" { p = (-265, -8, 10, -14) } else { return nil }
    let yaw = DMath.datan2(p.2 - p.0, p.3 - p.1)
    return Site(x: p.0, z: p.1, yaw: yaw, c: DMath.dcos(yaw), s: DMath.dsin(yaw))
}
@inline(__always) func siteLocal(_ s: Site, _ x: Double, _ y: Double, _ z: Double) -> (Double, Double, Double) {
    let dx = x - s.x, dz = z - s.z
    return (dx * s.c - dz * s.s, y, dx * s.s + dz * s.c)
}
// rocket.js: the fire schedule, the engines' levels and the trench's jet.
let FIRE_FIRST = 20.0, FIRE_EVERY = 40.0, FIRE_LEN = 7.5, FIRE_STAGGER = 0.04, FIRE_UP = 0.4, FIRE_DOWN = 0.6
let S1_ENGINES = 9, S1_THRUST_SL = 845e3
let JET_ETA = 0.5, JET_SPREAD = 0.113, JET_RHO = 1.2, JET_REACH = 400.0, JET_CUTOFF = 2.5
let CDA_FRONT = 0.55, CDA_SIDE = 4.2, CDA_FLOOR = 7.8, CDA_CPUP = 0.15
func fireClock(_ t: Double) -> Double {
    if t < FIRE_FIRST { return -1 }
    let k = jsFloor((t - FIRE_FIRST) / FIRE_EVERY), ft = t - FIRE_FIRST - k * FIRE_EVERY
    return ft < FIRE_LEN ? ft : -1
}
func staticFireThrust(_ ft: Double) -> Double {
    var level = 0.0
    for i in 0..<S1_ENGINES {
        let t0 = Double(i) * FIRE_STAGGER
        if ft <= t0 || ft >= FIRE_LEN { continue }
        let up = (ft - t0) / FIRE_UP, down = (FIRE_LEN - ft) / FIRE_DOWN
        level += jsMin(jsMin(1, up), down)
    }
    return level * S1_THRUST_SL
}
func jetSpeed(_ thrust: Double, _ a: Double, _ r2: Double, _ halfWidth: Double) -> Double {
    if thrust <= 0 || a < 0 || a > JET_REACH { return 0 }
    let x0 = halfWidth / JET_SPREAD, b = JET_SPREAD * (a + x0), b2 = b * b
    if r2 > JET_CUTOFF * JET_CUTOFF * b2 { return 0 }
    let J = JET_ETA * thrust
    let uc = jsSqrt((2 * J) / (JET_RHO * DMath.PI * b2))
    return uc * DMath.dexp(-r2 / b2)
}
// complex.js siteSolids: the pad, the mount, the vehicle, the strongback, masts, the tank, buildings, spheres.
struct SiteShape { let shape: ShapeDesc; let x, y, z: Double; let q: (Double, Double, Double, Double); let mat: Material }
let MOUNT_TOP = 8.0, TOWER_X = 6.4, TOWER_H = 82.0, TOWER_W = 3.4, MAST_H = 104.0
let SITE_TOP = PAD_Y + MAST_H + 1
func lathe(_ profile: [(Double, Double)], _ n: Int, _ y0: Double = 0) -> [Float] {
    var pts: [Double] = []
    for (r, y) in profile {
        if r == 0 { pts += [0, y0 + y, 0]; continue }
        for k in 0..<n { let a = (2 * DMath.PI * Double(k)) / Double(n); pts += [r * DMath.dsin(a), y0 + y, r * DMath.dcos(a)] }
    }
    return pts.map { Float($0) }
}
func upTo(_ dx: Double, _ dy: Double, _ dz: Double) -> (Double, Double, Double, Double) {
    let x = dz, z = -dx, w = 1 + dy, l = jsSqrt(x * x + z * z + w * w)
    return (x / l, 0, z / l, w / l)
}
let SITE_SOLIDS: [SiteShape] = {
    var S: [SiteShape] = []
    let steel = MATERIALS.steel, concrete = MATERIALS.concrete, Q0 = (0.0, 0.0, 0.0, 1.0)
    func box(_ x: Double, _ y: Double, _ z: Double, _ hx: Double, _ hy: Double, _ hz: Double, _ mat: Material = MATERIALS.steel, _ q: (Double, Double, Double, Double) = (0, 0, 0, 1)) {
        S.append(SiteShape(shape: .cuboid(hx, hy, hz), x: x, y: y, z: z, q: q, mat: mat))
    }
    func member(_ a: (Double, Double, Double), _ b: (Double, Double, Double), _ t: Double) {
        let dx = b.0 - a.0, dy = b.1 - a.1, dz = b.2 - a.2, L = jsSqrt(dx * dx + dy * dy + dz * dz)
        box((a.0 + b.0) / 2, (a.1 + b.1) / 2, (a.2 + b.2) / 2, t / 2, L / 2, t / 2, steel, upTo(dx / L, dy / L, dz / L))
    }
    func frustum(_ x: Double, _ z: Double, _ y0: Double, _ y1: Double, _ r0: Double, _ r1: Double, _ n: Int = 8) {
        S.append(SiteShape(shape: .hull(lathe([(r0, y0), (r1, y1)], n)), x: x, y: 0, z: z, q: Q0, mat: steel))
    }
    S.append(SiteShape(shape: .hull(lathe([(66, PAD_Y), (86, 0), (86, -0.5)], 64)), x: 0, y: 0, z: 0, q: Q0, mat: concrete))
    let dw = 10.0, dh = 1.6, dd = 10.0
    box(0, MOUNT_TOP - dh / 2, 0, dw / 2, dh / 2, dd / 2)
    let ch = MOUNT_TOP - dh - PAD_Y
    for (x, z) in [(-4.2, -4.2), (4.2, -4.2), (-4.2, 4.2), (4.2, 4.2)] { box(x, PAD_Y + ch / 2, z, 1.4 / 2, ch / 2, 1.4 / 2) }
    let B = MOUNT_TOP, R = 1.83, interstageTop = 47.7, stage2Top = 56.6, FR = 2.6, fairingTop = 70.0, boosterTop = 41.2
    S.append(SiteShape(shape: .cylinder(interstageTop / 2, R + 0.03), x: 0, y: B + interstageTop / 2, z: 0, q: Q0, mat: steel))
    let zb = stage2Top + 1.6, zo = fairingTop - 6.2
    var nose: [(Double, Double)] = []
    for i in 0...6 { let t = Double(i) / 6; nose.append((jsMax(FR * jsSqrt(1 - t * t) * (1 - 0.06 * t), 0), zo + t * (fairingTop - zo))) }
    nose[nose.count - 1].0 = 0
    S.append(SiteShape(shape: .hull(lathe([(R, interstageTop), (R, stage2Top), (FR - 0.02, zb), (FR, zb + 0.2), (FR, zo)] + nose.dropFirst(), 16)), x: 0, y: B, z: 0, q: Q0, mat: steel))
    box(TOWER_X, (PAD_Y + TOWER_H) / 2, 0, TOWER_W / 2, (TOWER_H - PAD_Y) / 2, TOWER_W / 2)
    box(TOWER_X, TOWER_H, 0, (TOWER_W + 1.2) / 2, 0.5, (TOWER_W + 1.2) / 2)
    let armY = B + interstageTop + 5.5, armX0 = R + 0.2, armX1 = TOWER_X - TOWER_W / 2
    box((armX0 + armX1) / 2, armY, 0, (armX1 - armX0) / 2, 1.2, 1.1)
    box(R + 1.3, armY + 0.2, 0, 1.3, 1.5, 1.5)
    for y in [18.0, 33.0, boosterTop - 1.5] { for z in [-0.9, 0.9] { member((TOWER_X - TOWER_W / 2, B + y, z), (R + 0.15, B + y, z * 0.5), 0.45) } }
    for (x, z) in [(-34.0, -22.0), (30.0, -30.0), (-8.0, 44.0)] { frustum(x, z, PAD_Y, PAD_Y + MAST_H, 1.0, 0.35) }
    for (x, top, z) in [(-30.0, 26.0, 24.0), (24.0, 32.0, -26.0)] { frustum(x, z, PAD_Y, top, 0.4, 0.25) }   // FLOODS that aren't on the ground
    let tx = -62.0, tz = 36.0
    S.append(SiteShape(shape: .cylinder(11.0 / 2, 5.5), x: tx, y: PAD_Y + 46, z: tz, q: Q0, mat: steel))
    for (dx, dz) in [(-3.6, -3.6), (3.6, -3.6), (-3.6, 3.6), (3.6, 3.6)] { member((tx + dx * 1.5, PAD_Y, tz + dz * 1.5), (tx + dx, PAD_Y + 41, tz + dz), 0.6) }
    for (x, z, bw, h, d) in [(-48.0, -30.0, 22.0, 7.0, 12.0), (-60.0, -6.0, 12.0, 5.0, 9.0), (44.0, -44.0, 16.0, 6.0, 10.0)] { box(x, PAD_Y + h / 2, z, bw / 2, h / 2, d / 2, concrete) }
    for (x, z, r) in [(38.0, 30.0, 4.2), (48.0, 33.0, 4.2), (-30.0, 44.0, 5.0)] { S.append(SiteShape(shape: .ball(r), x: x, y: PAD_Y + r + 1.2, z: z, q: Q0, mat: steel)) }
    return S
}()
@inline(__always) func qmul(_ a: (Double, Double, Double, Double), _ b: (Double, Double, Double, Double)) -> (Double, Double, Double, Double) {
    (a.3 * b.0 + a.0 * b.3 + a.1 * b.2 - a.2 * b.1, a.3 * b.1 - a.0 * b.2 + a.1 * b.3 + a.2 * b.0,
     a.3 * b.2 + a.0 * b.1 - a.1 * b.0 + a.2 * b.3, a.3 * b.3 - a.0 * b.0 - a.1 * b.1 - a.2 * b.2)
}
func buildSite(_ w: World) {
    guard let at = w.siteAt else { return }
    let qy = (0.0, DMath.dsin(at.yaw / 2), 0.0, DMath.dcos(at.yaw / 2))
    for sh in SITE_SOLIDS {
        let sx = at.x + sh.x * at.c + sh.z * at.s, sy = sh.y, sz = at.z - sh.x * at.s + sh.z * at.c
        let col = colliderFor(w, sh.shape, DescOpts(t: (sx - w.ox, sy - w.oy, sz - w.oz), q: qmul(qy, sh.q)), sh.mat, GROUP.staticG)
        if col != CG_NONE { w.siteCols.append(col) }
    }
    let solid = Solid((at.x - SITE_RADIUS, -1, at.z - SITE_RADIUS, at.x + SITE_RADIUS, SITE_TOP, at.z + SITE_RADIUS))
    w.siteSolid = solid
    w.solids.append(solid)
}
func dropSite(_ w: World) {
    for col in w.siteCols { w.info[col] = nil; cg_world_remove_collider(w.rw, col, false) }
    w.siteCols.removeAll()
    if let s = w.siteSolid, let i = w.solids.firstIndex(where: { $0 === s }) { w.solids.remove(at: i) }
    w.siteSolid = nil
}
let SITE_IN = SITE_RADIUS + 60, SITE_OUT = SITE_RADIUS + 90
func siteTick(_ w: World) throws {
    guard let S = w.siteAt, let p = w.carPos else { return }
    let dx = p.x - S.x, dz = p.z - S.z, d2 = dx * dx + dz * dz
    if w.siteCols.isEmpty { if d2 < SITE_IN * SITE_IN { buildSite(w) } } else if d2 > SITE_OUT * SITE_OUT { dropSite(w) }
    w.sitePush = 0
    let ft = fireClock(Double(w.tick) * WORLD_DT)
    if ft < 0 { return }
    let sp = siteLocal(S, p.x, p.y, p.z)
    let a = PLUME_EXIT.2 - sp.2, ey = sp.1 - PLUME_EXIT.1, ex = sp.0 - PLUME_EXIT.0
    if a < 0 || a > JET_REACH { return }
    let U = jetSpeed(staticFireThrust(ft), a, ex * ex + ey * ey, PLUME_HALF)
    if !(U > 0) { return }
    guard let v = w.carVel, let q = w.carQuat else { return }
    let ux = -S.s * U - v.x, uy = -v.y, uz = -S.c * U - v.z, um = jsSqrt(ux * ux + uy * uy + uz * uz)
    if !(um > 0) { return }
    let qq = (q.x, q.y, q.z, q.w)
    var ax = rot(qq, 0, 0, 1); let cf = abs(ax.0 * ux + ax.1 * uy + ax.2 * uz) / um
    ax = rot(qq, 1, 0, 0); let cs = abs(ax.0 * ux + ax.1 * uy + ax.2 * uz) / um
    ax = rot(qq, 0, 1, 0); let cu = abs(ax.0 * ux + ax.1 * uy + ax.2 * uz) / um
    let k = 0.5 * JET_RHO * (CDA_FRONT * cf + CDA_SIDE * cs + CDA_FLOOR * cu) * um
    let fx = k * ux, fy = k * uy, fz = k * uz
    w.carF.x += fx; w.carF.y += fy; w.carF.z += fz
    let rx = ax.0 * CDA_CPUP, ry = ax.1 * CDA_CPUP, rz = ax.2 * CDA_CPUP
    w.carT.x += ry * fz - rz * fy; w.carT.y += rz * fx - rx * fz; w.carT.z += rx * fy - ry * fx
    w.sitePush = jsSqrt(fx * fx + fy * fy + fz * fz)
}

/// Step the engine one tick, then copy every moving parked body's pose back to its mirror.
public func stepEngine(_ w: World) {
    for b in w.bodies { b.pvx = b.vx; b.pvy = b.vy; b.pvz = b.vz; b.pwx = b.wx; b.pwy = b.wy; b.pwz = b.wz }
    cg_world_step_events(w.rw)
    if w.carCol != CG_NONE {
        let n = cg_world_collision_events(w.rw, &w.evA, &w.evB, &w.evS, w.evA.count)
        if n > w.evA.count {   // more events than the scratch holds: grow once and read again
            w.evA = .init(repeating: 0, count: n); w.evB = w.evA; w.evS = .init(repeating: false, count: n)
            _ = cg_world_collision_events(w.rw, &w.evA, &w.evB, &w.evS, n)
        }
        let c = w.carCol
        for i in 0..<n where w.evA[i] == c || w.evB[i] == c { w.carTouching += w.evS[i] ? 1 : -1 }
    }
    var moved = false
    for b in w.bodies where readBody(w, b) { moved = true }
    if moved { refreshBounds(w.bounds, w.bodies) }
}
func readBody(_ w: World, _ b: ParkedBody) -> Bool {
    let rb = b.rb
    if rb == CG_NONE || cg_body_is_sleeping(w.rw, rb) { b.asleep = true; b.vx = 0; b.vy = 0; b.vz = 0; b.wx = 0; b.wy = 0; b.wz = 0; return false }
    b.asleep = false
    let p = readT(w, rb), q = readRot(w, rb)
    b.cx = p.0 + w.ox; b.cy = p.1 + w.oy; b.cz = p.2 + w.oz
    b.qx = q.0; b.qy = q.1; b.qz = q.2; b.qw = q.3
    let up = rot(q, 1, 0, 0)
    b.yaw = DMath.datan2(-up.2, up.0)
    cg_body_linvel(w.rw, rb, &f3); b.vx = Double(f3[0]); b.vy = Double(f3[1]); b.vz = Double(f3[2])
    cg_body_angvel(w.rw, rb, &f3); b.wx = Double(f3[0]); b.wy = Double(f3[1]); b.wz = Double(f3[2])
    b.moved = true
    return true
}
#endif
