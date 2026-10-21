// A run's physical world in the rigid-body engine (Rapier, src/sim/engine.js): the course as static
// colliders, every parked vehicle as its own rigid body on four suspended, parked tyres, and the
// roadster's rigid hull (attached by src/sim/vehicle.js). Each run builds a fresh one, so a shoved
// car stays shoved for that run only and replays the same way (the server re-simulates it).
//
// What the engine does: integrates every body, finds and solves every contact (body on body, body
// on ground or deck), friction and restitution per material pair, sleeping.
// What this file adds on top, as forces on the engine's bodies: the parked vehicles' suspension
// (spring, damper, bump stop per corner) and their parked tyres (locked, friction-limited).
// Pure and deterministic: the engine is the cross-platform-deterministic build, every input is
// set in the same order on every host, and nothing here reads a clock or a random source.
import { RAPIER as R, requirePhysics } from './engine.js';
import { WALL, wallProfile, RAMP, MATERIALS, parkedMirror, refreshBounds, PAD_R, PARK_MU } from './courses.js';
import { RAILS, roadSurface } from './roads.js';
import { dsin, dcos, datan2 } from './dmath.js';

export const WORLD_DT = 1 / 240;
const G = 9.81;
// Collision groups (membership << 16 | filter). Rays choose what they may hit.
export const GROUP = { static: 1, parked: 2, car: 4, approx: 8 };
const groups = (member, filter = 0xffff) => ((member << 16) | filter) >>> 0;
const RAY_ALL = groups(0xffff, 0xffff);

// --- Building ---------------------------------------------------------------------------------------
function colliderFor(w, desc, mat, member, body = null, extra = null) {
  desc.setFriction(mat.slide).setRestitution(mat.bounce)
    .setFrictionCombineRule(R.CoefficientCombineRule.Min)
    .setCollisionGroups(groups(member));
  const col = w.rw.createCollider(desc, body?.rb ?? extra ?? undefined);
  w.info.set(col.handle, { mat, body, car: false, approx: member === GROUP.approx });
  return col;
}

// The Wall's deck as a closed slab: the riding surface sampled along `wallProfile` every 20 cm
// (on the 13.5 m arc a 20 cm chord sits 0.37 mm inside the true curve and the facets turn 0.85°
// apiece: below what a tyre feels; 10 cm cost 40 % more per tick for no change in the flights),
// the back face one slab thickness behind it, both sides and both ends. Triangles face out.
function wallMesh() {
  const L = WALL.length, W = WALL.width / 2, T = WALL.slab;
  const ss = [];
  for (let s = 0; s < WALL.arcLength; s += 0.2) ss.push(s);
  for (let u = 0; u < WALL.ledge; u += 0.5) ss.push(WALL.arcLength + u);
  ss.push(L);
  const n = ss.length, v = new Float32Array(n * 4 * 3), mid = [];
  const p = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 };
  for (let i = 0; i < n; i++) {
    wallProfile(ss[i], p);
    const k = i * 12;
    // top −x, top +x, back −x, back +x
    v.set([-W, p.y, p.z, W, p.y, p.z, -W, p.y - p.ny * T, p.z - p.nz * T, W, p.y - p.ny * T, p.z - p.nz * T], k);
    mid.push([0, p.y - p.ny * T / 2, p.z - p.nz * T / 2]);
  }
  const idx = [];
  // Wind each triangle away from a point inside the slab next to it.
  const tri = (a, b, c, inside) => {
    const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2];
    const ux = v[b * 3] - ax, uy = v[b * 3 + 1] - ay, uz = v[b * 3 + 2] - az;
    const wx = v[c * 3] - ax, wy = v[c * 3 + 1] - ay, wz = v[c * 3 + 2] - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const cx = (ax + v[b * 3] + v[c * 3]) / 3 - inside[0], cy = (ay + v[b * 3 + 1] + v[c * 3 + 1]) / 3 - inside[1], cz = (az + v[b * 3 + 2] + v[c * 3 + 2]) / 3 - inside[2];
    if (nx * cx + ny * cy + nz * cz >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const quad = (a, b, c, d, inside) => { tri(a, b, c, inside); tri(b, d, c, inside); };
  for (let i = 0; i + 1 < n; i++) {
    const a = i * 4, b = (i + 1) * 4;
    const m = [(mid[i][0] + mid[i + 1][0]) / 2, (mid[i][1] + mid[i + 1][1]) / 2, (mid[i][2] + mid[i + 1][2]) / 2];
    quad(a, a + 1, b, b + 1, m);            // riding surface
    quad(a + 2, a + 3, b + 2, b + 3, m);    // back
    quad(a, a + 2, b, b + 2, m);            // −x side
    quad(a + 1, a + 3, b + 1, b + 3, m);    // +x side
  }
  const e = (n - 1) * 4;
  quad(0, 1, 2, 3, [mid[0][0], mid[0][1], mid[0][2] + 0.05]);
  wallProfile(L, p);
  quad(e, e + 1, e + 2, e + 3, [0, mid[n - 1][1] - p.ty * 0.05, mid[n - 1][2] - p.tz * 0.05]);
  return { v, idx: new Uint32Array(idx) };
}
let WALL_MESH = null;

