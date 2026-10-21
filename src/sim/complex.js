// THE LAUNCH COMPLEX as geometry, for the renderer and the physics alike: the raised pad, the launch
// mount, the vehicle standing on it, the strongback, the lightning and flood masts, the water tank on
// its legs, the ground buildings and the tank farm. src/render/rocket.js draws these numbers and
// src/sim/world.js builds its colliders from them, so what you see out there is what you hit.
// Dimensions and their sources: docs/ROCKET.md. Pure: + − × ÷ √ and dmath, no clock, no DOM.
//
// The site's local frame: origin on the ground at the pad's centre (under the vehicle's axis), +y up,
// +z the floodlit front (turned toward the stage), +x the strongback's side. The flame trench runs
// from under the mount out along −z, away from the stage, and the static fire's exhaust leaves it
// there (src/sim/rocket.js: the plume).
import { dsin, dcos, datan2 } from './dmath.js';
import { MATERIALS } from './courses.js';

// --- The vehicle (metres; docs/ROCKET.md) ---------------------------------------------------------
export const VEHICLE = {
  height: 70.0,          // overall, base of the engine section to the fairing tip
  radius: 1.83,          // 3.66 m core diameter (road-transportable)
  boosterTop: 41.2,      // first-stage tanks + engine section
  interstageTop: 47.7,   // interstage (carries the four grid fins)
  stage2Top: 56.6,       // second stage, visible part
  fairingRadius: 2.6,    // 5.2 m payload fairing
  fairingTop: 70.0,
  legLength: 9.6,        // four landing legs folded flat against the engine section and tank
  finSize: [1.3, 1.5],   // grid fin, stowed (w × h)
};
export const MOUNT_TOP = 8.0;   // the launch mount's deck: the vehicle stands on hold-downs here
export const PAD_Y = 3.0;       // the pad: a raised hardstand above the surrounding ground
export const TOWER_X = 6.4;     // strongback centre, beside the vehicle
export const TOWER_H = 82;
export const TOWER_W = 3.4;
// The hardstand's profile, a lathe (r, y): flat top to 66 m, a skirt down to grade at 86 m.
export const PAD_PROFILE = [[0, PAD_Y], [66, PAD_Y], [84, 0.25], [86, 0]];
export const PAD_SEGMENTS = 64;
// The launch mount: a steel table (10 × 1.6 × 10) on four 1.4 m columns.
export const MOUNT = { deck: [10, 1.6, 10], col: 1.4, cols: [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]] };
// The flame trench: 9 m wide, from under the mount (4 m out) to its exit 48 m out along −z.
export const TRENCH = { w: 9, from: 4, to: 48 };
export const MAST_H = 104;
export const MASTS = [[-34, -22], [30, -30], [-8, 44]];
export const TANK = { x: -62, z: 36, r: 5.5, h: 11, y: 46, legs: [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]], legTop: 41, legT: 0.6 };
// Ground support buildings [x, z, w, h, d] and the tank farm's spheres [x, z, r] (on 1.2 m saddles).
export const BUILDINGS = [[-48, -30, 22, 7, 12], [-60, -6, 12, 5, 9], [44, -44, 16, 6, 10]];
export const SPHERES = [[38, 30, 4.2], [48, 33, 4.2], [-30, 44, 5]];
// Flood banks: ground banks close in and mast heads further out. Aimed at a point on the vehicle.
export const FLOODS = [
  { p: [-15, PAD_Y + 1.2, 19], aim: 18, col: [1.0, 0.95, 0.88], k: 2300, ground: true },
  { p: [18, PAD_Y + 1.2, 13], aim: 26, col: [0.84, 0.9, 1.0], k: 900, ground: true },
  { p: [-30, 26, 24], aim: 52, col: [0.97, 0.98, 1.0], k: 6500 },
  { p: [24, 32, -26], aim: 46, col: [0.78, 0.86, 1.0], k: 7000 },
];
export const CLAMP_LEVELS = [18, 33, VEHICLE.boosterTop - 1.5];   // above the mount deck

