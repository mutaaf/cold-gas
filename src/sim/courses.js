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
const R1 = 9.5, TURN = 170 * D2R, LEDGE = 5.5;
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
export const LINEUP_SPEC = [
  { id: 'sedan', name: 'Sedan', w: 1.86, l: 4.72, h: 1.44, paint: 0xe8e8ea },
  { id: 'suv', name: 'Crossover', w: 1.92, l: 4.76, h: 1.62, paint: 0x1d1f24 },
  { id: 'semi', name: 'Semi', w: 2.55, l: 6.9, h: 3.85, paint: 0xf4f4f2 },
  { id: 'pickup', name: 'Pickup', w: 2.2, l: 5.68, h: 1.86, paint: 0x9aa0a6 },
  { id: 'cab', name: 'Cab', w: 1.94, l: 3.95, h: 1.52, paint: 0xd8b25a },
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

function boxSdf(b, x, y, z, n) {
  const qx = Math.max(b.minX - x, 0, x - b.maxX), qy = Math.max(b.minY - y, 0, y - b.maxY), qz = Math.max(b.minZ - z, 0, z - b.maxZ);
  const out = dhypot(qx, qy, qz);
  if (out > 0) {
    n.nx = (x < b.minX ? -qx : x > b.maxX ? qx : 0) / out;
    n.ny = (y < b.minY ? -qy : y > b.maxY ? qy : 0) / out;
    n.nz = (z < b.minZ ? -qz : z > b.maxZ ? qz : 0) / out;
    return out;
  }
  // Inside: nearest face (never down; the floor handles that).
  const f = [[x - b.minX, -1, 0, 0], [b.maxX - x, 1, 0, 0], [b.maxY - y, 0, 1, 0], [z - b.minZ, 0, 0, -1], [b.maxZ - z, 0, 0, 1]];
  let m = f[0];
  for (const c of f) if (c[0] < m[0]) m = c;
  n.nx = m[1]; n.ny = m[2]; n.nz = m[3];
  return -m[0];
}

export const COURSES = { wall: WALL, lineup: LINEUP };
export const DEFAULT_COURSE = 'wall';

// --- The query the physics asks ---------------------------------------------------------------------
const tmpN = { nx: 0, ny: 0, nz: 0 };
// Signed distance from (x, y, z) to the course's solids. `out` gets the unit normal {x, y, z}.
// `out.obstacle` is set when the nearest solid is a parked vehicle.
export function surface(course, x, y, z, out) {
  // The ground: flat concrete everywhere (y = 0), plus the kicker on the Lineup.
  let phi, nx = 0, ny = 1, nz = 0;
  if (course.ramp && Math.abs(x) <= RAMP.halfWidth && z >= RAMP.z0 && z <= RAMP.z1) {
    const L = RAMP.z1 - RAMP.z0, s = (z - RAMP.z0) / L, slope = (2 * RAMP.height * s) / L, k = 1 / Math.sqrt(1 + slope * slope);
    phi = (y - kickerHeight(z)) * k; ny = k; nz = -slope * k;
  } else {
    phi = y;
  }
  out.obstacle = false;
  if (course.id === 'wall') {
    if (Math.abs(x) <= WALL.width / 2) {
      const d = wallSdf(z, y, tmpN);
      if (d < phi) { phi = d; nx = 0; ny = tmpN.ny; nz = tmpN.nz; }
    }
  } else if (course.id === 'lineup') {
    for (let i = 0; i < LINEUP_BOXES.length; i++) {
      const d = boxSdf(LINEUP_BOXES[i], x, y, z, tmpN);
      if (d < phi) { phi = d; nx = tmpN.nx; ny = tmpN.ny; nz = tmpN.nz; out.obstacle = true; }
    }
  }
  out.x = nx; out.y = ny; out.z = nz;
  return phi;
}

// Height of the tallest roof under (x, z) on the Lineup, or −Infinity (clearance telemetry).
export function roofUnder(x, z) {
  for (let i = 0; i < LINEUP_BOXES.length; i++) {
    const b = LINEUP_BOXES[i];
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return b.maxY;
  }
  return -Infinity;
}