// The kicker (a course with `ramp`): its parabolic face over the concrete, closed underneath.
function kickerMesh() {
  const N = 24, Wd = RAMP.halfWidth, v = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const z = RAMP.z0 + ((RAMP.z1 - RAMP.z0) * i) / N, s = i / N, y = RAMP.height * s * s;
    v.push(-Wd, y, z, Wd, y, z, -Wd, -0.2, z, Wd, -0.2, z);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4, b = a + 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }
  const e = N * 4;
  idx.push(e, e + 1, e + 2, e + 1, e + 3, e + 2);
  return { v: new Float32Array(v), idx: new Uint32Array(idx) };
}

// The Wall's steel (src/render/wall.js draws the same members): the tower's four chords behind the
// curl and the posts under its lower curve, which stand just outside the deck's edge.
function wallSteel(w) {
  const T = WALL.slab, zA = WALL.r1 + T + 0.35, zB = zA + 3.0, top = WALL.lip.y + T + 1.6;
  for (const x of [-1.7, 1.7]) for (const z of [zA, zB]) {
    colliderFor(w, R.ColliderDesc.cuboid(0.15, top / 2, 0.15).setTranslation(x, top / 2, z), MATERIALS.steel, GROUP.static);
  }
  for (let z = 6.2; z <= WALL.r1 + 0.3; z += 1.45) {
    const y = WALL.r1 - Math.sqrt(Math.max(0, (WALL.r1 + T) * (WALL.r1 + T) - z * z));
    if (y < 0.35) continue;
    for (const x of [-1.9, 1.9]) colliderFor(w, R.ColliderDesc.cuboid(0.09, y / 2, 0.09).setTranslation(x, y / 2, z), MATERIALS.steel, GROUP.static);
  }
}

// A parked vehicle: a rigid body (its own mass, CoM, inertia tensor), a box collider from its
// ground clearance to its roof, and four suspended corners. It starts asleep, at rest on its
// springs exactly where the course parked it: until something touches it, it costs nothing.
function addParked(w, b, index) {
  const m = parkedMirror(b), ph = m.phys;
  m.index = index;
  const rb = w.rw.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(m.cx, 0, m.cz).setSleeping(true));
  rb.setAdditionalMassProperties(ph.mass, { x: ph.cgx, y: ph.cgh, z: 0 }, { x: ph.inertia.roll, y: ph.inertia.yaw, z: ph.inertia.pitch }, { x: 0, y: 0, z: 0, w: 1 }, false);
  m.rb = rb;
  const hy = (m.h - m.clr) / 2;
  m.collider = colliderFor(w, R.ColliderDesc.cuboid(m.hx, hy, m.hz).setTranslation(0, m.clr + hy, 0).setDensity(0), m.mat, GROUP.parked, m);
  // Suspension, per corner: rate from the ride frequency and the load it carries,
  // k = m_c (2π f)², damper at ζ of critical; every corner then sags g/(2π f)², so with the rest
  // length set to that the chassis frame sits level at y = 0 under its own weight.
  const om = 2 * 3.141592653589793 * ph.rideHz;
  const MOUNT = 0.25;                      // spring top mount above the wheel centre, m
  const sag = G / (om * om);
  m.susp = { mount: MOUNT, rest: MOUNT + sag, travel: Math.min(0.12, 0.6 * ph.clearance), mu: PARK_MU };
  m.wheels = ph.corners.map((cn) => {
    const mc = cn.load / G, k = mc * om * om;
    return { x: cn.x, y: cn.r + MOUNT, z: cn.z, R: cn.r, mc, k, c: 2 * ph.damping * Math.sqrt(k * mc), bump: 20 * k, comp: sag, contact: true, load: cn.load };
  });
  return m;
}

