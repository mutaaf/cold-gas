// The courses, as exact geometry. Pure: the sim, the Worker's replay and the renderer all read
// these numbers, so what you see is what you drive on.
//
// Every course answers one question for the physics: `surface(course, p, outNormal)`, the signed
// distance from a world point to the nearest solid (> 0 = free space, < 0 = inside), with the
// unit normal pointing out of the solid. Wheels, the hull and the suction fan all use it, so the
// car can drive up walls and hang upside down under a ledge with the same code that drives it
// on flat concrete. +z is the driving direction, +y is up, metres.
import { dsin, dcos, datan2, dhypot } from './dmath.js';

const D2R = Math.PI / 180;

// --- The Wall (the reveal's stunt) ---------------------------------------------------------------
// Geometry fitted to the livestream's pitch/altitude telemetry and frame measurements
// (docs/REVEAL_RESEARCH.md): one circular arc of radius R that rises from the concrete and turns
// the car through 170° (vertical at 90°, nearly upside down at 170°), then a straight ledge that
// carries the car inverted to the lip at ≈20 m. The riding surface is the concave side, profiled
// in (z, y) and extruded across x:
//   arc:   centre (0, R), from straight down (−90°) to 80°, i.e. 170° of turn
//   ledge: a straight line from the arc's end, along its tangent, for LEDGE metres
const R1 = 13.5, TURN = 170 * D2R, LEDGE = 5.5;   // R1 scaled from the reveal's 9.5 m to raise the lip to 27.7 m (taller than the reveal by design)
const A_END = -Math.PI / 2 + TURN;                      // 80°
const P_END = { z: R1 * dcos(A_END), y: R1 + R1 * dsin(A_END) };
const T_LEDGE = { z: -dsin(A_END), y: dcos(A_END) };    // along the ledge (up the curl)
const N_LEDGE = { z: -dcos(A_END), y: -dsin(A_END) };   // toward free space (below the ledge)
const ARC_LEN = R1 * TURN;
export const WALL = {
  id: 'wall',
  name: 'The Wall',
  blurb: 'Crawl up a 20 m curl on fan suction, hang upside down, let go, roll it, land it.',
  r1: R1, turn: TURN, ledge: LEDGE, arcLength: ARC_LEN,
  h: 0, r2: 0,                // (legacy fields the stage reads; the profile is arc + ledge)
  width: 3.7,                 // m, deck width (frame measurement)
  slab: 0.9,                  // m, deck thickness
  start: { z: -120, x: 0 },
  pad: { z: -9, x: 0, rings: [2, 4, 7] },   // landing target under the ledge, on the approach
  runout: { zMin: -260, zMax: 40 },
  lip: { z: P_END.z + T_LEDGE.z * LEDGE, y: P_END.y + T_LEDGE.y * LEDGE },
  length: ARC_LEN + LEDGE,
};
WALL.topHeight = WALL.lip.y;

// Point, normal (toward free space) and tangent (up the curl) at arc length s along the profile.
export function wallProfile(s, out = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 }) {
  if (s <= ARC_LEN) {
    const th = -Math.PI / 2 + s / R1, c = dcos(th), sn = dsin(th);
    out.z = R1 * c; out.y = R1 + R1 * sn;
    out.nz = -c; out.ny = -sn;
    out.tz = -sn; out.ty = c;
  } else {
    const u = Math.min(LEDGE, s - ARC_LEN);
    out.z = P_END.z + T_LEDGE.z * u; out.y = P_END.y + T_LEDGE.y * u;
    out.nz = N_LEDGE.z; out.ny = N_LEDGE.y;
    out.tz = T_LEDGE.z; out.ty = T_LEDGE.y;
  }
  return out;
}

// Arc length along the profile of the nearest point to (z, y), clamped to [0, length].
export function wallArcLength(z, y) {
  if (y < R1 && z < 0.5) return 0;                      // on the approach, before the foot
  const th = datan2(y - R1, z);
  const onArc = th >= -Math.PI / 2 && th <= A_END;
  const u = (z - P_END.z) * T_LEDGE.z + (y - P_END.y) * T_LEDGE.y;
  if (u > 0 && (!onArc || th > A_END - 0.35)) return Math.min(WALL.length, ARC_LEN + u);
  return Math.max(0, Math.min(ARC_LEN, R1 * (th + Math.PI / 2)));
}

