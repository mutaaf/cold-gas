// BUILD: the object layer, a small world API for placed things.
//
//   WorldObject = { id, type, transform: { x, y, z, yaw, scale }, collider, material, sensor, tag, hidden }
//     type       a catalogue id (src/build/catalogue.js PIECES) or 'pickup:<powerup>'
//     transform  world position of the footprint centre on the ground, yaw (rad, about +y, the sim's
//                quatFromYaw convention: local +z → (sin yaw, 0, cos yaw)), uniform scale
//     collider   the catalogue's shape spec ({ kind, …dims }) or null for sensors
//     material   a BUILD_MATERIALS id; tag 'build' | 'quest'; hidden: drawn but not marked
//
//   store.addObject(spec) → object · store.removeObject(id) · store.objectsNear(x, z, r, out) →
//   out[] · store.sdf(x, y, z, out, phi) folds every solid near the point into a distance query.
//
// That is the whole interface the build/quest/power-up layer needs from a world. Free Drive's real
// roads and the Sandbox use this store directly. The infinite procedural world exposes the same
// verbs (world.addObject(spec) / world.objectsNear): hand it these specs as they are and let its
// `sdf` call `objectSdf` for each solid near the query, or keep this store beside it. Either way
// the colliders stay in src/build/colliders.js, behind one adapter.
import { PIECES, BUILD_MATERIALS, POWERUPS, SKIRT } from './catalogue.js';
import { shapeSdf, shapeBounds, profileOf, loopShift } from './colliders.js';
import { dsin, dcos } from '../sim/dmath.js';
import { CONE, BARRIER, propBody, parkedBody } from '../sim/props.js';

const TAU = 2 * Math.PI;

const CELL = 16;
const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
const nl = [0, 0, 0];
const lb = new Float64Array(6);

// Signed distance from a world point to one object's solid; world normal into out {x, y, z}.
export function objectSdf(o, x, y, z, out) {
  const dx = x - o.transform.x, dy = y - o.transform.y, dz = z - o.transform.z, k = o.inv;
  const lx = (o.c * dx - o.s * dz) * k, lz = (o.s * dx + o.c * dz) * k, ly = dy * k;
  const d = shapeSdf(o.collider, lx, ly, lz, nl);
  out.x = o.c * nl[0] + o.s * nl[2]; out.y = nl[1]; out.z = -o.s * nl[0] + o.c * nl[2];
  return d * o.transform.scale;
}

// World → object-local (scale 1) for sensors and footprints. Writes into out [x, y, z].
export function toLocal(o, x, y, z, out) {
  const dx = x - o.transform.x, dz = z - o.transform.z, k = o.inv;
  out[0] = (o.c * dx - o.s * dz) * k; out[1] = (y - o.transform.y) * k; out[2] = (o.s * dx + o.c * dz) * k;
  return out;
}

