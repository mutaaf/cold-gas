// The hero: the Cold Gas Roadster, our own design. A low two-seat electric roadster on the sim's
// numbers (src/sim/spec.js: length, width, height, wheelbase, track, tyres): a long hood sunk
// between two rounded front fenders, a raked screen into a short glass canopy, a fastback that
// falls into a short deck with a ducktail lip, broad rear haunches over the wider rear track, and a
// squared carbon diffuser with the four rear nozzles above four suction fans. Every surface is a
// smooth loft (curved sections, curved in plan and profile): no flat facets, no wedge, nothing
// from any real vehicle. No badges, no names, no logos (AGENTS.md 3.7).
//
// Light signature (ours): a slim lamp unit on each front corner, sitting on the fender's fall to the
// nose, with a white light blade along its lower edge and the main lamp inside a smoked lens; amber
// repeaters behind the front arches; at the rear a thin red bar under the ducktail lip that wraps
// into an L at each corner; red side markers at the rear corners; plate lamps; red cabin ambient.
//
// Built in the GROUND frame: y = 0 at the tyre contact patch, x/z origin at the centre of mass
// (the physics' body frame shifted down by SPEC.comHeight). +x is the car's LEFT, +z forward.
//
// Animation reads only what the renderer already has: the car's transform (speed, braking), the
// wheel pivots (on the ground or not), setFan / setWing from main, and the valve states the plume
// renderer publishes on the car root (`userData.thr`). `update(time)` runs once per rendered frame.
//
// Budget: static parts are merged per material (≈ 50 draw calls for the whole car, as before);
// ≈ 30k triangles, most of them in the body's loft and the four tyres' sidewalls and tread.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPEC, NOZZLE_SPEC, wheelAnchors, AXLE_F, AXLE_R } from '../sim/spec.js';
import { CAR } from '../sim/vehicle.js';
import { sliverTube, LAYER } from './sliver.js';

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
// (NOZZLE_SPEC.pos): the four rear nozzles in one row in the top of the diffuser box, the four
// down-jets just behind each wheel, the two yaw ports in the front fenders. The plumes start here too.
export const NOZZLE_VISUAL = NOZZLE_SPEC.map((n) => n.pos.slice());   // drawn where the physics fires them

