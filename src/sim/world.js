// A run's physical world in the rigid-body engine (Rapier, src/sim/engine.js): the course as static
// colliders, every parked vehicle as its own rigid body on four suspended, parked tyres, and the
// roadster's rigid hull (attached by src/sim/vehicle.js). Each run builds a fresh one, so a shoved
// car stays shoved for that run only and replays the same way (the server re-simulates it).
//
// What the engine does: integrates every body, finds and solves every contact (body on body, body
// on ground or deck), friction and restitution per material pair, sleeping.
// What this file adds on top, as forces on the engine's bodies: the parked vehicles' suspension
// (spring, damper, bump stop per corner) and their parked tyres (locked, friction-limited); the launch
// complex's solids, streamed in when the car comes near them, and the static fire's jet on the car
// (src/sim/complex.js, src/sim/rocket.js); in Free Drive and the Sandbox, the loose things a car
// knocks about (cones, barriers, a parked car: src/sim/props.js), pooled and streamed with the cells.
// Pure and deterministic: the engine is the cross-platform-deterministic build, every input is
// set in the same order on every host, and nothing here reads a clock or a random source.
import { RAPIER as R, requirePhysics } from './engine.js';
import { WALL, wallProfile, RAMP, MATERIALS, parkedMirror, refreshBounds, PAD_R, PARK_MU, fixturesOf } from './courses.js';
import { RAILS, roadSurface, bridgePier, PIER, tunnelArch, cellKey } from './roads.js';
import { CELL, bakedScenery, endlessScenery } from './scenery.js';
import { dsin, dcos, datan2 } from './dmath.js';
import { siteOf, siteSolids, toWorld as siteWorld, toLocal as siteLocal, SITE_RADIUS, SITE_TOP, PLUME } from './complex.js';
import { staticFire, fireClock, jetSpeed, JET, CAR_CDA } from './rocket.js';

export const WORLD_DT = 1 / 240;
const G = 9.81;
// Collision groups (membership << 16 | filter). Rays choose what they may hit.
export const GROUP = { static: 1, parked: 2, car: 4, approx: 8, curl: 16 };
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
// A mesh's bounding box [minX, minY, minZ, maxX, maxY, maxZ] (the floor fast path in `raycast`).
function meshBox(v) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], v[i + k]); b[k + 3] = Math.max(b[k + 3], v[i + k]); }
  return b;
}

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
    w.solids.push([x - 0.15, 0, z - 0.15, x + 0.15, top, z + 0.15]);
  }
  for (let z = 6.2; z <= WALL.r1 + 0.3; z += 1.45) {
    const y = WALL.r1 - Math.sqrt(Math.max(0, (WALL.r1 + T) * (WALL.r1 + T) - z * z));
    if (y < 0.35) continue;
    for (const x of [-1.9, 1.9]) {
      colliderFor(w, R.ColliderDesc.cuboid(0.09, y / 2, 0.09).setTranslation(x, y / 2, z), MATERIALS.steel, GROUP.static);
      w.solids.push([x - 0.09, 0, z - 0.09, x + 0.09, y, z + 0.09]);
    }
  }
}