export function createObjectStore() {
  const objs = new Map();
  const grid = new Map();
  let nextId = 1, version = 0;

  function cellsOf(o, fn) {
    // A metre of margin, so a probe just outside a cell's edge still meets a piece across it.
    const ix0 = Math.floor((o.min[0] - 1) / CELL), ix1 = Math.floor((o.max[0] + 1) / CELL), iz0 = Math.floor((o.min[2] - 1) / CELL), iz1 = Math.floor((o.max[2] + 1) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) fn(key(ix, iz));
  }

  // Prepare a spec: trig, inverse scale, world AABB, resolved material and solidity.
  function prepare(spec) {
    const isPickup = String(spec.type).startsWith('pickup:');
    const def = isPickup ? null : PIECES[spec.type];
    if (!isPickup && !def) throw new Error(`unknown piece ${spec.type}`);
    if (isPickup && !POWERUPS[spec.type.slice(7)]) throw new Error(`unknown power-up ${spec.type}`);
    const t = spec.transform;
    const tr = { x: +t.x || 0, y: +t.y || 0, z: +t.z || 0, yaw: +t.yaw || 0, scale: Math.min(3, Math.max(0.5, +t.scale || 1)) };
    const shape = isPickup ? { kind: 'pickup', r: 1.6 } : def.shape;
    const sensor = isPickup || !!def.sensor;
    const o = {
      id: spec.id ?? `o${nextId++}`, type: spec.type, transform: tr, tag: spec.tag || 'build', hidden: !!spec.hidden,
      collider: sensor ? null : shape, shape, sensor, pickup: isPickup ? spec.type.slice(7) : null,
      material: BUILD_MATERIALS[spec.material] ? spec.material : def?.mat || 'concrete',
      c: dcos(tr.yaw), s: dsin(tr.yaw), inv: 1 / tr.scale, min: [0, 0, 0], max: [0, 0, 0],
      obstacle: def?.solid === 'obstacle', data: spec.data || null,
      // A loose piece is a body of its own in the engine (src/sim/world.js), not part of the ground.
      dynamic: !!def?.body, bodySpec: null,
    };
    o.mat = BUILD_MATERIALS[o.material];
    if (isPickup) { lb[0] = -1.6; lb[1] = 0; lb[2] = -1.6; lb[3] = 1.6; lb[4] = 3.2; lb[5] = 1.6; } else shapeBounds(shape, lb);
    // Yawed, scaled corners → world AABB.
    const S = tr.scale;
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const ax of [lb[0], lb[3]]) for (const az of [lb[2], lb[5]]) {
      const wx = tr.x + (o.c * ax + o.s * az) * S, wz = tr.z + (-o.s * ax + o.c * az) * S;
      if (wx < mnx) mnx = wx; if (wx > mxx) mxx = wx; if (wz < mnz) mnz = wz; if (wz > mxz) mxz = wz;
    }
    o.min[0] = mnx; o.min[1] = tr.y + lb[1] * S; o.min[2] = mnz;
    o.max[0] = mxx; o.max[1] = tr.y + lb[4] * S; o.max[2] = mxz;
    return o;
  }

  function addObject(spec) {
    const o = prepare(spec);
    if (objs.has(o.id)) removeObject(o.id);
    objs.set(o.id, o);
    cellsOf(o, (k) => { let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(o); });
    version++;
    return o;
  }
  function removeObject(id) {
    const o = objs.get(id);
    if (!o) return false;
    cellsOf(o, (k) => { const a = grid.get(k); if (!a) return; const i = a.indexOf(o); if (i >= 0) a.splice(i, 1); if (!a.length) grid.delete(k); });
    objs.delete(id);
    version++;
    return true;
  }
  // Every object whose AABB comes within r of (x, z) in plan. Reuses `out`.
  const seen = new Set();
  function objectsNear(x, z, r, out = []) {
    out.length = 0; seen.clear();
    const ix0 = Math.floor((x - r) / CELL), ix1 = Math.floor((x + r) / CELL), iz0 = Math.floor((z - r) / CELL), iz1 = Math.floor((z + r) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const a = grid.get(key(ix, iz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const o = a[i];
        if (seen.has(o)) continue;
        seen.add(o);
        if (x < o.min[0] - r || x > o.max[0] + r || z < o.min[2] - r || z > o.max[2] + r) continue;
        out.push(o);
      }
    }
    return out;
  }
  // Fold the solids near (x, y, z) into a distance query that already found `phi` (the world's own
  // ground). Updates out (normal, mat, obstacle) where a piece is nearer. Allocation-free.
  const tn = { x: 0, y: 0, z: 0 };
  function sdf(x, y, z, out, phi) {
    const a = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!a) return phi;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (!o.collider || o.dynamic) continue;
      // Lower bound: the distance to the object's box. Skip whatever can't be nearer.
      const ex = o.min[0] - x > 0 ? o.min[0] - x : x - o.max[0] > 0 ? x - o.max[0] : 0;
      const ey = o.min[1] - y > 0 ? o.min[1] - y : y - o.max[1] > 0 ? y - o.max[1] : 0;
      const ez = o.min[2] - z > 0 ? o.min[2] - z : z - o.max[2] > 0 ? z - o.max[2] : 0;
      if (ex * ex + ey * ey + ez * ez >= phi * phi && phi > 0) continue;
      const d = objectSdf(o, x, y, z, tn);
      if (d < phi) { phi = d; out.x = tn.x; out.y = tn.y; out.z = tn.z; out.mat = o.mat; out.obstacle = o.obstacle; out.body = null; }
    }
    return phi;
  }
  function clear(tag) {
    for (const o of [...objs.values()]) if (!tag || o.tag === tag) removeObject(o.id);
  }
  return {
    addObject, removeObject, objectsNear, sdf, clear,
    get: (id) => objs.get(id), all: () => [...objs.values()], get size() { return objs.size; }, get version() { return version; },
  };
}