/**
 * A run's world: the course's static colliders and its parked bodies, in a fresh engine world.
 * @param {object} course  a course from src/sim/courses.js COURSES (or a road course)
 */
export function createWorld(course) {
  requirePhysics();
  const rw = new R.World({ x: 0, y: -G, z: 0 });
  rw.timestep = WORLD_DT;
  const w = {
    course, rw, info: new Map(), bodies: [], ox: 0, oy: 0, oz: 0,
    carRb: null, carCol: null, carF: { x: 0, y: 0, z: 0 }, carT: { x: 0, y: 0, z: 0 }, carPos: null,
    minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0, stream: null, chunk: null, freed: false,
    hit: { t: 0, nx: 0, ny: 1, nz: 0, mat: MATERIALS.concrete, body: null, car: false, x: 0, y: 0, z: 0 },
    ray: new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
    // How many colliders the roadster's hull is in contact with (the engine's collision events):
    // its contacts are only read while there are any.
    events: new R.EventQueue(true), carTouching: 0, onCollision: null,
  };
  w.onCollision = (h1, h2, started) => {
    const c = w.carCol?.handle;
    if (h1 === c || h2 === c) w.carTouching += started ? 1 : -1;
  };
  if (course.sdf) {
    // Free Drive: the road is exact geometry (src/sim/roads.js) the tyres read directly; the
    // engine gets a near-car approximation of it for hull contacts, rebuilt as the car moves.
    // (A course without a road, the flat Sandbox apron, gets its floor. Build pieces placed on
    // either are exact for the tyres and fan; as hull colliders they are not mapped yet:
    // src/build/colliders.js `shapeMesh` is the hook.)
    if (course.road) w.stream = streamRoad;
    else colliderFor(w, R.ColliderDesc.cuboid(1500, 1, 1500).setTranslation(0, -1, 0), MATERIALS.concrete, GROUP.approx);
  } else {
    const floor = colliderFor(w, R.ColliderDesc.cuboid(1500, 1, 1500).setTranslation(0, -1, 0), MATERIALS.concrete, GROUP.static);
    // The landing mark is a film of paint on that concrete: the floor's material inside its disc.
    if (course.pad) w.info.get(floor.handle).pad = course.pad;
    if (course.id === 'wall' || course.id === 'show') {
      WALL_MESH ??= wallMesh();
      colliderFor(w, R.ColliderDesc.trimesh(WALL_MESH.v, WALL_MESH.idx, R.TriMeshFlags.FIX_INTERNAL_EDGES), MATERIALS.deck, GROUP.static);
      wallSteel(w);
    }
    if (course.ramp) { const k = kickerMesh(); colliderFor(w, R.ColliderDesc.trimesh(k.v, k.idx, R.TriMeshFlags.FIX_INTERNAL_EDGES), MATERIALS.deck, GROUP.static); }
  }
  (course.boxes || []).forEach((b, i) => w.bodies.push(addParked(w, b, i)));
  refreshBounds(w);
  // A zero-length step files every collider in the engine's broad phase, so the first tick's ray
  // casts see the world (nothing moves; the sleeping bodies stay asleep).
  rw.timestep = 0; rw.step(); rw.timestep = WORLD_DT;
  return w;
}

/** Release the engine's memory for this world (the run is over; its mirrors stay readable). */
export function freeWorld(w) {
  if (w.freed) return;
  w.freed = true;
  w.ray.free?.();
  w.events.free?.();
  w.rw.free();
  for (const b of w.bodies) { b.rb = null; b.collider = null; }
  w.carRb = null; w.carCol = null;
}