// --- Where it stands --------------------------------------------------------------------------------
// Per stage: the pad's centre in the world and a point it faces (its +z turned toward it). Chosen by
// framing (docs/ROCKET.md): 265 m to the −x side of the Wall's stage; ≈ 580 m out on the Lineup.
export const PLACES = {
  night: { pos: [-265, 0, -8], face: [10, -14] },
  lineup: { pos: [-260, 0, 520], face: [0, 30] },
};
const SITES = new Map();
/** The complex's placement on a course: { x, z, yaw, c, s } (c, s: cos and sin of yaw), or null. */
export function siteOf(courseId) {
  const key = courseId === 'lineup' ? 'lineup' : courseId === 'show' || courseId === 'wall' ? 'night' : null;
  if (!key) return null;
  let s = SITES.get(key);
  if (!s) {
    const P = PLACES[key], yaw = datan2(P.face[0] - P.pos[0], P.face[1] - P.pos[2]);
    s = { key, x: P.pos[0], z: P.pos[2], yaw, c: dcos(yaw), s: dsin(yaw) };
    SITES.set(key, s);
  }
  return s;
}
/** A point in the site's frame → the world (three.js's rotation about +y by yaw, then the pad's centre). */
export function toWorld(site, lx, ly, lz, out = { x: 0, y: 0, z: 0 }) {
  out.x = site.x + lx * site.c + lz * site.s; out.y = ly; out.z = site.z - lx * site.s + lz * site.c;
  return out;
}
/** A world point → the site's frame. */
export function toLocal(site, x, y, z, out = { x: 0, y: 0, z: 0 }) {
  const dx = x - site.x, dz = z - site.z;
  out.x = dx * site.c - dz * site.s; out.y = y; out.z = dx * site.s + dz * site.c;
  return out;
}
// Everything solid lies within this radius of the pad's centre (the skirt's foot at 86 m).
export const SITE_RADIUS = 90;
export const SITE_TOP = PAD_Y + MAST_H + 1;