// A parked vehicle: a rigid body (its own mass, CoM, inertia tensor), a box collider from its
// ground clearance to its roof, and four suspended corners. It starts asleep, at rest on its
// springs exactly where the course parked it: until something touches it, it costs nothing.
function addParked(w, b, index) {
  const m = parkedMirror(b), ph = m.phys;
  m.index = index;
  const rb = w.rw.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(m.cx - w.ox, 0 - w.oy, m.cz - w.oz).setSleeping(true));
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
    minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0, stream: null, chunk: null, freed: false, solids: null, curl: false, curlOn: true,
    // The run's tick (src/sim/vehicle.js sets it: the static fire's clock), the roadster's attitude,
    // the launch complex (null where there is none) and the loose props in the engine now.
    tick: 0, carQuat: null, site: null, props: [], fixtures: null,
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
    // Free Drive and the Sandbox: the road is exact geometry (src/sim/roads.js) the tyres read
    // directly; the engine gets the world near the car for the hull, streamed as the car moves:
    // the ground, the road's structures, the scenery, and every placed piece (streamFree, below).
    w.free = {
      cells: new Map(), queue: [], qi: 0, ix: NaN, iz: NaN, init: false, near: null, fixed: [],
      pieces: new Map(), srcVer: [], px: NaN, pz: NaN, seen: new Set(),
      // Loose props (cones, barriers, parked cars): the active ones by their store object, a pool of
      // disabled bodies per kind, and where each knocked one was left when it streamed out.
      props: new Map(), pool: new Map(), kept: new WeakMap(),
      scenery: course.scenery ?? (course.road ? (course.road.sceneryOf ??= (course.road.endless ? endlessScenery : bakedScenery)(course.road)) : null),
      sources: [course.pieces, course.objects].filter((src) => src && src.near && src.shapes),
    };
    w.stream = streamFree;
    // A course without a road (the Sandbox's apron) is a plane, as far as it is drawn.
    if (!course.road) w.free.fixed.push(colliderFor(w, R.ColliderDesc.cuboid(1800, 1, 1800).setTranslation(0, -1, 0), MATERIALS.concrete, GROUP.approx));
  } else {
    const floor = colliderFor(w, R.ColliderDesc.cuboid(1500, 1, 1500).setTranslation(0, -1, 0), MATERIALS.concrete, GROUP.static);
    // The landing mark is a film of paint on that concrete: the floor's material inside its disc.
    if (course.pad) w.info.get(floor.handle).pad = course.pad;
    if (course.id === 'wall' || course.id === 'show') {
      WALL_MESH ??= wallMesh();
      colliderFor(w, R.ColliderDesc.trimesh(WALL_MESH.v, WALL_MESH.idx, R.TriMeshFlags.FIX_INTERNAL_EDGES), MATERIALS.deck, GROUP.curl);
      w.solids = [meshBox(WALL_MESH.v)];
      w.curl = true;
      wallSteel(w);
    }
    if (course.ramp) { const k = kickerMesh(); colliderFor(w, R.ColliderDesc.trimesh(k.v, k.idx, R.TriMeshFlags.FIX_INTERNAL_EDGES), MATERIALS.deck, GROUP.static); (w.solids ??= []).push(meshBox(k.v)); }
    w.solids ??= [];
    // The stage's fixtures (uplights, searchlight drums, floodlight poles): solid, as drawn, each in
    // the engine only while the car is within reach of it (fixtureTick).
    w.fixtures = fixturesOf(course.id).map((f) => {
      const hx = f.hx ?? f.r, hz = f.hz ?? f.r, hy = f.hy ?? f.hh;
      return { f, col: null, box: [f.x - hx, f.y - hy, f.z - hz, f.x + hx, f.y + hy, f.z + hz], reach: Math.sqrt(hx * hx + hy * hy + hz * hz) + FIX_REACH };
    });
    // The launch complex beyond the stage: its solids join the world when the car comes near.
    const at = siteOf(course.id);
    if (at) w.site = { at, cols: [], solid: null, f: {}, push: 0 };
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
  for (const b of w.props) { b.rb = null; }
  if (w.free) { w.free.props.clear(); w.free.pool.clear(); }
  w.props.length = 0;
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

// The curl's deck is the inside of a circle (radius WALL.r1 about z 0, y r1, seen from the side)
// and the whole slab lies outside that disc: the arc, the ledge on its tangent, the slab behind them
// (the mesh's chords sit under 0.5 mm inside the circle). A convex hull's farthest point from the
// centre is one of its corners, so a hull whose farthest corner is δ inside the circle is at least δ
// from every triangle of it. While δ beats a margin (2 cm, ten times the engine's contact prediction,
// plus however far a hull point can travel in the tick) the hull can't touch the curl this step, and
// the engine is spared testing it against the triangles: the bulk of a replay's step time on the
// Wall, and the server replays every run on a CPU budget. The engine's answer isn't bit-identical
// across the gate (its pair caches restart when the pair comes back), so this is sim behaviour
// (SIM_VERSION 20); the reference runs replay to the same bits either way.
const CURL_MARGIN = 0.02;
export const GATES = { curl: true, rays: true };   // the tests switch them off to compare
export function gateCurl(w, far, travel) {
  if (!w.curl || !w.carCol) return;
  const on = !GATES.curl || WALL.r1 - far <= CURL_MARGIN + travel;
  if (on === w.curlOn) return;
  w.curlOn = on;
  w.carCol.setCollisionGroups(groups(GROUP.car, on ? 0xffff : 0xffff & ~GROUP.curl));
}

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

// --- Free Drive and the Sandbox: the world near the car, for the hull ------------------------------
// The tyres read the exact road (src/sim/roads.js); what the engine needs is everything the body
// can hit, and only what is drawn. The world near the car is kept in CELL (16 m) squares, streamed
// as the car moves, each built once:
//   - a heightfield of the ground (the road's own surface, the graded roadside and the land), 2 m
//     posts sampled from the exact surface on the renderer's 4 m lattice;
//   - the road's guard rails, stone walls and tunnel walls (boxes per 3 m segment), the tunnel's
//     arch (four plates), a bridge's girder and its piers, as src/render/road.js draws them;
//   - the scenery (src/sim/scenery.js): tree trunks as cylinders, boulders as convex hulls, brush
//     and foliage as soft volumes (a drag force, not a collider).
// Cells within one of the car's are built at once; the rest of the window (±3 cells: 32–48 m of
// warning ahead) one a tick, nearest first, so a new row costs a few small builds spread over
// ticks instead of one big rebuild. Placed things (build pieces, the world API's objects) follow
// as their own colliders. The engine's origin moves with the car in REBASE steps (the roads span
// kilometres and the engine stores single-precision floats); a move translates what is built.
const HN = 8, WIN = 3, REBASE = 384, PIECE_R = 64;
const q0 = { x: 0, y: 0, z: 0, w: 1 }, qr = { x: 0, y: 0, z: 0, w: 1 };
const yawQuat = (q, th) => { q.x = 0; q.y = dsin(th / 2); q.z = 0; q.w = dcos(th / 2); return q; };
// q = yaw(th) · roll(φ about the yawed +z): a plate in the road's cross-section.
function yawRoll(q, th, phi) {
  const ay = dsin(th / 2), aw = dcos(th / 2), bz = dsin(phi / 2), bw = dcos(phi / 2);
  q.x = ay * bz; q.y = ay * bw; q.z = aw * bz; q.w = aw * bw;
  return q;
}

function place(w, desc, x, y, z) { return desc.setTranslation(x - w.ox, y - w.oy, z - w.oz); }
function drop(w, cols) { for (const col of cols) { w.info.delete(col.handle); w.rw.removeCollider(col, false); } cols.length = 0; }

// The road's structures on segment i, as hull colliders into cols.
function segmentSolids(w, road, i, cols) {
  const L = road.len[i], mx = road.sx[i] + road.dx[i] * L / 2, mz = road.sz[i] + road.dz[i] * L / 2;
  const my = road.y[i] + road.grade[i] * L / 2, fl = road.flags[i], th = datan2(road.dx[i], road.dz[i]);
  const lx = road.dz[i], lz = -road.dx[i];
  yawQuat(q0, th);
  for (const side of [1, -1]) {
    const kind = side > 0 ? (fl >> 2) & 3 : (fl >> 4) & 3;
    if (!kind) continue;
    const rr = RAILS[kind], off = road.hw[i] + rr.off + rr.t / 2, base = my + road.bank[i] * off * side;
    const d = R.ColliderDesc.cuboid(rr.t / 2, (rr.h + 1) / 2, L / 2 + 0.05).setRotation(q0);
    cols.push(colliderFor(w, place(w, d, mx + lx * off * side, base + (rr.h - 1) / 2, mz + lz * off * side), MATERIALS.barrier, GROUP.approx));
  }
  if (fl & 2) {
    // The arch: from the wall's top (3.6 m) to the haunch (5.0 m at 0.7 of the bore) to the crown
    // (5.6 m), each side, as 0.6 m plates lying on the drawn shell, in the rock above it.
    const H = road.hw[i] + RAILS[3].off, T = 0.6;
    for (const side of [1, -1]) for (const [a0, a1] of [[H, 0.7 * H], [0.7 * H, 0]]) {
      const l0 = side * a0, l1 = side * a1;
      const y0 = my + road.bank[i] * side * Math.min(a0, road.hw[i]) + tunnelArch(a0, H), y1 = my + road.bank[i] * side * Math.min(a1, road.hw[i]) + tunnelArch(a1, H);
      const el = l1 - l0, ey = y1 - y0, len = Math.sqrt(el * el + ey * ey), phi = datan2(ey, el);
      // Up and out of the bore: the plate's normal, (−ey, el)/len, turned to point up.
      let nl = -ey / len, ny = el / len;
      if (ny < 0) { nl = -nl; ny = -ny; }
      const cl = (l0 + l1) / 2 + nl * T / 2, cy = (y0 + y1) / 2 + ny * T / 2;
      const d = R.ColliderDesc.cuboid(len / 2 + 0.05, T / 2, L / 2 + 0.05).setRotation(yawRoll(qr, th, phi));
      cols.push(colliderFor(w, place(w, d, mx + lx * cl, cy, mz + lz * cl), MATERIALS.barrier, GROUP.approx));
    }
  }
  if (fl & 1) {
    // The bridge's box girder under the deck (drawn 0.2–1.9 m under it, ±(hw + 1.1), its lower
    // corners chamfered): two boxes. And a pier where one stands.
    const hw = road.hw[i];
    for (const [hx, y0, y1] of [[hw + 1.1, -1.3, -0.2], [hw + 0.3, -1.9, -0.2]]) {
      const d = R.ColliderDesc.cuboid(hx, (y1 - y0) / 2, L / 2 + 0.05).setRotation(q0);
      cols.push(colliderFor(w, place(w, d, mx, my + (y0 + y1) / 2, mz), MATERIALS.concrete, GROUP.approx));
    }
    const gy = bridgePier(road, i);
    if (gy !== null) {
      const a = Math.max(0, i - 1), b = Math.min(road.n - 1, i + 1);
      const top = road.y[i] - PIER.top, bot = Math.max(gy - PIER.sink, PIER.floor);
      const d = R.ColliderDesc.cuboid(road.hw[i] * PIER.half, (top - bot) / 2, PIER.along).setRotation(yawQuat(qr, datan2(road.x[b] - road.x[a], road.z[b] - road.z[a])));
      cols.push(colliderFor(w, place(w, d, road.x[i], (top + bot) / 2, road.z[i]), MATERIALS.concrete, GROUP.approx));
    }
  }
}

// A scenery spec (src/sim/scenery.js) as a collider, or a soft volume.
function sceneSolid(w, s, cell) {
  if (s.kind === 'trunk') {
    cell.cols.push(colliderFor(w, place(w, R.ColliderDesc.cylinder(s.h / 2, s.r), s.x, s.y + s.h / 2, s.z), s.mat, GROUP.static));
  } else if (s.kind === 'hull') {
    const d = R.ColliderDesc.convexHull(s.points);
    if (d) cell.cols.push(colliderFor(w, place(w, d.setRotation(yawQuat(qr, s.yaw)), s.x, s.y, s.z), s.mat, GROUP.static));
  } else if (s.kind === 'soft') cell.soft.push(s);
}

const segSeen = new Set(), specs = [], lowered = new Float32Array((HN + 1) * (HN + 1));
function buildCell(w, ix, iz, yHint) {
  const F = w.free, road = w.course.road;
  const cell = { ix, iz, y: yHint, cols: [], soft: [] };
  const x0 = ix * CELL, z0 = iz * CELL;
  if (road) {
    const sdf = (x, y, z, out) => roadSurface(road, x, y, z, out, true);   // the ground, not what's built on it
    if (road.ensure && (iz + 1) * CELL + road.reach + 40 > road.zMax) road.ensure((iz + 1) * CELL);
    const hs = new Float32Array((HN + 1) * (HN + 1)), step = CELL / HN;
    // Column-major (rows along z, columns along x), as the engine's heightfield stores it.
    for (let j = 0; j <= HN; j++) for (let i = 0; i <= HN; i++) hs[j * (HN + 1) + i] = surfaceHeight(sdf, x0 + j * step, z0 + i * step, yHint + 1.5) - w.oy;
    // Never above the ground: where the ground dips between posts (a ditch where a fill slope meets
    // the land, the hinge of a cut) a straight chord would stand over it, a floor in the air the hull
    // would rest on with a wheel hanging in the ditch. Each 2 m square's middle is sampled too, and
    // where it lies under the chord across the square, its four posts come down by the difference.
    lowered.set(hs);
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
      const a = (j + 1) * (HN + 1) + i, b = j * (HN + 1) + i + 1;          // the split's ends: (+x, z), (x, +z)
      const dip = (hs[a] + hs[b]) / 2 - (surfaceHeight(sdf, x0 + (j + 0.5) * step, z0 + (i + 0.5) * step, yHint + 1.5) - w.oy);
      if (dip <= 0.005) continue;
      for (const k of [a - (HN + 1), a, b, b + (HN + 1)]) if (hs[k] - dip < lowered[k]) lowered[k] = hs[k] - dip;
    }
    hs.set(lowered);
    // Its material: the ground's at the cell's middle (the hull scrapes asphalt, or grass).
    sdf(x0 + CELL / 2, hs[(HN / 2) * (HN + 1) + HN / 2] + w.oy + 0.01, z0 + CELL / 2, sdfOut);
    // The engine splits each cell from its (+x, −z) corner to its (−x, +z) corner, as the renderer
    // does (and the terrain the tyres read: src/sim/roads.js terrainAt).
    const d = R.ColliderDesc.heightfield(HN, HN, hs, { x: CELL, y: 1, z: CELL });
    cell.cols.push(colliderFor(w, place(w, d, x0 + CELL / 2, w.oy, z0 + CELL / 2), sdfOut.mat || MATERIALS.asphalt, GROUP.approx));
    // The structures on every segment whose middle lies in this cell.
    segSeen.clear();
    const g = road.grid;
    const visit = (list, a, b) => {
      for (let k = a; k < b; k++) {
        const i = list[k];
        if (segSeen.has(i)) continue;
        segSeen.add(i);
        const L = road.len[i], mx = road.sx[i] + road.dx[i] * L / 2, mz = road.sz[i] + road.dz[i] * L / 2;
        if (mx >= x0 && mx < x0 + CELL && mz >= z0 && mz < z0 + CELL && (road.flags[i] & 63)) segmentSolids(w, road, i, cell.cols);
      }
    };
    if (g.cells) {
      const list = g.cells.get(cellKey(Math.floor((x0 + CELL / 2) / g.cell), Math.floor((z0 + CELL / 2) / g.cell)));
      if (list) visit(list, 0, list.length);
    } else {
      const C8 = 8;   // src/sim/roads.js segment grid cell
      for (let cj = Math.floor((z0 - g.z0) / C8); cj <= Math.floor((z0 + CELL - g.z0) / C8); cj++) for (let ci = Math.floor((x0 - g.x0) / C8); ci <= Math.floor((x0 + CELL - g.x0) / C8); ci++) {
        if (ci < 0 || cj < 0 || ci >= g.nx || cj >= g.nz) continue;
        const c = cj * g.nx + ci;
        visit(g.list, g.start[c], g.start[c + 1]);
      }
    }
  }
  if (F.scenery) {
    specs.length = 0;
    F.scenery.cell(ix, iz, specs);
    for (const s of specs) sceneSolid(w, s, cell);
  }
  return cell;
}