// The roadster's rigid hull: a convex hull of its body (src/sim/vehicle.js), on a body whose
// motion src/sim/vehicle.js integrates; the engine resolves its contacts each tick.
export function attachCar(w, hullPoints, mass, inertia) {
  const rb = w.rw.createRigidBody(R.RigidBodyDesc.dynamic().setGravityScale(0).setCanSleep(false).setCcdEnabled(false));
  rb.setAdditionalMassProperties(mass, { x: 0, y: 0, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 }, false);
  const desc = R.ColliderDesc.convexHull(hullPoints).setDensity(0);
  const col = colliderFor(w, desc.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), MATERIALS.body, GROUP.car, null, rb);
  w.info.get(col.handle).car = true;
  w.carRb = rb; w.carCol = col;
  return rb;
}

// --- Free Drive: the road near the car, for the hull --------------------------------------------------
// The tyres read the exact road (src/sim/roads.js); what the engine needs is something for the
// body to hit: a 96 m heightfield around the car sampled from the road's own surface every 2 m,
// its guard rails, walls and tunnel roofs as boxes per 3 m segment. Rebuilt when the car is 24 m
// from its centre, with the engine's origin moved there: the roads span kilometres and the engine
// stores single-precision floats, so everything it holds stays near its origin.
const CH = 96, CN = 48;
// The surface's height under (x, z), from y0 down: Newton steps on the distance field (two or three
// do it on the road), then, if they haven't landed, bracket and bisect. Beside a vertical face the
// field's gradient is level and a step falls only φ: five of them stopped 0.6 m above the road,
// and the hull hit that vertex at speed like a kerb.
export function surfaceHeight(sdf, x, z, y0) {
  let y = y0, phi = 0;
  for (let k = 0; k < 5; k++) {
    phi = sdf(x, y, z, sdfOut);
    const ny = sdfOut.y, dy = ny > 0.2 ? phi / ny : phi;
    y -= dy;
    if (dy < 0.005 && dy > -0.005) { phi = sdf(x, y, z, sdfOut); break; }
  }
  // Landed: on the surface, and it faces up (beside a face, a small φ is a horizontal distance).
  if (phi < 0.005 && phi > -0.005 && sdfOut.y > 0.5) return y;
  // Bracket: a point above the surface (φ > 0) and one at or under it, stepping down from the
  // higher of y and y0 in doubling strides (≤ 64 m), then halve to a millimetre.
  let hi = Math.max(y, y0), lo = hi, d = 0.25;
  while (sdf(x, hi, z, sdfOut) <= 0 && d <= 64) { hi += d; d *= 2; }
  d = 0.25;
  while (sdf(x, lo, z, sdfOut) > 0 && d <= 64) { hi = lo; lo -= d; d *= 2; }
  for (let k = 0; k < 40 && hi - lo > 0.001; k++) {
    const m = (lo + hi) / 2;
    if (sdf(x, m, z, sdfOut) > 0) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}
const q0 = { x: 0, y: 0, z: 0, w: 1 };
function streamRoad(w, pos) {
  const c = w.chunk;
  if (c && Math.abs(pos.x - c.x) < 24 && Math.abs(pos.z - c.z) < 24 && Math.abs(pos.y - c.y) < 30) return;
  if (c) for (const col of c.cols) { w.info.delete(col.handle); w.rw.removeCollider(col, false); }
  const road = w.course.road, sdf = (x, y, z, out) => roadSurface(road, x, y, z, out, true);   // the ground, not what's built on it (rails and roofs follow as boxes)
  const cx = Math.round(pos.x), cy = Math.round(pos.y), cz = Math.round(pos.z);
  w.ox = cx; w.oy = cy; w.oz = cz;
  const cols = [];
  const hs = new Float32Array((CN + 1) * (CN + 1)), step = CH / CN;
  // Column-major (rows along z, columns along x), as the engine's heightfield stores it.
  for (let j = 0; j <= CN; j++) for (let i = 0; i <= CN; i++) {
    hs[j * (CN + 1) + i] = surfaceHeight(sdf, cx - CH / 2 + j * step, cz - CH / 2 + i * step, pos.y + 1.5) - cy;
  }
  cols.push(colliderFor(w, R.ColliderDesc.heightfield(CN, CN, hs, { x: CH, y: 1, z: CH }), MATERIALS.asphalt, GROUP.approx));
  if (road) {
    const r2 = (CH / 2 + 4) * (CH / 2 + 4);
    for (let i = 0; i < road.m; i++) {
      const L = road.len[i], mx = road.sx[i] + road.dx[i] * L / 2, mz = road.sz[i] + road.dz[i] * L / 2;
      const ex = mx - cx, ez = mz - cz;
      if (ex * ex + ez * ez > r2) continue;
      const lx = road.dz[i], lz = -road.dx[i], my = road.y[i] + road.grade[i] * L / 2, fl = road.flags[i];
      const th = datan2(road.dx[i], road.dz[i]);
      q0.y = dsin(th / 2); q0.w = dcos(th / 2);
      for (const side of [1, -1]) {
        const kind = side > 0 ? (fl >> 2) & 3 : (fl >> 4) & 3;
        if (!kind) continue;
        const rr = RAILS[kind], off = road.hw[i] + rr.off + rr.t / 2, base = my + road.bank[i] * off * side;
        const d = R.ColliderDesc.cuboid(rr.t / 2, (rr.h + 1) / 2, L / 2 + 0.05)
          .setTranslation(mx + lx * off * side - cx, base + (rr.h - 1) / 2 - cy, mz + lz * off * side - cz).setRotation(q0);
        cols.push(colliderFor(w, d, MATERIALS.barrier, GROUP.approx));
      }
      if (fl & 2) {
        const d = R.ColliderDesc.cuboid(road.hw[i] + 3, 0.5, L / 2 + 0.05).setTranslation(mx - cx, my + 5.4 + 0.5 - cy, mz - cz).setRotation(q0);
        cols.push(colliderFor(w, d, MATERIALS.barrier, GROUP.approx));
      }
    }
  }
  w.chunk = { x: cx, y: cy, z: cz, cols };
}

// --- Queries ----------------------------------------------------------------------------------------
const sdfOut = { x: 0, y: 0, z: 0, obstacle: false, body: null, mat: MATERIALS.concrete };
// March a ray through an exact signed-distance field (Free Drive's road): six steps, then bisection
// and a secant step for a sub-micron hit, so a damper never sees quantisation noise.
function marchSdf(sdf, ox, oy, oz, dx, dy, dz, maxT, hit) {
  let prevT = 0, prevPhi = sdf(ox, oy, oz, sdfOut);
  if (prevPhi <= 0) { hit.nx = sdfOut.x; hit.ny = sdfOut.y; hit.nz = sdfOut.z; hit.mat = sdfOut.mat; return 0; }
  for (let i = 1; i <= 6; i++) {
    const t = (maxT * i) / 6;
    const phi = sdf(ox + dx * t, oy + dy * t, oz + dz * t, sdfOut);
    if (phi <= 0) {
      let lo = prevT, hi = t, pLo = prevPhi, pHi = phi;
      for (let k = 0; k < 5; k++) {
        const mid = (lo + hi) / 2, pm = sdf(ox + dx * mid, oy + dy * mid, oz + dz * mid, sdfOut);
        if (pm <= 0) { hi = mid; pHi = pm; } else { lo = mid; pLo = pm; }
      }
      const th = pLo - pHi > 1e-12 ? lo + ((hi - lo) * pLo) / (pLo - pHi) : hi;
      sdf(ox + dx * th, oy + dy * th, oz + dz * th, sdfOut);
      hit.nx = sdfOut.x; hit.ny = sdfOut.y; hit.nz = sdfOut.z; hit.mat = sdfOut.mat;
      return th;
    }
    prevT = t; prevPhi = phi;
  }
  return -1;
}

/**
 * Cast a ray (unit direction) up to maxT metres. Returns the distance to the first solid, or −1;
 * `w.hit` then holds the normal (out of the solid), its material, and the parked body (or null) or
 * `car: true` for the roadster. `excludeRb` skips one body (the caster's own).
 */
export function raycast(w, ox, oy, oz, dx, dy, dz, maxT, excludeRb) {
  const h = w.hit, ray = w.ray, sdf = w.course.sdf;
  ray.origin.x = ox - w.ox; ray.origin.y = oy - w.oy; ray.origin.z = oz - w.oz;
  ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz;
  // On a road the tyres read the exact road; the engine's near-car copy of it is for the hull.
  const hitR = w.rw.castRayAndGetNormal(ray, maxT, true, undefined, sdf ? groups(0xffff, 0xffff & ~GROUP.approx) : RAY_ALL, undefined, excludeRb);
  let t = -1;
  if (hitR) {
    t = hitR.timeOfImpact;
    const info = w.info.get(hitR.collider.handle);
    let nx = hitR.normal.x, ny = hitR.normal.y, nz = hitR.normal.z;
    if (nx * nx + ny * ny + nz * nz < 0.25) { nx = -dx; ny = -dy; nz = -dz; }   // started inside: push back along the ray
    h.nx = nx; h.ny = ny; h.nz = nz; h.mat = info.mat; h.body = info.body; h.car = info.car;
    if (info.pad) {
      const ex = ox + dx * t - info.pad.x, ez = oz + dz * t - info.pad.z;
      if (ex * ex + ez * ez <= PAD_R * PAD_R) h.mat = MATERIALS.pad;
    }
  }
  if (sdf) {
    const ts = marchSdf(sdf, ox, oy, oz, dx, dy, dz, t >= 0 ? t : maxT, h);
    if (ts >= 0) { t = ts; h.body = null; h.car = false; }
  }
  h.t = t;
  return t;
}

// --- Stepping ---------------------------------------------------------------------------------------
const pv = { x: 0, y: 0, z: 0 }, pt = { x: 0, y: 0, z: 0 }, imp = { x: 0, y: 0, z: 0 }, tv = { x: 0, y: 0, z: 0 }, tq = { x: 0, y: 0, z: 0, w: 1 };
function rot(q, x, y, z, out) {
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  out.x = x + q.w * tx + (q.y * tz - q.z * ty); out.y = y + q.w * ty + (q.z * tx - q.x * tz); out.z = z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}
const up = { x: 0, y: 0, z: 0 }, anc = { x: 0, y: 0, z: 0 }, ctr = { x: 0, y: 0, z: 0 }, vo = { x: 0, y: 0, z: 0 };

// The parked bodies' own forces for this tick, before the engine steps: each awake body's four
// corners. A spring and damper along the body's down axis to whatever is under the wheel, a bump
// stop past the travel, and a parked tyre: locked, it cancels the patch's sliding (a velocity
// constraint over the step, as a static friction) up to μ × load. What a tyre stands on gets the
// opposite push (another parked body directly; the roadster through `w.carF`/`w.carT`).
export function preStep(w) {
  w.carF.x = 0; w.carF.y = 0; w.carF.z = 0; w.carT.x = 0; w.carT.y = 0; w.carT.z = 0;
  const dt = WORLD_DT;
  for (const b of w.bodies) {
    const rb = b.rb;
    if (!rb || rb.isSleeping()) continue;
    const q = rb.rotation(tq), p = rb.translation(ctr);
    rot(q, 0, -1, 0, up);                   // the body's down, in the world
    const S = b.susp;
    for (const wh of b.wheels) {
      rot(q, wh.x, wh.y, wh.z, anc);
      const ax = p.x + anc.x + w.ox, ay = p.y + anc.y + w.oy, az = p.z + anc.z + w.oz;
      const maxT = S.rest + wh.R, mc = wh.mc;
      const t = raycast(w, ax, ay, az, up.x, up.y, up.z, maxT, rb);
      const prev = wh.comp;
      if (t < 0) { wh.contact = false; wh.comp = 0; wh.load = 0; continue; }
      const h = w.hit;
      const comp = maxT - t;
      wh.comp = comp; wh.contact = true;
      let fs = wh.k * Math.min(comp, S.rest) + wh.c * ((comp - prev) / dt);
      const over = comp - (S.rest - S.mount + S.travel);
      if (over > 0) fs += wh.bump * over;
      if (fs < 0) fs = 0;
      const cosn = -(up.x * h.nx + up.y * h.ny + up.z * h.nz);
      const Fz = fs * (cosn > 0.3 ? cosn : 0.3);
      wh.load = Fz;
      // The patch, its velocity relative to what it stands on, in the contact plane.
      pt.x = ax + up.x * t - w.ox; pt.y = ay + up.y * t - w.oy; pt.z = az + up.z * t - w.oz;
      rb.velocityAtPoint(pt, pv);
      vo.x = 0; vo.y = 0; vo.z = 0;
      if (h.body?.rb) h.body.rb.velocityAtPoint(pt, vo);
      else if (h.car && w.carRb) w.carRb.velocityAtPoint(pt, vo);
      let rx = pv.x - vo.x, ry = pv.y - vo.y, rz = pv.z - vo.z;
      const rn = rx * h.nx + ry * h.ny + rz * h.nz;
      rx -= h.nx * rn; ry -= h.ny * rn; rz -= h.nz * rn;
      // Gravity's pull along the slope is held too, as in the roadster's own stiction.
      const gn = -G * h.ny;
      const gx = -h.nx * gn, gy = -G - h.ny * gn, gz = -h.nz * gn;
      let fx = -mc * (rx / dt * 0.5 + gx), fy = -mc * (ry / dt * 0.5 + gy), fz = -mc * (rz / dt * 0.5 + gz);
      const lim = S.mu * h.mat.grip * Fz, f = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (f > lim && f > 0) { fx *= lim / f; fy *= lim / f; fz *= lim / f; }
      imp.x = (h.nx * Fz + fx) * dt; imp.y = (h.ny * Fz + fy) * dt; imp.z = (h.nz * Fz + fz) * dt;
      rb.applyImpulseAtPoint(imp, pt, false);
      imp.x = -imp.x; imp.y = -imp.y; imp.z = -imp.z;
      if (h.body?.rb) h.body.rb.applyImpulseAtPoint(imp, pt, true);
      else if (h.car && w.carPos) {
        const Fx = imp.x / dt, Fy = imp.y / dt, Fz2 = imp.z / dt;
        const r0 = pt.x + w.ox - w.carPos.x, r1 = pt.y + w.oy - w.carPos.y, r2 = pt.z + w.oz - w.carPos.z;
        w.carF.x += Fx; w.carF.y += Fy; w.carF.z += Fz2;
        w.carT.x += r1 * Fz2 - r2 * Fy; w.carT.y += r2 * Fx - r0 * Fz2; w.carT.z += r0 * Fy - r1 * Fx;
      }
    }
  }
}

// Step the engine one tick, then copy every moving parked body's pose back to its mirror.
export function stepEngine(w) {
  // Each body's velocity going into the step (a contact's closing speed is measured against it).
  for (const b of w.bodies) { b.pvx = b.vx; b.pvy = b.vy; b.pvz = b.vz; b.pwx = b.wx; b.pwy = b.wy; b.pwz = b.wz; }
  w.rw.step(w.events);
  if (w.carCol) w.events.drainCollisionEvents(w.onCollision);
  let moved = false;
  for (const b of w.bodies) {
    const rb = b.rb;
    if (!rb || rb.isSleeping()) { b.asleep = true; b.vx = 0; b.vy = 0; b.vz = 0; b.wx = 0; b.wy = 0; b.wz = 0; continue; }
    b.asleep = false;
    const p = rb.translation(tv), q = rb.rotation(tq);
    b.cx = p.x + w.ox; b.cy = p.y + w.oy; b.cz = p.z + w.oz;
    b.qx = q.x; b.qy = q.y; b.qz = q.z; b.qw = q.w;
    // Heading: where the body's +x (its nose) points, about +y.
    rot(q, 1, 0, 0, up);
    b.yaw = datan2(-up.z, up.x);
    const v = rb.linvel(tv); b.vx = v.x; b.vy = v.y; b.vz = v.z;
    const a = rb.angvel(tv); b.wx = a.x; b.wy = a.y; b.wz = a.z;
    b.moved = true; moved = true;
  }
  if (moved) refreshBounds(w);
}
