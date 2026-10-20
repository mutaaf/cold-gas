// The hero, modelled on the October 2026 reveal car (sources and measurements:
// docs/REVEAL_RESEARCH.md §10 "Body & lighting"). A low cab-forward wedge in satin white over a
// black lower body: a flat hood sunk between two raised fender peaks, a 20°-raked screen and a
// dark gold-glazed canopy, a long straight roof wedge into a flat deck, buttressed rear quarters
// around a recessed rear glass, a deck panel that lifts into the wing, and a squared carbon
// diffuser box with four nozzles above four suction fans. Our own model: no badges, no names.
//
// Light signature (OFFICIAL + PHOTO): a full-width white DRL bar on the hood's leading edge; two
// pop-down headlamps in the V-notches where the hood meets the fender peaks; an amber repeater on
// each front fender; a full-width red bar under the deck lip with a dimmer strip below it, wrapping
// the corners; red corner lenses low at the rear; plate lamps; red cabin ambient light seen through
// the glazing. No underglow, no lit nozzles (none was seen or reported).
//
// Built in the GROUND frame: y = 0 at the tyre contact patch, x/z origin at the centre of mass
// (the physics' body frame shifted down by SPEC.comHeight). +x is the car's LEFT, +z forward.
// Overall size, wheelbase, track and tyres come from src/sim/spec.js; the shape between them comes
// from the reveal imagery.
//
// Animation reads only what the renderer already has: the car's transform (speed, braking), the
// wheel pivots (on the ground or not), setFan / setWing from main, and the valve states the plume
// renderer publishes on the car root (`userData.thr`). `update(time)` runs once per rendered frame.
//
// Budget: static parts are merged per material, so the whole car is ~50 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPEC, NOZZLE_SPEC, wheelAnchors, AXLE_F, AXLE_R } from '../sim/spec.js';
import { CAR } from '../sim/vehicle.js';

// --- Suspension contract ------------------------------------------------------------------------
// Visual wheel-centre height in the ground frame for a suspension compression (m).
//   ANCHOR_Y      top mount height in the ground frame = wheelAnchors()[i][1] + SPEC.comHeight
//   freeLength    top mount → wheel centre distance at compression 0
//   wheelCenterY(c) = ANCHOR_Y − freeLength + c
export const ANCHOR_Y = wheelAnchors()[0][1] + SPEC.comHeight;
// Staggered tyres (20" front, 21" rear): each axle's top mount sits at its own height.
const ANCHORS_Y = wheelAnchors().map((a) => a[1] + SPEC.comHeight);
export const REST_LENGTH = 0.24;
export function wheelCenterY(compression = 0, freeLength = REST_LENGTH, i = 0) {
  return ANCHORS_Y[i] - freeLength + compression;
}

// --- Where the nozzles are drawn ------------------------------------------------------------------
// Body frame (origin at the CoM). Drawn exactly where the physics applies each force
// (NOZZLE_SPEC.pos, sourced in docs/REVEAL_RESEARCH.md §10.3): the four rear nozzles in one row
// 0.42 m up in the top of the diffuser box, the four down-jets just behind each wheel. The plumes
// start here too.
export const NOZZLE_VISUAL = NOZZLE_SPEC.map((n) => n.pos.slice());   // drawn where the physics fires them

// --- Materials ---------------------------------------------------------------------------------
// HDR colours on the lamps (MeshBasic, values > 1) so the bloom pass picks them up; the low tier
// has no bloom and they simply clip to white / red.
const lamp = (hex) => new THREE.MeshBasicMaterial({ color: hex });
const M = {
  // "Ano White": a satin, aerospace-coating white (OFFICIAL name; "matte white", REPORTED).
  paint: new THREE.MeshPhysicalMaterial({
    color: 0xe3e4e2, metalness: 0.05, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.45,
    sheen: 0.3, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6, envMapIntensity: 1.15,
  }),
  black: new THREE.MeshPhysicalMaterial({ color: 0x0c0d0f, metalness: 0.2, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.35, roughness: 0.5 }),
  under: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.1, roughness: 0.85 }),
  // "Gold Glazed" titanium-oxide glass: reads bronze / copper-brown from outside (OFFICIAL).
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x45301c, metalness: 0.45, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: 1.7, transparent: true, opacity: 0.93,
  }),
  cabin: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.8, metalness: 0 }),
  seam: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }),
  brass: new THREE.MeshPhysicalMaterial({ color: 0xc19a62, metalness: 1, roughness: 0.28, clearcoat: 0.4 }),
  nozzleIn: new THREE.MeshBasicMaterial({ color: 0x050505 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.88, metalness: 0 }),
  // "Super light wheels with thin spokes" (OFFICIAL): six dark twin-blade spokes over a flat
  // light-grey aero disc (PHOTO).
  spoke: new THREE.MeshPhysicalMaterial({ color: 0x24262a, metalness: 0.7, roughness: 0.3, clearcoat: 0.6 }),
  disc: new THREE.MeshStandardMaterial({ color: 0xe4e6e8, metalness: 0.1, roughness: 0.38 }),
  rotor: new THREE.MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.3, roughness: 0.7 }),   // carbon-ceramic
  caliper: new THREE.MeshPhysicalMaterial({ color: 0x2b2d31, metalness: 0.6, roughness: 0.35, clearcoat: 0.8 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 }),
  fan: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.5, roughness: 0.45 }),
  // Lamps.
  drl: lamp(0xffffff), head: lamp(0xffffff), tail: lamp(0xff2030), tailDim: lamp(0xff2030),
  brake: lamp(0xff2030), amber: lamp(0xff9a2a), marker: lamp(0xff2030), plateLamp: lamp(0xffffff),
  ambient: lamp(0xff2a24),
  // Nozzle states (additive; black = invisible, so one instanced draw call covers all ten).
  jetCore: new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
  frost: new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
};
for (const [k, m] of Object.entries(M)) m.name = `roadster-${k}`;   // findable in tests and tools
export const ROADSTER_MATERIALS = M;
const setLamp = (mat, r, g, b, k) => mat.color.setRGB(r * k, g * k, b * k);

// --- Geometry helpers -----------------------------------------------------------------------------
const zF = AXLE_F;                                          // front axle
const zR = AXLE_R;                                          // rear axle
const zNose = zF + SPEC.overhangFront;                      // +2.305
const zTail = zNose - SPEC.length;                          // −2.345