// --- Materials ---------------------------------------------------------------------------------
// HDR colours on the lamps (MeshBasic, values > 1) so the bloom pass picks them up; the low tier
// has no bloom and they simply clip to white / red.
const SEAM_R = 0.0042;   // a shut line's radius (m)
const lamp = (hex) => new THREE.MeshBasicMaterial({ color: hex });
const M = {
  // Paint: a white over a clear coat, glossy enough that the set's lights lie along the panels.
  paint: new THREE.MeshPhysicalMaterial({
    color: 0xe3e4e2, metalness: 0.05, roughness: 0.36, clearcoat: 0.85, clearcoatRoughness: 0.12,
    sheen: 0.15, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6, envMapIntensity: 1.15,
  }),
  // Gloss black: the rockers, the arch lips, the mirror stalks, the lamp housings.
  black: new THREE.MeshPhysicalMaterial({ color: 0x0c0d0f, metalness: 0.2, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.35, roughness: 0.5 }),
  under: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.1, roughness: 0.85 }),
  // Smoked glass: neutral grey, dark enough to hide the cabin from a distance, clear enough to show it up close.
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x1a1d21, metalness: 0.25, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.015, ior: 1.52,
    envMapIntensity: 1.8, transparent: true, opacity: 0.84,
  }),
  // Lamp lenses: a clear smoked cover over each lamp unit (the lamp shows through it).
  lens: new THREE.MeshPhysicalMaterial({
    color: 0x101215, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    envMapIntensity: 1.6, transparent: true, opacity: 0.4, depthWrite: false,
  }),
  cabin: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.8, metalness: 0 }),
  // Shut lines (seam()): 4.2 mm tubes, faded by pixel coverage once they're under a pixel wide (0187: on the lit
  // deck in the replay, a black line under a pixel popped on and off the white paint).
  seam: sliverTube(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }), { radius: SEAM_R, minPx: 3, maxK: 16 }),
  brass: new THREE.MeshPhysicalMaterial({ color: 0xc19a62, metalness: 1, roughness: 0.28, clearcoat: 0.4 }),
  nozzleIn: new THREE.MeshBasicMaterial({ color: 0x050505 }),
  // Tyres: a soft black compound, the sidewalls a touch scuffed (rougher, lighter) by use.
  tyre: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.9, metalness: 0 }),
  // Wheels: forged, five split spokes in gunmetal over a dark barrel dusted by the brakes.
  spoke: new THREE.MeshPhysicalMaterial({ color: 0x45484d, metalness: 0.85, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.5, roughness: 0.6 }),
  rotor: new THREE.MeshStandardMaterial({ color: 0x6d6f73, metalness: 0.85, roughness: 0.42 }),
  caliper: new THREE.MeshPhysicalMaterial({ color: 0x8c1a1e, metalness: 0.3, roughness: 0.35, clearcoat: 0.9 }),
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
const zNose = zF + SPEC.overhangFront;
const zTail = zNose - SPEC.length;

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
    const a = m.attributes[key]?.array;
    if (!a) continue;
    for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
  }
  return m;
}
function mergedMesh(mat, geos, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

// A smooth curve through keys [[z, v], …] (monotone cubic, Fritsch–Carlson: no overshoot between keys).
function curve(keys) {
  const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// --- The body: a smooth loft ----------------------------------------------------------------------
// Lines along the car (z, m), tail → nose. Our own proportions on the sim's box (4.33 × 2.00 × 1.15,
// wheelbase 2.825, overhangs 0.85 front / 0.655 rear).
const zN = zNose, zT = zTail;
// Plan: half the width at the widest line of each section. Narrow at the nose, swelling over the
// front wheels, a waist at the doors, the broad rear haunch over the wider rear track.
const HALF_W = curve([[zT, 0.87], [zT + 0.06, 0.93], [zT + 0.25, 0.975], [zR, 0.998], [-0.8, 0.985], [-0.35, 0.958],
  [0.3, 0.952], [0.95, 0.962], [zF, 0.985], [2.05, 0.968], [2.28, 0.92], [zN - 0.08, 0.84], [zN - 0.025, 0.78], [zN, 0.72]]);
// Profile: the top centre line. Nose → hood (sunk between the fenders) → cowl → a raked screen →
// the roof's crown → a fastback → the deck → a ducktail lip.
const TOP = curve([[zT, 0.874], [zT + 0.12, 0.866], [-1.45, 0.874], [-1.12, 0.918], [-0.75, 1.03], [-0.35, 1.112], [0.0, 1.138],
  [0.28, 1.118], [0.5, 1.035], [0.75, 0.915], [0.97, 0.806], [1.3, 0.772], [1.8, 0.735], [2.15, 0.672], [2.36, 0.585], [zN - 0.03, 0.535], [zN, 0.5]]);
// The belt / fender crown: the body's upper edge. Peaks over the front wheels (above the hood) and
// over the rear haunches.
const BELT = curve([[zT, 0.835], [-1.55, 0.872], [zR, 0.888], [-0.85, 0.868], [-0.35, 0.835], [0.3, 0.818], [0.95, 0.802],
  [1.35, 0.803], [1.7, 0.797], [2.05, 0.757], [2.3, 0.672], [zN - 0.03, 0.57], [zN, 0.53]]);
const SHOULDER = curve([[zT, 0.6], [zR, 0.62], [-0.4, 0.57], [0.6, 0.55], [zF, 0.57], [2.2, 0.5], [zN, 0.4]]);
// The floor: flat between the axles, kicking up into the diffuser at the tail and into the chin.
const FLOOR = curve([[zT, 0.1], [zT + 0.25, 0.115], [-1.3, 0.125], [2.1, 0.12], [zN - 0.1, 0.14], [zN, 0.18]]);
// The canopy: the side glass's base and the roof's edge (half widths), and where it stands.
const GLASS_W = curve([[-1.15, 0.56], [-0.8, 0.7], [-0.2, 0.765], [0.5, 0.765], [0.97, 0.7]]);
const ROOF_W = curve([[-1.15, 0.42], [-0.7, 0.55], [-0.1, 0.6], [0.3, 0.605], [0.97, 0.64]]);
const GH = (z) => sstep(-1.17, -1.06, z) * (1 - sstep(0.9, 0.99, z));
const SIDE_GLASS = [-0.62, 0.62], SCREEN = [0.3, 0.975], BACKLIGHT = [-1.1, -0.42];
// Wheel arches: circles round each axle, the lip high enough to clear the tyre at full bump.
const ARCH = [{ z: zF, r: 0.43, cy: 0.315 }, { z: zR, r: 0.455, cy: 0.33 }];
function archY(z) {
  let y = -1;
  for (const a of ARCH) { const d = z - a.z; if (Math.abs(d) <= a.r) y = Math.max(y, a.cy + Math.sqrt(a.r * a.r - d * d)); }
  return y;
}
const WELL_X = 0.64;   // the wheel well's inner wall (inboard of the tyres' inner faces, 0.70)

// The section's control points (right half, x ≥ 0), bottom centre → top centre:
//   0 floor centre · 1 floor edge · 2 wheel-well top (= 1 away from the arches) · 3 rocker underside
//   4 rocker top (the black-to-paint break) · 5 lower side · 6 shoulder · 7 belt crease
//   8 glass base / fender crown · 9 window head (pillar) / hood · 10 roof edge / hood · 11 top centre
function controls(z) {
  const W = HALF_W(z), fl = FLOOR(z), yt = TOP(z), yb = BELT(z), sh = SHOULDER(z), g = GH(z), a = archY(z);
  const P = [];
  P[0] = [0, fl];
  P[1] = [WELL_X, fl];
  P[2] = [WELL_X, Math.max(fl, a)];
  P[3] = [W - 0.03, Math.max(fl + 0.07, a)];
  P[4] = [W - 0.004, Math.max(0.29, a + 0.018)];
  P[5] = [W, Math.max(sh, P[4][1] + 0.02)];
  P[6] = [W - 0.03, Math.max(sh + (yb - sh) * 0.72, P[5][1] + 0.008)];
  P[7] = [W - 0.095, Math.max(yb, P[6][1] + 0.006)];
  const gw = GLASS_W(z), rw = ROOF_W(z);
  const hoodA = [W - 0.19, P[7][1] + 0.002], hoodB = [(W - 0.19) * 0.52, yb + (yt - yb) * 0.75], hoodC = [W * 0.22, yt - 0.002];
  const ghA = [gw, P[7][1] + 0.012], ghB = [rw + 0.045, yt - 0.05], ghC = [rw, yt - 0.024];
  P[8] = lerp2(hoodA, ghA, g);
  P[9] = lerp2(hoodB, ghB, g); P[9][1] = Math.max(P[9][1], P[8][1] + 0.003);
  P[10] = lerp2(hoodC, ghC, g); P[10][1] = Math.max(P[10][1], P[9][1] + 0.002);
  P[11] = [0, Math.max(yt, P[10][1] + 0.001)];
  for (let i = 8; i <= 10; i++) P[i][0] = Math.min(P[i][0], P[i - 1][0] - 0.004);
  return P;
}
const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  const f = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return [f(0), f(1)];
};
// Subdivisions per span: the lower body (4–6) and the top (7–10) are Catmull–Rom curves through the
// control points, kept apart at the belt crease (7) so it stays a crisp line.
const SUBS = [1, 1, 1, 1, 3, 3, 3, 2, 2, 1, 3];
// The half section, subdivided: points (right half) and the span (0–10) each segment belongs to.
function halfSection(z) {
  const P = controls(z), pts = [P[0]], span = [];
  for (let k = 0; k <= 10; k++) {
    const n = SUBS[k];
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      let q;
      if (k < 4 || n === 1) q = lerp2(P[k], P[k + 1], t);
      else if (k <= 6) q = cr(k === 4 ? P[4] : P[k - 1], P[k], P[k + 1], k + 1 === 7 ? P[7] : P[k + 2], t);
      else q = cr(k === 7 ? P[7] : P[k - 1], P[k], P[k + 1], k === 10 ? [-P[10][0], P[10][1]] : P[k + 2], t);
      pts.push(q); span.push(k);
    }
  }
  return { pts, span };
}
const NH = halfSection(0).pts.length;   // points per half section
const RING = 2 * NH - 2;
function spanMat(k, z) {
  if (k <= 1) return 'under';
  if (k <= 3) return 'black';
  if (k === 8) return GH(z) > 0.5 && z > SIDE_GLASS[0] && z < SIDE_GLASS[1] ? 'glass' : 'paint';
  if (k === 10) return (z > SCREEN[0] && z < SCREEN[1]) || (z > BACKLIGHT[0] && z < BACKLIGHT[1]) ? 'glass' : 'paint';
  return 'paint';
}
// A point on the skin: z, and u = span + fraction along it (right side; mirror x for the left).
function surfPoint(z, u) {
  const { pts, span } = halfSection(z);
  const k = Math.min(10, Math.max(0, Math.floor(u))), f = clamp01(u - k);
  const first = span.indexOf(k), n = SUBS[k];
  const t = f * n, i = Math.min(n - 1, Math.floor(t));
  return lerp2(pts[first + i], pts[first + i + 1], t - i);
}
function surfFrame(z, u) {
  const p = surfPoint(z, u), e = 0.004;
  const pu = surfPoint(z, u + e), pm = surfPoint(z, u - e);
  const du = [pu[0] - pm[0], pu[1] - pm[1], 0];
  const zp = surfPoint(z + e, u), zm = surfPoint(z - e, u);
  const dz = [zp[0] - zm[0], zp[1] - zm[1], 2 * e];
  const n = [du[1] * dz[2] - du[2] * dz[1], du[2] * dz[0] - du[0] * dz[2], du[0] * dz[1] - du[1] * dz[0]];
  const l = Math.hypot(...n) || 1;
  return { p: [p[0], p[1], z], n: [n[0] / l, n[1] / l, n[2] / l] };
}
const onSkin = (z, u, off = 0.002, s = 1) => { const { p, n } = surfFrame(z, u); return [s * (p[0] + n[0] * off), p[1] + n[1] * off, p[2] + n[2] * off]; };
// A patch lying on the skin (lamps, lenses, handles, intakes), both sides.
function skinPatch(mat, z0, z1, u0, u1, off, nz = 4, nu = 3, both = true, bag = true) {
  const pos = [], nrm = [];
  const grid = [];
  for (let i = 0; i <= nz; i++) {
    const row = [];
    for (let j = 0; j <= nu; j++) {
      const { p, n } = surfFrame(lerp(z0, z1, i / nz), lerp(u0, u1, j / nu));
      row.push({ p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n });
    }
    grid.push(row);
  }
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nu; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i][j + 1], d = grid[i + 1][j + 1];
      for (const [x, y, w] of [[a, c, b], [b, c, d]]) { addTri(pos, x.p, y.p, w.p); addTri(nrm, x.n, y.n, w.n); }
    }
  }
  const g = rawGeo(pos, nrm);
  if (!bag) return g;
  if (!bags.has(mat)) bags.set(mat, []);
  bags.get(mat).push(g);
  if (both) bags.get(mat).push(mirrorX(g));
  return g;
}

