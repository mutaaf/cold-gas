// Things placed in a world: ramps, loops, boost pads, power-ups, blocks. Pure and deterministic
// like the rest of src/sim: an object is plain data (a spec), its id comes from what it is and
// where it is (so the same build gets the same ids in every session and on every machine), and
// its collider is a signed-distance function the physics asks through the course's one query
// (src/sim/endless.js `course.sdf`). A different physics engine reads `colliders()` instead:
// boxes, wedges and loop bands as primitives with poses.
//
// Spec (all lengths in metres, yaw in radians about +y, the object's +z is its "forward"):
//   { type: 'ramp',  x, y?, z, yaw, w = 4, l = 8, h = 1.6 }      a wedge rising along +z
//   { type: 'box',   x, y?, z, yaw, w = 2, l = 2, h = 1 }        a block
//   { type: 'loop',  x, y?, z, yaw, r = 6, w = 4, shift = 4.6, t = 0.5 }
//                                                               a vertical loop entered at its
//                                                               foot going +z, leaving `shift` m
//                                                               to the left of where it entered
//   { type: 'boost', x, y?, z, yaw, w = 3, l = 4, power = 1 }    a pad (trigger, no collider)
//   { type: 'powerup', x, y?, z, kind = 'gas', r = 1.4 }          a pickup (trigger, no collider)
// y defaults to the ground under (x, z) (the caller's `groundY`). Extra fields ride along
// untouched (`data`), for whatever a build mode wants to remember.
import { MATERIALS } from './courses.js';
import { dsin, dcos, datan2 } from './dmath.js';
import { hash2 } from './noise.js';

export const OBJECT_TYPES = {
  ramp: { collider: 'wedge', defaults: { w: 4, l: 8, h: 1.6 } },
  box: { collider: 'box', defaults: { w: 2, l: 2, h: 1 } },
  loop: { collider: 'loop', defaults: { r: 6, w: 4, shift: 4.6, t: 0.5 } },
  boost: { collider: null, trigger: 'pad', defaults: { w: 3, l: 4, power: 1 } },
  powerup: { collider: null, trigger: 'sphere', defaults: { r: 1.4, kind: 'gas' } },
};
const CHUNK = 64;                          // m: objects are indexed by the 64 m chunk they sit in
const TAU = 2 * Math.PI;
// What placed things are made of: poured concrete for ramps, loops and blocks (sealed, like the
// stunt courses' deck).
const MAT = MATERIALS.concrete;

export const chunkOf = (x, z) => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];

// A deterministic id: the type, the chunk and a hash of the quantised pose and size.
export function objectId(seed, o) {
  const [cx, cz] = chunkOf(o.x, o.z);
  let h = hash2(seed >>> 0, Math.round(o.x * 100), Math.round(o.z * 100));
  h = hash2(Math.floor(h * 4294967296), Math.round((o.y ?? 0) * 100), Math.round((o.yaw ?? 0) * 1000));
  for (const k of ['w', 'l', 'h', 'r', 'shift', 't']) if (o[k] != null) h = hash2(Math.floor(h * 4294967296), Math.round(o[k] * 100), k.charCodeAt(0));
  for (let i = 0; i < o.type.length; i++) h = hash2(Math.floor(h * 4294967296), o.type.charCodeAt(i), i);
  return `${o.type}.${cx}.${cz}.${Math.floor(h * 2176782336).toString(36).padStart(6, '0')}`;
}

