// Ground stands kept out of a set's splash tanks (0355, pure: no three.js, no DOM, no allocation per call).
//
// 0340 put a splash tank off the Show's landing (x 10–18, z −40…−24) and the Lineup's (x 10–18, z 16–32), and the
// landed rig (0119) stood where it always had: car + 12 m at +x on an upright phone, i.e. over the water, inside the
// walls, with the coping, the LED bar and the water across the wheels and the rings. The director now asks these
// before it stands a ground shot anywhere: is the stand inside a tank's box (walls included, grown by a margin), and do
// its sight lines to the car's four wheel contacts and to the mark's 4 m ring cross a tank's box.
//
// A tank's box is its outer footprint (the water and its walls) from the slab to the coping (`top`). A sight line to a
// point over a tank's water (a car that splashed in) ignores that tank: the rig may look into a tank from outside it,
// never stand in it. A point against the outside of a wall is not over the water, so the wall still blocks.
import { tankWalls } from '../sim/surfaces.js';

export const STAND_MARGIN = 0.5;   // m: a stand keeps this far from a tank's box, every side and above the coping
export const RING_R = 4;           // m: the mark's ring the touchdown is judged on (courses.js `rings`)
export const RING_N = 16;          // points sampled round it
export const RING_MIN = 14;        // of RING_N that must be in sight
// The car's four wheel contacts from its centre (m: half-track, half-wheelbase; spec.js's 4.65 m roadster), at the slab.
// Taken square to the stage: the director knows the car's position, not its heading, and a box this size round the
// centre is the footprint whichever way the car points within a few degrees of the run's line.
const WX = 0.82, WZ = 1.42, WY = 0.05;

const BOXES = new WeakMap();
export const STRIDE = 7;
/** A course's tanks as flat boxes [x0, y0, z0, x1, y1, z1, wall, …] (outer box, wall thickness; cached per course). */
export function tankBoxes(course) {
  const tanks = course?.surfaces?.tanks;
  if (!tanks || !tanks.length) return EMPTY;
  let b = BOXES.get(course);
  if (b) return b;
  b = new Float64Array(tanks.length * STRIDE);
  tanks.forEach((k, i) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = 0;
    for (const w of tankWalls(k)) { x0 = Math.min(x0, w[0]); z0 = Math.min(z0, w[2]); x1 = Math.max(x1, w[3]); y1 = Math.max(y1, w[4]); z1 = Math.max(z1, w[5]); }
    b.set([x0, 0, z0, x1, y1, z1, k.wall], i * STRIDE);
  });
  BOXES.set(course, b);
  return b;
}
const EMPTY = new Float64Array(0);

/** Whether (x, y, z) is inside any tank's box grown by `m` (default STAND_MARGIN). */
export function inTank(boxes, x, y, z, m = STAND_MARGIN) {
  for (let i = 0; i < boxes.length; i += STRIDE) {
    if (x > boxes[i] - m && x < boxes[i + 3] + m && z > boxes[i + 2] - m && z < boxes[i + 5] + m && y < boxes[i + 4] + m) return true;
  }
  return false;
}

/**
 * Whether the segment a → b crosses a box (slab test). `boxes` is flat with `stride` floats a box (tankBoxes: STRIDE,
 * the 7th its wall; any other box list: 6). A tank (stride 7) whose water (inside its walls) holds b is ignored.
 */
export function sightBlocked(boxes, ax, ay, az, bx, by, bz, stride = STRIDE) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (let i = 0; i < boxes.length; i += stride) {
    const x0 = boxes[i], y0 = boxes[i + 1], z0 = boxes[i + 2], x1 = boxes[i + 3], y1 = boxes[i + 4], z1 = boxes[i + 5];
    if (stride === STRIDE) { const t = boxes[i + 6]; if (bx > x0 + t && bx < x1 - t && bz > z0 + t && bz < z1 - t) continue; }
    let t0 = 0, t1 = 1;
    // x
    if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) continue; } else {
      let a = (x0 - ax) / dx, c = (x1 - ax) / dx; if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) continue; } else {
      let a = (y0 - ay) / dy, c = (y1 - ay) / dy; if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) continue; } else {
      let a = (z0 - az) / dz, c = (z1 - az) / dz; if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/** How many of the car's four wheel contacts the point (x, y, z) can see past the tanks. */
export function wheelsInSight(boxes, x, y, z, car) {
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const wx = car.x + (i & 1 ? WX : -WX), wz = car.z + (i & 2 ? WZ : -WZ);
    if (!sightBlocked(boxes, x, y, z, wx, WY, wz)) n++;
  }
  return n;
}

/** How many of the RING_N points of the mark's RING_R ring round `pad` ({x, z}) the point can see past the tanks. */
const RING_C = Array.from({ length: RING_N }, (_, i) => Math.cos((i / RING_N) * 2 * Math.PI));
const RING_S = Array.from({ length: RING_N }, (_, i) => Math.sin((i / RING_N) * 2 * Math.PI));
export function ringInSight(boxes, x, y, z, pad) {
  let n = 0;
  for (let i = 0; i < RING_N; i++) {
    if (!sightBlocked(boxes, x, y, z, pad.x + RING_R * RING_C[i], 0.02, pad.z + RING_R * RING_S[i])) n++;
  }
  return n;
}

/**
 * Whether a ground stand at (x, y, z) is clear: outside every tank's box (+ STAND_MARGIN), all four wheels in sight
 * and, while the car is near the mark (within `near` m of `pad`), at least RING_MIN of the ring's points.
 */
export function standClear(boxes, x, y, z, car, pad, near = 12) {
  if (!boxes.length) return true;
  if (inTank(boxes, x, y, z)) return false;
  if (wheelsInSight(boxes, x, y, z, car) < 4) return false;
  if (pad && Math.hypot(car.x - pad.x, car.z - pad.z) < near && ringInSight(boxes, x, y, z, pad) < RING_MIN) return false;
  return true;
}