// Signed distance (z, y) → riding-surface solid. Returns +Infinity where the deck isn't.
function wallSdf(z, y, n) {
  let best = Infinity, bz = 0, by = 0;
  {
    const dz = z, dy = y - R1, d = dhypot(dz, dy), th = datan2(dy, dz);
    if (th >= -Math.PI / 2 - 1e-9 && th <= A_END && d > 1e-6) { best = R1 - d; bz = -dz / d; by = -dy / d; }
  }
  {
    const u = (z - P_END.z) * T_LEDGE.z + (y - P_END.y) * T_LEDGE.y;
    if (u >= 0 && u <= LEDGE) {
      const sd = (z - P_END.z) * N_LEDGE.z + (y - P_END.y) * N_LEDGE.y;
      if (Math.abs(sd) < Math.abs(best)) { best = sd; bz = N_LEDGE.z; by = N_LEDGE.y; }
    }
  }
  if (best === Infinity) return Infinity;
  const T = WALL.slab;
  if (best >= 0) { n.nz = bz; n.ny = by; return best; }
  if (best > -T) {
    if (-best <= T + best) { n.nz = bz; n.ny = by; return best; }
    n.nz = -bz; n.ny = -by; return -(T + best);
  }
  n.nz = -bz; n.ny = -by; return -best - T;
}

