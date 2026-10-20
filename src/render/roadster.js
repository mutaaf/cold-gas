// The hero: an angular, faceted wedge after the October 2026 reveal car. SR-71 / F-35 surfacing,
// satin silver-white over a satin-black lower body, gold-tint glass, a full-width red taillight,
// four round cold-gas nozzles in a deep diffuser. Our own model; no badges, no names.
//
// Built in the GROUND frame: y = 0 at the tyre contact patch, x/z origin at the centre of mass
// (so the physics' body frame is this frame shifted down by SPEC.comHeight). Every dimension
// comes from src/sim/spec.js.
//
// The body is an explicit faceted loft: 19 cross-section polygons (stations) placed by hand
// along z, each 8 vertices per side, lofted with flat shading so every panel is a crisp facet.
// Wheel arches are part of the sections (the inner well wall and the arch lip rise at the arch
// stations), which gives the angular, trapezoidal arches of the reference.
import * as THREE from 'three';
import { SPEC, NOZZLE_SPEC, wheelAnchors } from '../sim/spec.js';

// --- Suspension contract ------------------------------------------------------------------------
// Visual wheel-centre height in the ground frame for a suspension compression (m).
//   ANCHOR_Y      top mount height in the ground frame = wheelAnchors()[i][1] + SPEC.comHeight
//                 (= wheelRadius + 0.24 = 0.60 m)
//   freeLength    top mount → wheel centre distance at compression 0
//   wheelCenterY(c) = ANCHOR_Y − freeLength + c
// With the default freeLength 0.24, compression 0 is the static ride (wheel centre at
// SPEC.wheelRadius = 0.36 m) and positive compression moves the wheel up into the arch. If the
// sim measures compression from full droop, pass its free (droop) length instead.
export const ANCHOR_Y = wheelAnchors()[0][1] + SPEC.comHeight;
export const REST_LENGTH = 0.24;
export function wheelCenterY(compression = 0, freeLength = REST_LENGTH) {
  return ANCHOR_Y - freeLength + compression;
}

