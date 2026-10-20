// The courses, as exact geometry. Pure: the sim, the Worker's replay and the renderer all read
// these numbers, so what you see is what you drive on.
//
// Every course answers one question for the physics: `surface(course, p, outNormal)`, the signed
// distance from a world point to the nearest solid (> 0 = free space, < 0 = inside), with the
// unit normal pointing out of the solid. Wheels, the hull and the suction fan all use it, so the
// car can drive up walls and hang upside down under a ledge with the same code that drives it
// on flat concrete. +z is the driving direction, +y is up, metres.

const D2R = Math.PI / 180;

// --- The Wall (the reveal's stunt) ---------------------------------------------------------------
// A quarter-pipe that rises from the concrete into a vertical wall, then curls past vertical into
// an overhanging ledge. The riding surface is the concave side. The profile is in the (z, y)
// plane and extruded across x. Three exact pieces:
//   arc A: centre (0, R1), radius R1, from straight down (−90°) to level with the centre (0°)
//   wall:  the vertical line z = R1, from y = R1 to y = R1 + H
//   arc B: centre (R1 − R2, R1 + H), radius R2, from 0° to TIP degrees (past vertical: the ledge)
const R1 = 11, H = 6, R2 = 6, TIP = 70 * D2R;
export const WALL = {
  id: 'wall',
  name: 'The Wall',
  blurb: 'Drive up a 22 m curl on 2 g of suction, launch upside down, roll it, stick it.',
  r1: R1, h: H, r2: R2, tip: TIP,
  width: 5.2,                 // m, concrete deck width
  slab: 0.9,                  // m, deck thickness
  start: { z: -175, x: 0 },
  pad: { z: -34, x: 0, rings: [2.5, 5, 8] },   // landing target, back on the approach
  runout: { zMin: -230, zMax: 40 },
  // Derived: lip of the ledge (where you launch from) and the profile's total length.
  lip: { z: R1 - R2 + R2 * Math.cos(TIP), y: R1 + H + R2 * Math.sin(TIP) },
  length: R1 * Math.PI / 2 + H + R2 * TIP,
  topHeight: R1 + H + R2,     // highest point of the curl's centreline circle
};

// Point and normal on the Wall's riding surface at arc length s along the profile (renderer,
// cameras, lights and the autopilot use this).
export function wallProfile(s, out = { z: 0, y: 0, nz: 0, ny: 0, tz: 0, ty: 0 }) {
  const a = R1 * Math.PI / 2;
  if (s <= a) {
    const th = -Math.PI / 2 + s / R1;
    out.z = R1 * Math.cos(th); out.y = R1 + R1 * Math.sin(th);
    out.nz = -Math.cos(th); out.ny = -Math.sin(th);
    out.tz = -Math.sin(th); out.ty = Math.cos(th);
  } else if (s <= a + H) {
    out.z = R1; out.y = R1 + (s - a);
    out.nz = -1; out.ny = 0; out.tz = 0; out.ty = 1;
  } else {
    const th = Math.min(TIP, (s - a - H) / R2);
    out.z = R1 - R2 + R2 * Math.cos(th); out.y = R1 + H + R2 * Math.sin(th);
    out.nz = -Math.cos(th); out.ny = -Math.sin(th);
    out.tz = -Math.sin(th); out.ty = Math.cos(th);
  }
  return out;
}

// Signed distance (z, y) → riding-surface solid. Returns +Infinity where the deck isn't.
function wallSdf(z, y, n) {
  let best = Infinity, bz = 0, by = 0;
  // arc A
  {
    const dz = z, dy = y - R1, d = Math.hypot(dz, dy), th = Math.atan2(dy, dz);
    if (th >= -Math.PI / 2 - 1e-9 && th <= 0 && d > 1e-6) {
      const s = R1 - d;
      if (Math.abs(s) < Math.abs(best)) { best = s; bz = -dz / d; by = -dy / d; }
    }
  }
  // vertical wall
  if (y >= R1 && y <= R1 + H) {
    const s = R1 - z;
    if (Math.abs(s) < Math.abs(best)) { best = s; bz = -1; by = 0; }
  }
  // arc B (the ledge)
  {
    const cz = R1 - R2, cy = R1 + H, dz = z - cz, dy = y - cy, d = Math.hypot(dz, dy), th = Math.atan2(dy, dz);
    if (th >= 0 && th <= TIP && d > 1e-6) {
      const s = R2 - d;
      if (Math.abs(s) < Math.abs(best)) { best = s; bz = -dz / d; by = -dy / d; }
    }
  }
  if (best === Infinity) return Infinity;
  const T = WALL.slab;
  if (best >= 0) { n.nz = bz; n.ny = by; return best; }
  if (best > -T) {
    // Inside the deck: push out through whichever face is nearer.
    if (-best <= T + best) { n.nz = bz; n.ny = by; return best; }
    n.nz = -bz; n.ny = -by; return -(T + best);
  }
  n.nz = -bz; n.ny = -by; return -best - T;   // behind the deck: free
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
const GAP = 0.62, Z0 = 8;
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
  blurb: 'Kicker, lift burn, a full roll over five parked EVs, a soft landing on the mark.',
  ramp: RAMP,
  boxes: LINEUP_BOXES,
  start: { z: -95, x: 0 },
  pad: { z: 48, x: 0, rings: [2, 4, 7] },
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
  const out = Math.hypot(qx, qy, qz);
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
  if (course.id === 'lineup' && Math.abs(x) <= RAMP.halfWidth && z >= RAMP.z0 && z <= RAMP.z1) {
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