const bags = new Map();
function put(mat, geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const o = new THREE.Object3D();
  o.position.set(...p); o.rotation.set(...r); o.scale.set(...s); o.updateMatrix();
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(o.matrix);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!bags.has(mat)) bags.set(mat, []);
  bags.get(mat).push(g);
  return g;
}
// Both sides: (x, ry, rz) mirrored for the car's right.
function put2(mat, geo, [x, y, z], [rx, ry, rz] = [0, 0, 0], s = [1, 1, 1]) {
  put(mat, geo, [x, y, z], [rx, ry, rz], s);
  put(mat, geo, [-x, y, z], [rx, -ry, -rz], s);
}
function rawGeo(buf, normals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf, 3));
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else g.computeVertexNormals();
  return g;
}
function addTri(buf, a, b, c) { buf.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
// Mirror a non-indexed geometry in x (keeping outward winding).
function mirrorX(g) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  for (const key of ['position', 'normal']) {
    const a = m.attributes[key].array;
    for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
  }
  return m;
}
function mergedMesh(mat, geos, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}

// --- The body: an explicit faceted loft ---------------------------------------------------------
// 9 points per half-section (right side, x ≥ 0), bottom centre → top centre:
//   p0 floor centre · p1 floor edge · p2 wheel-well top (= p1 away from the arches)
//   p3 lower outer corner (sill, or the arch lip) · p4 the black-to-white break
//   p5 shoulder · p6 fender peak / glass base · p7 hood edge / roof edge · p8 top centre
// `m` = materials of the four upper faces (p4→p5, p5→p6, p6→p7, p7→p8) on the segment AFT of the
// station: p paint · g glass. Below p4 is the black lower body; over an arch the lip is paint.
// Heights and stations are PHOTO measurements from the studio side, front and rear shots (§10.1).
const ST = (z, fy, wy, p3, p4, p5, p6, p7, ty, m = 'pppp') => ({ z, fy, wy, p3, p4, p5, p6, p7, ty, m, arch: wy > fy + 0.01 });
const AF = 0.74, AR = 0.79;   // arch lip heights (tyre tops 0.686 / 0.734)
const STATIONS = [
  // nose: hood leading edge 0.42 (DRL bar), fender peaks rising either side
  ST(zNose, 0.16, 0.16, [0.88, 0.17], [0.93, 0.27], [0.95, 0.36], [0.80, 0.585], [0.665, 0.43], 0.42),
  ST(2.1, 0.14, 0.14, [0.93, 0.15], [0.965, 0.29], [0.975, 0.45], [0.82, 0.645], [0.66, 0.5], 0.49),
  ST(1.84, 0.12, 0.12, [0.96, 0.15], [0.975, 0.3], [0.98, 0.55], [0.82, 0.705], [0.645, 0.575], 0.565),
  // front arch (wheel centre zF = 1.405)
  ST(1.75, 0.12, 0.5, [0.975, 0.5], [0.98, 0.55], [0.98, 0.6], [0.82, 0.73], [0.645, 0.6], 0.59),
  ST(1.58, 0.12, AF, [0.98, AF], [0.98, AF + 0.01], [0.977, 0.765], [0.815, 0.785], [0.655, 0.665], 0.655),
  // windscreen base ~0.11 m behind the front axle (PHOTO); the A-pillar root sits over the wheel
  ST(1.29, 0.12, AF, [0.98, AF], [0.98, AF + 0.01], [0.975, 0.77], [0.81, 0.81], [0.72, 0.76], 0.745, 'ppgg'),
  ST(1.06, 0.11, 0.5, [0.975, 0.5], [0.975, 0.55], [0.965, 0.79], [0.84, 0.8], [0.74, 0.86], 0.85, 'ppgg'),
  // cabin: glass from the screen over the roof; side glass base rising 0.80 → 1.05
  ST(0.93, 0.11, 0.11, [0.95, 0.14], [0.965, 0.15], [0.955, 0.795], [0.86, 0.815], [0.72, 0.9], 0.885, 'ppgg'),
  ST(0.46, 0.11, 0.11, [0.95, 0.13], [0.965, 0.2], [0.955, 0.84], [0.87, 0.86], [0.6, 1.1], 1.11, 'ppgg'),
  ST(0.0, 0.11, 0.11, [0.955, 0.13], [0.97, 0.25], [0.965, 0.885], [0.88, 0.905], [0.62, 1.128], 1.135, 'ppgg'),
  // roof peak (1.14 m), then a straight wedge to the deck
  ST(-0.42, 0.11, 0.11, [0.96, 0.13], [0.975, 0.29], [0.975, 0.93], [0.89, 0.95], [0.62, 1.135], 1.14, 'ppgg'),
  ST(-0.88, 0.11, 0.11, [0.97, 0.14], [0.99, 0.35], [0.995, 0.97], [0.9, 0.995], [0.62, 1.085], 1.07, 'ppgg'),
  // rear arch (wheel centre zR = −1.42): the widest point, 2.0 m
  ST(-1.02, 0.12, 0.52, [1.0, 0.52], [1.0, 0.56], [0.985, 0.955], [0.92, 1.01], [0.64, 1.065], 1.05, 'pppg'),
  ST(-1.2, 0.12, AR, [1.0, AR], [1.0, AR + 0.01], [0.975, 0.95], [0.93, 1.0], [0.66, 1.04], 1.025, 'pppg'),
  ST(-1.64, 0.12, AR, [1.0, AR], [1.0, AR + 0.01], [0.97, 0.905], [0.92, 0.94], [0.66, 0.975], 0.96),
  ST(-1.82, 0.12, 0.52, [0.995, 0.52], [0.995, 0.56], [0.965, 0.885], [0.92, 0.92], [0.66, 0.935], 0.935),
  // tail: flat deck over the light slot, white panel, carbon diffuser box
  ST(-1.96, 0.12, 0.12, [0.98, 0.18], [0.99, 0.46], [0.96, 0.87], [0.92, 0.902], [0.66, 0.915], 0.915),
  ST(-2.2, 0.15, 0.15, [0.97, 0.2], [0.98, 0.48], [0.95, 0.845], [0.915, 0.873], [0.66, 0.885], 0.885),
  ST(zTail, 0.18, 0.18, [0.95, 0.22], [0.96, 0.5], [0.935, 0.83], [0.905, 0.853], [0.66, 0.865], 0.865),
].reverse();   // tail → nose, so z increases along the array

const NV = 9;
function sectionRight(st) {
  const x1 = st.z > 2.2 ? 0.55 : 0.62;
  return [[0, st.fy], [x1, st.fy], [x1, st.wy], st.p3, st.p4, st.p5, st.p6, st.p7, [0, st.ty]];
}
function ring(st) {
  const r = sectionRight(st);
  const out = r.map(([x, y]) => [x, y]);
  for (let i = NV - 2; i >= 1; i--) out.push([-r[i][0], r[i][1]]);
  return out;
}
const RING = 2 * NV - 2;
function edgeMat(e, st) {
  const k = e < NV - 1 ? e : RING - 1 - e;
  if (k === 0) return 'under';
  if (k === 1) return 'black';
  if (k === 2) return 'black';
  if (k === 3) return st.arch ? 'paint' : 'black';
  return st.m[k - 4] === 'g' ? 'glass' : 'paint';
}

