// The car drawn between sim ticks. The sim steps at 240 Hz and the screen draws at 60–144 Hz, so a
// frame runs a whole number of ticks: 1 then 2 at 144 Hz, 3 then 5 when a 60 Hz frame is late. At
// 108 km/h that moved the drawn car 0.125 m one frame and 0.25 m the next while the chase camera
// glided, and the car shimmered against the road. Drawing it at the fraction of a tick the clock
// has reached (the previous tick's pose toward this one's) costs at most one tick of latency
// (4 ms) and never changes the sim. No allocation per frame.
export function createPoseLerp() {
  const prev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  const pos = { x: 0, y: 0, z: 0 }, quat = { x: 0, y: 0, z: 0, w: 1 };
  const out = { pos, quat };
  let car = null;
  return {
    // Before each sim step: remember where the car was.
    before(c) {
      prev.x = c.pos.x; prev.y = c.pos.y; prev.z = c.pos.z;
      prev.qx = c.quat.x; prev.qy = c.quat.y; prev.qz = c.quat.z; prev.qw = c.quat.w;
      car = c;
    },
    // The pose to draw, `alpha` (0–1) of the way from the previous tick to the current one. A car
    // that hasn't stepped since it was placed (a reset, a new run) is drawn where it is.
    pose(c, alpha) {
      if (car !== c) { out.pos = c.pos; out.quat = c.quat; return out; }
      const a = Math.max(0, Math.min(1, alpha)), b = 1 - a;
      // A teleport (the world shifted, a respawn into the same car) is drawn as is.
      const dx = c.pos.x - prev.x, dy = c.pos.y - prev.y, dz = c.pos.z - prev.z;
      if (dx * dx + dy * dy + dz * dz > 4) { out.pos = c.pos; out.quat = c.quat; return out; }
      pos.x = prev.x * b + c.pos.x * a; pos.y = prev.y * b + c.pos.y * a; pos.z = prev.z * b + c.pos.z * a;
      const s = prev.qx * c.quat.x + prev.qy * c.quat.y + prev.qz * c.quat.z + prev.qw * c.quat.w < 0 ? -1 : 1;
      let x = prev.qx * b * s + c.quat.x * a, y = prev.qy * b * s + c.quat.y * a, z = prev.qz * b * s + c.quat.z * a, w = prev.qw * b * s + c.quat.w * a;
      const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
      x /= l; y /= l; z /= l; w /= l;
      quat.x = x; quat.y = y; quat.z = z; quat.w = w;
      out.pos = pos; out.quat = quat;
      return out;
    },
  };
}
