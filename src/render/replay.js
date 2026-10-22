// The replay behind the results, sampled between its 60 Hz frames. Pure (no DOM, no three.js) and
// allocation-free, so it is unit-tested across frame boundaries (tests/unit/replay.test.js).
//
// The replay clock `t` counts frames (frame i was recorded after tick FRAME_EVERY·(i+1)). Each
// draw advances the clock FIRST, then samples the pose at the new fraction: sampling against the
// frame index from before the advance clamped the fraction to 1 at every boundary, so the car
// stalled then jumped (0.45, 0.45, 0.1, 0.8 of a frame at slow motion). Attitude is slerped, the
// wheels' compression, spin and steer and the valves are lerped. Slow motion eases in and out
// (≈0.25 s) instead of switching, so the drawn speed never steps.
import { FRAME_SIZE, FRAME_EVERY } from '../sim/run.js';
import { COURSES } from '../sim/courses.js';

const NZ = FRAME_SIZE - 17;          // valves in a frame: pos(3) quat(4) comp(4) spin(4) valves steer fan
export const REPLAY_HOLD = 90;       // frames held on the last one before the loop starts over
const SLOW_TAU = 0.25;               // s: how fast the slow-motion factor eases to its target

export function newReplayPose() {
  return { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, comp: [0, 0, 0, 0], spin: [0, 0, 0, 0], steer: 0, fan: 0, thr: new Float64Array(NZ), i0: 0, i1: 0, k: 0 };
}

// The replay's clock: { replayT (frames), replaySlow (the eased factor) }. main.js keeps both on its
// state S (tests and scripts/flicker.mjs set S.replayT directly).
export const newReplayClock = () => ({ replayT: 0, replaySlow: 1 });

// Slow motion where it matters: up the Wall and through the roll (car above 3 m), or over the
// Lineup's row. `f` is the frame on screen.
export function slowTarget(f, course) {
  if (course !== 'lineup') return f[1] > 3 ? 0.45 : 1;
  const L = COURSES.lineup;
  return f[2] > L.liftOffZ - 2 && f[2] < L.pad.z - 6 ? 0.42 : 1;
}

// Advance the clock by dt seconds of the game clock. Returns true when it looped (the caller
// restarts the director).
export function stepReplayClock(clock, frames, dt, course) {
  const n = frames.length;
  if (!n) return false;
  const f = frames[Math.min(n - 1, Math.max(0, Math.floor(clock.replayT)))];
  const target = slowTarget(f, course);
  clock.replaySlow += (target - clock.replaySlow) * (1 - Math.exp(-dt / SLOW_TAU));
  clock.replayT += dt * (240 / FRAME_EVERY) * clock.replaySlow;
  if (clock.replayT >= n + REPLAY_HOLD) { clock.replayT = 0; clock.replaySlow = slowTarget(frames[0], course); return true; }
  return false;
}

// The pose at clock t (frames, fractional) into `out`. Past the last frame it holds the last one.
export function sampleReplay(frames, t, out) {
  const n = frames.length;
  const tt = Math.max(0, Math.min(n - 1, t));
  const i0 = Math.floor(tt), i1 = Math.min(n - 1, i0 + 1), k = tt - i0, j = 1 - k;
  const f = frames[i0], g = frames[i1];
  out.i0 = i0; out.i1 = i1; out.k = k;
  out.pos.x = f[0] * j + g[0] * k; out.pos.y = f[1] * j + g[1] * k; out.pos.z = f[2] * j + g[2] * k;
  slerp(f[3], f[4], f[5], f[6], g[3], g[4], g[5], g[6], k, out.quat);
  for (let w = 0; w < 4; w++) { out.comp[w] = f[7 + w] * j + g[7 + w] * k; out.spin[w] = f[11 + w] * j + g[11 + w] * k; }
  for (let v = 0; v < NZ; v++) out.thr[v] = f[15 + v] * j + g[15 + v] * k;
  out.steer = (f[15 + NZ] || 0) * j + (g[15 + NZ] || 0) * k;
  out.fan = (f[16 + NZ] || 0) * j + (g[16 + NZ] || 0) * k;
  return out;
}

// Shortest-arc slerp of two unit quaternions into o ({x, y, z, w}); nlerp when they nearly agree.
export function slerp(ax, ay, az, aw, bx, by, bz, bw, k, o) {
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
  let wa = 1 - k, wb = k;
  if (d < 0.9995) {
    const th = Math.acos(d), s = Math.sin(th);
    wa = Math.sin(wa * th) / s; wb = Math.sin(k * th) / s;
  }
  const x = ax * wa + bx * wb, y = ay * wa + by * wb, z = az * wa + bz * wb, w = aw * wa + bw * wb;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  o.x = x / l; o.y = y / l; o.z = z / l; o.w = w / l;
  return o;
}