// --- The Lineup (the kickflip over five parked EVs) -----------------------------------------------
export const RAMP = { z0: -12, z1: 0, height: 1.2, halfWidth: 3.2 };
// The parked vehicles, at the researched size of the class each stands in for (docs/VEHICLES.md:
// every number there carries its source and an OFFICIAL / REPORTED / PHOTO / ESTIMATE tag).
// Each is parked crosswise, so `l` runs across the lane (x) and `w` along the approach (z).
//   w, l, h        the physics box: body width without mirrors, overall length, height (m)
//   wMirrors       width across the mirrors, unfolded (the cab has cameras, no mirrors)
//   clearance      ground clearance, unladen (m)
//   wheelbase      front axle to rear axle (the semi: to the middle of the tandem)
//   axles          [{ at, track, r, w, dual }]: `at` is the axle's distance from the box centre
//                  toward the nose (m), `track` the tyre centre-to-centre width (for twin tyres,
//                  the centre of each pair), r / w the tyre's radius and section width
//   tyreR, tyreW   the front tyre, for code that wants one number; rimR the rim's radius
//   mass           curb mass (kg); cgHeight above the ground, cgAt from the box centre toward the
//                  nose (from the axle loads where published)
//   inertia        about the CoM (kg·m²), ESTIMATE: a solid box × 0.8 for the cars (mass sits low
//                  and inboard: floor battery), × 0.7 for the semi tractor; that lands a mid-size
//                  sedan within ≈10 % of measured values for the class (NHTSA inertia database)
export const LINEUP_SPEC = [
  // Mid-size fastback sedan: 4.720 × 1.850 × 1.440, wb 2.875, 235/45R18 (OFFICIAL, owner's manual).
  { id: 'sedan', name: 'Sedan', w: 1.85, l: 4.72, h: 1.44, paint: 0xe8e8ea, wMirrors: 2.089, clearance: 0.138,
    wheelbase: 2.875, tyreR: 0.335, tyreW: 0.235, rimR: 0.229,
    axles: [{ at: 1.492, track: 1.584, r: 0.335, w: 0.235 }, { at: -1.383, track: 1.584, r: 0.335, w: 0.235 }],
    mass: 1705, cgHeight: 0.46, cgAt: -0.032, inertia: { roll: 620, pitch: 2770, yaw: 2920 } },
  // Compact crossover: 4.790 × 1.920 × 1.624, wb 2.890, 255/45R19 (OFFICIAL, owner's manual).
  { id: 'suv', name: 'Crossover', w: 1.92, l: 4.79, h: 1.624, paint: 0x1d1f24, wMirrors: 2.129, clearance: 0.167,
    wheelbase: 2.89, tyreR: 0.356, tyreW: 0.255, rimR: 0.241,
    axles: [{ at: 1.502, track: 1.636, r: 0.356, w: 0.255 }, { at: -1.388, track: 1.636, r: 0.356, w: 0.255 }],
    mass: 1842, cgHeight: 0.53, cgAt: -0.03, inertia: { roll: 780, pitch: 3140, yaw: 3270 } },
  // Class 8 electric day-cab tractor, 6x4, no trailer: 4.11 m tall as parked (REPORTED); length,
  // wheelbase and tyres ESTIMATE (295/75R22.5, the class's usual size); 10,433 kg (REPORTED).
  { id: 'semi', name: 'Semi', w: 2.59, l: 6.32, h: 4.11, paint: 0xf4f4f2, wMirrors: 2.95, clearance: 0.26,
    wheelbase: 3.96, tyreR: 0.507, tyreW: 0.295, rimR: 0.286,
    axles: [{ at: 1.91, track: 2.05, r: 0.507, w: 0.295 }, { at: -1.39, track: 1.86, r: 0.507, w: 0.295, dual: true }, { at: -2.71, track: 1.86, r: 0.507, w: 0.295, dual: true }],
    mass: 10433, cgHeight: 1.1, cgAt: -0.268, inertia: { roll: 14360, pitch: 34590, yaw: 28390 } },
  // Full-size stainless pickup: 5.683 × 2.032 × 1.794, wb 3.635, 285/65R20, 3,009 kg with axle
  // loads 1,491 / 1,518 kg (OFFICIAL, owner's manual; air suspension at its medium height).
  { id: 'pickup', name: 'Pickup', w: 2.032, l: 5.683, h: 1.794, paint: 0x9aa0a6, wMirrors: 2.413, clearance: 0.257,
    wheelbase: 3.635, tyreR: 0.439, tyreW: 0.285, rimR: 0.254,
    axles: [{ at: 1.964, track: 1.772, r: 0.439, w: 0.285 }, { at: -1.672, track: 1.772, r: 0.439, w: 0.285 }],
    mass: 3009, cgHeight: 0.8, cgAt: 0.128, inertia: { roll: 1470, pitch: 7120, yaw: 7310 } },
  // Two-seat robotaxi: 4.445 × 1.753 × 1.407 (REPORTED, rider guide), 1,412 kg (OFFICIAL, EPA);
  // wheelbase and track ESTIMATE; staggered 215/60R18 front, 225/60R21 rear (REPORTED).
  { id: 'cab', name: 'Cab', w: 1.753, l: 4.445, h: 1.407, paint: 0xd8b25a, wMirrors: 1.753, clearance: 0.145,
    wheelbase: 2.7, tyreR: 0.358, tyreW: 0.215, rimR: 0.229,
    axles: [{ at: 1.423, track: 1.53, r: 0.358, w: 0.215 }, { at: -1.277, track: 1.53, r: 0.402, w: 0.225, rimR: 0.267 }],
    mass: 1412, cgHeight: 0.48, cgAt: 0.127, inertia: { roll: 480, pitch: 2050, yaw: 2150 } },
];
const GAP = 0.62, Z0 = 7;
export const LINEUP_BOXES = (() => {
  let z = Z0;
  return LINEUP_SPEC.map((v) => {
    const b = { ...v, minX: -v.l / 2, maxX: v.l / 2, minY: 0, maxY: v.h, minZ: z, maxZ: z + v.w, cz: z + v.w / 2 };
    z += v.w + GAP;
    return b;
  });
})();
export const LINEUP = {
  id: 'lineup',
  name: 'The Lineup',
  blurb: 'No ramp: lift off flat ground on thrust, roll 360° over five parked EVs, land on the mark.',
  ramp: null,                 // the reveal's kickflip used no ramp: thrust alone
  liftOffZ: 0,                // where the run-up ends and the lift-off marker sits
  boxes: LINEUP_BOXES,
  start: { z: -70, x: 0 },
  pad: { z: 44, x: 0, rings: [2, 4, 7] },
  runout: { zMin: -120, zMax: 190 },
  lineupZ0: Z0,
  lineupEnd: LINEUP_BOXES[LINEUP_BOXES.length - 1].maxZ,
  tallest: Math.max(...LINEUP_BOXES.map((b) => b.h)),
};

function kickerHeight(z) {
  if (z < RAMP.z0 || z > RAMP.z1) return 0;
  const s = (z - RAMP.z0) / (RAMP.z1 - RAMP.z0);
  return RAMP.height * s * s;
}

