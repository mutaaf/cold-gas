// The parked fleet's toolkit: smooth curves, swept bodies, polygon sweeps for faceted shapes,
// light strips that lie on a body's surface, instanced wheels, and per-material merging so each
// vehicle is a handful of draw calls.
//
// Frame (every parked model): y = 0 at the tyre contact patch, x/z origin at the centre of the
// vehicle's physics box (src/sim/courses.js LINEUP_SPEC), nose toward +z, +x the vehicle's LEFT.
// The scene turns the whole group crosswise.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sliver, setSliverAttributes } from '../sliver.js';

// --- Materials (shared across the fleet) ---------------------------------------------------------
const cache = new Map();
export function paint(color, { metal = 0.5, rough = 0.26, coat = 1 } = {}) {
  const key = `${color}:${metal}:${rough}:${coat}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshPhysicalMaterial({
      color, metalness: metal, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.05, envMapIntensity: 1.3,
    }));
  }
  return cache.get(key);
}
export const MAT = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e14, metalness: 0.3, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.15 }),
  gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090b, metalness: 0.3, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.88, metalness: 0 }),
  rimDark: new THREE.MeshPhysicalMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.34, clearcoat: 0.6 }),
  rimSilver: new THREE.MeshPhysicalMaterial({ color: 0xa7acb2, metalness: 1, roughness: 0.26, clearcoat: 0.5 }),
  cover: new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, metalness: 0.35, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  // Brushed stainless, unpainted (the pickup's body).
  stainless: new THREE.MeshPhysicalMaterial({ color: 0xb4b9bf, metalness: 1, roughness: 0.5, envMapIntensity: 1.2 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x6d7177, metalness: 0.9, roughness: 0.45 }),
  chassis: new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.4, roughness: 0.6 }),
};
// Running lights, parked: HDR just above the night stage's bloom threshold (0.82), so they read as
// lit without flaring. Slivers: a 2 cm strip is a pixel at 30 m, and that bloomed on and off.
const lamp = (r, g, b) => sliver(new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide }), { minPx: 1.2, maxK: 5 });
export const LAMP = {
  white: lamp(1.25, 1.3, 1.38),
  red: lamp(1.15, 0.05, 0.07),
  redDim: lamp(0.42, 0.02, 0.03),
  amber: lamp(1.2, 0.5, 0.06),
  // Solid lamp bodies (a box, not a strip): no sliver widening.
  redSolid: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 0.05, 0.07) }),
};

// --- Curves ---------------------------------------------------------------------------------------
// Monotone cubic (Fritsch–Carlson) through [[t, v], …]: smooth, and never overshoots a key, so a
// roofline doesn't bulge between two stations. Clamped outside the keys.
export function curve(keys) {
  const n = keys.length, t = keys.map((k) => k[0]), v = keys.map((k) => k[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((v[i + 1] - v[i]) / (t[i + 1] - t[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= t[0]) return v[0];
    if (x >= t[n - 1]) return v[n - 1];
    let i = 0;
    while (x > t[i + 1]) i++;
    const h = t[i + 1] - t[i], s = (x - t[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

// --- Swept bodies ---------------------------------------------------------------------------------
// A body swept along z. `at(z)` gives the cross-section there:
//   top, bot      roof (or deck) and underside heights
//   hw, sh        half-width at its widest, and the height of that shoulder
//   tt, tb        taper above / below the shoulder (0 = vertical sides; 0.2 = 20 % narrower at the top)
//   n, nb         superellipse exponent above / below the shoulder (2 = round, 6+ = boxy)
// `arches` lift the lower edge over each wheel: [{ z, r, top }] (top = height of the arch crown).
// The ends close with a fillet of radius `round` (plan and elevation both).
export function sweep(at, { z0, z1, segZ = 56, segR = 40, arches = [], round = 0.12 } = {}) {
  const pos = [];
  const sec = { top: 0, bot: 0, hw: 0, sh: 0, tt: 0, tb: 0, n: 3, nb: 3 };
  for (let i = 0; i <= segZ; i++) {
    const u = i / segZ;
    // Denser toward both ends, where the shape turns fastest.
    const z = z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos(Math.PI * u)) * 0.6 + (z1 - z0) * u * 0.4;
    Object.assign(sec, at(z));
    // End fillet: a quarter circle of radius `round`.
    const e = Math.min(z - z0, z1 - z);
    const endK = e >= round ? 1 : Math.max(0.12, Math.sqrt(Math.max(0, 1 - ((round - e) / round) ** 2)));
    let arch = 0, crown = 0;
    for (const a of arches) {
      const dz = Math.abs(z - a.z);
      if (dz < a.r) { const k = Math.sqrt(1 - (dz / a.r) ** 2); if (k > arch) { arch = k; crown = a.top; } }
    }
    const { top, sh, hw, tt, tb, n, nb } = sec;
    let bot = sec.bot;
    const archY = bot + (Math.min(sec.sh - 0.02, Math.max(bot, crown)) - bot) * arch;
    const mid = (top + bot) / 2;
    for (let j = 0; j < segR; j++) {
      const th = (j / segR) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const up = s >= 0;
      const ex = 2 / (up ? n : nb);
      const sy = Math.abs(s) ** ex, sx = Math.abs(c) ** ex;
      let y = up ? sh + (top - sh) * sy : sh - (sh - bot) * sy;
      let x = Math.sign(c) * sx * hw * (1 - (up ? tt : tb) * sy);
      if (!up && arch > 0) y = Math.max(y, archY - (1 - Math.abs(x) / hw) * 0.05);
      // Fillet the ends: shrink the whole section toward its centre (a dome, no ridge down the nose).
      x *= endK;
      y = mid + (y - mid) * endK;
      pos.push(x, y, z);
    }
  }
  return ringsToGeometry(pos, segZ + 1, segR);
}

// Rings of `segR` points each (closed around), capped at both ends.
function ringsToGeometry(pos, rings, segR) {
  const idx = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segR; j++) {
      const a = i * segR + j, b = i * segR + ((j + 1) % segR), c = (i + 1) * segR + j, d = (i + 1) * segR + ((j + 1) % segR);
      idx.push(a, b, c, b, d, c);
    }
  }
  const centre = (r) => {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < segR; j++) { x += pos[(r * segR + j) * 3]; y += pos[(r * segR + j) * 3 + 1]; z += pos[(r * segR + j) * 3 + 2]; }
    return [x / segR, y / segR, z / segR];
  };
  const ca = pos.length / 3; pos.push(...centre(0));
  const cb = pos.length / 3; pos.push(...centre(rings - 1));
  const last = (rings - 1) * segR;
  for (let j = 0; j < segR; j++) {
    idx.push(ca, (j + 1) % segR, j);
    idx.push(cb, last + j, last + ((j + 1) % segR));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A faceted solid: polygon sections [{ z, poly }] (every poly [[x, y], …] the same length and
// counter-clockwise seen from +z, i.e. up the left (+x) side first) joined straight between
// stations, so the panels meet in crisp creases. Unshare the vertices (setFlat) to shade them flat.
export function facets(stations) {
  const segR = stations[0].poly.length, pos = [];
  for (const s of stations) for (const [x, y] of s.poly) pos.push(x, y, s.z);
  return ringsToGeometry(pos, stations.length, segR);
}

// A closed, counter-clockwise section from its left half: points from the bottom centre (x = 0)
// up the +x side to the top centre (x = 0); the −x side is the mirror image.
export function mirrorPoly(half) {
  return [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
}

// --- Light strips on a surface ---------------------------------------------------------------------
const ray = new THREE.Raycaster();
const hits = [];
// Cast from each origin along `dir` onto `targets` (meshes in the vehicle's frame, untransformed)
// and lay a ribbon there: `halfW` across the path, lifted `lift` off the surface. Returns a
// geometry with sliver attributes (src/render/sliver.js), or null when nothing was hit.
export function strip(targets, origins, dir, halfW, { lift = 0.004, across = null } = {}) {
  const d = new THREE.Vector3(...dir).normalize();
  const P = [], N = [];
  for (const o of origins) {
    ray.set(new THREE.Vector3(...o), d);
    ray.far = 20;
    hits.length = 0;
    ray.intersectObjects(targets, false, hits);
    if (!hits.length) continue;
    const h = hits[0];
    const n = h.face.normal.clone();
    if (n.dot(d) > 0) n.negate();
    P.push(h.point.clone()); N.push(n);
  }
  if (P.length < 2) return null;
  const pos = [], spread = [], side = [], idx = [];
  const t = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < P.length; i++) {
    t.subVectors(P[Math.min(P.length - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
    if (across) b.set(...across).normalize().multiplyScalar(halfW);
    else b.crossVectors(N[i], t).normalize().multiplyScalar(halfW);
    const c = P[i].clone().addScaledVector(N[i], lift);
    pos.push(c.x + b.x, c.y + b.y, c.z + b.z, c.x - b.x, c.y - b.y, c.z - b.z);
    spread.push(b.x, b.y, b.z, -b.x, -b.y, -b.z);
    side.push(1, -1);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  setSliverAttributes(g, spread, side);
  // Both faces: a strip's winding depends on the path's direction.
  g.computeVertexNormals();
  return g;
}
// A panel that follows a surface: a grid of rays (origin(u, v) for u, v in [0, 1], all along
// `dir`) laid onto `targets` and lifted off them. Rays that miss are dropped with their cells.
// Glazing set into a body, a grille, a dark panel: anything bigger than a strip.
export function patch(targets, origin, dir, nu = 12, nv = 6, lift = 0.006) {
  const d = new THREE.Vector3(...dir).normalize();
  const pos = [], ok = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      ray.set(new THREE.Vector3(...origin(i / nu, j / nv)), d);
      ray.far = 20;
      hits.length = 0;
      ray.intersectObjects(targets, false, hits);
      if (!hits.length) { pos.push(0, 0, 0); ok.push(false); continue; }
      const h = hits[0], n = h.face.normal.clone();
      if (n.dot(d) > 0) n.negate();
      const p = h.point.addScaledVector(n, lift);
      pos.push(p.x, p.y, p.z); ok.push(true);
    }
  }
  const W = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * W + i, b = a + 1, c = a + W, e = c + 1;
      if (ok[a] && ok[b] && ok[c] && ok[e]) idx.push(a, b, c, b, e, c);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Face the ray's origin: flip the winding if the normals came out pointing along the rays.
  const nrm = g.attributes.normal;
  let dot = 0;
  for (let k = 0; k < nrm.count; k++) dot += nrm.getX(k) * d.x + nrm.getY(k) * d.y + nrm.getZ(k) * d.z;
  if (dot > 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}
// Origins along a polyline [[x, y, z], …], `n` samples per segment.
export function path(points, n = 8) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    for (let k = 0; k < n; k++) { const s = k / n; out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]); }
  }
  out.push(points.at(-1));
  return out;
}

// --- Wheels ---------------------------------------------------------------------------------------
// A tyre with rounded shoulders and a sidewall bulge, axis along x, centred at the origin.
export function tyreGeo(r, w, { seg = 36, rimR = r * 0.66 } = {}) {
  const pts = [];
  const sh = Math.min(0.045, w * 0.18);   // shoulder radius
  pts.push(new THREE.Vector2(rimR, -w / 2 + 0.01));
  pts.push(new THREE.Vector2(rimR + (r - sh - rimR) * 0.5, -w / 2 - 0.004));
  for (let i = 0; i <= 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, -w / 2 + sh + Math.sin(a) * sh));
  }
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh));
  }
  pts.push(new THREE.Vector2(rimR + (r - sh - rimR) * 0.5, w / 2 + 0.004));
  pts.push(new THREE.Vector2(rimR, w / 2 - 0.01));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateZ(-Math.PI / 2);   // lathe axis y → x
  return g;
}

// Wheel faces (outboard side at +x), as one geometry per material: { [matKey]: geometry }.
//   style 'aero'    flat disc cover with a ring of shallow slots (sedans, crossover)
//   style 'facet'   a flat polygonal cover with radial facets (the pickup, the cab)
//   style 'disc'    a flat colour-matched cover (the cab)
//   style 'steel'   a truck disc wheel: deep dish, hand holes, hub and lug ring
export function wheelFace(style, r, w, rimR) {
  const out = {};
  const add = (k, g) => (out[k] ||= []).push(g);
  const x0 = w / 2 - 0.012;
  const disc = (rad, x, segs = 36) => { const g = new THREE.CircleGeometry(rad, segs); g.rotateY(Math.PI / 2); g.translate(x, 0, 0); return g; };
  const box = (sx, sy, sz, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateX(rx); g.translate(x, y, z); return g; };
  // The barrel behind the face (seen through the openings) and the rim lip.
  const barrel = new THREE.CylinderGeometry(rimR, rimR, w * 0.86, 28, 1, true); barrel.rotateZ(Math.PI / 2);
  add('trim', barrel);
  const lip = new THREE.RingGeometry(rimR * 0.93, rimR * 1.01, 36); lip.rotateY(Math.PI / 2); lip.translate(x0 + 0.004, 0, 0);
  if (style === 'aero') {
    add('cover', disc(rimR * 0.94, x0));
    add('rim', lip);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const g = box(0.006, rimR * 0.26, 0.05, x0 + 0.002, 0, 0);
      g.rotateX(-a); g.translate(0, Math.cos(a) * rimR * 0.7, Math.sin(a) * rimR * 0.7);
      add('trim', g);
    }
    add('rim', disc(rimR * 0.2, x0 + 0.003, 20));
  } else if (style === 'disc') {
    // A flat colour-matched cover with a soft dark ring at its edge and a small centre cap.
    add('cover', disc(rimR * 0.9, x0 + 0.004));
    const ring = new THREE.RingGeometry(rimR * 0.9, rimR * 0.99, 36); ring.rotateY(Math.PI / 2); ring.translate(x0 + 0.002, 0, 0);
    add('trim', ring);
    add('rim', disc(rimR * 0.16, x0 + 0.008, 20));
  } else if (style === 'facet') {
    // Flat polygonal cover: an outer ring of trapezoids pitched alternately, and a flat hub.
    const N = 8, segs = [];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, tilt = k % 2 ? 0.012 : -0.004;
      const p = (a, rr, dx) => [x0 + dx, Math.cos(a) * rr, Math.sin(a) * rr];
      const A = p(a0, rimR * 0.98, 0), B = p(a1, rimR * 0.98, 0), C = p(a1, rimR * 0.42, tilt), D = p(a0, rimR * 0.42, tilt);
      segs.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3)); g.computeVertexNormals();
    add('cover', g);
    add('cover', disc(rimR * 0.43, x0 + 0.008, 8));
    add('rim', lip);
  } else if (style === 'steel') {
    const dish = new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.5, 0.06, 32, 1, true); dish.rotateZ(-Math.PI / 2); dish.translate(x0 - 0.03, 0, 0);
    add('rim', dish);
    add('rim', disc(rimR * 0.5, x0 - 0.06, 28));
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const g = new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6); g.rotateZ(Math.PI / 2);
      g.translate(x0 - 0.045, Math.cos(a) * rimR * 0.36, Math.sin(a) * rimR * 0.36);
      add('trim', g);
    }
    const hub = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.26, 0.09, 16); hub.rotateZ(Math.PI / 2); hub.translate(x0 - 0.02, 0, 0);
    add('steel', hub);
    add('rim', lip);
  }
  const merged = {};
  for (const k of Object.keys(out)) merged[k] = mergeGeometries(out[k].map((g) => { const h = g.index ? g.toNonIndexed() : g; h.deleteAttribute('uv'); if (!h.attributes.normal) h.computeVertexNormals(); return h; }));
  return merged;
}

// Instanced wheels from a LINEUP_SPEC entry's axles: per tyre size, one tyre mesh and one mesh per
// face material, every wheel of that size in one draw each. Each wheel's face looks outboard; twin
// tyres (`dual`) sit side by side about the axle's track, the inner one without a face.
export function axleWheels(spec, { style = 'aero', mats = {} } = {}) {
  const g = new THREE.Group();
  g.name = 'wheels';
  const sizes = new Map();
  for (const a of spec.axles) {
    const r = a.r ?? spec.tyreR, w = a.w ?? spec.tyreW, rimR = a.rimR ?? spec.rimR;
    const key = `${r}:${w}:${rimR}`;
    if (!sizes.has(key)) sizes.set(key, { r, w, rimR, place: [] });
    const place = sizes.get(key).place;
    for (const out of [1, -1]) {
      const x = (out * a.track) / 2;
      if (a.dual) {
        place.push({ x: x + out * (w / 2 + 0.015), z: a.at, out });
        place.push({ x: x - out * (w / 2 + 0.015), z: a.at, out, inner: true });
      } else place.push({ x, z: a.at, out });
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const matOf = { cover: mats.cover || MAT.cover, rim: mats.rim || MAT.rimDark, trim: MAT.trim, steel: MAT.steel };
  for (const { r, w, rimR, place } of sizes.values()) {
    const setAll = (mesh, list) => {
      list.forEach((pl, i) => {
        q.setFromAxisAngle(up, pl.out > 0 ? 0 : Math.PI);
        mesh.setMatrixAt(i, m.compose(p.set(pl.x, r, pl.z), q, s));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    const tyre = new THREE.InstancedMesh(tyreGeo(r, w, { rimR, seg: 28 }), MAT.rubber, place.length);
    setAll(tyre, place);
    g.add(tyre);
    const faces = wheelFace(style, r, w, rimR);
    const shown = place.filter((pl) => !pl.inner);
    for (const k of Object.keys(faces)) {
      const mesh = new THREE.InstancedMesh(faces[k], matOf[k], shown.length);
      setAll(mesh, shown);
      g.add(mesh);
    }
  }
  return g;
}

// --- Merging --------------------------------------------------------------------------------------
// Collects geometries per material, then one mesh each. Geometries are taken as built (vehicle
// frame); pass a matrix to place one.
export class Parts {
  constructor() { this.map = new Map(); }
  add(mat, geo, matrix = null) {
    if (!geo) return this;
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return this;
  }
  box(mat, [sx, sy, sz], [x, y, z], [rx, ry, rz] = [0, 0, 0]) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    return this.add(mat, g);
  }
  cyl(mat, rt, rb, h, [x, y, z], [rx, ry, rz] = [0, 0, 0], seg = 16) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    return this.add(mat, g);
  }
  build(group, { name = '' } = {}) {
    for (const [mat, geos] of this.map) {
      const sliverish = geos.some((g) => g.attributes.aSpread);
      const list = geos.map((g) => {
        let h = g.index ? g : g;
        if (!h.attributes.normal) h.computeVertexNormals();
        if (h.attributes.uv) h = h.clone(), h.deleteAttribute('uv');
        if (sliverish && !h.attributes.aSpread) setSliverAttributes(h, new Array(h.attributes.position.count * 3).fill(0), new Array(h.attributes.position.count).fill(0));
        return h;
      });
      const allIndexed = list.every((g) => g.index), noneIndexed = list.every((g) => !g.index);
      const geo = mergeGeometries(allIndexed || noneIndexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g)));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${name}:${mat.name || mat.type}`;
      group.add(mesh);
    }
    return group;
  }
}

// Flat facets: unshare the vertices so every panel takes its own normal.
export function setFlat(g) {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  return f;
}