// Clip a polygon to one side of an axis-aligned line (axis 0 = x, 1 = y).
function clip(poly, axis, c, keepAbove) {
  const inside = (p) => (keepAbove ? p[axis] >= c : p[axis] <= c);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (c - a[axis]) / (b[axis] - a[axis]);
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      q[axis] = c;
      out.push(q);
    }
  }
  return out;
}
function fan2D(buf, poly, z, faceOut) {
  if (poly.length < 3) return;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  for (let e = 0; e < poly.length; e++) {
    const p = poly[e], q = poly[(e + 1) % poly.length];
    const P = [p[0], p[1], z], Q = [q[0], q[1], z], C = [cx, cy, z];
    if (faceOut < 0) addTri(buf, C, Q, P); else addTri(buf, C, P, Q);
  }
}

// Point on the body surface: station-interpolated ring vertex (for shut lines and lamps).
function surfAt(z, vi) {
  let i = 0;
  while (i < STATIONS.length - 2 && STATIONS[i + 1].z < z) i++;
  const a = STATIONS[i], b = STATIONS[i + 1], t = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)));
  const ra = sectionRight(a)[vi], rb = sectionRight(b)[vi];
  return [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t];
}

function buildShell() {
  const bufs = { paint: [], black: [], under: [], glass: [] };
  const nrm = { paint: [], black: [], under: [], glass: [] };
  // Normals smooth ALONG each lengthwise strip, crisp ACROSS strips: every panel reads as one
  // clean sheet with a sharp crease at its edges, like folded body panels.
  const rings = STATIONS.map((st) => ring(st).map(([x, y]) => [x, y, st.z]));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const quadN = [];
  for (let s = 0; s < STATIONS.length - 1; s++) {
    const row = [];
    for (let e = 0; e < RING; e++) {
      const e2 = (e + 1) % RING;
      const a0 = rings[s][e], a1 = rings[s][e2], b0 = rings[s + 1][e], b1 = rings[s + 1][e2];
      row.push(norm(cross(sub(a1, b0), sub(b1, a0))));
    }
    quadN.push(row);
  }
  const stripN = (seg, s, e) => {
    const own = quadN[seg][e];
    const other = seg === s ? quadN[s - 1]?.[e] : quadN[s]?.[e];
    if (!other || dot(own, other) < Math.cos(30 * Math.PI / 180)) return own;
    return norm([own[0] + other[0], own[1] + other[1], own[2] + other[2]]);
  };
  for (let s = 0; s < STATIONS.length - 1; s++) {
    const B = STATIONS[s + 1];
    for (let e = 0; e < RING; e++) {
      const e2 = (e + 1) % RING;
      const a0 = rings[s][e], a1 = rings[s][e2], b0 = rings[s + 1][e], b1 = rings[s + 1][e2];
      const na = stripN(s, s, e), nb = stripN(s, s + 1, e);
      const key = edgeMat(e, B);
      addTri(bufs[key], a0, a1, b1); addTri(nrm[key], na, na, nb);
      addTri(bufs[key], a0, b1, b0); addTri(nrm[key], na, nb, nb);
    }
  }
  // Tail face, in bands (PHOTO, rear studio shot): carbon diffuser below 0.50, the white panel
  // 0.50–0.77 carrying the plate, the black light slot 0.77–0.84, the deck lip above.
  const tail = ring(STATIONS[0]);
  const band = (lo, hi) => clip(clip(tail, 1, lo, true), 1, hi, false);
  fan2D(bufs.black, band(0, 0.5), zTail, -1);
  fan2D(bufs.paint, band(0.5, 0.77), zTail, -1);
  fan2D(bufs.black, band(0.77, 0.838), zTail, -1);
  fan2D(bufs.paint, band(0.838, 2), zTail, -1);
  // Nose face: the fender fronts are white; between them (|x| < 0.665) a black mouth below the
  // DRL bar, recessed so the active intake wings sit inside it.
  const nose = ring(STATIONS[STATIONS.length - 1]);
  const MW = 0.665, MY0 = 0.17, MY1 = 0.405;
  fan2D(bufs.paint, clip(nose, 0, MW, true), zNose, 1);
  fan2D(bufs.paint, clip(nose, 0, -MW, false), zNose, 1);
  fan2D(bufs.paint, clip(clip(clip(nose, 0, -MW, true), 0, MW, false), 1, MY1, true), zNose, 1);
  fan2D(bufs.black, clip(clip(clip(nose, 0, -MW, true), 0, MW, false), 1, MY0, false), zNose, 1);
  // Mouth recess: top, bottom and side walls back to a black rear wall.
  const zb = zNose - 0.16;
  const quad = (buf, a, b, c, d) => { addTri(buf, a, c, b); addTri(buf, a, d, c); };   // faces into the mouth
  quad(bufs.black, [-MW, MY1, zNose], [MW, MY1, zNose], [MW, MY1, zb], [-MW, MY1, zb]);       // roof (faces down)
  quad(bufs.black, [-MW, MY0, zb], [MW, MY0, zb], [MW, MY0, zNose], [-MW, MY0, zNose]);       // floor
  quad(bufs.black, [MW, MY0, zb], [MW, MY1, zb], [MW, MY1, zNose], [MW, MY0, zNose]);         // left wall
  quad(bufs.black, [-MW, MY0, zNose], [-MW, MY1, zNose], [-MW, MY1, zb], [-MW, MY0, zb]);     // right wall
  quad(bufs.under, [-MW, MY0, zb], [-MW, MY1, zb], [MW, MY1, zb], [MW, MY0, zb]);             // back
  // Flat normals for everything added after the loft.
  for (const k of Object.keys(bufs)) {
    while (nrm[k].length < bufs[k].length) {
      const i = nrm[k].length;
      const a = bufs[k].slice(i, i + 3), b = bufs[k].slice(i + 3, i + 6), c = bufs[k].slice(i + 6, i + 9);
      const n = norm(cross(sub(b, a), sub(c, a)));
      nrm[k].push(...n, ...n, ...n);
    }
  }
  return Object.fromEntries(Object.keys(bufs).map((k) => [k, rawGeo(bufs[k], nrm[k])]));
}

// A thin dark line on the body: a tube through surface points.
function seam(points, radius = 0.0042, mat = M.seam) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  put(mat, new THREE.TubeGeometry(curve, Math.max(6, points.length * 3), radius, 4, false));
}
const out = (x, y, z, k = 1.004) => [x * k, y, z];