// Placed things near the car (build pieces; the endless world's objects): their colliders follow
// the stores, added and dropped as they change or the car moves.
function syncPieces(w, pos) {
  const F = w.free, srcs = F.sources;
  if (!srcs.length) return;
  let changed = false;
  for (let k = 0; k < srcs.length; k++) if (srcs[k].version !== F.srcVer[k]) { F.srcVer[k] = srcs[k].version; changed = true; }
  const mx = pos.x - F.px, mz = pos.z - F.pz;
  if (!changed && mx * mx + mz * mz < 64) return;
  F.px = pos.x; F.pz = pos.z;
  const seen = F.seen;
  seen.clear();
  dyn.length = 0;
  for (const src of srcs) {
    for (const o of src.near(pos.x, pos.z, PIECE_R)) {
      // A loose prop is a body of its own (below), not a static collider.
      const body = src.body ? src.body(o) : null;
      if (body) { dyn.push(o, body); continue; }
      seen.add(o);
      if (F.pieces.has(o)) continue;
      const cols = [];
      for (const s of src.shapes(o)) {
        let d = null;
        if (s.kind === 'box') d = R.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
        else if (s.kind === 'hull') d = R.ColliderDesc.convexHull(s.points);
        if (d) cols.push(colliderFor(w, place(w, d.setRotation(yawQuat(qr, s.yaw)), s.x, s.y, s.z), s.mat, GROUP.approx));
      }
      F.pieces.set(o, cols);
    }
  }
  for (const [o, cols] of F.pieces) if (!seen.has(o)) { drop(w, cols); F.pieces.delete(o); }
  syncProps(w, pos);
}