function stationZs() {
  const zs = [];
  for (let z = zT; z < zN; z += 0.06) zs.push(z);
  for (const a of ARCH) {
    for (let k = 0; k <= 22; k++) zs.push(a.z - a.r * Math.cos((Math.PI * k) / 22));
    zs.push(a.z - a.r - 0.004, a.z + a.r + 0.004);
  }
  zs.push(zT + 0.015, zT + 0.035, zT + 0.07, zN - 0.012, zN - 0.03, zN - 0.055, zN - 0.085, zN - 0.12);
  for (const r of [SIDE_GLASS, SCREEN, BACKLIGHT]) zs.push(r[0], r[1]);
  zs.push(zN);
  zs.sort((a, b) => a - b);
  const out = [zT];
  for (const z of zs) if (z > out[out.length - 1] + 0.006 && z < zN - 0.004) out.push(z);
  out.push(zN);
  return out;
}

function ringAt(z) {
  const { pts, span } = halfSection(z);
  const r = pts.map(([x, y]) => [x, y, z]);
  const sp = span.slice();
  for (let i = NH - 2; i >= 1; i--) r.push([-pts[i][0], pts[i][1], z]);
  for (let i = NH - 2; i >= 0; i--) sp.push(span[i]);   // left half: the same spans walked back
  return { r, sp };
}

function buildShell() {
  const ZS = stationZs();
  const rings = ZS.map(ringAt);
  const bufs = { paint: [], black: [], under: [], glass: [] };
  const nrm = { paint: [], black: [], under: [], glass: [] };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const S = ZS.length;
  // Face normals and materials per quad (s, e): between stations s and s+1, ring edge e → e+1.
  const fn = [], fm = [];
  for (let s = 0; s < S - 1; s++) {
    const rn = [], rm = [];
    const zm = (ZS[s] + ZS[s + 1]) / 2;
    for (let e = 0; e < RING; e++) {
      const e2 = (e + 1) % RING;
      const a0 = rings[s].r[e], a1 = rings[s].r[e2], b0 = rings[s + 1].r[e], b1 = rings[s + 1].r[e2];
      rn.push(norm(cross(sub(a1, b0), sub(b1, a0))));
      rm.push(spanMat(rings[s].sp[e], zm));
    }
    fn.push(rn); fm.push(rm);
  }
  // Smooth normals per corner: the faces round a vertex that share this face's material and lie
  // within 38° of it (a crease anywhere sharper: the belt line, the glass's edges, the rocker).
  const COS = Math.cos((38 * Math.PI) / 180);
  const cornerN = (s, e, vs, ve) => {
    const own = fn[s][e], mat = fm[s][e];
    const acc = [0, 0, 0];
    for (const qs of [vs - 1, vs]) {
      if (qs < 0 || qs >= S - 1) continue;
      for (const qe of [(ve - 1 + RING) % RING, ve % RING]) {
        const n = fn[qs][qe];
        if (fm[qs][qe] !== mat || dot(n, own) < COS) continue;
        acc[0] += n[0]; acc[1] += n[1]; acc[2] += n[2];
      }
    }
    return norm(acc);
  };
  for (let s = 0; s < S - 1; s++) {
    for (let e = 0; e < RING; e++) {
      const e2 = (e + 1) % RING;
      const a0 = rings[s].r[e], a1 = rings[s].r[e2], b0 = rings[s + 1].r[e], b1 = rings[s + 1].r[e2];
      const key = fm[s][e];
      const na0 = cornerN(s, e, s, e), na1 = cornerN(s, e, s, e2), nb0 = cornerN(s, e, s + 1, e), nb1 = cornerN(s, e, s + 1, e2);
      addTri(bufs[key], a0, a1, b1); addTri(nrm[key], na0, na1, nb1);
      addTri(bufs[key], a0, b1, b0); addTri(nrm[key], na0, nb1, nb0);
    }
  }
  // End faces (flat normals).
  const flat = (key, poly, z, faceOut) => {
    const b = [];
    fan2D(b, poly, z, faceOut);
    for (let i = 0; i < b.length; i += 9) {
      bufs[key].push(...b.slice(i, i + 9));
      nrm[key].push(0, 0, faceOut, 0, 0, faceOut, 0, 0, faceOut);
    }
  };
  // Tail: the open diffuser (|x| < 0.69, below 0.5: its box is drawn inside), the white panel that
  // carries the plate (0.50–0.735), the lamp slot (0.735–0.79), the ducktail lip above.
  const tail = rings[0].r.map(([x, y]) => [x, y]);
  const band = (lo, hi) => clip(clip(tail, 1, lo, true), 1, hi, false);
  flat('black', clip(band(0, 0.5), 0, 0.69, true), zT, -1);
  flat('black', clip(band(0, 0.5), 0, -0.69, false), zT, -1);
  flat('paint', band(0.5, 0.735), zT, -1);
  flat('black', band(0.735, 0.79), zT, -1);
  flat('paint', band(0.79, 2), zT, -1);
  // Nose: white above the intake and either side of it; a black mouth recessed so the active intake
  // wings sit inside it.
  const nose = rings[S - 1].r.map(([x, y]) => [x, y]);
  const MW = NOSE_MOUTH.w, MY0 = NOSE_MOUTH.y0, MY1 = NOSE_MOUTH.y1;
  flat('paint', clip(nose, 0, MW, true), zN, 1);
  flat('paint', clip(nose, 0, -MW, false), zN, 1);
  flat('paint', clip(clip(clip(nose, 0, -MW, true), 0, MW, false), 1, MY1, true), zN, 1);
  flat('black', clip(clip(clip(nose, 0, -MW, true), 0, MW, false), 1, MY0, false), zN, 1);
  const zb = zN - 0.16;
  const quad = (key, a, b, c, d) => {
    const n = norm(cross(sub(c, a), sub(b, a)));
    addTri(bufs[key], a, c, b); addTri(nrm[key], n, n, n);
    addTri(bufs[key], a, d, c); addTri(nrm[key], n, n, n);
  };
  quad('black', [-MW, MY1, zN], [MW, MY1, zN], [MW, MY1, zb], [-MW, MY1, zb]);       // roof (faces down)
  quad('black', [-MW, MY0, zb], [MW, MY0, zb], [MW, MY0, zN], [-MW, MY0, zN]);       // floor
  quad('black', [MW, MY0, zb], [MW, MY1, zb], [MW, MY1, zN], [MW, MY0, zN]);         // left wall
  quad('black', [-MW, MY0, zN], [-MW, MY1, zN], [-MW, MY1, zb], [-MW, MY0, zb]);     // right wall
  quad('under', [-MW, MY0, zb], [-MW, MY1, zb], [MW, MY1, zb], [MW, MY0, zb]);       // back
  return Object.fromEntries(Object.keys(bufs).map((k) => [k, rawGeo(bufs[k], nrm[k])]));
}
const NOSE_MOUTH = { w: 0.6, y0: 0.19, y1: 0.4 };

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

