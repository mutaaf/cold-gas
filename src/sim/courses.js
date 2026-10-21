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
  start: { z: -6, x: 0 },     // parked at the foot of the curl, as run 1 began (research §2.1.2; was -120)
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
  pad: { z: 28, x: 0, rings: [2, 4, 7] },
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
// Each material answers two questions. `grip` is a tyre's: SPEC.tyreMu × grip is the peak μ on it.
// `slide` is the Coulomb friction of bodywork sliding on it, and `bounce` its restitution: these
// go to the rigid-body engine (src/sim/world.js) as the collider's friction and restitution, and a
// contact takes the lower friction of the pair (Rapier's Min rule) and the mean restitution.
// ESTIMATES, with their sources:
//  - concrete: sealed show-floor concrete is the tyre reference (grip 1). Sheet metal or composite
//    sliding on dry concrete μ ≈ 0.45–0.55 (accident-reconstruction tables, e.g. Fricke, Traffic
//    Accident Reconstruction, 1990: a vehicle sliding on its side or roof 0.3–0.5 on dry pavement).
//    A body that hits it keeps little bounce: e ≈ 0.1 (crash tests: 0.1–0.3 at crash speeds).
//  - deck: the Wall's curl is poured, brushed concrete (the reveal footage): concrete's numbers, its
//    own id so a crash can tell the deck from the floor.
//  - pad: the landing mark is traffic paint on the concrete. Dry marking paint measures μ ≈ 0.6–0.7
//    against ≈ 0.8 for the bare surface (pavement-marking skid tests): 0.85 of concrete's grip.
//  - paint: a parked car's clearcoat and glass hold a tyre about half as well as concrete and let
//    bodywork skate (car on car: painted steel on painted steel μ ≈ 0.3–0.4, e ≈ 0.15).
//  - steel: the Wall's truss and its posts: steel on steel / composite μ ≈ 0.4, e ≈ 0.2.
//  - body: the roadster's own skin (carbon and aluminium): μ 0.5 against anything rougher than it.
//  - Free Drive's real roads (src/sim/roads.js), relative to the sealed concrete: dry dense asphalt
//    grips about the same; loose gravel μ ≈ 0.5–0.7 of it; dry grass and soil ≈ 0.4–0.5; bare rock
//    ≈ 0.7. Bodywork scrapes along a steel rail or a stone wall at μ ≈ 0.3–0.4.
export const MATERIALS = {
  concrete: { id: 'concrete', grip: 1, slide: 0.5, bounce: 0.1 },
  deck: { id: 'deck', grip: 1, slide: 0.5, bounce: 0.1 },
  pad: { id: 'pad', grip: 0.85, slide: 0.45, bounce: 0.1 },
  paint: { id: 'paint', grip: 0.55, slide: 0.35, bounce: 0.15 },
  steel: { id: 'steel', grip: 0.6, slide: 0.4, bounce: 0.2 },
  body: { id: 'body', grip: 0.55, slide: 0.5, bounce: 0.12 },
  asphalt: { id: 'asphalt', grip: 1, slide: 0.55, bounce: 0.1 },
  // `loose`: off the pavement; traction control adapts to it (vehicle.js).
  // `roll`: rolling resistance over the pavement's, as a coefficient of the tyre's load (Crr). A car
  // tyre rolls at Crr ≈ 0.010–0.015 on asphalt or concrete (already in the tyre model); on soft
  // ground the tyre sinks and ploughs: ≈ 0.02 on packed gravel, ≈ 0.035–0.04 on firm mown turf,
  // ≈ 0.05 on hard earth, ≈ 0.1 on firm sand, up to 0.3 in loose (Wong, Theory of Ground Vehicles, 4th ed.,
  // tab. 1.2; Gillespie, Fundamentals of Vehicle Dynamics, §4). Values are those minus pavement's
  // (ESTIMATE).
  gravel: { id: 'gravel', grip: 0.62, slide: 0.6, bounce: 0.05, loose: true, roll: 0.01 },
  grass: { id: 'grass', grip: 0.45, slide: 0.45, bounce: 0.05, loose: true, roll: 0.025 },
  // Bare earth (forest soil, eroded banks): firmer than turf, softer than gravel (ESTIMATE μ ≈ 0.55).
  dirt: { id: 'dirt', grip: 0.55, slide: 0.55, bounce: 0.05, loose: true, roll: 0.04 },
  rock: { id: 'rock', grip: 0.7, slide: 0.55, bounce: 0.15, loose: true, roll: 0.005 },
  // Dry sand (the endless road's deserts and shores): tyres on loose dry sand manage μ ≈ 0.4–0.6
  // of their tarmac grip (ESTIMATE, off-road traction studies).
  sand: { id: 'sand', grip: 0.5, slide: 0.5, bounce: 0.05, loose: true, roll: 0.1 },
  barrier: { id: 'barrier', grip: 0.5, slide: 0.35, bounce: 0.2 },
  // A tree's trunk (bark on wood): what bodywork meets hitting one (ESTIMATE, like the barrier).
  wood: { id: 'wood', grip: 0.6, slide: 0.45, bounce: 0.15 },
};