// --- The solids ----------------------------------------------------------------------------------------
// In the site's frame: { kind: 'hull', points } | { kind: 'box', hx, hy, hz } | { kind: 'cyl', hh, r } |
// { kind: 'ball', r }, at (x, y, z), turned by the quaternion q (about the shape's centre), with a material.
// Built once. Each is what is drawn, or its convex envelope (within a few centimetres): the skirt's
// knee, the fins and the folded legs (inside the vehicle's cylinder) are where they differ.
let SOLIDS = null;
const Q0 = { x: 0, y: 0, z: 0, w: 1 };
// The rotation taking +y to the unit vector d (a member's axis).
function upTo(dx, dy, dz) {
  const x = dz, z = -dx, w = 1 + dy, l = Math.sqrt(x * x + z * z + w * w);
  return { x: x / l, y: 0, z: z / l, w: w / l };
}
function lathe(profile, n, y0 = 0) {
  const pts = [];
  for (const [r, y] of profile) {
    if (r === 0) { pts.push(0, y0 + y, 0); continue; }
    for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; pts.push(r * dsin(a), y0 + y, r * dcos(a)); }
  }
  return Float32Array.from(pts);
}
export function siteSolids() {
  if (SOLIDS) return SOLIDS;
  const S = [], steel = MATERIALS.steel, concrete = MATERIALS.concrete;
  const box = (x, y, z, hx, hy, hz, mat = steel, q = Q0) => S.push({ kind: 'box', x, y, z, hx, hy, hz, q, mat });
  const member = (a, b, t) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, t / 2, L / 2, t / 2, steel, upTo(dx / L, dy / L, dz / L));
  };
  const frustum = (x, z, y0, y1, r0, r1, n = 8) => S.push({ kind: 'hull', x, y: 0, z, q: Q0, mat: steel, points: lathe([[r0, y0], [r1, y1]], n) });
  // The hardstand: the drawn lathe's top ring and its foot (the skirt's knee sits 5 cm under the
  // straight line between them), on the drawn segments, buried half a metre into the ground.
  S.push({ kind: 'hull', x: 0, y: 0, z: 0, q: Q0, mat: concrete, points: lathe([[PAD_PROFILE[1][0], PAD_Y], [PAD_PROFILE[3][0], 0], [PAD_PROFILE[3][0], -0.5]], PAD_SEGMENTS) });
  // The launch mount: its deck and four columns.
  const [dw, dh, dd] = MOUNT.deck;
  box(0, MOUNT_TOP - dh / 2, 0, dw / 2, dh / 2, dd / 2);
  const ch = MOUNT_TOP - dh - PAD_Y;
  for (const [x, z] of MOUNT.cols) box(x, PAD_Y + ch / 2, z, MOUNT.col / 2, ch / 2, MOUNT.col / 2);
  // The vehicle on its hold-downs: the core to the interstage's top, then the upper stage, the
  // boat-tail, the fairing's barrel and its ogive nose as one convex lathe.
  const V = VEHICLE, B = MOUNT_TOP, R = V.radius;
  S.push({ kind: 'cyl', x: 0, y: B + V.interstageTop / 2, z: 0, hh: V.interstageTop / 2, r: R + 0.03, q: Q0, mat: steel });
  const FR = V.fairingRadius, zb = V.stage2Top + 1.6, zo = V.fairingTop - 6.2, nose = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; nose.push([Math.max(FR * Math.sqrt(1 - t * t) * (1 - 0.06 * t), 0), zo + t * (V.fairingTop - zo)]); }
  nose[nose.length - 1][0] = 0;
  S.push({ kind: 'hull', x: 0, y: B, z: 0, q: Q0, mat: steel, points: lathe([[R, V.interstageTop], [R, V.stage2Top], [FR - 0.02, zb], [FR, zb + 0.2], [FR, zo], ...nose.slice(1)], 16) });
  // The strongback: its lattice as a solid column, the top deck, the crew access arm and white room,
  // and the clamp arms.
  box(TOWER_X, (PAD_Y + TOWER_H) / 2, 0, TOWER_W / 2, (TOWER_H - PAD_Y) / 2, TOWER_W / 2);
  box(TOWER_X, TOWER_H, 0, (TOWER_W + 1.2) / 2, 0.5, (TOWER_W + 1.2) / 2);
  const armY = B + V.interstageTop + 5.5, armX0 = R + 0.2, armX1 = TOWER_X - TOWER_W / 2;
  box((armX0 + armX1) / 2, armY, 0, (armX1 - armX0) / 2, 1.2, 1.1);
  box(R + 1.3, armY + 0.2, 0, 1.3, 1.5, 1.5);
  for (const y of CLAMP_LEVELS) for (const z of [-0.9, 0.9]) member([TOWER_X - TOWER_W / 2, B + y, z], [R + 0.15, B + y, z * 0.5], 0.45);
  // Lightning masts (tapered, 8-sided as drawn) and the two flood masts.
  for (const [x, z] of MASTS) frustum(x, z, PAD_Y, PAD_Y + MAST_H, 1.0, 0.35);
  for (const f of FLOODS) if (!f.ground) frustum(f.p[0], f.p[2], PAD_Y, f.p[1], 0.4, 0.25);
  // The water tank on its four raked legs.
  S.push({ kind: 'cyl', x: TANK.x, y: PAD_Y + TANK.y, z: TANK.z, hh: TANK.h / 2, r: TANK.r, q: Q0, mat: steel });
  for (const [dx, dz] of TANK.legs) member([TANK.x + dx * 1.5, PAD_Y, TANK.z + dz * 1.5], [TANK.x + dx, PAD_Y + TANK.legTop, TANK.z + dz], TANK.legT);
  // Ground buildings and the tank farm's spheres.
  for (const [x, z, w, h, d] of BUILDINGS) box(x, PAD_Y + h / 2, z, w / 2, h / 2, d / 2, concrete);
  for (const [x, z, r] of SPHERES) S.push({ kind: 'ball', x, y: PAD_Y + r + 1.2, z, r, q: Q0, mat: steel });
  SOLIDS = S;
  return S;
}

// --- The static fire's exhaust ------------------------------------------------------------------------
// The engines fire down into the trench; its deflector turns the flow along it and out of its exit
// as a jet along −z, centred 2 m over the pad (src/sim/rocket.js computes what it does to a car).
export const PLUME = { exit: [0, PAD_Y + 2, -TRENCH.to], dir: [0, 0, -1], halfWidth: TRENCH.w / 2 };