// A thin dark line on the body: a tube through surface points.
function seam(points, radius = SEAM_R, mat = M.seam) {
  const curve3 = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  put(mat, new THREE.TubeGeometry(curve3, Math.max(6, points.length * 2), radius, 4, false));
}
// A shut line across the skin at one z, from span position u0 to u1, both sides.
function seamAcross(z, u0, u1, n = 10) {
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(onSkin(z, lerp(u0, u1, i / n), 0.0015, s));
    seam(pts);
  }
}
// A shut line along the skin at one u, from z0 to z1, both sides.
function seamAlong(u, z0, z1, n = 14) {
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(onSkin(lerp(z0, z1, i / n), u, 0.0015, s));
    seam(pts);
  }
}

// --- Wheels -----------------------------------------------------------------------------------------
const tyreGeoCache = new Map();
// A tyre: rounded shoulders, sidewalls that bulge past the rim flange, and four circumferential
// tread grooves (no lettering: no brands).
function tyreGeo(width, R) {
  const key = `${width}:${R}`;
  if (tyreGeoCache.has(key)) return tyreGeoCache.get(key);
  const rr = R - 0.3 * width, h = width / 2, mid = rr + (R - rr) * 0.45;
  const pts = [[rr - 0.004, -h + 0.02], [rr + 0.012, -h - 0.002], [mid, -h - 0.012], [R - 0.024, -h - 0.004], [R - 0.007, -h + 0.012], [R, -h + 0.032]];
  for (const g of [-0.22, 0, 0.22]) {
    const x = g * width;
    pts.push([R, x - 0.007], [R - 0.007, x - 0.005], [R - 0.007, x + 0.005], [R, x + 0.007]);
  }
  pts.push([R, h - 0.032], [R - 0.007, h - 0.012], [R - 0.024, h + 0.004], [mid, h + 0.012], [rr + 0.012, h + 0.002], [rr - 0.004, h - 0.02]);
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 36);
  g.rotateZ(Math.PI / 2);
  tyreGeoCache.set(key, g);
  return g;
}
// A tapered bar between two polar points in the wheel's plane (y–z), at axial positions x0 (hub end)
// and x1 (rim end): a forged spoke.
function spokeGeo(r0, a0, r1, a1, w0, w1, t, x0, x1) {
  const P = (r, a, x, dw, dt) => {
    const ty = -Math.sin(a), tz = Math.cos(a);   // tangent (across the spoke)
    return [x + dt, r * Math.cos(a) + ty * dw, r * Math.sin(a) + tz * dw];
  };
  const v = [P(r0, a0, x0, -w0 / 2, 0), P(r0, a0, x0, w0 / 2, 0), P(r1, a1, x1, w1 / 2, 0), P(r1, a1, x1, -w1 / 2, 0)];
  const b = v.map((p) => [p[0] - t, p[1], p[2]]);
  const buf = [];
  const q = (a, b2, c, d) => { addTri(buf, a, b2, c); addTri(buf, a, c, d); };
  q(v[0], v[1], v[2], v[3]); q(b[3], b[2], b[1], b[0]);
  q(v[1], b[1], b[2], v[2]); q(v[3], b[3], b[0], v[0]); q(v[2], b[2], b[3], v[3]);
  const g = rawGeo(buf);
  return g;
}
// An arc block round the axle (a caliper): radii rIn–rOut, angles a0–a1, axial x0–x1.
function arcBlock(rIn, rOut, a0, a1, x0, x1, n = 6) {
  const buf = [];
  const P = (r, a, x) => [x, r * Math.cos(a), r * Math.sin(a)];
  for (let i = 0; i < n; i++) {
    const a = lerp(a0, a1, i / n), b = lerp(a0, a1, (i + 1) / n);
    const q = (p, q2, r, s) => { addTri(buf, p, q2, r); addTri(buf, p, r, s); };
    q(P(rOut, a, x0), P(rOut, b, x0), P(rOut, b, x1), P(rOut, a, x1));
    q(P(rIn, a, x1), P(rIn, b, x1), P(rIn, b, x0), P(rIn, a, x0));
    q(P(rIn, a, x0), P(rIn, b, x0), P(rOut, b, x0), P(rOut, a, x0));
    q(P(rOut, a, x1), P(rOut, b, x1), P(rIn, b, x1), P(rIn, a, x1));
  }
  const q = (p, q2, r, s) => { addTri(buf, p, q2, r); addTri(buf, p, r, s); };
  q(P(rIn, a0, x0), P(rOut, a0, x0), P(rOut, a0, x1), P(rIn, a0, x1));
  q(P(rIn, a1, x1), P(rOut, a1, x1), P(rOut, a1, x0), P(rIn, a1, x0));
  const g = rawGeo(buf);
  // Outward winding either way: flip any face whose normal points into the block.
  return g;
}
// The spinning wheel: tyre (first child: the ghost uses it), the barrel, and the face: five split
// spokes dished toward a recessed hub with five lug nuts (two merged meshes).
function heroWheel(width, side, R) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(tyreGeo(width, R), M.tyre);
  tyre.castShadow = true;
  g.add(tyre);
  const rim = R - 0.3 * width, face = side * width * 0.4;
  const barrelG = [], faceG = [];
  const o = new THREE.Object3D();
  const add = (list, geo, p, r = [0, 0, 0]) => {
    o.position.set(...p); o.rotation.set(...r); o.updateMatrix();
    const c = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(o.matrix);
    if (c.attributes.uv) c.deleteAttribute('uv');
    list.push(c);
  };
  // Barrel (seen through the spokes), its inner end closed by a dark backing ring round the hub.
  add(barrelG, new THREE.CylinderGeometry(rim - 0.004, rim - 0.004, width * 0.82, 36, 1, true), [0, 0, 0], [0, 0, Math.PI / 2]);
  // The lip: a bright rim flange.
  add(faceG, new THREE.TorusGeometry(rim - 0.008, 0.011, 5, 44), [face, 0, 0], [0, Math.PI / 2, 0]);
  // Hub, recessed 45 mm behind the face, and five lug nuts on a 112 mm circle; a dark centre cap.
  const hubX = face - side * 0.045;
  add(faceG, new THREE.CylinderGeometry(0.072, 0.078, 0.03, 20), [hubX, 0, 0], [0, 0, Math.PI / 2]);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    add(faceG, new THREE.CylinderGeometry(0.0105, 0.0105, 0.022, 6), [hubX + side * 0.018, Math.cos(a) * 0.056, Math.sin(a) * 0.056], [0, 0, Math.PI / 2]);
  }
  // Five split spokes: each a pair of blades leaving the hub together and opening toward the rim,
  // dished (the hub end 45 mm deeper than the rim end).
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    for (const d of [-1, 1]) {
      add(faceG, spokeGeo(0.07, a + d * 0.07, rim - 0.012, a + d * 0.16, 0.026, 0.02, side * -0.022, hubX + side * 0.012, face), [0, 0, 0]);
    }
  }
  const barrel = new THREE.Mesh(mergeGeometries(barrelG), M.disc);
  barrel.material.side = THREE.DoubleSide;
  const faceM = new THREE.Mesh(mergeGeometries(faceG.map((x) => { for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k); return x; })), M.spoke);
  faceM.material.side = THREE.DoubleSide;
  g.add(barrel, faceM);
  return g;
}
function brakes(side, R, width) {
  // A ventilated iron rotor on an aluminium hat and a four-piston caliper behind the spokes, toward
  // the rear and up. They steer with the wheel but do not spin, so they live on the pivot.
  const g = new THREE.Group();
  const rim = R - 0.3 * width, rOut = rim - 0.045;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rOut, rOut, 0.032, 40), M.rotor);
  disc.rotation.z = Math.PI / 2; disc.position.x = -side * 0.03;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.05, 24), M.disc);
  hat.rotation.z = Math.PI / 2; hat.position.x = -side * 0.012;
  const cal = new THREE.Mesh(arcBlock(rOut - 0.065, rOut + 0.018, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55, -side * 0.075, side * 0.012), M.caliper);
  cal.material.side = THREE.DoubleSide;
  cal.rotation.x = Math.PI / 6;   // centred behind the axle and up
  g.add(disc, hat, cal);
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

  // Wheel tubs: liner walls inboard of each wheel, and a liner roof under each arch.
  for (const a of ARCH) {
    put2(M.under, new THREE.BoxGeometry(0.02, a.cy + a.r - 0.12, a.r * 2), [WELL_X + 0.01, (a.cy + a.r + 0.12) / 2, a.z]);
  }

  // --- Front: splitter blade, nose camera, the active intake wings (animated) ---
  put(M.carbon, new THREE.BoxGeometry(1.46, 0.018, 0.14), [0, 0.15, zNose - 0.03]);
  put(M.black, new THREE.BoxGeometry(0.035, 0.03, 0.02), [0, NOSE_MOUTH.y1 - 0.025, zNose - 0.15]);
  // A fine mesh across the back of the mouth (three slats read as a grille, not as one black hole).
  for (const y of [0.235, 0.29, 0.345]) put(M.carbon, new THREE.BoxGeometry(NOSE_MOUTH.w * 2 - 0.02, 0.006, 0.02), [0, y, zNose - 0.14]);
  const vanes = new THREE.Group();
  {
    const g = [];
    for (const y of [0.25, 0.33]) {
      const v = new THREE.BoxGeometry(NOSE_MOUTH.w * 2 - 0.04, 0.008, 0.07).toNonIndexed();
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
    const x = HALF_W(zF - 0.55) + 0.006;
    for (const s of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.012, 0.14, 0.26).toNonIndexed();
      b.rotateY(s * 0.12); b.translate(s * x, 0.24, zF - 0.55); g.push(b);
    }
    barge = mergedMesh(M.carbon, g);
    body.add(barge);
  }
  // Side sills: a carbon blade along each rocker between the arches.
  {
    const z0 = ARCH[1].z + ARCH[1].r + 0.02, z1 = ARCH[0].z - ARCH[0].r - 0.02;
    for (const s of [-1, 1]) {
      put(M.carbon, new THREE.BoxGeometry(0.05, 0.016, z1 - z0), [s * (HALF_W((z0 + z1) / 2) - 0.005), FLOOR(0) + 0.035, (z0 + z1) / 2]);
    }
  }

  // --- Lamps ---
  // Front: a slim unit on each corner where the fender falls to the nose. A smoked lens over a dark
  // housing; inside it the main lamp (a short bright bar) and along its lower edge the light blade
  // (the DRL). The body-colour reflector behind the lens (`covers`) shows while the car sleeps.
  const LZ0 = 2.24, LZ1 = zNose - 0.006;
  skinPatch(M.black, LZ0, LZ1, 6.25, 7.75, 0.0025, 5, 4);                  // housing
  skinPatch(M.lens, LZ0 - 0.006, LZ1 + 0.002, 6.2, 7.8, 0.009, 5, 4);       // lens
  const headG = skinPatch(M.head, 2.31, zNose - 0.03, 6.95, 7.45, 0.005, 3, 2, false, false);
  const heads = new THREE.Mesh(mergeGeometries([headG, mirrorX(headG)]), M.head);
  const drlG = skinPatch(M.drl, LZ0 + 0.02, zNose - 0.02, 6.32, 6.48, 0.006, 5, 1, false, false);
  // The DRL wakes from the middle outward (scale x about the centre line): both blades in one mesh.
  const drl = new THREE.Mesh(mergeGeometries([drlG, mirrorX(drlG)]), M.drl);
  body.add(heads, drl);
  // The reflector: one triangle per side, behind the lens (6 vertices: the iPhone's export finds it by that).
  const coverTri = (s) => {
    const a = onSkin(2.3, 6.9, 0.004, s), b = onSkin(zNose - 0.025, 6.95, 0.004, s), c = onSkin(2.36, 7.5, 0.004, s);
    const buf = [];
    if (s > 0) addTri(buf, a, c, b); else addTri(buf, a, b, c);
    return rawGeo(buf);
  };
  const covers = new THREE.Mesh(mergeGeometries([coverTri(1), coverTri(-1)]), M.paint);
  body.add(covers);
  // Repeaters: a small amber lens on each front fender just behind the arch.
  skinPatch(M.amber, ARCH[0].z - ARCH[0].r - 0.075, ARCH[0].z - ARCH[0].r - 0.02, 5.55, 5.75, 0.003, 1, 1);
  // Rear: the thin red bar under the ducktail lip, across the lamp slot and turning down into an L at
  // each corner. Built centre-out so the wake sweep can scale it from the middle.
  const tailG = [], dimG = [];
  const TAIL_Y = 0.772, tailZ = zTail - 0.003;
  {
    const hw = HALF_W(zTail) - 0.06;
    const main = new THREE.BoxGeometry(hw * 2, 0.018, 0.01).toNonIndexed(); main.translate(0, TAIL_Y, tailZ); tailG.push(main);
    const dim = new THREE.BoxGeometry(hw * 2 - 0.12, 0.008, 0.01).toNonIndexed(); dim.translate(0, 0.749, tailZ); dimG.push(dim);
    for (const s of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.018, 0.11, 0.01).toNonIndexed(); leg.translate(s * (hw - 0.009), TAIL_Y - 0.046, tailZ); tailG.push(leg);
      const wrap = new THREE.BoxGeometry(0.01, 0.018, 0.07).toNonIndexed(); wrap.translate(s * (hw + 0.035), TAIL_Y, zTail + 0.035); wrap.rotateY(0); tailG.push(wrap);
    }
  }
  for (const gg of [...tailG, ...dimG]) gg.deleteAttribute('uv');
  const tailBar = new THREE.Mesh(mergeGeometries(tailG), M.tail);
  const tailDim = new THREE.Mesh(mergeGeometries(dimG), M.tailDim);
  // Brake: the bar's centre section brightens.
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.01), M.brake);
  brake.position.set(0, TAIL_Y, zTail - 0.006);
  body.add(tailBar, tailDim, brake);
  // A smoked lens over the whole lamp slot.
  put(M.lens, new THREE.BoxGeometry((HALF_W(zTail) - 0.03) * 2, 0.056, 0.006), [0, 0.7625, zTail - 0.008]);
  // The ducktail's lip: a small kick over the slot that throws it into shadow.
  put(M.paint, new THREE.BoxGeometry((HALF_W(zTail) - 0.02) * 2, 0.022, 0.05), [0, TOP(zTail) - 0.004, zTail - 0.016]);
  // Red side markers low on the rear corners; short red lines on the diffuser's outer top edges.
  skinPatch(M.marker, zTail + 0.03, zTail + 0.1, 4.55, 4.85, 0.003, 1, 1);
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
    plate.position.set(0, 0.618, zTail - 0.012); plate.rotation.y = Math.PI;
    body.add(plate);
    put(M.black, new THREE.BoxGeometry(0.33, 0.175, 0.012), [0, 0.618, zTail - 0.004]);
    // Two plate lamps and the rear camera between them.
    put2(M.plateLamp, new THREE.BoxGeometry(0.03, 0.006, 0.01), [0.05, 0.712, zTail - 0.008]);
    put(M.black, new THREE.BoxGeometry(0.03, 0.02, 0.015), [0, 0.718, zTail - 0.008]);
  }

  // --- Diffuser: a squared carbon box (±0.69 m, up to 0.50 m) open at the back, outer fences to the
  // ground, four nozzle bells along its top and four suction fans in bays below them ---
  {
    const z = zTail - 0.005;
    put(M.carbon, new THREE.BoxGeometry(1.38, 0.02, 0.32), [0, 0.5, z + 0.155]);          // top shelf
    put2(M.carbon, new THREE.BoxGeometry(0.02, 0.44, 0.34), [0.69, 0.28, z + 0.165]);       // outer fences
    for (const x of [-0.31, 0, 0.31]) put(M.carbon, new THREE.BoxGeometry(0.012, 0.3, 0.26), [x, 0.26, z + 0.13]);   // bay dividers
    put(M.under, new THREE.PlaneGeometry(1.36, 0.42), [0, 0.29, z + 0.32], [0, Math.PI, 0]);    // dark back wall
    put(M.carbon, new THREE.BoxGeometry(1.38, 0.01, 0.33), [0, FLOOR(zTail + 0.15) + 0.006, z + 0.16]);   // its floor (the body's, seen from above)
  }
  // Fans: four impellers (cone hub + blades) in the bays, angled rearward and up.
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
  // Rear: brass bells in the diffuser top. Lift: bells pointing down through the floor; yaw: flush
  // black ports in the front fenders.
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
      const exitD = n.group === 'rear' ? (pz - zTail) + 0.035 : n.group === 'yaw' ? Math.max(0, HALF_W(pz) - Math.abs(px)) + 0.004 : (y - SPEC.rideHeight) + 0.004;
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
      const k = n.group === 'yaw' ? 0.6 : 1;
      place(k < 1 ? lip.clone().scale(k, k, k) : lip, n.group === 'yaw' ? M.black : M.brass, 0);
      place(k < 1 ? bell.clone().scale(k, k, k) : bell, n.group === 'yaw' ? M.black : M.brass, -0.045 * k, Math.PI / 2);
      place(dark, M.nozzleIn, -0.07);
      nozzleFrames.push({ pos: ex.clone(), quat: q.clone() });
    }
  }
  // Nozzle states: a bright jet core in each throat while the valve is open, and rime that builds
  // on the lip with use (the gas leaves below freezing) and thaws over a few seconds.
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

  // --- Skirts: four deployable fences, rubber with nylon bristles, sealing the floor between the
  // axles. Sides and front/rear move separately (front and rear lift at speed).
  const skirtH = 0.12, skirtTop = SPEC.rideHeight + 0.012;
  const sideSkirts = mergedMesh(M.rubber, [-1, 1].map((s) => new THREE.BoxGeometry(0.014, skirtH, 1.9).toNonIndexed().translate(s * 0.8, skirtTop + skirtH / 2, 0)));
  const endSkirts = mergedMesh(M.rubber, [-1, 1].map((s) => new THREE.BoxGeometry(1.6, skirtH, 0.014).toNonIndexed().translate(0, skirtTop + skirtH / 2, s * 0.95)));
  body.add(sideSkirts, endSkirts);

  // --- Cabin, seen through the glass: a dark tub, two bucket seats with headrests, the dash with its
  // binnacle, a steering wheel on the left (+x), a centre tunnel, the bulkhead; red ambient strips.
  put(M.cabin, new THREE.BoxGeometry(1.24, 0.3, 1.9), [0, 0.38, -0.05]);
  put(M.cabin, new THREE.BoxGeometry(1.36, 0.1, 0.42), [0, 0.74, 0.72]);           // dash top
  put(M.cabin, new THREE.BoxGeometry(1.3, 0.22, 0.12), [0, 0.63, 0.55]);           // dash face
  put(M.cabin, new THREE.BoxGeometry(0.3, 0.07, 0.14), [0.33, 0.81, 0.6], [0.4, 0, 0]);   // binnacle
  put(M.cabin, new THREE.BoxGeometry(0.2, 0.18, 1.0), [0, 0.5, 0.05]);              // tunnel
  for (const s of [-1, 1]) {
    put(M.cabin, new THREE.BoxGeometry(0.46, 0.5, 0.09), [s * 0.33, 0.68, -0.42], [-0.3, 0, 0]);    // seat back
    put(M.cabin, new THREE.BoxGeometry(0.46, 0.09, 0.5), [s * 0.33, 0.48, -0.12]);                  // cushion
    put(M.cabin, new THREE.BoxGeometry(0.06, 0.16, 0.42), [s * 0.33 + 0.22, 0.58, -0.25]);          // bolster
    put(M.cabin, new THREE.BoxGeometry(0.06, 0.16, 0.42), [s * 0.33 - 0.22, 0.58, -0.25]);
    put(M.cabin, new THREE.BoxGeometry(0.24, 0.16, 0.08), [s * 0.33, 0.97, -0.52], [-0.3, 0, 0]);   // headrest
  }
  put(M.black, new THREE.TorusGeometry(0.17, 0.016, 6, 24), [0.33, 0.8, 0.42], [-0.35, 0, 0]);       // wheel rim
  put(M.black, new THREE.CylinderGeometry(0.025, 0.03, 0.22, 8), [0.33, 0.76, 0.5], [Math.PI / 2 - 0.35, 0, 0]);   // column
  put(M.cabin, new THREE.BoxGeometry(1.1, 0.4, 0.05), [0, 0.66, -0.86]);   // bulkhead (tank bay behind)
  const ambient = mergedMesh(M.ambient, [
    new THREE.BoxGeometry(1.15, 0.01, 0.01).toNonIndexed().translate(0, 0.69, 0.495),
    ...[-1, 1].map((s) => new THREE.BoxGeometry(0.01, 0.01, 0.9).toNonIndexed().translate(s * 0.66, 0.66, 0.05)),
    new THREE.BoxGeometry(0.05, 0.14, 0.01).toNonIndexed().translate(0, 0.78, -0.83),
  ].map((g) => { g.deleteAttribute('uv'); return g; }), false);
  body.add(ambient);

  // --- Exterior details ---
  // Mirrors: body-colour caps on black stalks off the doors' front corners, glass facing back.
  {
    const z = 0.66, base = onSkin(z, 7.0, 0, 1);
    const cap = new THREE.SphereGeometry(1, 16, 10);
    cap.scale(0.075, 0.052, 0.115);
    for (const s of [-1, 1]) {
      const cx = s * (base[0] + 0.12), cy = base[1] + 0.07;
      put(M.paint, cap, [cx, cy, z - 0.03], [0, s * 0.12, 0]);
      put(M.glass, new THREE.CircleGeometry(1, 16).scale(0.066, 0.044, 1), [cx, cy, z - 0.142], [0, Math.PI, 0]);
      put(M.black, new THREE.BoxGeometry(0.11, 0.022, 0.05), [s * (base[0] + 0.05), base[1] + 0.05, z], [0, 0, s * 0.45]);
    }
  }
  // Wipers: two black blades parked low on the screen.
  for (const [x0, x1] of [[-0.6, -0.06], [0.02, 0.56]]) {
    const z0 = 0.94, p0 = [x0, TOP(z0) + 0.012, z0], p1 = [x1, TOP(z0 - 0.06) + 0.016, z0 - 0.06];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    put(M.black, new THREE.BoxGeometry(len, 0.012, 0.016), mid, [0, Math.atan2(p1[2] - p0[2], p1[0] - p0[0]) * -1, 0]);
  }
  // Flush door handles: a short black strip high on each door, behind the window's lower edge.
  skinPatch(M.black, -0.28, -0.14, 6.45, 6.62, 0.0025, 2, 1);
  // Side intakes: a dark scoop low on each rear haunch, ahead of the rear wheel, feeding the motor.
  skinPatch(M.under, ARCH[1].z + ARCH[1].r + 0.05, -0.5, 4.3, 5.2, 0.002, 4, 4);
  skinPatch(M.black, ARCH[1].z + ARCH[1].r + 0.03, -0.48, 5.15, 5.3, 0.003, 4, 1);

  // --- Shut lines: the doors, the front clip, the hood, the deck lid, the charge door ---
  {
    const zD0 = 1.05, zD1 = -0.43;   // the door: just behind the front arch to ahead of the haunch
    seamAcross(zD0, 3.95, 7.0);
    seamAcross(zD1, 3.95, 7.0);
    // The door's lower edge, along the rocker.
    seamAlong(4.0, zD1, zD0, 12);
    // The front clip: just ahead of each front arch, from the rocker up to the lamp.
    seamAcross(ARCH[0].z + ARCH[0].r + 0.03, 3.95, 6.2);
    // The rear clip: just behind each rear arch.
    seamAcross(ARCH[1].z - ARCH[1].r - 0.03, 3.95, 6.6);
    // The hood: along the inside of each fender crown, from the lamps back to the cowl.
    seamAlong(8.15, 1.0, 2.22, 12);
    // The deck lid: either side of the wing panel, and across in front of it.
    seamAlong(8.4, zTail + 0.02, -1.22, 10);
    const across = [];
    for (let i = 0; i <= 12; i++) { const u = lerp(8.4, 11, i / 12); across.push(onSkin(-1.22, u, 0.0015, 1)); }
    for (let i = 11; i >= 0; i--) { const u = lerp(8.4, 11, i / 12); across.push(onSkin(-1.22, u, 0.0015, -1)); }
    seam(across.reverse());
    // The charge door on the left haunch: a small rounded square.
    const cd = [];
    const zc = -0.62, uc = 6.55, dz = 0.055, du = 0.22;
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2, k = 0.75;
      const ex = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** k, ey = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** k;
      cd.push(onSkin(zc + dz * ex, uc + du * ey, 0.0015, 1));
    }
    seam(cd);
  }

  // --- Active rear wing: the deck panel itself. Stowed it is flush with the deck; deployed it
  // rises on two swan-neck struts and pitches, with a dark lower element and angled end plates.
  const wing = new THREE.Group();
  const wingPivot = new THREE.Group();
  let wingStruts, wingPlates, wingLower;
  {
    const zMid = -1.56, y0 = TOP(zMid);
    wing.position.set(0, y0 + 0.004, zMid);
    wing.rotation.x = -Math.atan2(TOP(zMid + 0.25) - TOP(zMid - 0.25), 0.5);   // lie on the deck
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.02, 0.5), M.paint);
    blade.castShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.012, 0.012), M.black);
    edge.position.set(0, -0.004, -0.25);
    wingPivot.add(blade, edge);
    wing.add(wingPivot);
    wingLower = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.012, 0.16), M.black);
    wing.add(wingLower);
    const plates = [-1, 1].map((s) => { const g = new THREE.BoxGeometry(0.012, 1, 0.42).toNonIndexed(); g.translate(0, -0.5, 0); g.rotateZ(s * -0.45); g.translate(s * 0.84, 0, 0); g.deleteAttribute('uv'); return g; });
    wingPlates = new THREE.Mesh(mergeGeometries(plates), M.paint);
    wingPivot.add(wingPlates);
    const struts = [-1, 1].map((s) => { const g = new THREE.BoxGeometry(0.025, 1, 0.08).toNonIndexed(); g.translate(s * 0.45, -0.5, 0.05); g.deleteAttribute('uv'); return g; });
    wingStruts = new THREE.Mesh(mergeGeometries(struts), M.black);
    wingPivot.add(wingStruts);
    body.add(wing);
  }

  // --- Merge the static parts ---
  const merged = {};
  for (const [mat, geos] of bags) {
    if (!geos.length) continue;
    const glow = mat instanceof THREE.MeshBasicMaterial;
    const m = mergedMesh(mat, geos, !glow && mat !== M.glass && mat !== M.lens);
    if (mat === M.glass) m.renderOrder = 1;
    if (mat === M.lens) m.renderOrder = 2;
    if (mat === M.seam) m.renderOrder = LAYER.paint;   // a faded line on the body: before every free-floating effect (src/render/sliver.js)
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
    pivot.add(brakes(side, radius, w), spin);
    group.add(pivot);
    wheels.push({ pivot, spin, baseY: y0 });
  });
  group.traverse((o) => {
    if (!o.isMesh) return;
    const glow = o.material instanceof THREE.MeshBasicMaterial || o.material === M.glass || o.material === M.lens;
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
    // Crash damage (src/render/crash.js): parts torn off, lamps flickering or dead, hazards on.
    broken: { wing: false, skirts: false, vanes: false, barge: false },
    dmgHead: 1, dmgTail: 1, hazard: false,
  };
  const fwd = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
  // The physics' droop: with no load the sim reports compression 0, the pivot at its lowest.
  const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  const ease = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

  function setWing(t) { st.wingExt = Math.min(1, Math.max(0, t)); st.wingExtT = st.last; }
  function setFan(level) { st.fan = Math.min(1, Math.max(0, level)); }
  function setBrake(v) { st.forcedBrake = v; }
  function setThrust(arr) { st.thrForced = arr; }
  function setBroken(name, on) { if (name in st.broken) st.broken[name] = on; }
  function setDamage(head = 1, tail = 1, hazard = false) { st.dmgHead = head; st.dmgTail = tail; st.hazard = hazard; }

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
    wing.visible = !st.broken.wing; vanes.visible = !st.broken.vanes; barge.visible = !st.broken.barge;
  }
  function applySkirts() {
    sideSkirts.position.y = -0.11 * st.skirtSide;
    endSkirts.position.y = -0.11 * st.skirtEnd;
    sideSkirts.visible = st.skirtSide > 0.01 && !st.broken.skirts; endSkirts.visible = st.skirtEnd > 0.01 && !st.broken.skirts;
  }
  function applyLights(dt) {
    const t = st.wake;
    const sweep = smooth(0.15, 0.85, t), lampsOn = smooth(0.85, 1.15, t);
    const flare = 1 + 0.7 * Math.max(0, 1 - Math.abs(t - 1.25) / 0.25);
    drl.scale.x = Math.max(0.001, sweep); drl.visible = sweep > 0.002;
    // After a crash: hazards blink at 1.5 Hz (amber repeaters, and the red bar, as rear signals do).
    const blink = st.hazard ? ((st.last * 1.5) % 1 < 0.5 ? 1 : 0) : -1;
    const head = st.dmgHead, tailK = st.dmgTail * (blink < 0 ? 1 : blink ? 1.5 : 0.25);
    setLamp(M.drl, 0.92, 0.96, 1, 3.2 * Math.min(1, sweep * 1.4) * head);
    // Headlamp covers drop ~15 mm into the fender, then the lamps come up.
    covers.position.y = -0.02 * lampsOn; covers.position.z = -0.012 * lampsOn;
    covers.visible = lampsOn < 0.98;
    setLamp(M.head, 0.95, 0.97, 1, 6 * lampsOn * flare * head);
    heads.visible = lampsOn > 0.01;
    tailBar.scale.x = tailDim.scale.x = Math.max(0.001, sweep);
    tailBar.visible = tailDim.visible = sweep > 0.002;
    // Brake: the whole bar steps up and the centre section goes bright.
    st.brake = ease(st.brake, st.forcedBrake ?? (st.brakeHold > 0 ? 1 : 0), dt, st.brakeHold > 0 ? 0.04 : 0.12);
    setLamp(M.tail, 1, 0.08, 0.1, (1.7 + 3.5 * st.brake) * sweep * tailK);
    setLamp(M.tailDim, 1, 0.08, 0.1, (0.6 + 1.2 * st.brake) * sweep * tailK);
    setLamp(M.brake, 1, 0.1, 0.12, 9 * st.brake * sweep * st.dmgTail);
    brake.visible = st.brake > 0.02 && sweep > 0.5;
    const markers = smooth(0.9, 1.05, t);
    setLamp(M.amber, 1, 0.55, 0.12, 2.2 * markers * (blink < 0 ? 1 : blink ? 3.5 : 0.08));
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
      st.skirtSide = st.skirtEnd = st.fan > 0.01 ? 1 : 0;
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
    const on = st.fan > 0.01 ? 1 : 0;   // armed: even the idle suction (≈130 kgf) is 0.028 of the cap
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
    // A new placement the 3 m jump can't see (the Wall starts 3 m from its pad): wake on the next frame.
    placed: () => { st.has = false; },
    // Crash hooks: the parts that can tear off, and the lamp damage / hazard state.
    parts: { wing, vanes, barge, sideSkirts, endSkirts }, setBroken, setDamage,
  };
  applyWing(0, 0); applySkirts(); applyLights(0); applyNozzles(0, null);
  return hero;
}