// The parked vehicles as physical objects. LINEUP_SPEC is the data (docs/VEHICLES.md, every number
// sourced): dimensions, curb mass, CoM height and its offset toward the nose, inertia, ground
// clearance and the axles (position, track, tyre radius). Anything it doesn't carry falls back to a
// class estimate here, so a better number in LINEUP_SPEC wins without touching the physics.
// Fallback ESTIMATES: wheelbase ≈ 0.60 × length, track ≈ width − 0.28 m, CoM height ≈ 0.31 ×
// height (floor batteries carry the mass low), inertia a uniform box × 0.8 (Heydinger et al., SAE
// 1999-01-1336: measured cars sit ≈0.8 of the box), clearance 0.15 m (0.3 for a truck).
// Suspension (ours, ESTIMATE): ride frequency 1.3 Hz for cars, 1.8 Hz for the tractor (Gillespie,
// Fundamentals of Vehicle Dynamics, 1992: passenger cars 1–1.5 Hz, trucks higher), damping ratio
// 0.3 (0.2–0.4), each corner's spring rated to the load it carries (lever rule over the axles; a
// tandem shares as one axle at its middle), so the body sits level at its clearance.
// Parked means in Park with the electric parking brake set: every tyre resists sliding, a locked
// tyre on dry concrete at μ ≈ 0.8 of its load (skid-test values for dry concrete: 0.7–0.85).
const PARKED_MASS = { sedan: 1800, suv: 2000, semi: 10500, pickup: 3100, cab: 1600 };
export const PARK_MU = 0.8;
const G0 = 9.81;
export function parkedPhysics(v) {
  const truck = v.h > 3;
  const mass = v.mass ?? PARKED_MASS[v.id] ?? 2000;
  const box = (a, b) => (mass * (a * a + b * b)) / 12 * 0.8;
  const wheelbase = v.wheelbase ?? 0.6 * v.l, track = v.track ?? v.w - 0.28, wheelR = v.wheelR ?? v.tyreR ?? (truck ? 0.52 : 0.36);
  const cgx = v.cgAt ?? 0;
  const axles = v.axles ?? [{ at: wheelbase / 2, track, r: wheelR }, { at: -wheelbase / 2, track, r: wheelR }];
  // Static axle loads by the lever rule between the front axle and the rear group's middle.
  const front = axles[0], rear = axles.slice(1), rearAt = rear.reduce((a, x) => a + x.at, 0) / rear.length;
  const span = front.at - rearAt, frontShare = span > 0 ? (cgx - rearAt) / span : 0.5;
  const corners = [];
  for (const ax of axles) {
    const share = ax === front ? frontShare : (1 - frontShare) / rear.length;
    for (const side of [1, -1]) corners.push({ x: ax.at, z: (side * ax.track) / 2, r: ax.r, load: (mass * G0 * share) / 2 });
  }
  return {
    mass, wheelbase, track, wheelR, cgx, corners,
    cgh: v.cgHeight ?? v.cgh ?? 0.31 * v.h,
    clearance: v.clearance ?? (truck ? 0.3 : 0.15),
    rideHz: v.rideHz ?? (truck ? 1.8 : 1.3),
    damping: v.damping ?? 0.3,
    // Principal moments in the body frame: x along the length (roll), y up (yaw), z across (pitch).
    inertia: v.inertia ?? { roll: box(v.w, v.h), yaw: box(v.l, v.w), pitch: box(v.l, v.h) },
  };
}