// --- Materials ---------------------------------------------------------------------------------
const M = {
  paint: new THREE.MeshPhysicalMaterial({
    color: 0xd6d8db, metalness: 0.5, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12,
    sheen: 0.25, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 1.3,
  }),
  black: new THREE.MeshPhysicalMaterial({ color: 0x0f1012, metalness: 0.25, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  under: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.1, roughness: 0.8 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x6b4f1c, metalness: 0.92, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.9 }),
  seam: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a36 }),
  redGlow: new THREE.MeshBasicMaterial({ color: 0xff1b2b, transparent: true, opacity: 0.55, depthWrite: false }),
  white: new THREE.MeshBasicMaterial({ color: 0xf2f6ff }),
  nozzle: new THREE.MeshPhysicalMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.22 }),
  nozzleIn: new THREE.MeshBasicMaterial({ color: 0x050505 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.88, metalness: 0 }),
  rim: new THREE.MeshPhysicalMaterial({ color: 0x1e2023, metalness: 0.85, roughness: 0.32, clearcoat: 0.5 }),
  blade: new THREE.MeshPhysicalMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.28 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x47484b, metalness: 0.4, roughness: 0.6 }),
  caliper: new THREE.MeshPhysicalMaterial({ color: 0x2b2d31, metalness: 0.6, roughness: 0.35, clearcoat: 0.8 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.4, metalness: 0.1 }),
  fanRing: new THREE.MeshBasicMaterial({ color: 0x6ff3ff, transparent: true, opacity: 0.0, depthWrite: false }),
  fanGlow: new THREE.MeshBasicMaterial({ color: 0x5ce8ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
};
export const ROADSTER_MATERIALS = M;

// --- Geometry --------------------------------------------------------------------------------------
const zF = SPEC.wheelbase - SPEC.comFromFront;              // front axle (+1.405)
const zR = -SPEC.comFromFront;                              // rear axle (−1.42)
const zNose = zF + SPEC.overhangFront;                      // +2.265
const zTail = zNose - SPEC.length;                          // −2.355
const R = SPEC.wheelRadius;

// Section parameters (right half). Vertices, bottom centre → top centre:
//   v0 (0, fy) floor centre · v1 (0.62, fy) floor edge · v2 (0.62, wy) wheel-well inner top
//   v3 (sx, sy) lower outer corner (sill, or the arch lip over a wheel)
//   v4 (bx, by) haunch crease (widest line) · v5 (rx, ry) beltline ridge
//   v6 window base (derived: 17 cm inboard of the shoulder, so a body-colour shoulder deck runs
//   outboard of the glass) · v7 (gx, gy) roof / deck edge · v8 (0, ty) top centre
// `glass`: the side-window (v6→v7) and roof/screen (v7→v8) faces aft of this station are glass.
const ARCH = 0.81;   // arch lip height over the wheels (tyre top is 0.72)
const S = (z, fy, wy, sx, sy, bx, by, rx, ry, gx, gy, ty, extra = {}) => ({ z, fy, wy: wy ?? fy, sx, sy, bx, by, rx, ry, gx, gy, ty, ...extra });
const STATIONS = [
  // nose: low, pointed, chined
  S(zNose, 0.19, null, 0.66, 0.205, 0.72, 0.26, 0.66, 0.33, 0.34, 0.37, 0.38),
  S(zNose - 0.2, 0.15, null, 0.82, 0.2, 0.89, 0.31, 0.86, 0.46, 0.5, 0.54, 0.56),
  // front arch (wheel centre zF)
  S(zF + 0.5, 0.12, null, 0.92, 0.22, 0.95, 0.38, 0.92, 0.62, 0.56, 0.68, 0.69),
  S(zF + 0.36, 0.12, 0.42, 0.94, 0.43, 0.96, 0.52, 0.93, 0.69, 0.56, 0.73, 0.74),
  S(zF + 0.18, 0.12, ARCH, 0.96, ARCH, 0.97, 0.84, 0.93, 0.87, 0.58, 0.79, 0.8),
  S(zF - 0.18, 0.11, ARCH, 0.96, ARCH, 0.97, 0.85, 0.92, 0.89, 0.57, 0.86, 0.87),
  S(zF - 0.36, 0.11, 0.42, 0.95, 0.43, 0.97, 0.56, 0.91, 0.89, 0.58, 0.93, 0.94, { glass: true }),
  S(zF - 0.5, 0.11, null, 0.94, 0.23, 0.965, 0.52, 0.9, 0.89, 0.6, 0.97, 0.99, { glass: true }),
  // cabin: a narrow teardrop greenhouse between broad shoulders
  S(0.45, 0.11, null, 0.94, 0.23, 0.965, 0.52, 0.88, 0.87, 0.6, 1.06, 1.1, { glass: true }),
  S(-0.15, 0.11, null, 0.95, 0.23, 0.98, 0.54, 0.89, 0.85, 0.6, 1.08, 1.12, { glass: true }),
  S(-0.55, 0.11, null, 0.97, 0.24, 1.0, 0.58, 0.93, 0.86, 0.58, 1.04, 1.08, { glass: true }),
  // rear arch (wheel centre zR): the wide haunches
  S(zR + 0.5, 0.11, null, 0.99, 0.25, 1.0, 0.62, 0.97, 0.89, 0.55, 1.0, 1.03, { glass: true }),
  S(zR + 0.36, 0.11, 0.42, 1.0, 0.43, 1.0, 0.66, 0.98, 0.91, 0.54, 0.97, 1.0),
  S(zR + 0.18, 0.11, ARCH + 0.01, 1.0, ARCH + 0.01, 1.0, 0.86, 0.985, 0.93, 0.56, 0.95, 0.97),
  S(zR - 0.18, 0.12, ARCH + 0.01, 1.0, ARCH + 0.01, 1.0, 0.88, 0.975, 0.93, 0.58, 0.92, 0.93),
  S(zR - 0.36, 0.12, 0.42, 0.99, 0.43, 0.99, 0.74, 0.965, 0.91, 0.6, 0.9, 0.9),
  // tail: a short, high, cut-off rear with the nozzles low in a black face
  S(zR - 0.5, 0.12, null, 0.98, 0.26, 0.98, 0.7, 0.96, 0.89, 0.62, 0.89, 0.89),
  S(zTail + 0.15, 0.12, null, 0.97, 0.26, 0.97, 0.7, 0.955, 0.87, 0.64, 0.87, 0.87),
  S(zTail, 0.13, null, 0.95, 0.27, 0.955, 0.68, 0.94, 0.85, 0.64, 0.85, 0.85),
].reverse();   // tail → nose, so z increases along the array

const NV = 9;                // vertices per half-section
function sectionRight(st) {
  const k = st.glass ? 0 : 0.35;
  const w = st.glass
    ? [st.rx - 0.17, st.ry + 0.035]
    : [st.rx + (st.gx - st.rx) * k, st.ry + (st.gy - st.ry) * k];
  return [
    [0, st.fy], [0.62, st.fy], [0.62, st.wy], [st.sx, st.sy],
    [st.bx, st.by], [st.rx, st.ry], w, [st.gx, st.gy], [0, st.ty],
  ];
}
// Full ring (closed), right side bottom→top then left side top→bottom, without duplicating the
// centre points: indices 0..8 right, 9..15 left (mirror of 7..1).
function ring(st) {
  const r = sectionRight(st);
  const out = r.map(([x, y]) => [x, y]);
  for (let i = NV - 2; i >= 1; i--) out.push([-r[i][0], r[i][1]]);
  return out;
}
const RING = 2 * NV - 2;     // 16
// Which material each ring edge e (from vertex e to e+1) takes, aft of station st.
function edgeMat(e, st) {
  const k = e < NV - 1 ? e : RING - 1 - e;   // mirror left edges onto right indices 0..7
  if (k === 0) return 'under';               // floor
  if (k === 1 || k === 2) return 'black';    // well wall, sill underside
  if (k === 3 && st.sy > 0.4) return 'black'; // arch lip return under the haunch
  if ((k === 6 || k === 7) && st.glass) return 'glass';
  return 'paint';
}

// Clip a polygon (array of [x, y]) to y >= c (keep 'above') or y <= c.
function clipY(poly, c, above) {
  const inside = (p) => (above ? p[1] >= c : p[1] <= c);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (c - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, c]);
    }
  }
  return out;
}