// --- The Show (one flight: off the Wall and over the lineup) ---------------------------------------
// The two reveal stunts joined into one: the lineup is parked across the approach under the
// ledge, so the car crawls up the curl from a standing start just short of the row, hangs
// inverted, lets go, fires the rear jets to carry over the five parked vehicles, rolls upright on
// the way down and lands on a pad beyond them. One fill of nitrogen for the whole flight, which is
// the real constraint: the down-jets drink ≈95 kg/s at full lift.
const SHOW_ROW_NEAR = -10;          // m: the row's edge nearest the Wall (under the lip at ≈ −3.8)
export const SHOW_BOXES = (() => {
  let z = SHOW_ROW_NEAR;
  return LINEUP_SPEC.map((v) => {
    const b = { ...v, minX: -v.l / 2, maxX: v.l / 2, minY: 0, maxY: v.h, minZ: z - v.w, maxZ: z, cz: z - v.w / 2 };
    z -= v.w + GAP;
    return b;
  });
})();
export const SHOW = {
  id: 'show',
  name: 'The Show',
  blurb: 'One flight: up the Wall, hang inverted, let go, thrust over five parked vehicles, roll it, land it.',
  ramp: null,
  start: { z: -6, x: 0 },
  pad: { z: -30, x: 0, rings: [2, 4, 7] },
  boxes: SHOW_BOXES,
  rowNear: SHOW_ROW_NEAR,
  rowFar: SHOW_BOXES[SHOW_BOXES.length - 1].minZ,
  tallest: Math.max(...SHOW_BOXES.map((b) => b.h)),
  runout: { zMin: -140, zMax: 40 },
};

export const COURSES = { show: SHOW, wall: WALL, lineup: LINEUP };
export const DEFAULT_COURSE = 'show';

// --- Objects: every solid has its own material, and every parked vehicle its own body -------------
// Tyre grip is SPEC.tyreMu × `grip`; `slide` is the friction of bodywork scraping across it.
// ESTIMATES: sealed show-floor concrete is the reference (the curl is poured concrete too); a
// parked car's clearcoat and glass hold a tyre about half as well, and let a sill skate.
export const MATERIALS = {
  concrete: { id: 'concrete', grip: 1, slide: 0.5 },
  paint: { id: 'paint', grip: 0.55, slide: 0.3 },
  // Free Drive's real roads (src/sim/roads.js). ESTIMATES from road-friction literature, relative
  // to the sealed concrete above: dry dense asphalt grips about the same; loose gravel μ ≈ 0.5–0.7
  // of it; dry grass and soil ≈ 0.4–0.5; bare rock ≈ 0.7. Bodywork scrapes along a steel rail or
  // a stone wall at μ ≈ 0.3–0.4.
  asphalt: { id: 'asphalt', grip: 1, slide: 0.55 },
  gravel: { id: 'gravel', grip: 0.62, slide: 0.6 },
  grass: { id: 'grass', grip: 0.45, slide: 0.45 },
  rock: { id: 'rock', grip: 0.7, slide: 0.55 },
  barrier: { id: 'barrier', grip: 0.5, slide: 0.35 },
};
// Parked vehicles: curb mass from LINEUP_SPEC (sourced in docs/VEHICLES.md). Parked means in Park
// with the brake set: all four tyres resist sliding at μ ≈ 0.8 of their load.
const PARKED_MASS = Object.fromEntries(LINEUP_SPEC.map((v) => [v.id, v.mass]));
const PARK_MU = 0.8;

// A world: the course plus its own moving bodies. Each vehicle run gets a fresh one, so a nudged
// car stays nudged for that run only (and replays the same way, it is all in the sim).
export function createWorld(course) {
  const bodies = (course.boxes || []).map((b) => {
    const hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2, m = PARKED_MASS[b.id] || 2000;
    return {
      id: b.id, hx, hz, h: b.maxY, cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, yaw: 0, c: 1, s: 0,
      vx: 0, vz: 0, w: 0, mass: m, inertia: (m * (4 * hx * hx + 4 * hz * hz)) / 12, mat: MATERIALS.paint,
      fx: 0, fz: 0, fy: 0, tq: 0, moved: false,
    };
  });
  const w = { bodies, minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0 };
  refreshBounds(w);
  return w;
}