// A parked vehicle's state as everything outside the engine sees it: a box of the vehicle's size,
// clearance to roof, posed by its chassis frame (origin on the ground under the box's centre when
// it stands at rest, x along its length, y up, z across). `cx, cy, cz` + quaternion `qx..qw` is the
// pose; `yaw` its heading. The engine's rigid body (src/sim/world.js) writes these every tick.
export function parkedMirror(b) {
  const ph = parkedPhysics(b);
  return {
    id: b.id, spec: b, phys: ph, mass: ph.mass, mat: MATERIALS.paint,
    hx: (b.maxX - b.minX) / 2, hz: (b.maxZ - b.minZ) / 2, h: b.maxY, clr: ph.clearance,
    cx: (b.minX + b.maxX) / 2, cy: 0, cz: (b.minZ + b.maxZ) / 2, qx: 0, qy: 0, qz: 0, qw: 1, yaw: 0,
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, pvx: 0, pvy: 0, pvz: 0, pwx: 0, pwy: 0, pwz: 0, moved: false, asleep: true, rb: null, collider: null,
  };
}
export function refreshBounds(w) {
  w.minX = Infinity; w.maxX = -Infinity; w.minZ = Infinity; w.maxZ = -Infinity; w.maxY = -Infinity;
  for (const b of w.bodies) {
    const r = Math.sqrt(b.hx * b.hx + b.hz * b.hz + b.h * b.h);
    w.minX = Math.min(w.minX, b.cx - r); w.maxX = Math.max(w.maxX, b.cx + r);
    w.minZ = Math.min(w.minZ, b.cz - r); w.maxZ = Math.max(w.maxZ, b.cz + r); w.maxY = Math.max(w.maxY, b.cy + r);
  }
}
// The parked row where the course put it, for queries that don't belong to a run (the renderer's
// debris, the HUD, tests). A run's own bodies live in its engine world (src/sim/world.js).
export function staticWorld(course) {
  const w = { bodies: (course.boxes || []).map(parkedMirror), minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0 };
  refreshBounds(w);
  return w;
}

// World point → body frame (by the conjugate of the body's rotation).
const lp = { x: 0, y: 0, z: 0 };
function toLocal(b, x, y, z) {
  const vx = x - b.cx, vy = y - b.cy, vz = z - b.cz;
  const qx = -b.qx, qy = -b.qy, qz = -b.qz, qw = b.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  lp.x = vx + qw * tx + (qy * tz - qz * ty); lp.y = vy + qw * ty + (qz * tx - qx * tz); lp.z = vz + qw * tz + (qx * ty - qy * tx);
  return lp;
}
const wn = { x: 0, y: 0, z: 0 };
function toWorldDir(b, x, y, z) {
  const qx = b.qx, qy = b.qy, qz = b.qz, qw = b.qw;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  wn.x = x + qw * tx + (qy * tz - qz * ty); wn.y = y + qw * ty + (qz * tx - qx * tz); wn.z = z + qw * tz + (qx * ty - qy * tx);
  return wn;
}