// --- Loose props: cones, barriers, parked cars (src/sim/props.js) ---------------------------------------
// The budget, per world: at most PROP_CAP of them in the engine at once, the nearest to the car, each
// asleep until something touches it (Rapier's islands: a sleeping body costs nothing a tick). A prop
// that streams out is disabled and pooled for the next of its kind; where it was knocked to is kept
// for when the car comes back. The light ones sweep (CCD): at 30 m/s a car moves 12 cm a tick and
// throws a cone faster than its own size per tick; the parked cars and everything static don't.
export const PROP_CAP = 48;
// And at most PROP_BUILDS a tick come in (a new body, or one from the pool), nearest first: a car
// arriving at a slalom of 48 cones spreads them over six ticks instead of one long one.
export const PROP_BUILDS = 8;
const PROP_LIFT = 0.005;
const dyn = [], order = [];
const placed = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
function syncProps(w, pos) {
  const F = w.free;
  // A body knocked away from where it was placed is found by where it is now, not by the store's
  // query (which knows the placement): keep every active one still within reach.
  for (const [o, p] of F.props) {
    const dx = p.cx - pos.x, dz = p.cz - pos.z;
    if (dx * dx + dz * dz < PIECE_R * PIECE_R && dyn.indexOf(o) < 0) dyn.push(o, p.body);
  }
  // Nearest first, up to the cap (where it was left, if it was moved).
  order.length = 0;
  for (let k = 0; k < dyn.length; k += 2) {
    const o = dyn[k], kept = F.kept.get(o), x = kept ? kept.cx : o.transform.x, z = kept ? kept.cz : o.transform.z;
    order.push({ o, body: dyn[k + 1], d: (x - pos.x) * (x - pos.x) + (z - pos.z) * (z - pos.z) });
  }
  if (order.length > PROP_CAP) { order.sort((a, b) => a.d - b.d); order.length = PROP_CAP; }
  const want = (F.want ??= new Set());
  want.clear();
  for (const e of order) want.add(e.o);
  for (const [o, p] of F.props) if (!want.has(o)) releaseProp(w, o, p);
  if (order.length > PROP_BUILDS) order.sort((a, b) => a.d - b.d);
  let built = 0;
  for (const e of order) {
    if (F.props.has(e.o)) continue;
    if (built++ === PROP_BUILDS) { F.px = NaN; break; }   // the rest next tick (syncPieces runs again)
    acquireProp(w, e.o, e.body);
  }
}
const yawQ = (q, th) => { q.qx = 0; q.qy = dsin(th / 2); q.qz = 0; q.qw = dcos(th / 2); return q; };
function placedPose(o, body) {
  const t = o.transform;
  // A few millimetres up: a body put down touching the ground starts a contact, and a new contact
  // wakes it for two seconds; one that drops 5 mm the first time it's woken never needed to be awake.
  placed.x = t.x; placed.y = t.y + PROP_LIFT; placed.z = t.z;
  // A parked car's frame runs its length along x; the piece faces +z (src/build/catalogue.js).
  return yawQ(placed, body.kind === 'parked' ? t.yaw - Math.PI / 2 : t.yaw);
}
function newProp(w, body) {
  const rb = w.rw.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(!!body.ccd).setSleeping(true));
  rb.setAdditionalMassProperties(body.mass, { x: 0, y: body.com, z: 0 }, body.inertia, { x: 0, y: 0, z: 0, w: 1 }, false);
  const m = {
    id: body.spec.id, kind: 'prop', phys: { cgh: body.com }, mass: body.mass, mat: body.mat, index: -1, rb, collider: null,
    hx: body.size, hz: body.size, h: body.size, clr: 0,
    cx: 0, cy: 0, cz: 0, qx: 0, qy: 0, qz: 0, qw: 1, yaw: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, pvx: 0, pvy: 0, pvz: 0, pwx: 0, pwy: 0, pwz: 0,
    moved: false, asleep: true,
  };
  for (const sh of body.shapes) {
    const d = sh.kind === 'hull' ? R.ColliderDesc.convexHull(sh.points) : R.ColliderDesc.cuboid(sh.hx, sh.hy, sh.hz).setTranslation(sh.x, sh.y, sh.z);
    if (d) m.collider = colliderFor(w, d.setDensity(0), body.mat, GROUP.parked, m);
  }
  return m;
}
function acquireProp(w, o, body) {
  const F = w.free, key = body.kind === 'parked' ? `car:${body.s}` : `${body.spec.id}:${body.s}`;
  let p = F.pool.get(key)?.pop();
  if (!p) {
    p = body.kind === 'parked' ? addParked(w, body.vehicle, -1) : newProp(w, body);
    p.key = key;
  } else p.rb.setEnabled(true);
  const pose = F.kept.get(o) || placedPose(o, body);
  const rb = p.rb;
  rb.setTranslation({ x: (pose.cx ?? pose.x) - w.ox, y: (pose.cy ?? pose.y) - w.oy, z: (pose.cz ?? pose.z) - w.oz }, false);
  rb.setRotation({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw }, false);
  rb.setLinvel({ x: 0, y: 0, z: 0 }, false); rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
  rb.sleep();
  p.cx = pose.cx ?? pose.x; p.cy = pose.cy ?? pose.y; p.cz = pose.cz ?? pose.z;
  p.qx = pose.qx; p.qy = pose.qy; p.qz = pose.qz; p.qw = pose.qw;
  p.vx = p.vy = p.vz = p.wx = p.wy = p.wz = 0;
  p.moved = !!F.kept.get(o); p.asleep = true; p.o = o; p.body = body;
  if (p.wheels) for (const wh of p.wheels) { wh.comp = p.susp.rest - p.susp.mount; wh.contact = true; }
  F.props.set(o, p);
  w.props.push(p);
}
function releaseProp(w, o, p) {
  const F = w.free;
  if (p.moved) F.kept.set(o, { cx: p.cx, cy: p.cy, cz: p.cz, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
  p.rb.setEnabled(false);
  let pool = F.pool.get(p.key);
  if (!pool) F.pool.set(p.key, (pool = []));
  pool.push(p);
  F.props.delete(o);
  const i = w.props.indexOf(p);
  if (i >= 0) w.props.splice(i, 1);
  p.o = null;
}
/** Where a placed object's prop is now (its body's pose, or where it was left), or null if it never moved. */
export function propPose(w, o) {
  const p = w?.free?.props.get(o);
  if (p) return p;
  return w?.free?.kept.get(o) || null;
}

// Move the engine's origin to (x, y, z): everything built moves with it.
function rebase(w, x, y, z) {
  const F = w.free, dx = x - w.ox, dy = y - w.oy, dz = z - w.oz;
  w.ox = x; w.oy = y; w.oz = z;
  const move = (col) => { const t = col.translation(); col.setTranslation({ x: t.x - dx, y: t.y - dy, z: t.z - dz }); };
  for (const c of F.cells.values()) c.cols.forEach(move);
  for (const cols of F.pieces.values()) cols.forEach(move);
  F.fixed.forEach(move);
  for (const p of w.props) { const t = p.rb.translation(); p.rb.setTranslation({ x: t.x - dx, y: t.y - dy, z: t.z - dz }, false); }
}

const cheb = (c, ix, iz) => Math.max(Math.abs(c.ix - ix), Math.abs(c.iz - iz));
function streamFree(w, pos) {
  const F = w.free;
  // The origin: near the car (a cell corner, a whole metre up), moved when the car is REBASE away.
  if (!F.init || Math.abs(pos.x - w.ox) > REBASE || Math.abs(pos.z - w.oz) > REBASE || Math.abs(pos.y - w.oy) > REBASE) {
    const ox = Math.round(pos.x / CELL) * CELL, oz = Math.round(pos.z / CELL) * CELL, oy = Math.round(pos.y);
    rebase(w, ox, oy, oz);
    F.init = true;
  }
  const ix = Math.floor(pos.x / CELL), iz = Math.floor(pos.z / CELL);
  if (ix !== F.ix || iz !== F.iz) {
    const jump = !(Math.abs(ix - F.ix) <= WIN && Math.abs(iz - F.iz) <= WIN);
    F.ix = ix; F.iz = iz;
    for (const [k, c] of F.cells) if (cheb(c, ix, iz) > WIN + 1) { drop(w, c.cols); F.cells.delete(k); }
    F.queue.length = 0; F.qi = 0;
    for (let d = 0; d <= WIN; d++) for (let b = iz - d; b <= iz + d; b++) for (let a = ix - d; a <= ix + d; a++) {
      if (Math.max(Math.abs(a - ix), Math.abs(b - iz)) !== d || F.cells.has(cellKey(a, b))) continue;
      F.queue.push(a, b);
    }
    // A first build, or a jump (a reset): all of it now.
    if (jump) { for (let k = 0; k < F.queue.length; k += 2) F.cells.set(cellKey(F.queue[k], F.queue[k + 1]), buildCell(w, F.queue[k], F.queue[k + 1], pos.y)); F.queue.length = 0; }
    F.near = null;
  }
  // The cells next to the car's: now (and again if the car has climbed or dropped far since).
  for (let b = iz - 1; b <= iz + 1; b++) for (let a = ix - 1; a <= ix + 1; a++) {
    const k = cellKey(a, b), c = F.cells.get(k);
    if (c && Math.abs(c.y - pos.y) < 24) continue;
    if (c) drop(w, c.cols);
    F.cells.set(k, buildCell(w, a, b, pos.y));
    F.near = null;
  }
  // The rest of the window, one a tick.
  while (F.qi < F.queue.length) {
    const a = F.queue[F.qi], b = F.queue[F.qi + 1];
    F.qi += 2;
    if (F.cells.has(cellKey(a, b))) continue;
    F.cells.set(cellKey(a, b), buildCell(w, a, b, pos.y));
    break;
  }
  // The soft volumes the car can be in this tick: those of the nine cells round it.
  if (!F.near) {
    F.near = [];
    for (let b = iz - 1; b <= iz + 1; b++) for (let a = ix - 1; a <= ix + 1; a++) { const c = F.cells.get(cellKey(a, b)); if (c) for (const s of c.soft) F.near.push(s); }
  }
  syncPieces(w, pos);
}

// Brush and foliage: while the car's body overlaps a soft volume, a drag against its motion,
// k·v scaled by how deep it is in (1 at the middle, 0 at the edge), as a force on the car
// (vehicle.js adds w.carF). The volume is grown by the car's half-size, so it is the car's body,
// not its centre, that brushes it.
const CAR_HX = 1.0, CAR_HY = 0.6;
function softDrag(w) {
  const p = w.carPos, v = w.carVel, list = w.free.near;
  if (!p || !v || !list) return;
  for (let k = 0; k < list.length; k++) {
    const s = list[k];
    const ex = (p.x - s.x) / (s.rx + CAR_HX), ey = (p.y - s.y) / (s.ry + CAR_HY), ez = (p.z - s.z) / (s.rz + CAR_HX);
    const e = ex * ex + ey * ey + ez * ez;
    if (e >= 1) continue;
    const f = s.k * (1 - e);
    w.carF.x -= f * v.x; w.carF.y -= f * v.y; w.carF.z -= f * v.z;
  }
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
  if (GATES.rays && w.solids && excludeRb === w.carRb && clear(w, ox, oy, oz, dx, dy, dz, maxT)) {
    // The roadster's own ray, clear of every collider's bounds: a miss, without a trip into the
    // engine (the server replays every run on a CPU budget). Only misses are answered here; a hit
    // is the engine's, to the last bit.
    h.t = -1;
    return -1;
  }
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

// True when the segment o → o + d·maxT stays clear (with a margin) of every collider: the floor's
// top (y = 0), the static boxes recorded at build time and each parked body's bounding sphere.
const RAY_MARGIN = 0.1;
function clear(w, ox, oy, oz, dx, dy, dz, maxT) {
  const ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
  const x0 = Math.min(ox, ex) - RAY_MARGIN, x1 = Math.max(ox, ex) + RAY_MARGIN;
  const y0 = Math.min(oy, ey) - RAY_MARGIN, y1 = Math.max(oy, ey) + RAY_MARGIN;
  const z0 = Math.min(oz, ez) - RAY_MARGIN, z1 = Math.max(oz, ez) + RAY_MARGIN;
  if (y0 <= 0) return false;
  for (const b of w.solids) if (x0 <= b[3] && x1 >= b[0] && y0 <= b[4] && y1 >= b[1] && z0 <= b[5] && z1 >= b[2]) return false;
  for (const b of w.bodies) {
    const r = Math.sqrt(b.hx * b.hx + b.hz * b.hz + b.h * b.h);
    if (x0 <= b.cx + r && x1 >= b.cx - r && y0 <= b.cy + r && y1 >= b.cy - r && z0 <= b.cz + r && z1 >= b.cz - r) return false;
  }
  return true;
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
  for (const b of w.bodies) parkedForces(w, b);
  for (let i = 0; i < w.props.length; i++) if (w.props[i].wheels) parkedForces(w, w.props[i]);
  if (w.free) softDrag(w);
  if (w.fixtures) fixtureTick(w);
  if (w.site) siteTick(w);
}

// The stage's fixtures: a dozen small static solids beside the lane. Always in the engine they cost
// a replay ≈ 4 % (every ray and the broad phase carry them), for things a run meets only if it
// leaves the line. So each is built the tick the car's CoM comes within FIX_REACH of its surface
// (the hull reaches 2.4 m from the CoM; 0.5 m more is two ticks at 60 m/s) and dropped 2 m further out.
const FIX_REACH = 3, FIX_DROP = 2;
function fixtureTick(w) {
  const p = w.carPos;
  if (!p) return;
  for (let i = 0; i < w.fixtures.length; i++) {
    const x = w.fixtures[i], f = x.f, dx = p.x - f.x, dy = p.y - f.y, dz = p.z - f.z, d2 = dx * dx + dy * dy + dz * dz;
    if (!x.col) {
      if (d2 >= x.reach * x.reach) continue;
      const d = f.kind === 'box' ? R.ColliderDesc.cuboid(f.hx, f.hy, f.hz) : R.ColliderDesc.cylinder(f.hh, f.r);
      x.col = colliderFor(w, d.setTranslation(f.x, f.y, f.z), MATERIALS.steel, GROUP.static);
      w.solids.push(x.box);
    } else if (d2 > (x.reach + FIX_DROP) * (x.reach + FIX_DROP)) {
      w.info.delete(x.col.handle); w.rw.removeCollider(x.col, false); x.col = null;
      const k = w.solids.indexOf(x.box);
      if (k >= 0) w.solids.splice(k, 1);
    }
  }
}
function parkedForces(w, b) {
  const dt = WORLD_DT;
  {
    const rb = b.rb;
    if (!rb || rb.isSleeping()) return;
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

// --- The launch complex (the Show, the Wall and the Lineup: src/sim/complex.js) ----------------------
// Its solids exist in the engine only while the car is within SITE_IN of the pad's centre (dropped past
// SITE_OUT): a run on the stage, 270 m away, never meets them, so the stunts replay as they did and
// the server's replay pays one distance check a tick. Built in one tick (≈ 30 colliders) the moment
// the car comes within reach: 60 m of warning, a second at the fastest the car drives.
const SITE_IN = SITE_RADIUS + 60, SITE_OUT = SITE_RADIUS + 90;
const qy = { x: 0, y: 0, z: 0, w: 1 }, qc = { x: 0, y: 0, z: 0, w: 1 }, sp = { x: 0, y: 0, z: 0 }, ax = { x: 0, y: 0, z: 0 };
function qmul(a, b, o) {
  o.x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y; o.y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  o.z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w; o.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  return o;
}
function buildSite(w) {
  const S = w.site, at = S.at;
  yawQuat(qy, at.yaw);
  for (const sh of siteSolids()) {
    const d = sh.kind === 'box' ? R.ColliderDesc.cuboid(sh.hx, sh.hy, sh.hz) : sh.kind === 'cyl' ? R.ColliderDesc.cylinder(sh.hh, sh.r)
      : sh.kind === 'ball' ? R.ColliderDesc.ball(sh.r) : R.ColliderDesc.convexHull(sh.points);
    if (!d) continue;
    siteWorld(at, sh.x, sh.y, sh.z, sp);
    S.cols.push(colliderFor(w, d.setRotation(qmul(qy, sh.q, qc)).setTranslation(sp.x - w.ox, sp.y - w.oy, sp.z - w.oz), sh.mat, GROUP.static));
  }
  // The rays' fast path (`clear`) must know it's there.
  S.solid = [at.x - SITE_RADIUS, -1, at.z - SITE_RADIUS, at.x + SITE_RADIUS, SITE_TOP, at.z + SITE_RADIUS];
  w.solids.push(S.solid);
}
function dropSite(w) {
  const S = w.site;
  drop(w, S.cols);
  const i = w.solids.indexOf(S.solid);
  if (i >= 0) w.solids.splice(i, 1);
  S.solid = null;
}
/** Whether the complex's solids are in the engine now (tests, the nerds panel). */
export const siteBuilt = (w) => !!w.site && w.site.cols.length > 0;
function siteTick(w) {
  const S = w.site, p = w.carPos;
  if (!p) return;
  const dx = p.x - S.at.x, dz = p.z - S.at.z, d2 = dx * dx + dz * dz;
  if (!S.cols.length) { if (d2 < SITE_IN * SITE_IN) buildSite(w); } else if (d2 > SITE_OUT * SITE_OUT) dropSite(w);
  S.push = 0;
  // The static fire: on the range's schedule (src/sim/rocket.js), its jet out of the trench's exit.
  const ft = fireClock(w.tick * WORLD_DT);
  if (ft < 0) return;
  // Where the car is against the jet: metres downstream of the exit (behind it, as the stage is: none).
  siteLocal(S.at, p.x, p.y, p.z, sp);
  const a = PLUME.exit[2] - sp.z, ey = sp.y - PLUME.exit[1], ex = sp.x - PLUME.exit[0];
  if (a < 0 || a > JET.reach) return;
  const f = staticFire(ft, S.f);
  const U = jetSpeed(f.thrust, a, ex * ex + ey * ey, PLUME.halfWidth);
  if (!(U > 0)) return;
  // The jet runs along the site's −z: in the world, (−sin yaw, 0, −cos yaw). Drag on the air moving
  // past the car, by the area it shows that air (src/sim/rocket.js CAR_CDA).
  const v = w.carVel, q = w.carQuat;
  const ux = -S.at.s * U - v.x, uy = -v.y, uz = -S.at.c * U - v.z, um = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (!(um > 0) || !q) return;
  rot(q, 0, 0, 1, ax); const cf = Math.abs(ax.x * ux + ax.y * uy + ax.z * uz) / um;
  rot(q, 1, 0, 0, ax); const cs = Math.abs(ax.x * ux + ax.y * uy + ax.z * uz) / um;
  rot(q, 0, 1, 0, ax); const cu = Math.abs(ax.x * ux + ax.y * uy + ax.z * uz) / um;
  const k = 0.5 * JET.rho * (CAR_CDA.front * cf + CAR_CDA.side * cs + CAR_CDA.floor * cu) * um;
  const fx = k * ux, fy = k * uy, fz = k * uz;
  w.carF.x += fx; w.carF.y += fy; w.carF.z += fz;
  // At the centre of pressure, above the CoM along the car's up (ax): it rolls the car away too.
  const rx = ax.x * CAR_CDA.cpUp, ry = ax.y * CAR_CDA.cpUp, rz = ax.z * CAR_CDA.cpUp;
  w.carT.x += ry * fz - rz * fy; w.carT.y += rz * fx - rx * fz; w.carT.z += rx * fy - ry * fx;
  S.push = Math.sqrt(fx * fx + fy * fy + fz * fz);
}

// Step the engine one tick, then copy every moving parked body's pose back to its mirror.
export function stepEngine(w) {
  // Each body's velocity going into the step (a contact's closing speed is measured against it).
  for (const b of w.bodies) { b.pvx = b.vx; b.pvy = b.vy; b.pvz = b.vz; b.pwx = b.wx; b.pwy = b.wy; b.pwz = b.wz; }
  for (const b of w.props) { b.pvx = b.vx; b.pvy = b.vy; b.pvz = b.vz; b.pwx = b.wx; b.pwy = b.wy; b.pwz = b.wz; }
  w.rw.step(w.events);
  if (w.carCol) w.events.drainCollisionEvents(w.onCollision);
  let moved = false;
  for (const b of w.bodies) if (readBody(w, b)) moved = true;
  for (let i = 0; i < w.props.length; i++) readBody(w, w.props[i]);
  if (moved) refreshBounds(w);
}
// Copy a body's pose and velocities from the engine to its mirror; false while it sleeps.
function readBody(w, b) {
  const rb = b.rb;
  if (!rb || rb.isSleeping()) { b.asleep = true; b.vx = 0; b.vy = 0; b.vz = 0; b.wx = 0; b.wy = 0; b.wz = 0; return false; }
  b.asleep = false;
  const p = rb.translation(tv), q = rb.rotation(tq);
  b.cx = p.x + w.ox; b.cy = p.y + w.oy; b.cz = p.z + w.oz;
  b.qx = q.x; b.qy = q.y; b.qz = q.z; b.qw = q.w;
  // Heading: where the body's +x (its nose) points, about +y.
  rot(q, 1, 0, 0, up);
  b.yaw = datan2(-up.z, up.x);
  const v = rb.linvel(tv); b.vx = v.x; b.vy = v.y; b.vz = v.z;
  const a = rb.angvel(tv); b.wx = a.x; b.wy = a.y; b.wz = a.z;
  b.moved = true;
  return true;
}