function addTri(buf, a, b, c) { buf.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
function flipWinding(g) {
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
function meshFrom(buf, mat, normals = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf, 3));
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Point on the body surface: station-interpolated ring vertex (for shut lines, lamps, decals).
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
  // Panel normals: smooth ALONG each lengthwise strip (one ring edge across consecutive stations),
  // crisp ACROSS strips. So every panel reads as one clean, gently curved sheet with a sharp crease
  // at its edges, like stamped and folded body panels, rather than a crumple of triangles.
  const rings = STATIONS.map((st) => ring(st).map(([x, y]) => [x, y, st.z]));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const quadN = [];   // [segment][edge]
  for (let s = 0; s < STATIONS.length - 1; s++) {
    const row = [];
    for (let e = 0; e < RING; e++) {
      const e2 = (e + 1) % RING;
      const a0 = rings[s][e], a1 = rings[s][e2], b0 = rings[s + 1][e], b1 = rings[s + 1][e2];
      row.push(norm(cross(sub(a1, b0), sub(b1, a0))));   // diagonals: same sense as (a0, a1, b1)
    }
    quadN.push(row);
  }
  // Normal for strip e at station s, seen from segment seg (s or s−1): blend with the neighbouring
  // segment of the same strip unless they meet at a real crease (> 32°).
  const stripN = (seg, s, e) => {
    const own = quadN[seg][e];
    const other = seg === s ? quadN[s - 1]?.[e] : quadN[s]?.[e];
    if (!other || dot(own, other) < Math.cos(32 * Math.PI / 180)) return own;
    return norm([own[0] + other[0], own[1] + other[1], own[2] + other[2]]);
  };
  for (let s = 0; s < STATIONS.length - 1; s++) {
    const B = STATIONS[s + 1];
    for (let e = 0; e < RING; e++) {
      const e2 = (e + 1) % RING;
      const a0 = rings[s][e], a1 = rings[s][e2], b0 = rings[s + 1][e], b1 = rings[s + 1][e2];
      const na = stripN(s, s, e), nb = stripN(s, s + 1, e);
      const key = edgeMat(e, B);
      // Outward winding: the ring runs counter-clockwise seen from +z, so (a0, a1, b1) faces out.
      addTri(bufs[key], a0, a1, b1); addTri(nrm[key], na, na, nb);
      addTri(bufs[key], a0, b1, b0); addTri(nrm[key], na, nb, nb);
    }
  }
  // Caps: the tail face (looking from −z) and the nose face, split by a horizontal line into a
  // silver upper panel and a black lower one (the reference's black lower rear).
  const cap = (st, faceOut, split) => {
    const r = ring(st);
    for (const [above, buf] of [[true, bufs.paint], [false, bufs.black]]) {
      const poly = clipY(r, split, above);
      if (poly.length < 3) continue;
      let cx = 0, cy = 0;
      for (const p of poly) { cx += p[0]; cy += p[1]; }
      cx /= poly.length; cy /= poly.length;
      for (let e = 0; e < poly.length; e++) {
        const p = poly[e], q = poly[(e + 1) % poly.length];
        const P = [p[0], p[1], st.z], Q = [q[0], q[1], st.z], C = [cx, cy, st.z];
        if (faceOut < 0) addTri(buf, C, Q, P); else addTri(buf, C, P, Q);
      }
    }
  };
  cap(STATIONS[0], -1, 0.5);
  cap(STATIONS[STATIONS.length - 1], 1, 0.3);
  // Caps carry their own flat normal.
  for (const k of Object.keys(bufs)) {
    while (nrm[k].length < bufs[k].length) {
      const i = nrm[k].length;
      const a = bufs[k].slice(i, i + 3), b = bufs[k].slice(i + 3, i + 6), c = bufs[k].slice(i + 6, i + 9);
      const n = norm(cross(sub(b, a), sub(c, a)));
      nrm[k].push(...n, ...n, ...n);
    }
  }
  const g = new THREE.Group();
  const shell = meshFrom(bufs.paint, M.paint, nrm.paint);
  g.add(shell, meshFrom(bufs.black, M.black, nrm.black), meshFrom(bufs.under, M.under, nrm.under));
  const glassMesh = meshFrom(bufs.glass, M.glass, nrm.glass);
  g.add(glassMesh);
  return { g, shell, glass: glassMesh };
}