// Signed distance to one parked body's box (clearance to roof, in its own frame), normal into `n`.
function bodySdf(b, x, y, z, n) {
  const p = toLocal(b, x, y, z);
  const cy = (b.clr + b.h) / 2, hy = (b.h - b.clr) / 2;
  const lx = p.x, ly = p.y - cy, lz = p.z;
  const qx = Math.max(-b.hx - lx, 0, lx - b.hx), qy = Math.max(-hy - ly, 0, ly - hy), qz = Math.max(-b.hz - lz, 0, lz - b.hz);
  let nx, ny, nz, d;
  const out = dhypot(qx, qy, qz);
  if (out > 0) {
    nx = (lx < -b.hx ? -qx : lx > b.hx ? qx : 0) / out;
    ny = (ly < -hy ? -qy : ly > hy ? qy : 0) / out;
    nz = (lz < -b.hz ? -qz : lz > b.hz ? qz : 0) / out;
    d = out;
  } else {
    // Inside: the nearest face.
    const f0 = lx + b.hx, f1 = b.hx - lx, f2 = hy - ly, f3 = lz + b.hz, f4 = b.hz - lz, f5 = ly + hy;
    d = f0; nx = -1; ny = 0; nz = 0;
    if (f1 < d) { d = f1; nx = 1; ny = 0; nz = 0; }
    if (f2 < d) { d = f2; nx = 0; ny = 1; nz = 0; }
    if (f3 < d) { d = f3; nx = 0; ny = 0; nz = -1; }
    if (f4 < d) { d = f4; nx = 0; ny = 0; nz = 1; }
    if (f5 < d) { d = f5; nx = 0; ny = -1; nz = 0; }
    d = -d;
  }
  const r = toWorldDir(b, nx, ny, nz);
  n.nx = r.x; n.ny = r.y; n.nz = r.z;
  return d;
}

// --- The query the geometry answers -----------------------------------------------------------------
// The physics itself runs in the engine (src/sim/world.js builds its colliders from these same
// numbers). `surface` is the exact geometry for everything else that asks where the solids are:
// the renderer's debris and camera, the HUD, the tests.
const staticWorlds = new Map();
const worldOf = (course) => {
  let w = staticWorlds.get(course);
  if (!w) { w = staticWorld(course); staticWorlds.set(course, w); }
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
  out.obstacle = false; out.body = null; out.mat = MATERIALS.concrete;
  if (course.ramp && Math.abs(x) <= RAMP.halfWidth && z >= RAMP.z0 && z <= RAMP.z1) {
    const L = RAMP.z1 - RAMP.z0, s = (z - RAMP.z0) / L, slope = (2 * RAMP.height * s) / L, k = 1 / Math.sqrt(1 + slope * slope);
    phi = (y - kickerHeight(z)) * k; ny = k; nz = -slope * k;
  } else {
    phi = y;
    const pad = course.pad;
    if (pad) { const dx = x - pad.x, dz = z - pad.z; if (dx * dx + dz * dz <= PAD_R * PAD_R) out.mat = MATERIALS.pad; }
  }
  if (course.id === 'wall' || course.id === 'show') {
    if (Math.abs(x) <= WALL.width / 2) {
      const d = wallSdf(z, y, tmpN);
      if (d < phi) { phi = d; nx = 0; ny = tmpN.ny; nz = tmpN.nz; out.mat = MATERIALS.deck; }
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
// The landing pad's painted disc: the outer ring plus its 0.8 m border (src/render/wall.js), a
// film of paint on the concrete (its material, not a step: a fraction of a millimetre).
export const PAD_R = 7.8;

// Height of the tallest roof under (x, z), or −Infinity (clearance telemetry): where a vertical
// line through (x, z) first enters each parked body's box, however it is tilted.
export function roofUnder(world, x, z) {
  let top = -Infinity;
  for (const b of world.bodies) {
    const dx = x - b.cx, dz = z - b.cz;
    if (dx * dx + dz * dz > b.hx * b.hx + b.hz * b.hz + b.h * b.h) continue;
    // The line, in the body's frame: from 100 m up, straight down.
    const o = toLocal(b, x, b.cy + 100, z), ox = o.x, oy = o.y, oz = o.z;
    const d = toLocal(b, b.cx, b.cy - 1, b.cz), dx2 = d.x, dy2 = d.y, dz2 = d.z;   // world down, in the body frame
    let t0 = -Infinity, t1 = Infinity;
    const slab = (o0, d0, lo, hi) => {
      if (d0 > -1e-12 && d0 < 1e-12) return o0 >= lo && o0 <= hi;
      let a = (lo - o0) / d0, c = (hi - o0) / d0;
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a; if (c < t1) t1 = c;
      return t0 <= t1;
    };
    if (!slab(ox, dx2, -b.hx, b.hx) || !slab(oy, dy2, b.clr, b.h) || !slab(oz, dz2, -b.hz, b.hz)) continue;
    const y = b.cy + 100 - t0;
    if (t0 >= 0 && y > top) top = y;
  }
  return top;
}