// A piece's solid as colliders for the rigid-body engine (src/sim/world.js streams them near the car,
// for the hull), from the same numbers its distance field and its mesh are built from
// (src/build/colliders.js): a block is a box; a ramp, a quarter- or a half-pipe is its profile cut
// into convex slices (each a step of the drawn curve, down to the skirt, across its width); the loop
// is its band in 96 convex slabs. Solid volumes, not a hollow mesh: a body pressed into one at
// 4–5 g (the kicker's curve at 80 km/h bottoms the suspension) is pushed back out of its top.
// Sensors (rings, pads, crates, pickups) have none.
const slices = new WeakMap(), physMats = new Map();
const physMat = (m) => { let p = physMats.get(m); if (!p) physMats.set(m, (p = { ...m, bounce: 0.1 })); return p; };
function sliceShape(sh) {
  const out = [];
  if (sh.kind === 'loop') {
    const { r, w, t, rail } = sh, hw = w / 2, shift = loopShift(sh), RT = 0.15, N = 96;
    // The deck (r … r + t) across the lane and both rails, and the rails (r − rail … r) at each edge.
    const bands = [[r, r + t, -hw - RT, hw + RT], [r - rail, r, -hw - RT, -hw], [r - rail, r, hw, hw + RT]];
    for (let i = 0; i < N; i++) for (const [r0, r1, x0, x1] of bands) {
      const pts = [];
      for (const k of [i, i + 1]) {
        const phi = (k / N) * TAU, xc = shift / 2 - (shift * phi) / TAU, sz = dsin(phi), cy = -dcos(phi);
        for (const rr of [r0, r1]) for (const xx of [x0, x1]) pts.push(xc + xx, r + rr * cy, rr * sz);
      }
      out.push(Float32Array.from(pts));
    }
    return out;
  }
  const pr = profileOf(sh.kind);
  if (!pr) return out;
  const T = pr.top, m = T.length / 2, H = pr.half;
  // Internal edges: a slice's end face stands up to the drawn curve, so a body bottomed onto the
  // slice before it (the kicker at 80 km/h presses the hull ≈ 2 cm in) catches its top corner and
  // the contact normal is the face's, horizontal: the car stopped dead from 22 m/s in one tick. At
  // each concave turn the slice runs on under its neighbour along its own line (which a concave
  // curve keeps below the neighbour's surface) and dips EDGE_DIP into the solid, so the corner left
  // at the surface is a 6° slant and every vertical face is buried. Convex turns (a deck's lip)
  // keep a plain end: running on there would stand proud of the next face.
  const EDGE_RUN = 0.4, EDGE_DIP = 0.04;
  const seg = (i) => { const du = T[2 * i + 2] - T[2 * i], dy = T[2 * i + 3] - T[2 * i + 1], L = Math.hypot(du, dy); return { du: du / L, dy: dy / L, L }; };
  const concave = (a, b) => a.du * b.dy - a.dy * b.du > 1e-9;
  for (let i = 0; i + 1 < m; i++) {
    const s = seg(i), u0 = T[2 * i], y0 = T[2 * i + 1], u1 = T[2 * i + 2], y1 = T[2 * i + 3];
    const top = [[u0, y0], [u1, y1]];
    if (i > 0) { const p = seg(i - 1); if (concave(p, s)) { const o = Math.min(EDGE_RUN, 0.9 * p.L); top.unshift([u0 - o * s.du + EDGE_DIP * s.dy, y0 - o * s.dy - EDGE_DIP * s.du]); } }
    if (i + 2 < m) { const n = seg(i + 1); if (concave(s, n)) { const o = Math.min(EDGE_RUN, 0.9 * n.L); top.push([u1 + o * s.du + EDGE_DIP * s.dy, y1 + o * s.dy - EDGE_DIP * s.du]); } }
    const pts = [];
    for (const l of [-H, H]) for (const [u, y] of [...top, ...top.map(([u]) => [u, -SKIRT])]) {
      if (pr.axis === 'x') pts.push(l, y, u); else pts.push(u, y, l);
    }
    out.push(Float32Array.from(pts));
  }
  return out;
}
export function pieceShapes(o) {
  const sh = o.collider;
  if (!sh || o.dynamic) return [];
  const t = o.transform, S = t.scale, mat = physMat(o.mat);
  if (sh.kind === 'box') return [{ kind: 'box', x: t.x, y: t.y + ((sh.h - SKIRT) / 2) * S, z: t.z, yaw: t.yaw, hx: (sh.w / 2) * S, hy: ((sh.h + SKIRT) / 2) * S, hz: (sh.d / 2) * S, mat }];
  let list = slices.get(sh);
  if (!list) { list = sliceShape(sh); slices.set(sh, list); }
  return list.map((pts) => {
    const p = new Float32Array(pts.length);
    for (let k = 0; k < p.length; k++) p[k] = pts[k] * S;
    return { kind: 'hull', x: t.x, y: t.y, z: t.z, yaw: t.yaw, points: p, mat };
  });
}

// A loose piece's rigid body (src/sim/props.js) at its scale, or null for everything fixed.
const PROP_SPECS = { cone: CONE, barrier: BARRIER };
export function pieceBody(o) {
  if (!o.dynamic) return null;
  if (!o.bodySpec) {
    const kind = PIECES[o.type].body, s = o.transform.scale;
    o.bodySpec = kind === 'parked' ? parkedBody(s) : propBody(PROP_SPECS[kind], s);
  }
  return o.bodySpec;
}

// A course for the sim with every solid of `store` folded into `base`'s ground. `base` is a course
// object: its `sdf` (Free Drive's roads, the Sandbox) or courses.js `surface()` semantics.
export function composeCourse(base, store) {
  const baseSdf = base.sdf;
  return {
    ...base,
    id: `${base.id}+build`,
    sdf: (x, y, z, out) => store.sdf(x, y, z, out, baseSdf(x, y, z, out)),
    store,
    // The hull's view of the same pieces (src/sim/world.js).
    pieces: { get version() { return store.version; }, near: (x, z, r) => store.objectsNear(x, z, r), shapes: pieceShapes, body: pieceBody },
  };
}