// A thin dark line drawn on the body: a tube through surface points, nudged outward.
function seamLine(points, radius = 0.0045, mat = M.seam) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 4), radius, 5, false), mat);
}
const outward = (x, y, z, k = 1.004) => [x * k, y, z];

// --- Wheels -----------------------------------------------------------------------------------------
const tyreGeoCache = new Map();
function tyreGeo(width) {
  if (tyreGeoCache.has(width)) return tyreGeoCache.get(width);
  // Low-profile tyre on a 22" rim (rim radius ≈ 0.28 m): squared shoulders, flat tread.
  const rr = 0.28, h = width / 2;
  const pts = [[rr, -h], [R - 0.032, -h], [R - 0.012, -h + 0.012], [R - 0.002, -h + 0.035], [R, -h + 0.06],
    [R, h - 0.06], [R - 0.002, h - 0.035], [R - 0.012, h - 0.012], [R - 0.032, h], [rr, h]].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, 56);
  g.rotateZ(Math.PI / 2);
  tyreGeoCache.set(width, g);
  return g;
}

function heroWheel(width, side) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(tyreGeo(width), M.tyre);   // first child: the ghost uses it
  tyre.castShadow = true;
  g.add(tyre);
  const face = side * width * 0.36;                      // outer face x
  // Rim barrel.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, width * 0.82, 40, 1, true), M.rim);
  barrel.rotation.z = Math.PI / 2;
  barrel.material.side = THREE.DoubleSide;
  g.add(barrel);
  // Turbine blades: 14 twisted blades from hub to lip.
  const blade = new THREE.BoxGeometry(0.012, 0.2, 0.046);
  blade.translate(0, 0.165, 0);
  for (let k = 0; k < 14; k++) {
    const b = new THREE.Mesh(blade, M.blade);
    b.position.x = face - side * 0.012;
    b.rotation.x = (k / 14) * Math.PI * 2;
    b.rotateY(side * 0.5);   // twist
    g.add(b);
  }
  // Lip ring and hub.
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.272, 0.012, 6, 48), M.rim);
  lip.rotation.y = Math.PI / 2; lip.position.x = face;
  g.add(lip);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 20), M.blade);
  hub.rotation.z = Math.PI / 2; hub.position.x = face - side * 0.01;
  g.add(hub);
  return g;
}

function brakes(side) {
  // Disc and caliper: they steer with the wheel but do not spin, so they live on the pivot.
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.034, 40), M.disc);
  disc.rotation.z = Math.PI / 2; disc.position.x = -side * 0.02;
  g.add(disc);
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), M.caliper);
  cal.position.set(-side * 0.0, 0.15, -0.09);
  cal.rotation.x = 0.55;
  g.add(cal);
  return g;
}

