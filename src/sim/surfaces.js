// A set's water and mud (0340), as the physics reads them: pure functions of a course's `surfaces` (courses.js) and a
// point on the slab. The sim (world.js, vehicle.js), the renderer and the HUD all ask these, so the water you see is the
// water that floats the car and the mud you see is the mud a tyre sinks into. Only + − × ÷ and comparisons: the same
// bits in every engine and in the Swift port (ColdGasCore Surfaces.swift).

// No water here: the level a point outside every tank reads.
export const NO_WATER = -1e9;

/** The water's level (m over the slab) at (x, z), or NO_WATER outside every tank. */
export function waterLevel(surf, x, z) {
  const tanks = surf.tanks;
  for (let i = 0; i < tanks.length; i++) {
    const k = tanks[i];
    if (x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1) return k.level;
  }
  return NO_WATER;
}

/** How far a tyre settles into mud at (x, z) (m, ≥ 0), or −1 off every patch. The deepest patch wins. */
export function mudSink(surf, x, z) {
  const mud = surf.mud;
  let best = -1;
  for (let i = 0; i < mud.length; i++) {
    const m = mud[i], ex = (x - m.x) / m.rx, ez = (z - m.z) / m.rz, e = ex * ex + ez * ez;
    if (e >= 1) continue;
    // Full depth from a quarter of the way in: the edge is a slope a tyre rolls down, not a step.
    const k = (1 - e) * 4, s = m.sink * (k < 1 ? k : 1);
    if (s > best) best = s;
  }
  return best;
}

/** A tank's walls as boxes [x0, y0, z0, x1, y1, z1] (the four sides, outside the water: what world.js makes solid). */
export function tankWalls(k) {
  const t = k.wall, h = k.top;
  return [
    [k.x0 - t, 0, k.z0 - t, k.x1 + t, h, k.z0],   // near (−z)
    [k.x0 - t, 0, k.z1, k.x1 + t, h, k.z1 + t],   // far (+z)
    [k.x0 - t, 0, k.z0, k.x0, h, k.z1],           // −x
    [k.x1, 0, k.z0, k.x1 + t, h, k.z1],           // +x
  ];
}