// --- Wheels -----------------------------------------------------------------------------------------
const tyreGeoCache = new Map();
function tyreGeo(width, R) {
  const key = `${width}:${R}`;
  if (tyreGeoCache.has(key)) return tyreGeoCache.get(key);
  const rr = R - 0.3 * width, h = width / 2;   // 30-series sidewall
  const pts = [[rr, -h], [R - 0.032, -h], [R - 0.012, -h + 0.012], [R - 0.002, -h + 0.035], [R, -h + 0.06],
    [R, h - 0.06], [R - 0.002, h - 0.035], [R - 0.012, h - 0.012], [R - 0.032, h], [rr, h]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(Math.PI / 2);
  tyreGeoCache.set(key, g);
  return g;
}
// The spinning wheel: tyre (first child, the ghost uses it), the light-grey aero disc and the six
// dark twin-blade spokes over it (two merged meshes).
function heroWheel(width, side, R) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(tyreGeo(width, R), M.tyre);
  tyre.castShadow = true;
  g.add(tyre);
  const rim = R - 0.3 * width, face = side * width * 0.4;
  const discG = [], spokeG = [];
  const o = new THREE.Object3D();
  const add = (list, geo, p, r = [0, 0, 0]) => { o.position.set(...p); o.rotation.set(...r); o.updateMatrix(); const c = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(o.matrix); c.deleteAttribute('uv'); list.push(c); };
  // Barrel, the flat disc a few mm inside the face, the lip.
  add(discG, new THREE.CylinderGeometry(rim, rim, width * 0.8, 36, 1, true), [0, 0, 0], [0, 0, Math.PI / 2]);
  add(discG, new THREE.CircleGeometry(rim - 0.012, 36), [face - side * 0.02, 0, 0], [0, side * Math.PI / 2, 0]);
  add(spokeG, new THREE.TorusGeometry(rim - 0.006, 0.01, 5, 40), [face, 0, 0], [0, Math.PI / 2, 0]);
  add(spokeG, new THREE.CylinderGeometry(0.055, 0.062, 0.05, 18), [face - side * 0.012, 0, 0], [0, 0, Math.PI / 2]);
  // Six twin-blade spokes: two thin blades per spoke, splitting toward the rim.
  const blade = new THREE.BoxGeometry(0.014, rim - 0.06, 0.022);
  blade.translate(0, (rim - 0.06) / 2 + 0.05, 0);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (const d of [-1, 1]) add(spokeG, blade, [face - side * 0.006, 0, 0], [a + d * 0.06, 0, 0]);
  }
  const discM = new THREE.Mesh(mergeGeometries(discG), M.disc);
  discM.material.side = THREE.DoubleSide;
  const spokeM = new THREE.Mesh(mergeGeometries(spokeG), M.spoke);
  g.add(discM, spokeM);
  return g;
}
function brakes(side) {
  // Carbon-ceramic disc and caliper (OFFICIAL type; caliper colour not found, kept dark). They
  // steer with the wheel but do not spin, so they live on the pivot.
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.034, 32), M.rotor);
  disc.rotation.z = Math.PI / 2; disc.position.x = -side * 0.03;
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), M.caliper);
  cal.position.set(-side * 0.01, 0.15, -0.09); cal.rotation.x = 0.55;
  g.add(disc, cal);
  return g;
}

