// A simple driver for Free Drive (e2e tests, screenshots, the perf probe, and the determinism
// test's scripted drive): pure-pursuit steering on a point ahead in the right-hand lane, and a
// speed from the tightest curve in the next stretch (v = √(a·R), a ≈ 0.8 g by default).
import { poseAt, nearestSample } from '../sim/roads.js';
import { newInput } from '../sim/vehicle.js';

export function createPilot(road, { lat = 0.8, vmax = 40, dir = 1 } = {}) {
  const out = newInput();
  const p = { x: 0, y: 0, z: 0, yaw: 0, i: 0 };
  let hint = -1;
  return function pilot(car) {
    const sp = road.meta.spacing;
    hint = nearestSample(road, car.pos.x, car.pos.z, hint, hint < 0 ? 0 : 40);
    const q = car.quat;
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const v = Math.sqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z);
    const s = hint * sp;
    // Pure pursuit: aim at a point ld ahead in the lane; δ = atan(2·L·sin α / ld), as a fraction of
    // the steering rack's lock at this speed (vehicle.js: min(0.5, L·μ·g/v² + 0.04)).
    const ld = 4.5 + v * 0.38;
    poseAt(road, Math.max(0, Math.min(road.length - 1, s + dir * ld)), dir, p);
    // Through a hairpin, use the whole road (as drivers do): drift the aim from the right-hand
    // lane toward the outside of the bend as it tightens.
    {
      const j = Math.max(2, Math.min(road.m - 3, p.i)), a = j - 2, b = j + 2;
      const cr = road.dx[a] * road.dz[b] - road.dz[a] * road.dx[b];          // < 0: bending left
      const turn = Math.abs(cr) / (4 * sp);                                   // ≈ 1/R
      const k = Math.max(0, Math.min(1, (turn - 1 / 30) / (1 / 9 - 1 / 30)));
      if (k > 0) {
        const lx = road.dz[j], lz = -road.dx[j], outside = (cr < 0 ? -1 : 1) * dir;  // left = +
        const lane = -Math.min(1.9, road.hw[j] * 0.48) * dir, want = outside * road.hw[j] * 0.35;
        const shift = (want - lane) * k;
        p.x += lx * shift; p.z += lz * shift;
      }
    }
    const ex = p.x - car.pos.x, ez = p.z - car.pos.z;
    // + = target to the driver's right (left is (fz, −fx) in this frame).
    const right = -(ex * fz - ez * fx), ahead = ex * fx + ez * fz;
    const alpha = Math.atan2(right, ahead), dist = Math.max(1, Math.hypot(ex, ez));
    const L = 2.825, delta = Math.atan((2 * L * Math.sin(alpha)) / dist);
    const lock = Math.min(0.5, (L * 1.25 * 9.81) / Math.max(1, v * v) + 0.04);
    // Tightest curve over the braking distance ahead.
    let kmax = 0;
    const look = Math.max(20, Math.ceil((v * v) / (2 * 6) / sp) + 8);
    for (let k = 0; k < look; k += 2) {
      const a = Math.max(1, Math.min(road.m - 2, hint + dir * k)), b = a + 1;
      const c = road.dx[a - 1] * road.dz[b] - road.dz[a - 1] * road.dx[b];
      kmax = Math.max(kmax, Math.abs(c) / (2 * sp));
    }
    const vt = Math.min(vmax, Math.sqrt((lat * 9.81) / Math.max(1e-4, kmax)));
    out.steer = Math.max(-1, Math.min(1, (delta / lock) * 1.1));
    out.throttle = v < vt ? Math.min(1, (vt - v) * 0.5 + 0.2) : 0;
    out.brake = v > vt + 1.5 ? Math.min(1, (v - vt) * 0.3) : 0;
    out.assist = 1;
    return out;
  };
}