// --- The model ----------------------------------------------------------------------------------------
export function makeRoadster() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const { g: shellGroup, shell, glass } = buildShell();
  const ghostParts = shellGroup.children.slice();
  body.add(shellGroup);

  // Wheel tubs: satin-black walls inboard of each wheel, so the arches read as deep wells from
  // outside (kept under the bonnet and deck surfaces).
  for (const [z, top] of [[zF, 0.7], [zR, 0.78]]) {
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.02, top - 0.12, 0.72), M.under);
      wall.position.set(s * 0.635, (top + 0.12) / 2, z);
      body.add(wall);
    }
  }

  // --- Lights ---
  // Hidden headlights: a hairline of white light across the nose, just under the leading crease.
  {
    const st = STATIONS[STATIONS.length - 1], st2 = STATIONS[STATIONS.length - 2];
    const y = (st.by + st.ry) / 2 - 0.005, hw = st.bx - 0.06;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.012, 0.012), M.white);
    bar.position.set(0, y, st.z + 0.004);
    body.add(bar);
    // Corner returns along the first facet.
    for (const s of [-1, 1]) {
      const p0 = [s * hw, y, st.z], p1 = [s * (st2.bx - 0.04), (st2.by + st2.ry) / 2 - 0.02, st2.z + 0.02];
      body.add(seamLine([p0, p1], 0.006, M.white));
    }
  }
  // Full-width taillight, a thin second line below it, and the red-lit cabin seen through the
  // rear glass.
  {
    const st = STATIONS[0];
    const main = new THREE.Mesh(new THREE.BoxGeometry(st.rx * 2 - 0.08, 0.032, 0.01), M.red);
    main.position.set(0, st.ry - 0.06, st.z - 0.006);
    const thin = new THREE.Mesh(new THREE.BoxGeometry(st.rx * 2 - 0.5, 0.008, 0.01), M.red);
    thin.position.set(0, st.ry - 0.1, st.z - 0.006);
    body.add(main, thin);
    // The light wraps a few centimetres onto each rear corner.
    for (const s of [-1, 1]) {
      const p0 = [s * (st.rx - 0.04), st.ry - 0.06, st.z - 0.002];
      const p1 = [s * (STATIONS[1].rx), STATIONS[1].ry - 0.06, STATIONS[1].z];
      body.add(seamLine([p0, p1], 0.011, M.red));
    }
    // Red-lit cabin seen through the rear glass: a rounded outline of red light lying just on
    // the glass, inset from its edges (the reference's glowing rear-window frame).
    const z0 = zR + 0.42, z1 = -0.6, inset = 0.07, pts = [];
    const edge = (z, side) => { const g = surfAt(z, 7), t = surfAt(z, 8); return [side * (g[0] - inset - 0.05), g[1] + (t[1] - g[1]) * 0.25 + 0.006, z]; };
    const top = (z, x) => { const t = surfAt(z, 8), g = surfAt(z, 7); return [x, t[1] - (t[1] - g[1]) * Math.abs(x) / g[0] + 0.006, z]; };
    for (let i = 0; i <= 6; i++) pts.push(edge(z0 + inset + (z1 - z0 - 2 * inset) * (i / 6), -1));
    for (let i = 0; i <= 6; i++) pts.push(top(z1 - inset, -0.3 + 0.6 * (i / 6)));
    for (let i = 6; i >= 0; i--) pts.push(edge(z0 + inset + (z1 - z0 - 2 * inset) * (i / 6), 1));
    body.add(seamLine(pts, 0.005, M.red));
    body.add(seamLine(pts, 0.016, M.redGlow));
  }

  // --- Plate recess (blank-ish plate with our own name, never a brand) ---
  {
    const st = STATIONS[0];
    const recess = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.02), M.black);
    recess.position.set(0, 0.63, st.z + 0.004);
    const c = document.createElement('canvas'); c.width = 256; c.height = 80;
    const x = c.getContext('2d');
    x.fillStyle = '#eceef0'; x.fillRect(0, 0, 256, 80);
    x.strokeStyle = '#9da2a8'; x.lineWidth = 4; x.strokeRect(4, 4, 248, 72);
    x.fillStyle = '#2b2e33'; x.font = '600 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('COLD GAS', 128, 42);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.11), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    plate.position.set(0, 0.63, st.z - 0.008); plate.rotation.y = Math.PI;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.01), M.white);
    lamp.position.set(0, 0.705, st.z - 0.012);
    body.add(recess, plate, lamp);
  }

  // --- Diffuser: black, five short strakes between and beside the nozzles ---
  {
    const st = STATIONS[0];
    for (const x of [-0.78, -0.34, 0, 0.34, 0.78]) {
      const strake = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.42), M.black);
      strake.position.set(x, 0.195, st.z + 0.2);
      body.add(strake);
    }
    // Rear valance: a black blade across the base.
    const val = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.018, 0.3), M.black);
    val.position.set(0, 0.125, st.z + 0.14);
    body.add(val);
  }

  // --- Side intakes ahead of the rear wheels: black triangular recesses on the haunch ---
  for (const s of [-1, 1]) {
    const zA = -0.5, zB = zR + 0.42;
    const a = surfAt(zA, 4), b = surfAt(zB, 4), c = surfAt(zB, 5), d = surfAt(zB + 0.1, 3);
    const buf = [];
    const P = (q, z) => [s * (q[0] + 0.004), q[1], z];
    addTri(buf, P(a, zA), P(b, zB), P(c, zB));
    addTri(buf, P(a, zA), P(d, zB + 0.1), P(b, zB));
    const intake = meshFrom(buf, M.black);
    intake.material = M.black;
    if (s < 0) intake.geometry = flipWinding(intake.geometry);
    body.add(intake);
  }

  // --- The ten nozzles, at the spec's body-frame positions (+ comHeight into this frame) ---
  const nozzleGroup = new THREE.Group();
  body.add(nozzleGroup);
  const ringGeo = new THREE.TorusGeometry(0.058, 0.013, 10, 32);
  const throatGeo = new THREE.CylinderGeometry(0.055, 0.042, 0.09, 24, 1, true);
  const darkGeo = new THREE.CircleGeometry(0.046, 24);
  const nozzles = [];
  for (const n of NOZZLE_SPEC) {
    const [px, py, pz] = n.pos, y = py + SPEC.comHeight;
    const jet = new THREE.Vector3(-n.dir[0], -n.dir[1], -n.dir[2]);   // exhaust points out of the jet
    const holder = new THREE.Group();
    // The spec gives the nozzle throat, a few centimetres inside the skin. Push the visible exit
    // ring out along the jet axis to the body surface it fires through.
    const exit = n.group === 'rear' ? (pz - zTail) + 0.004 : n.group === 'front' ? (zNose - pz) + 0.004 : (y - SPEC.rideHeight) + 0.004;
    holder.position.set(px + jet.x * exit, y + jet.y * exit, pz + jet.z * exit);
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), jet);
    const bez = new THREE.Mesh(ringGeo, M.nozzle);
    const throat = new THREE.Mesh(throatGeo, M.nozzle);
    throat.rotation.x = Math.PI / 2; throat.position.z = -0.04;
    throat.material.side = THREE.DoubleSide;
    const dark = new THREE.Mesh(darkGeo, M.nozzleIn);
    dark.position.z = -0.075;
    holder.add(bez, throat, dark);
    if (n.group === 'rear') {
      // The four rear nozzles sit in individual black cups in the diffuser face.
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 28), M.black);
      cup.rotation.x = Math.PI / 2; cup.position.z = -0.03;
      holder.add(cup);
    }
    nozzleGroup.add(holder);
    nozzles.push(holder);
  }

  // --- Front intake (the retro nozzles sit inside it) ---
  {
    const st = STATIONS[STATIONS.length - 1];
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.075, 0.03), M.black);
    intake.position.set(0, 0.25, st.z - 0.012);
    body.add(intake);
  }

  // --- Shut lines: butterfly doors, the T-top seam, the bonnet and the engine-bay deck ---
  {
    const zD0 = 0.98, zD1 = -0.42;
    for (const s of [-1, 1]) {
      const line = (z, v0, v1) => {
        const a = surfAt(z, v0), b = surfAt(z, v1), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return [outward(s * a[0], a[1], z), outward(s * m[0], m[1], z), outward(s * b[0], b[1], z)];
      };
      body.add(seamLine(line(zD0, 3, 5)));
      body.add(seamLine(line(zD1, 3, 5)));
      // Door top runs along the beltline ridge, the bottom along the sill.
      const top = [], bot = [];
      for (let i = 0; i <= 8; i++) {
        const z = zD1 + (zD0 - zD1) * (i / 8);
        const r = surfAt(z, 5), c = surfAt(z, 4), q = surfAt(z, 3);
        const along = (p0, p1, d) => { const t = d / Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]; };
        const tp = along(r, c, 0.02), bp = along(q, c, 0.035);
        top.push(outward(s * tp[0], tp[1], z));
        bot.push(outward(s * bp[0], bp[1], z));
      }
      body.add(seamLine(top), seamLine(bot));
    }
    // T-top centre bar: a body-colour spine over the glass roof.
    const spine = [];
    for (let i = 0; i <= 10; i++) {
      const z = 0.55 - 1.15 * (i / 10);
      spine.push([0, surfAt(z, 8)[1] + 0.006, z]);
    }
    const spineMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(...p))), 30, 0.03, 4, false), M.paint);
    spineMesh.scale.set(2.2, 0.25, 1);
    body.add(spineMesh);
    // The rear deck lid's shut line.
    const deck = [];
    for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) deck.push([x, surfAt(zR - 0.25, 8)[1] + 0.006, zR - 0.25]);
    body.add(seamLine(deck));
  }

  // --- Active rear wing: flush with the deck when stowed, rises and pitches when deployed ---
  const wing = new THREE.Group();
  const wingPivot = new THREE.Group();
  {
    const st = STATIONS[1];
    wing.position.set(0, st.ty - 0.005, st.z + 0.05);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.022, 0.26), M.paint);
    blade.castShadow = true;
    blade.position.z = 0.1;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.006, 0.01), M.black);
    edge.position.set(0, 0.012, 0.23);
    wingPivot.add(blade, edge);
    wing.add(wingPivot);
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1, 0.07), M.black);
      strut.name = 'strut';
      strut.position.set(s * 0.5, 0, 0.12);
      strut.scale.y = 0.001;
      wing.add(strut);
    }
    body.add(wing);
  }
  const struts = wing.children.filter((c) => c.name === 'strut');
  function setWing(t) {
    const k = Math.min(1, Math.max(0, t));
    wingPivot.position.y = k * 0.17;
    wingPivot.rotation.x = k * 0.21;          // trailing edge up = downforce
    for (const s of struts) { s.scale.y = Math.max(0.001, k * 0.17); s.position.y = k * 0.085; }
  }

  // --- Suction fan: a recessed grille under the floor, a cyan ring and underglow ---
  const fan = new THREE.Group();
  {
    fan.position.set(0, SPEC.rideHeight + 0.004, -0.15);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.34, 48), M.black);
    grille.rotation.x = Math.PI / 2;
    const ringM = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.37, 64), M.fanRing);
    ringM.rotation.x = Math.PI / 2; ringM.position.y = -0.001;
    fan.add(grille, ringM);
    for (let k = 0; k < 9; k++) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.004, 0.03), M.blade);
      vane.rotation.y = (k / 9) * Math.PI; vane.position.y = -0.003;
      fan.add(vane);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.6), M.fanGlow);
    glow.rotation.x = -Math.PI / 2; glow.position.y = -SPEC.rideHeight + 0.012;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    M.fanGlow.map = new THREE.CanvasTexture(c);
    fan.add(glow);
    body.add(fan);
  }
  function setFan(level) {
    const k = Math.min(1, Math.max(0, level));
    M.fanRing.opacity = 0.15 + 0.85 * k;
    M.fanGlow.opacity = 0.55 * k;
  }
  setFan(0);
  setWing(0);

  // --- Wheels: FL, FR, RL, RR (the sim's order) ---
  const wheels = [];
  const corners = [
    [-SPEC.trackFront / 2, zF, SPEC.tyreWidthFront, -1], [SPEC.trackFront / 2, zF, SPEC.tyreWidthFront, 1],
    [-SPEC.trackRear / 2, zR, SPEC.tyreWidthRear, -1], [SPEC.trackRear / 2, zR, SPEC.tyreWidthRear, 1],
  ];
  for (const [x, z, w, side] of corners) {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelCenterY(0), z);
    const spin = heroWheel(w, side);
    pivot.add(brakes(side), spin);
    group.add(pivot);
    wheels.push({ pivot, spin, baseY: wheelCenterY(0) });
  }

  group.traverse((o) => { if (o.isMesh && o.material !== M.fanGlow && o.material !== M.redGlow) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, body, shell, canopy: glass, ghostParts: [...ghostParts, ...wheels.map((w) => w.spin.children[0])], wheels, nozzles, comY: SPEC.comHeight, setWing, setFan };
}