// --- The model ----------------------------------------------------------------------------------------
export function makeRoadster() {
  bags.clear();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const shell = buildShell();
  put(M.paint, shell.paint); put(M.black, shell.black); put(M.under, shell.under); put(M.glass, shell.glass);

  // Wheel tubs: black walls inboard of each wheel so the arches read as deep wells.
  for (const [z, top] of [[zF, AF - 0.02], [zR, AR - 0.02]]) {
    put2(M.under, new THREE.BoxGeometry(0.02, top - 0.12, 0.8), [0.635, (top + 0.12) / 2, z]);
  }

  // --- Front: black splitter blade, nose camera, the active intake wings (animated) ---
  put(M.carbon, new THREE.BoxGeometry(1.7, 0.02, 0.12), [0, 0.15, zNose - 0.02]);
  put(M.black, new THREE.BoxGeometry(0.035, 0.03, 0.02), [0, 0.37, zNose - 0.15]);
  const vanes = new THREE.Group();
  {
    const g = [];
    for (const y of [0.24, 0.33]) {
      const v = new THREE.BoxGeometry(1.28, 0.008, 0.07).toNonIndexed();
      v.translate(0, y, 0); g.push(v);
    }
    const m = new THREE.Mesh(mergeGeometries(g), M.carbon);
    vanes.position.z = zNose - 0.08;
    vanes.add(m);
    body.add(vanes);
  }
  // --- Barge boards behind the front wheels (pop out at high downforce): one mesh, both sides,
  // moved outward by scaling x about the centre line.
  let barge;
  {
    const g = [];
    for (const s of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.012, 0.16, 0.26).toNonIndexed();
      b.rotateY(s * 0.2); b.translate(s * 0.93, 0.25, zF - 0.5); g.push(b);
    }
    barge = mergedMesh(M.carbon, g);
    body.add(barge);
  }

  // --- Lamps ---
  // DRL: a full-width cool-white bar on the hood's leading edge, 0.415 m up, 1.33 m wide (PHOTO).
  const drl = new THREE.Mesh(new THREE.BoxGeometry(0.665 * 2, 0.013, 0.012), M.drl);
  drl.position.set(0, 0.413, zNose + 0.002);
  body.add(drl);
  // Pop-down headlamps (OFFICIAL "hidden headlights"; ~15 mm modules): an inverted triangle of
  // light in each V-notch where the hood meets the fender peak (PHOTO: 0.69 m out, 0.53 m up).
  // A body-colour cover sits over each when the car sleeps and drops into the fender on wake.
  const triGeo = (s, dz) => {
    const a = [s * 0.615, 0.56, zNose + dz], b = [s * 0.79, 0.575, zNose + dz], c = [s * 0.7, 0.475, zNose + dz];
    const buf = [];
    if (s > 0) addTri(buf, a, c, b); else addTri(buf, a, b, c);
    return rawGeo(buf);
  };
  const heads = new THREE.Mesh(mergeGeometries([triGeo(1, 0.004), triGeo(-1, 0.004)]), M.head);
  const covers = new THREE.Mesh(mergeGeometries([triGeo(1, 0.008), triGeo(-1, 0.008)]), M.paint);
  body.add(heads, covers);
  // Repeaters: a small amber lens on each front fender at the top-rear corner of the arch, with the
  // side camera's black triangle beside it (PHOTO; OFFICIAL "repeaters on the side").
  {
    const z = 1.0, p = surfAt(z, 5), q = surfAt(z, 4);
    const y = 0.63, x = q[0] + (p[0] - q[0]) * ((y - q[1]) / (p[1] - q[1])) + 0.004;
    put2(M.amber, new THREE.BoxGeometry(0.004, 0.022, 0.07), [x, y, z]);
    put2(M.black, new THREE.BoxGeometry(0.004, 0.03, 0.035), [x, y - 0.002, z - 0.07]);
  }
  // Rear: the full-length red bar under the deck lip (OFFICIAL "full-length taillight"; PHOTO 0.83 m
  // up, 1.84 m wide, 25–30 mm tall) with a dimmer strip under it, both wrapping onto the corners.
  // Built centre-out so the wake sweep can scale it from the middle.
  const tailG = [], dimG = [];
  {
    const hw = 0.915, z = zTail - 0.003;
    const main = new THREE.BoxGeometry(hw * 2, 0.026, 0.01).toNonIndexed(); main.translate(0, 0.812, z); tailG.push(main);
    const dim = new THREE.BoxGeometry(hw * 2 - 0.06, 0.009, 0.01).toNonIndexed(); dim.translate(0, 0.786, z); dimG.push(dim);
    for (const s of [-1, 1]) {
      const wrap = new THREE.BoxGeometry(0.01, 0.026, 0.12).toNonIndexed(); wrap.translate(s * 0.94, 0.812, zTail + 0.06); tailG.push(wrap);
    }
  }
  const tailBar = new THREE.Mesh(mergeGeometries(tailG), M.tail);
  const tailDim = new THREE.Mesh(mergeGeometries(dimG), M.tailDim);
  // Brake: the bar's centre section brightens (the reveal car showed a brighter middle portion;
  // dedicated brake lamps were not found, ESTIMATE).
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.028, 0.01), M.brake);
  brake.position.set(0, 0.812, zTail - 0.006);
  body.add(tailBar, tailDim, brake);
  // Deck lip over the slot (casts the slot into shadow, as on the car).
  put(M.paint, new THREE.BoxGeometry(1.86, 0.03, 0.05), [0, 0.851, zTail - 0.012]);
  // Red corner lenses low at the rear corners (PHOTO), and the short red lines on the diffuser's
  // outer top edges.
  put2(M.marker, new THREE.BoxGeometry(0.006, 0.09, 0.03), [0.962, 0.43, zTail + 0.07]);
  put2(M.marker, new THREE.BoxGeometry(0.12, 0.006, 0.006), [0.6, 0.502, zTail - 0.006]);

  // --- Plate: our own name, never a brand ---
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#eceeef'; x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#a4a9ae'; x.lineWidth = 6; x.strokeRect(5, 5, 246, 118);
    x.fillStyle = '#7b8086'; x.font = '600 52px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('COLD GAS', 128, 66);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.305, 0.152), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    plate.position.set(0, 0.6, zTail - 0.012); plate.rotation.y = Math.PI;
    body.add(plate);
    put(M.black, new THREE.BoxGeometry(0.33, 0.175, 0.012), [0, 0.6, zTail - 0.004]);
    // Two plate lamps and the rear camera between them.
    put2(M.plateLamp, new THREE.BoxGeometry(0.03, 0.006, 0.01), [0.05, 0.695, zTail - 0.008]);
    put(M.black, new THREE.BoxGeometry(0.03, 0.02, 0.015), [0, 0.7, zTail - 0.008]);
  }

  // --- Diffuser: a squared carbon box (PHOTO ±0.68 m, 0.085–0.50 m), outer fences to the ground,
  // four nozzle bells along its top and four suction fans in bays below them ---
  {
    const z = zTail - 0.005;
    put(M.carbon, new THREE.BoxGeometry(1.38, 0.02, 0.32), [0, 0.5, z + 0.14]);           // top shelf
    put(M.carbon, new THREE.BoxGeometry(1.38, 0.02, 0.36), [0, 0.09, z + 0.16]);          // floor
    put2(M.carbon, new THREE.BoxGeometry(0.02, 0.46, 0.5), [0.69, 0.29, z + 0.2]);        // outer fences
    for (const x of [-0.31, 0, 0.31]) put(M.carbon, new THREE.BoxGeometry(0.012, 0.3, 0.26), [x, 0.24, z + 0.13]);   // bay dividers
    put(M.under, new THREE.PlaneGeometry(1.36, 0.4), [0, 0.29, z + 0.32], [0, Math.PI, 0]);    // dark back wall
  }
  // Fans: four impellers (cone hub + blades) in the bays, "angled rearward and up" (OFFICIAL).
  const fanRotors = [];
  {
    const g = [];
    const hub = new THREE.ConeGeometry(0.035, 0.07, 14).toNonIndexed(); hub.rotateX(-Math.PI / 2); hub.translate(0, 0, -0.03); g.push(hub);
    for (let k = 0; k < 9; k++) {
      const b = new THREE.BoxGeometry(0.004, 0.075, 0.03).toNonIndexed();
      b.translate(0, 0.055, 0); b.rotateY(0.5); b.rotateZ((k / 9) * Math.PI * 2); g.push(b);
    }
    const rotorGeo = mergeGeometries(g.map((x) => { x.deleteAttribute('uv'); return x; }));
    for (const x of [0.465, 0.155, -0.155, -0.465]) {
      const holder = new THREE.Group();
      holder.position.set(x, 0.25, zTail + 0.08);
      holder.rotation.x = 0.25;   // axis tipped up toward the rear
      const r = new THREE.Mesh(rotorGeo, M.fan);
      holder.add(r);
      body.add(holder);
      fanRotors.push(r);
      put(M.carbon, new THREE.TorusGeometry(0.1, 0.008, 5, 28), [x, 0.25, zTail + 0.06], [0.25, Math.PI, 0]);
    }
  }

  // --- The ten nozzles ---
  // Rear: brass/bronze bells (OFFICIAL "Inconel / titanium", PHOTO colour) in the diffuser top.
  // Lift: gold bells pointing down through the floor; yaw: flush exits in the front fenders.
  const nozzleFrames = [];
  {
    const bell = new THREE.CylinderGeometry(0.05, 0.036, 0.09, 20, 1, true);
    const lip = new THREE.TorusGeometry(0.05, 0.007, 6, 22);
    const dark = new THREE.CircleGeometry(0.04, 18);
    const o = new THREE.Object3D(), q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
    for (const [i, n] of NOZZLE_SPEC.entries()) {
      const [px, py, pz] = NOZZLE_VISUAL[i], y = py + SPEC.comHeight;
      const jet = new THREE.Vector3(-n.dir[0], -n.dir[1], -n.dir[2]);
      // Push the exit out along the jet to the skin it fires through.
      const exitD = n.group === 'rear' ? (pz - zTail) + 0.035 : n.group === 'yaw' ? Math.max(0, surfAt(pz, 4)[0] - Math.abs(px)) + 0.004 : (y - SPEC.rideHeight) + 0.004;
      const ex = new THREE.Vector3(px, y, pz).addScaledVector(jet, exitD);
      q.setFromUnitVectors(zAxis, jet);
      const place = (geo, mat, along, extraRotX = 0) => {
        o.position.copy(ex).addScaledVector(jet, along);
        o.quaternion.copy(q);
        if (extraRotX) o.rotateX(extraRotX);
        o.updateMatrix();
        const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(o.matrix);
        g.deleteAttribute('uv');
        if (!bags.has(mat)) bags.set(mat, []);
        bags.get(mat).push(g);
      };
      // Yaw exits are small flush ports (their spot is unconfirmed: "in the front", OFFICIAL).
      const k = n.group === 'yaw' ? 0.6 : 1;
      place(k < 1 ? lip.clone().scale(k, k, k) : lip, n.group === 'yaw' ? M.black : M.brass, 0);
      place(k < 1 ? bell.clone().scale(k, k, k) : bell, n.group === 'yaw' ? M.black : M.brass, -0.045 * k, Math.PI / 2);
      place(dark, M.nozzleIn, -0.07);
      nozzleFrames.push({ pos: ex.clone(), quat: q.clone() });
    }
  }
  // Nozzle states: a bright jet core in each throat while the valve is open, and rime that builds
  // on the lip with use (the gas leaves below freezing, OFFICIAL) and thaws over a few seconds.
  const coreInst = new THREE.InstancedMesh(new THREE.CircleGeometry(0.042, 18), M.jetCore, NOZZLE_SPEC.length);
  const frostInst = new THREE.InstancedMesh(new THREE.TorusGeometry(0.052, 0.012, 6, 22), M.frost, NOZZLE_SPEC.length);
  {
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), black = new THREE.Color(0, 0, 0);
    nozzleFrames.forEach((f, i) => {
      const p = f.pos.clone().add(new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat).multiplyScalar(-0.02));
      m4.compose(p, f.quat, one); coreInst.setMatrixAt(i, m4); coreInst.setColorAt(i, black);
      m4.compose(f.pos, f.quat, one); frostInst.setMatrixAt(i, m4); frostInst.setColorAt(i, black);
    });
    for (const im of [coreInst, frostInst]) { im.frustumCulled = false; im.visible = false; im.renderOrder = 3; body.add(im); }
  }

  // --- Skirts: four deployable fences, rubber with nylon bristles (OFFICIAL), sealing an area
  // "about the size of the battery pack" between the axles. Sides and front/rear move separately
  // (front and rear lift for the high-speed venturi mode, OFFICIAL).
  const skirtH = 0.12, skirtTop = SPEC.rideHeight + 0.012;
  const sideSkirts = mergedMesh(M.rubber, [-1, 1].map((s) => new THREE.BoxGeometry(0.014, skirtH, 1.9).toNonIndexed().translate(s * 0.8, skirtTop + skirtH / 2, 0)));
  const endSkirts = mergedMesh(M.rubber, [-1, 1].map((s) => new THREE.BoxGeometry(1.6, skirtH, 0.014).toNonIndexed().translate(0, skirtTop + skirtH / 2, s * 0.95)));
  body.add(sideSkirts, endSkirts);

  // --- Cabin, seen through the glazing: a dark tub, two seat shells, the dash, and the red ambient
  // light (OFFICIAL "Ultrawhite + grey microsuede", red ambient strips, PHOTO).
  put(M.cabin, new THREE.BoxGeometry(1.2, 0.3, 1.9), [0, 0.42, -0.05]);
  put(M.cabin, new THREE.BoxGeometry(1.3, 0.12, 0.4), [0, 0.74, 0.72]);
  for (const s of [-1, 1]) {
    put(M.cabin, new THREE.BoxGeometry(0.46, 0.62, 0.08), [s * 0.31, 0.78, -0.42], [-0.32, 0, 0]);
    put(M.cabin, new THREE.BoxGeometry(0.46, 0.08, 0.5), [s * 0.31, 0.5, -0.12]);
  }
  put(M.cabin, new THREE.BoxGeometry(1.1, 0.5, 0.05), [0, 0.8, -0.82]);   // bulkhead (tank bay behind)
  const ambient = mergedMesh(M.ambient, [
    new THREE.BoxGeometry(1.15, 0.01, 0.01).toNonIndexed().translate(0, 0.8, 0.52),
    ...[-1, 1].map((s) => new THREE.BoxGeometry(0.01, 0.01, 0.9).toNonIndexed().translate(s * 0.66, 0.66, 0.05)),
    new THREE.BoxGeometry(0.05, 0.14, 0.01).toNonIndexed().translate(0, 0.9, -0.85),
  ].map((g) => { g.deleteAttribute('uv'); return g; }), false);
  body.add(ambient);

  // --- Shut lines: butterfly doors, the hood, the deck lid ---
  {
    const zD0 = 0.95, zD1 = -0.27;   // PHOTO: door from just behind the front arch to mid-quarter
    for (const s of [-1, 1]) {
      const v = (z) => { const a = surfAt(z, 3), b = surfAt(z, 4), c = surfAt(z, 5); return [out(s * a[0], Math.max(a[1], 0.14), z), out(s * b[0], b[1], z), out(s * c[0], c[1], z)]; };
      seam(v(zD0)); seam(v(zD1));
      // Hood: along the inside of each fender peak.
      const h = [];
      for (let i = 0; i <= 6; i++) { const z = 2.2 - (2.2 - 1.32) * (i / 6), p = surfAt(z, 7); h.push([s * (p[0] - 0.006), p[1] + 0.004, z]); }
      seam(h);
    }
    // Roof rails: the thin white edge framing the glass from the A-pillar root over the roof to
    // the rear buttress (PHOTO, side and front studio shots).
    for (const s of [-1, 1]) {
      const r = [];
      for (let i = 0; i <= 14; i++) { const z = 1.29 - (1.29 + 1.2) * (i / 14), p = surfAt(z, 7); r.push([s * (p[0] + 0.004), p[1] + 0.006, z]); }
      seam(r, 0.013, M.paint);
    }
    // Deck lid / wing panel outline across the deck.
    const d = [];
    for (let i = 0; i <= 8; i++) { const x = -0.9 + 1.8 * (i / 8); const p = surfAt(-1.8, 8); d.push([x, p[1] + 0.004, -1.8]); }
    seam(d);
  }

  // --- Active rear wing: the deck panel itself. Stowed it is flush with the deck; deployed it
  // rises on two swan-neck struts and pitches, with a dark lower element ("biplane") and angled
  // end plates (OFFICIAL modes: low drag / high downforce / airbrake; PHOTO deployed top ≈ 1.22 m).
  const wing = new THREE.Group();
  const wingPivot = new THREE.Group();
  let wingStruts, wingPlates, wingLower;
  {
    const zMid = -2.07, y0 = surfAt(zMid, 8)[1];
    wing.position.set(0, y0 + 0.004, zMid);
    wing.rotation.x = -Math.atan2(surfAt(zMid + 0.25, 8)[1] - surfAt(zMid - 0.25, 8)[1], 0.5);   // lie on the sloping deck
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.02, 0.5), M.paint);
    blade.castShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.012, 0.012), M.black);
    edge.position.set(0, -0.004, -0.25);
    wingPivot.add(blade, edge);
    wing.add(wingPivot);
    wingLower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.012, 0.16), M.black);
    wing.add(wingLower);
    const plates = [-1, 1].map((s) => { const g = new THREE.BoxGeometry(0.012, 1, 0.42).toNonIndexed(); g.translate(0, -0.5, 0); g.rotateZ(s * -0.45); g.translate(s * 0.92, 0, 0); g.deleteAttribute('uv'); return g; });
    wingPlates = new THREE.Mesh(mergeGeometries(plates), M.paint);
    wingPivot.add(wingPlates);
    const struts = [-1, 1].map((s) => { const g = new THREE.BoxGeometry(0.025, 1, 0.08).toNonIndexed(); g.translate(s * 0.47, -0.5, 0.05); g.deleteAttribute('uv'); return g; });
    wingStruts = new THREE.Mesh(mergeGeometries(struts), M.black);
    wingPivot.add(wingStruts);
    body.add(wing);
  }

  // --- Merge the static parts ---
  const merged = {};
  for (const [mat, geos] of bags) {
    const glow = mat instanceof THREE.MeshBasicMaterial;
    const m = mergedMesh(mat, geos, !glow && mat !== M.glass);
    if (mat === M.glass) m.renderOrder = 1;
    body.add(m);
    merged[mat.uuid] = m;
  }
  bags.clear();

  // --- Wheels: FL, FR, RL, RR (the sim's order) ---
  const wheels = [];
  const corners = [
    [-SPEC.trackFront / 2, zF, SPEC.tyreWidthFront, -1, SPEC.wheelRadiusFront], [SPEC.trackFront / 2, zF, SPEC.tyreWidthFront, 1, SPEC.wheelRadiusFront],
    [-SPEC.trackRear / 2, zR, SPEC.tyreWidthRear, -1, SPEC.wheelRadiusRear], [SPEC.trackRear / 2, zR, SPEC.tyreWidthRear, 1, SPEC.wheelRadiusRear],
  ];
  corners.forEach(([x, z, w, side, radius], i) => {
    const pivot = new THREE.Group();
    const y0 = wheelCenterY(0, REST_LENGTH, i);
    pivot.position.set(x, y0, z);
    const spin = heroWheel(w, side, radius);
    pivot.add(brakes(side), spin);
    group.add(pivot);
    wheels.push({ pivot, spin, baseY: y0 });
  });
  group.traverse((o) => {
    if (!o.isMesh) return;
    const glow = o.material instanceof THREE.MeshBasicMaterial || o.material === M.glass;
    o.castShadow = !glow; o.receiveShadow = !glow;
  });

  // =============================================================================================
  // Animated states
  // =============================================================================================
  const st = {
    last: -1, wakeT0: null, wake: 0,
    pos: new THREE.Vector3(), prev: new THREE.Vector3(), has: false,
    vf: 0, vfPrev: 0, acc: 0, decel: 0, speed: 0, grounded: true,
    brake: 0, brakeHold: 0, forcedBrake: null,
    fan: 0, skirtSide: 0, skirtEnd: 0, fanAngle: 0,
    wingExt: 0, wingExtT: -1, wing: 0, airbrake: 0,
    frost: new Float32Array(NOZZLE_SPEC.length), thrForced: null,
  };
  const fwd = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
  // The physics' droop: with no load the sim reports compression 0, the pivot at its lowest.
  const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  const ease = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

  function setWing(t) { st.wingExt = Math.min(1, Math.max(0, t)); st.wingExtT = st.last; }
  function setFan(level) { st.fan = Math.min(1, Math.max(0, level)); }
  function setBrake(v) { st.forcedBrake = v; }
  function setThrust(arr) { st.thrForced = arr; }

  function applyWing(k, air) {
    // k: 0 stowed → 1 high downforce; air: 0 → 1 airbrake (kicked up).
    const rise = 0.3 * Math.min(1, k + air);
    wingPivot.position.set(0, rise, -0.04 * k);
    wingPivot.rotation.x = 0.16 * k + 0.75 * air;   // trailing edge up
    wingStruts.scale.y = Math.max(0.001, rise); wingStruts.position.y = 0;
    wingStruts.visible = rise > 0.003;
    wingPlates.scale.y = Math.max(0.001, rise * 0.45); wingPlates.visible = rise > 0.003;
    wingLower.position.y = rise * 0.45; wingLower.visible = rise > 0.02;
    // Front of the car follows the aero mode: intake wings close for low drag, open (up to 80°,
    // OFFICIAL) for downforce; the barge boards pop out.
    vanes.rotation.x = -(0.15 + 0.95 * Math.max(k, air));
    barge.scale.x = 0.955 + 0.06 * Math.max(k, air);
  }
  function applySkirts() {
    sideSkirts.position.y = -0.11 * st.skirtSide;
    endSkirts.position.y = -0.11 * st.skirtEnd;
    sideSkirts.visible = st.skirtSide > 0.01; endSkirts.visible = st.skirtEnd > 0.01;
  }
  function applyLights(dt) {
    const t = st.wake;
    const sweep = smooth(0.15, 0.85, t), lampsOn = smooth(0.85, 1.15, t);
    const flare = 1 + 0.7 * Math.max(0, 1 - Math.abs(t - 1.25) / 0.25);
    drl.scale.x = Math.max(0.001, sweep); drl.visible = sweep > 0.002;
    setLamp(M.drl, 0.92, 0.96, 1, 3.2 * Math.min(1, sweep * 1.4));
    // Headlamp covers drop ~15 mm into the fender, then the lamps come up.
    covers.position.y = -0.02 * lampsOn; covers.position.z = -0.012 * lampsOn;
    covers.visible = lampsOn < 0.98;
    setLamp(M.head, 0.95, 0.97, 1, 6 * lampsOn * flare);
    heads.visible = lampsOn > 0.01;
    tailBar.scale.x = tailDim.scale.x = Math.max(0.001, sweep);
    tailBar.visible = tailDim.visible = sweep > 0.002;
    // Brake: the whole bar steps up and the centre section goes bright.
    st.brake = ease(st.brake, st.forcedBrake ?? (st.brakeHold > 0 ? 1 : 0), dt, st.brakeHold > 0 ? 0.04 : 0.12);
    setLamp(M.tail, 1, 0.08, 0.1, (1.7 + 3.5 * st.brake) * sweep);
    setLamp(M.tailDim, 1, 0.08, 0.1, (0.6 + 1.2 * st.brake) * sweep);
    setLamp(M.brake, 1, 0.1, 0.12, 9 * st.brake * sweep);
    brake.visible = st.brake > 0.02 && sweep > 0.5;
    const markers = smooth(0.9, 1.05, t);
    setLamp(M.amber, 1, 0.55, 0.12, 2.2 * markers);
    setLamp(M.marker, 1, 0.08, 0.1, 2.4 * markers);
    setLamp(M.plateLamp, 1, 1, 1, 1.6 * markers);
    setLamp(M.ambient, 1, 0.12, 0.1, 2.2 * smooth(0, 0.6, t));
  }
  function applyNozzles(dt, thr) {
    let any = false;
    for (let i = 0; i < NOZZLE_SPEC.length; i++) {
      const p = thr ? Math.min(1, Math.max(0, thr[i])) : 0;
      st.frost[i] = Math.min(1, st.frost[i] + p * dt * 0.9) * Math.exp(-dt / 4.5);
      col.setRGB(0.7 * p * 0.55, 0.82 * p * 0.55, 1.0 * p * 0.55);
      coreInst.setColorAt(i, col);
      const f = st.frost[i];
      col.setRGB(0.5 * f, 0.55 * f, 0.6 * f);
      frostInst.setColorAt(i, col);
      if (p > 0.01 || f > 0.01) any = true;
    }
    coreInst.instanceColor.needsUpdate = frostInst.instanceColor.needsUpdate = true;
    coreInst.visible = frostInst.visible = any;
  }

  // Once per rendered frame. `time` is the game clock (seconds).
  function update(time) {
    const dt = st.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - st.last));
    st.last = time;
    group.getWorldPosition(st.pos);
    // A jump of more than 3 m between frames is a new placement (title, start line, replay
    // restart): the car "wakes" again, lights sweeping on (ESTIMATE: the reveal showed the DRL
    // and taillight lit; a wake sweep is our animation, after the teaser's animated light bar).
    if (!st.has || st.pos.distanceTo(st.prev) > 3) {
      st.wakeT0 = time; st.vf = st.vfPrev = st.acc = 0; st.brakeHold = 0;
      st.prev.copy(st.pos); st.has = true;
    }
    st.wake = time - st.wakeT0;
    if (dt > 0) {
      group.getWorldQuaternion(q);
      fwd.set(0, 0, 1).applyQuaternion(q);
      const vx = (st.pos.x - st.prev.x) / dt, vy = (st.pos.y - st.prev.y) / dt, vz = (st.pos.z - st.prev.z) / dt;
      st.speed = ease(st.speed, Math.hypot(vx, vy, vz), dt, 0.15);
      const vf = ease(st.vf, vx * fwd.x + vy * fwd.y + vz * fwd.z, dt, 0.06);
      st.acc = ease(st.acc, (vf - st.vf) / dt, dt, 0.08);
      st.vf = vf;
      // On the ground if any wheel is loaded (the sim reports droop as compression 0).
      st.grounded = wheels.some((w, i) => w.pivot.position.y > ANCHORS_Y[i] - CAR.restLen + 0.002);
      // Braking: decelerating hard on the wheels beyond what the slope explains (climbing the
      // wall slows the car without the brakes), inferred from the car's motion; held briefly
      // after the car stops.
      st.decel = st.acc + 9.81 * fwd.y;
      if (st.grounded && st.vf > 0.3 && st.decel < -2.5) st.brakeHold = 0.6;
      else if (st.grounded && Math.abs(st.vf) < 0.3 && st.brakeHold > 0) st.brakeHold = Math.max(st.brakeHold, 0.3);
      st.brakeHold = Math.max(0, st.brakeHold - dt);
    }
    st.prev.copy(st.pos);
    if (hero.debugHold) {
      // Studio shots: states forced through the setters, no inference.
      applyWing(st.wingExt, 0);
      st.skirtSide = st.skirtEnd = st.fan > 0.03 ? 1 : 0;
      applySkirts(); fanSpin(dt); applyLights(dt); applyNozzles(dt, st.thrForced);
      return;
    }

    // Active aero: deploys with speed (aero is "ineffective below ~50 mph", OFFICIAL) or when main
    // says so; kicks up as an airbrake under hard braking at speed.
    const ext = st.last - st.wingExtT < 0.3 ? st.wingExt : 0;
    st.wing = ease(st.wing, Math.max(ext, smooth(18, 36, st.speed)), dt, 0.5);
    st.airbrake = ease(st.airbrake, st.grounded && st.speed > 22 && st.decel < -9 ? 1 : 0, dt, 0.25);
    applyWing(st.wing, st.airbrake);
    // Skirts drop with the fan; front and rear lift above ~50 mph for the venturi mode (OFFICIAL).
    const on = st.fan > 0.03 ? 1 : 0;
    st.skirtSide = ease(st.skirtSide, on, dt, 0.25);
    st.skirtEnd = ease(st.skirtEnd, on && st.speed < 22 ? 1 : 0, dt, 0.25);
    applySkirts();
    fanSpin(dt);
    applyLights(dt);
    applyNozzles(dt, st.thrForced || group.parent?.userData.thr);
  }
  function fanSpin(dt) {
    st.fanAngle += dt * st.fan * 70;
    for (const r of fanRotors) r.rotation.z = st.fanAngle;
  }

  const hero = {
    group, body, shell: merged[M.paint.uuid], canopy: merged[M.glass.uuid],
    ghostParts: [merged[M.paint.uuid], merged[M.black.uuid], merged[M.glass.uuid], ...wheels.map((w) => w.spin.children[0])],
    wheels, comY: SPEC.comHeight, setWing, setFan, setBrake, setThrust, update, debugHold: false,
  };
  applyWing(0, 0); applySkirts(); applyLights(0); applyNozzles(0, null);
  return hero;
}