// The registry. `groundY(x, z)` puts objects on the ground when a spec has no y.
export function createObjects({ seed = 0, groundY = () => 0 } = {}) {
  const byId = new Map(), chunks = new Map(), listeners = new Set();
  let version = 0, count = 0;
  const ck = (cx, cz) => `${cx},${cz}`;

  function normalise(spec) {
    const T = OBJECT_TYPES[spec.type];
    if (!T) throw new Error(`unknown object type ${spec.type}`);
    const o = { ...T.defaults, ...spec, yaw: spec.yaw ?? 0 };
    for (const k of ['x', 'z']) if (!Number.isFinite(o[k])) throw new Error(`object ${k} must be a number`);
    if (o.y == null) o.y = groundY(o.x, o.z);
    o.c = dcos(o.yaw); o.s = dsin(o.yaw);
    // Bounding radius in plan, and the height span, for the broad phase.
    const ext = o.type === 'loop' ? Math.max(o.w + o.shift, 2 * o.r + 2 * o.t) : o.type === 'powerup' ? o.r : Math.sqrt((o.w || 0) * (o.w || 0) + (o.l || 0) * (o.l || 0)) / 2;
    o.radius = ext + 0.5;
    o.top = o.y + (o.type === 'loop' ? 2 * o.r + o.t : o.h ?? o.r ?? 1);
    return o;
  }

  function add(spec) {
    const o = normalise(spec);
    let id = spec.id || objectId(seed, o);
    for (let k = 2; byId.has(id); k++) id = `${objectId(seed, o)}~${k}`;
    o.id = id;
    byId.set(id, o);
    // Listed in every chunk its bounding circle touches.
    o.chunks = [];
    const c0 = Math.floor((o.x - o.radius) / CHUNK), c1 = Math.floor((o.x + o.radius) / CHUNK), d0 = Math.floor((o.z - o.radius) / CHUNK), d1 = Math.floor((o.z + o.radius) / CHUNK);
    for (let j = d0; j <= d1; j++) for (let i = c0; i <= c1; i++) {
      const k = ck(i, j);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(o);
      o.chunks.push(k);
    }
    count++; version++;
    emit('add', o);
    return id;
  }
  function remove(id) {
    const o = byId.get(id);
    if (!o) return false;
    for (const k of o.chunks) {
      const list = chunks.get(k), i = list.indexOf(o);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) chunks.delete(k);
    }
    byId.delete(id);
    count--; version++;
    emit('remove', o);
    return true;
  }
  function clear() { for (const id of [...byId.keys()]) remove(id); }
  function emit(kind, o) { for (const fn of listeners) fn(kind, o); }

  // Objects whose footprint comes within r of (x, z), nearest first.
  function near(x, z, r = 50) {
    const out = [], seen = new Set();
    const c0 = Math.floor((x - r) / CHUNK), c1 = Math.floor((x + r) / CHUNK), d0 = Math.floor((z - r) / CHUNK), d1 = Math.floor((z + r) / CHUNK);
    for (let j = d0; j <= d1; j++) for (let i = c0; i <= c1; i++) {
      for (const o of chunks.get(ck(i, j)) || []) {
        if (seen.has(o)) continue;
        seen.add(o);
        const d = Math.sqrt((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z)) - o.radius;
        if (d <= r) out.push([d, o]);
      }
    }
    out.sort((a, b) => a[0] - b[0] || (a[1].id < b[1].id ? -1 : 1));
    return out.map((e) => e[1]);
  }
  function inChunk(cx, cz) { return (chunks.get(ck(cx, cz)) || []).slice(); }

  // ---- Physics: signed distance to the nearest object solid (Infinity if none is nearer than
  // `limit`), its normal into out {x, y, z}, its material, `obstacle` (a block is a wall; a ramp's
  // or a loop's riding face is ground).
  const n = { x: 0, y: 0, z: 0 };
  function sdf(x, y, z, out, limit = Infinity) {
    const list = chunks.get(ck(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!list) return Infinity;
    let best = limit;
    for (let k = 0; k < list.length; k++) {
      const o = list[k];
      if (!OBJECT_TYPES[o.type].collider) continue;
      const dx = x - o.x, dz = z - o.z;
      const pr = Math.sqrt(dx * dx + dz * dz) - o.radius;
      if (pr > best || y - o.top > best || o.y - y - 1 > best) continue;      // broad phase
      // World → object frame (yaw about +y; the object's +z is forward).
      const lx = o.c * dx - o.s * dz, lz = o.s * dx + o.c * dz, ly = y - o.y;
      const d = o.type === 'loop' ? loopSdf(o, lx, ly, lz, n) : o.type === 'ramp' ? wedgeSdf(o, lx, ly, lz, n) : boxSdf(o.w / 2, o.h, o.l / 2, lx, ly, lz, n);
      if (d < best) {
        best = d;
        out.x = o.c * n.x + o.s * n.z; out.y = n.y; out.z = -o.s * n.x + o.c * n.z;   // object → world
        out.mat = MAT; out.obstacle = o.type === 'box' || (o.type === 'ramp' && n.y < 0.5); out.object = o;
      }
    }
    return best;
  }

  // Triggers the point (x, y, z) is inside: boost pads (a box 1.2 m tall over the pad) and
  // power-ups (a sphere). The caller decides what they do.
  function triggersAt(x, y, z, out = []) {
    out.length = 0;
    const list = chunks.get(ck(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!list) return out;
    for (const o of list) {
      const T = OBJECT_TYPES[o.type];
      if (!T.trigger) continue;
      const dx = x - o.x, dz = z - o.z, dy = y - o.y;
      if (T.trigger === 'sphere') { if (dx * dx + (dy - 1) * (dy - 1) + dz * dz < o.r * o.r) out.push(o); continue; }
      const lx = o.c * dx - o.s * dz, lz = o.s * dx + o.c * dz;
      if (lx > -o.w / 2 && lx < o.w / 2 && lz > -o.l / 2 && lz < o.l / 2 && dy > -0.3 && dy < 1.2) out.push(o);
    }
    return out;
  }

  // The solids as primitives with poses, for an engine that builds its own colliders.
  function colliders(minX = -Infinity, minZ = -Infinity, maxX = Infinity, maxZ = Infinity) {
    const out = [];
    for (const o of byId.values()) {
      const T = OBJECT_TYPES[o.type];
      if (!T.collider || o.x + o.radius < minX || o.x - o.radius > maxX || o.z + o.radius < minZ || o.z - o.radius > maxZ) continue;
      const pose = { x: o.x, y: o.y, z: o.z, yaw: o.yaw };
      if (T.collider === 'box') out.push({ id: o.id, shape: 'box', pose, half: [o.w / 2, o.h / 2, o.l / 2], offset: [0, o.h / 2, 0] });
      else if (T.collider === 'wedge') out.push({ id: o.id, shape: 'wedge', pose, w: o.w, l: o.l, h: o.h });
      else out.push({ id: o.id, shape: 'loop', pose, r: o.r, w: o.w, shift: o.shift, t: o.t });
    }
    return out;
  }

  // The same solids as colliders for the rigid-body engine (src/sim/world.js streams them near the
  // car, for the hull): a box, the ramp's wedge as a convex hull, the loop's band as convex slabs.
  function shapes(o) {
    const T = OBJECT_TYPES[o.type];
    if (!T.collider) return [];
    if (T.collider === 'box') return [{ kind: 'box', x: o.x, y: o.y + o.h / 2, z: o.z, yaw: o.yaw, hx: o.w / 2, hy: o.h / 2, hz: o.l / 2, mat: MAT }];
    if (T.collider === 'wedge') {
      const a = o.w / 2, b = o.l / 2;
      return [{ kind: 'hull', x: o.x, y: o.y, z: o.z, yaw: o.yaw, mat: MAT, points: new Float32Array([-a, 0, -b, a, 0, -b, -a, 0, b, a, 0, b, -a, o.h, b, a, o.h, b]) }];
    }
    // The loop's band in convex slabs, one per step of its drawn mesh (a solid shell, not a hollow
    // surface: a body pressed into it is pushed back out of its riding face).
    o.mesh ??= loopMesh(o);
    const v = o.mesh.v, out = [];
    for (let k = 0; k + 1 < v.length / 12; k++) out.push({ kind: 'hull', x: o.x, y: o.y, z: o.z, yaw: o.yaw, mat: MAT, points: v.slice(k * 12, k * 12 + 24) });
    return out;
  }

  function toJSON() {
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((o) => {
      const { c, s, radius, top, chunks: _c, mesh: _m, ...spec } = o;
      void c; void s; void radius; void top; void _c; void _m;
      return spec;
    });
  }
  function load(list) { clear(); for (const spec of list || []) add(spec); }

  return {
    add, remove, clear, get: (id) => byId.get(id) || null, near, inChunk, all: () => [...byId.values()],
    sdf, triggersAt, colliders, shapes, toJSON, load,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get count() { return count; }, get version() { return version; },
  };
}

// A loop's band as a triangle mesh in its own frame (src/world/objects-view.js draws exactly this, and
// src/sim/world.js makes the hull's collider of it): 96 steps round the turn, the inner (riding) face
// at radius r, the outer at r + t, both edges. { v: Float32Array xyz, idx: Uint32Array }.
export function loopMesh(o, seg = 96) {
  const v = new Float32Array((seg + 1) * 4 * 3), idx = [];
  for (let k = 0; k <= seg; k++) {
    const th = (k / seg) * TAU, xc = (o.shift * k) / seg, cth = dcos(th), sth = dsin(th);
    const cy = o.r - cth * o.r, cz = sth * o.r;
    let p = k * 12;
    for (const rr of [0, o.t]) for (const dx of [-o.w / 2, o.w / 2]) { v[p++] = xc + dx; v[p++] = cy - cth * rr; v[p++] = cz + sth * rr; }
  }
  for (let k = 0; k < seg; k++) {
    const a = k * 4, b = a + 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2, a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }
  return { v, idx: new Uint32Array(idx) };
}

// ---- Shapes, in the object's frame (y up from its base, +z forward) --------------------------------

// A box w × h × l standing on y = 0, centred in x and z.
function boxSdf(hx, h, hz, x, y, z, n) {
  const qx = Math.max(-hx - x, 0, x - hx), qy = Math.max(-y, 0, y - h), qz = Math.max(-hz - z, 0, z - hz);
  const out = Math.sqrt(qx * qx + qy * qy + qz * qz);
  if (out > 0) {
    n.x = (x < -hx ? -qx : x > hx ? qx : 0) / out; n.y = (y < 0 ? -qy : y > h ? qy : 0) / out; n.z = (z < -hz ? -qz : z > hz ? qz : 0) / out;
    return out;
  }
  let d = x + hx; n.x = -1; n.y = 0; n.z = 0;
  if (hx - x < d) { d = hx - x; n.x = 1; n.y = 0; n.z = 0; }
  if (h - y < d) { d = h - y; n.x = 0; n.y = 1; n.z = 0; }
  if (z + hz < d) { d = z + hz; n.x = 0; n.y = 0; n.z = -1; }
  if (hz - z < d) { d = hz - z; n.x = 0; n.y = 0; n.z = 1; }
  return -d;
}

// A wedge: the box w × h × l cut by the plane rising from (z = −l/2, y = 0) to (z = l/2, y = h).
// Distance = the larger of the box's and the slope plane's (exact on the faces a car meets).
const nb = { x: 0, y: 0, z: 0 };
function wedgeSdf(o, x, y, z, n) {
  const db = boxSdf(o.w / 2, o.h, o.l / 2, x, y, z, nb);
  const k = 1 / Math.sqrt(o.l * o.l + o.h * o.h);
  const ny = o.l * k, nz = -o.h * k;                                   // the slope's outward normal
  const dp = (y - (z + o.l / 2) * (o.h / o.l)) * ny;
  if (dp > db) { n.x = 0; n.y = ny; n.z = nz; return dp; }
  n.x = nb.x; n.y = nb.y; n.z = nb.z;
  return db;
}

// A loop: one turn of a band of width w around a circle of radius r in the y–z plane, centred
// (0, r, 0); its riding face is the inside. The band drifts `shift` m toward +x over the turn, so
// the way out clears the way in. The solid is the shell from r to r + t.
function loopSdf(o, x, y, z, n) {
  const py = y - o.r, rho = Math.sqrt(py * py + z * z) || 1e-9;
  // Angle from the foot (straight down = 0), increasing forward (+z) and up.
  let th = datan2(z, -py);
  if (th < 0) th += TAU;
  const xc = (o.shift * th) / TAU;
  const ar = rho - (o.r + o.t / 2), qa = (ar < 0 ? -ar : ar) - o.t / 2;
  const al = x - xc, ql = (al < 0 ? -al : al) - o.w / 2;
  let d, wr, wl;
  if (qa > 0 || ql > 0) {
    const a = qa > 0 ? qa : 0, b = ql > 0 ? ql : 0;
    d = Math.sqrt(a * a + b * b); wr = a / d; wl = b / d;
  } else if (qa > ql) { d = qa; wr = 1; wl = 0; } else { d = ql; wr = 0; wl = 1; }
  // Radial direction (outward from the centre), signed toward this side of the shell.
  const sr = ar > 0 ? 1 : -1, sl = al > 0 ? 1 : -1;
  n.x = sl * wl; n.y = (sr * wr * py) / rho; n.z = (sr * wr * z) / rho;
  return d;
}
