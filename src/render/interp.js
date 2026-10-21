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

// The same for rigid bodies (the parked row, the loose props): their pose before the last tick,
// kept per body, and the pose to draw between it and the current one. A body's pose is the sim
// mirror's { cx, cy, cz, qx, qy, qz, qw } (src/sim/courses.js parkedMirror). No allocation per frame
// once each body has its slot.
export function createBodiesLerp() {
  const prev = new WeakMap();
  const outs = [];
  function slot(b) { let p = prev.get(b); if (!p) prev.set(b, (p = new Float64Array(7))); return p; }
  function save(b) { const p = slot(b); p[0] = b.cx; p[1] = b.cy; p[2] = b.cz; p[3] = b.qx; p[4] = b.qy; p[5] = b.qz; p[6] = b.qw; }
  // Write body b drawn `alpha` of the way from its previous pose into out.
  function lerp(b, a, out) {
    const p = prev.get(b);
    if (!p || a >= 1) { out.cx = b.cx; out.cy = b.cy; out.cz = b.cz; out.qx = b.qx; out.qy = b.qy; out.qz = b.qz; out.qw = b.qw; return out; }
    const k = 1 - a;
    out.cx = p[0] * k + b.cx * a; out.cy = p[1] * k + b.cy * a; out.cz = p[2] * k + b.cz * a;
    const s = p[3] * b.qx + p[4] * b.qy + p[5] * b.qz + p[6] * b.qw < 0 ? -1 : 1;
    let x = p[3] * k * s + b.qx * a, y = p[4] * k * s + b.qy * a, z = p[5] * k * s + b.qz * a, w = p[6] * k * s + b.qw * a;
    const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
    out.qx = x / l; out.qy = y / l; out.qz = z / l; out.qw = w / l;
    return out;
  }
  return {
    // Before each sim step: remember where every body was.
    before(bodies) { for (let i = 0; i < bodies.length; i++) save(bodies[i]); },
    lerp,
    // The whole list drawn at alpha (0–1), into reused pose objects.
    poses(bodies, alpha) {
      const a = Math.max(0, Math.min(1, alpha));
      while (outs.length < bodies.length) outs.push({ cx: 0, cy: 0, cz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
      outs.length = bodies.length;
      for (let i = 0; i < bodies.length; i++) lerp(bodies[i], a, outs[i]);
      return outs;
    },
  };
}