function refreshBounds(w) {
  w.minX = Infinity; w.maxX = -Infinity; w.minZ = Infinity; w.maxZ = -Infinity; w.maxY = -Infinity;
  for (const b of w.bodies) {
    const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz, ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz;
    w.minX = Math.min(w.minX, b.cx - ex); w.maxX = Math.max(w.maxX, b.cx + ex);
    w.minZ = Math.min(w.minZ, b.cz - ez); w.maxZ = Math.max(w.maxZ, b.cz + ez); w.maxY = Math.max(w.maxY, b.h);
  }
}

// Push on a body at world point (px, pz) with force (fx, fy, fz) for this tick.
export function pushBody(b, px, pz, fx, fy, fz) {
  b.fx += fx; b.fz += fz; b.fy += fy;
  b.tq += (pz - b.cz) * fx - (px - b.cx) * fz;     // about +y
}

// Overlap of two yawed boxes in plan (separating axes): depth and unit axis from a to b, or 0.
const sat = { d: 0, x: 0, z: 0 };
function overlap2(a, b) {
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  const axes = [a.c, -a.s, a.s, a.c, b.c, -b.s, b.s, b.c];   // each box's local x and z, in world
  sat.d = Infinity;
  for (let k = 0; k < 8; k += 2) {
    const ux = axes[k], uz = axes[k + 1];
    const ra = a.hx * Math.abs(a.c * ux - a.s * uz) + a.hz * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hx * Math.abs(b.c * ux - b.s * uz) + b.hz * Math.abs(b.s * ux + b.c * uz);
    const dist = dx * ux + dz * uz, o = ra + rb - Math.abs(dist);
    if (o <= 0) return 0;
    if (o < sat.d) { sat.d = o; const sg = dist < 0 ? -1 : 1; sat.x = ux * sg; sat.z = uz * sg; }
  }
  return sat.d;
}

// Step the parked bodies: whatever pushed them this tick, against their parked tyres. Sliding on
// the concrete in the plane (x, z, yaw); a body at rest with nothing pushing costs nothing. A
// shoved car shoves the next one: body against body is a stiff, damped contact in plan.
export function stepWorld(w, dt, g) {
  let moved = false;
  const bs = w.bodies;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (!a.moved) continue;
    for (let j = 0; j < bs.length; j++) {
      const b = bs[j];
      if (j === i || (b.moved && j < i)) continue;
      const d = overlap2(a, b);
      if (d <= 0) continue;
      const vn = (b.vx - a.vx) * sat.x + (b.vz - a.vz) * sat.z;
      const f = Math.max(0, 4e6 * d - 4e4 * vn);
      const px = (a.cx + b.cx) / 2, pz = (a.cz + b.cz) / 2;
      pushBody(b, px, pz, f * sat.x, 0, f * sat.z);
      pushBody(a, px, pz, -f * sat.x, 0, -f * sat.z);
    }
  }
  for (const b of w.bodies) {
    const pushed = b.fx !== 0 || b.fz !== 0 || b.tq !== 0;
    if (!pushed && b.vx === 0 && b.vz === 0 && b.w === 0) continue;
    const N = b.mass * g + Math.max(0, -b.fy);
    let vx = b.vx + (b.fx / b.mass) * dt, vz = b.vz + (b.fz / b.mass) * dt;
    const v = dhypot(vx, vz), dv = (PARK_MU * N / b.mass) * dt;
    if (v <= dv) { vx = 0; vz = 0; } else { vx -= (vx / v) * dv; vz -= (vz / v) * dv; }
    // Yaw: the four tyre patches sit ≈ half the diagonal from the centre.
    let wy = b.w + (b.tq / b.inertia) * dt;
    const dw = (PARK_MU * N * 0.5 * dhypot(b.hx, b.hz) / b.inertia) * dt;
    wy = Math.abs(wy) <= dw ? 0 : wy - Math.sign(wy) * dw;
    b.vx = vx; b.vz = vz; b.w = wy;
    b.fx = 0; b.fz = 0; b.fy = 0; b.tq = 0;
    if (vx !== 0 || vz !== 0 || wy !== 0) {
      b.cx += vx * dt; b.cz += vz * dt; b.yaw += wy * dt;
      b.c = dcos(b.yaw); b.s = dsin(b.yaw);
      b.moved = true; moved = true;
    }
  }
  if (moved) refreshBounds(w);
}

