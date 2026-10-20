// The test range: a long concrete run-up, a kicker ramp, a row of parked EVs side by side
// (as at the reveal), and a flat landing pad beyond. +z is the driving direction, +y is up,
// metres throughout. Pure data + queries; the renderer builds its meshes from the same numbers.

export const RAMP = { z0: -12, z1: 0, height: 1.2, halfWidth: 3.2 };
export const START_Z = -95;
export const PAD = { z: 48, x: 0, rings: [2, 4, 7] };
export const RUNOUT_Z = 190;

// The lineup, parked crosswise (nose pointing +x). `w` is the footprint along z (the vehicle's
// width), `l` along x (its length), `h` its roof height. Our own invented vehicles.
export const LINEUP_SPEC = [
  { id: 'sedan', name: 'Sedan', w: 1.86, l: 4.72, h: 1.44, paint: 0xe8e8ea },
  { id: 'suv', name: 'Crossover', w: 1.92, l: 4.76, h: 1.62, paint: 0x1d1f24 },
  { id: 'semi', name: 'Semi', w: 2.55, l: 6.9, h: 3.85, paint: 0xf4f4f2 },
  { id: 'pickup', name: 'Pickup', w: 2.2, l: 5.68, h: 1.86, paint: 0x9aa0a6 },
  { id: 'cab', name: 'Cab', w: 1.94, l: 3.95, h: 1.52, paint: 0xd8b25a },
];
export const LINEUP_GAP = 0.62;
export const LINEUP_Z0 = 8;

// Axis-aligned boxes for collision, computed once.
export const LINEUP = (() => {
  let z = LINEUP_Z0;
  return LINEUP_SPEC.map((v) => {
    const box = { ...v, minX: -v.l / 2, maxX: v.l / 2, minY: 0, maxY: v.h, minZ: z, maxZ: z + v.w, cz: z + v.w / 2 };
    z += v.w + LINEUP_GAP;
    return box;
  });
})();
export const LINEUP_END = LINEUP[LINEUP.length - 1].maxZ;
export const TALLEST = Math.max(...LINEUP.map((b) => b.h));

// Ramp profile: a smooth kicker, h(s) = H * s^2 for s in [0,1]. The lip angle is atan(2H/len).
export function rampHeight(z) {
  if (z < RAMP.z0 || z > RAMP.z1) return 0;
  const s = (z - RAMP.z0) / (RAMP.z1 - RAMP.z0);
  return RAMP.height * s * s;
}
export const RAMP_LIP_ANGLE = Math.atan((2 * RAMP.height) / (RAMP.z1 - RAMP.z0));

// Ground height and normal at (x, z). The ramp is a solid block; off its sides the ground is 0.
export function groundAt(x, z, outNormal) {
  if (Math.abs(x) <= RAMP.halfWidth && z >= RAMP.z0 && z <= RAMP.z1) {
    const L = RAMP.z1 - RAMP.z0;
    const s = (z - RAMP.z0) / L;
    const slope = (2 * RAMP.height * s) / L;
    if (outNormal) {
      const n = 1 / Math.sqrt(1 + slope * slope);
      outNormal.x = 0; outNormal.y = n; outNormal.z = -slope * n;
    }
    return RAMP.height * s * s;
  }
  if (outNormal) { outNormal.x = 0; outNormal.y = 1; outNormal.z = 0; }
  return 0;
}

// Penetration of a world point into any parked vehicle. Writes the push-out normal and
// returns the depth (0 if outside).
export function obstaclePenetration(p, outNormal) {
  for (let i = 0; i < LINEUP.length; i++) {
    const b = LINEUP[i];
    if (p.x <= b.minX || p.x >= b.maxX || p.y <= b.minY || p.y >= b.maxY || p.z <= b.minZ || p.z >= b.maxZ) continue;
    // Smallest push-out axis (never down: the floor handles that).
    const dxn = p.x - b.minX, dxp = b.maxX - p.x, dyp = b.maxY - p.y, dzn = p.z - b.minZ, dzp = b.maxZ - p.z;
    let d = dyp; outNormal.x = 0; outNormal.y = 1; outNormal.z = 0;
    if (dzn < d) { d = dzn; outNormal.x = 0; outNormal.y = 0; outNormal.z = -1; }
    if (dzp < d) { d = dzp; outNormal.x = 0; outNormal.y = 0; outNormal.z = 1; }
    if (dxn < d) { d = dxn; outNormal.x = -1; outNormal.y = 0; outNormal.z = 0; }
    if (dxp < d) { d = dxp; outNormal.x = 1; outNormal.y = 0; outNormal.z = 0; }
    return d;
  }
  return 0;
}

// Height of the tallest roof under a world (x, z) footprint point, or -Infinity.
export function roofUnder(x, z) {
  for (let i = 0; i < LINEUP.length; i++) {
    const b = LINEUP[i];
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return b.maxY;
  }
  return -Infinity;
}