// Signed distance to one (yawed) box, normal into `n`.
function bodySdf(b, x, y, z, n) {
  const dx = x - b.cx, dz = z - b.cz;
  const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;          // world → body (yaw about +y)
  const qx = Math.max(-b.hx - lx, 0, lx - b.hx), qy = Math.max(-y, 0, y - b.h), qz = Math.max(-b.hz - lz, 0, lz - b.hz);
  let nx, ny, nz, d;
  const out = dhypot(qx, qy, qz);
  if (out > 0) {
    nx = (lx < -b.hx ? -qx : lx > b.hx ? qx : 0) / out;
    ny = (y < 0 ? -qy : y > b.h ? qy : 0) / out;
    nz = (lz < -b.hz ? -qz : lz > b.hz ? qz : 0) / out;
    d = out;
  } else {
    // Inside: nearest face (never down; the floor handles that).
    const f0 = lx + b.hx, f1 = b.hx - lx, f2 = b.h - y, f3 = lz + b.hz, f4 = b.hz - lz;
    d = f0; nx = -1; ny = 0; nz = 0;
    if (f1 < d) { d = f1; nx = 1; ny = 0; nz = 0; }
    if (f2 < d) { d = f2; nx = 0; ny = 1; nz = 0; }
    if (f3 < d) { d = f3; nx = 0; ny = 0; nz = -1; }
    if (f4 < d) { d = f4; nx = 0; ny = 0; nz = 1; }
    d = -d;
  }
  n.nx = b.c * nx + b.s * nz; n.ny = ny; n.nz = -b.s * nx + b.c * nz;   // body → world
  return d;
}

// --- The query the physics asks ---------------------------------------------------------------------
const staticWorlds = new Map();
const worldOf = (course) => {
  let w = staticWorlds.get(course);
  if (!w) { w = createWorld(course); staticWorlds.set(course, w); }
  return w;
};
const tmpN = { nx: 0, ny: 0, nz: 0 };
// Signed distance from (x, y, z) to the course's solids. `out` gets the unit normal {x, y, z},
// the material `mat`, and `body`: the parked vehicle it is (or null). `world` carries the run's
// own bodies; without one, the parked vehicles stand where the course put them.
export function surface(course, x, y, z, out, world = worldOf(course)) {
  // A course that brings its own geometry (Free Drive's real roads, src/sim/roads.js).
  if (course.sdf) return course.sdf(x, y, z, out);
  // The ground: flat concrete everywhere (y = 0), plus the kicker where a course has one.
  let phi, nx = 0, ny = 1, nz = 0;
  if (course.ramp && Math.abs(x) <= RAMP.halfWidth && z >= RAMP.z0 && z <= RAMP.z1) {
    const L = RAMP.z1 - RAMP.z0, s = (z - RAMP.z0) / L, slope = (2 * RAMP.height * s) / L, k = 1 / Math.sqrt(1 + slope * slope);
    phi = (y - kickerHeight(z)) * k; ny = k; nz = -slope * k;
  } else {
    phi = y;
  }
  out.obstacle = false; out.body = null; out.mat = MATERIALS.concrete;
  if (course.id === 'wall' || course.id === 'show') {
    if (Math.abs(x) <= WALL.width / 2) {
      const d = wallSdf(z, y, tmpN);
      if (d < phi) { phi = d; nx = 0; ny = tmpN.ny; nz = tmpN.nz; }
    }
  }
  // Parked vehicles. A body is never nearer than the row's bounding box, so skip the row whenever
  // that is already farther than the nearest surface: same answer, a fraction of the work.
  const bodies = world.bodies;
  if (bodies.length && x > world.minX - phi && x < world.maxX + phi && z > world.minZ - phi && z < world.maxZ + phi && y < world.maxY + phi) {
    for (let i = 0; i < bodies.length; i++) {
      const d = bodySdf(bodies[i], x, y, z, tmpN);
      if (d < phi) { phi = d; nx = tmpN.nx; ny = tmpN.ny; nz = tmpN.nz; out.obstacle = true; out.body = bodies[i]; out.mat = bodies[i].mat; }
    }
  }
  out.x = nx; out.y = ny; out.z = nz;
  return phi;
}

// Height of the tallest roof under (x, z), or −Infinity (clearance telemetry).
export function roofUnder(world, x, z) {
  let top = -Infinity;
  for (const b of world.bodies) {
    const dx = x - b.cx, dz = z - b.cz;
    const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;
    if (lx > -b.hx && lx < b.hx && lz > -b.hz && lz < b.hz && b.h > top) top = b.h;
  }
  return top;
}
