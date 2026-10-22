import { describe, it, expect } from 'vitest';
import { createRun, stepRun, FRAME_SIZE } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { newReplayPose, newReplayClock, sampleReplay, stepReplayClock, slerp, REPLAY_HOLD } from '../../src/render/replay.js';

// Synthetic frames: frame i sits at z = i, y = `y` (above 3 m: slow motion), rolled i·0.1 rad.
function synthetic(n, y = 1) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = new Float32Array(FRAME_SIZE);
    f[1] = y; f[2] = i;
    f[3] = Math.sin(i * 0.05); f[6] = Math.cos(i * 0.05);   // roll about x, 0.1 rad a frame
    for (let w = 0; w < 4; w++) { f[7 + w] = 0.1 + 0.01 * i; f[11 + w] = i; }
    frames.push(f);
  }
  return frames;
}

// The old sampler (src/main.js before 0036): the frame index taken before the clock advanced.
function oldDraws(frames, steps, slow) {
  let t = 0;
  const z = [];
  for (let s = 0; s < steps; s++) {
    const i0 = Math.min(frames.length - 1, Math.floor(t));
    t += slow;
    const i1 = Math.min(frames.length - 1, i0 + 1), k = Math.min(1, t - i0);
    z.push(frames[i0][2] + (frames[i1][2] - frames[i0][2]) * k);
  }
  return z;
}
const diffs = (a) => a.slice(1).map((v, i) => v - a[i]);

describe('replay sampler', () => {
  it('advances the clock first, so each draw moves the car the same distance across frame boundaries', () => {
    const frames = synthetic(40, 5), clock = newReplayClock(), pose = newReplayPose();
    clock.replaySlow = 0.45;   // already eased in
    const z = [];
    for (let s = 0; s < 40; s++) { stepReplayClock(clock, frames, 1 / 60, 'show'); z.push(sampleReplay(frames, clock.replayT, pose).pos.z); }
    for (const d of diffs(z)) expect(d).toBeCloseTo(0.45, 3);
    // The old sampler stalled then jumped at every boundary (0.45, 0.45, 0.1, 0.8 …).
    const old = diffs(oldDraws(frames, 40, 0.45));
    expect(Math.max(...old) - Math.min(...old)).toBeGreaterThan(0.5);
  });

  it('slerps the attitude and lerps the wheels between frames', () => {
    const frames = synthetic(4), pose = newReplayPose();
    sampleReplay(frames, 1.5, pose);
    // Halfway between 0.1 and 0.2 rad of roll: 0.15 rad, a unit quaternion.
    expect(2 * Math.atan2(pose.quat.x, pose.quat.w)).toBeCloseTo(0.15, 4);
    expect(Math.hypot(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w)).toBeCloseTo(1, 6);
    expect(pose.comp[2]).toBeCloseTo(0.115, 5);
    expect(pose.spin[0]).toBeCloseTo(1.5, 5);
    expect([pose.i0, pose.i1, pose.k]).toEqual([1, 2, 0.5]);
  });

  it('slerp takes the short way round and matches the ends', () => {
    const o = { x: 0, y: 0, z: 0, w: 1 };
    const h = Math.SQRT1_2;
    slerp(0, 0, 0, 1, h, 0, 0, h, 0.5, o);   // 0 → 90° about x: 45°
    expect(2 * Math.acos(o.w)).toBeCloseTo(Math.PI / 4, 6);
    slerp(0, 0, 0, 1, 0, 0, 0, -1, 0.5, o);  // q and −q are the same attitude
    expect(Math.abs(o.w)).toBeCloseTo(1, 6);
    slerp(0, 0, 0, 1, h, 0, 0, h, 1, o);
    expect(o.x).toBeCloseTo(h, 6);
  });

  it('holds the last frame, then loops', () => {
    const frames = synthetic(10), clock = newReplayClock(), pose = newReplayPose();
    expect(sampleReplay(frames, 9.7, pose).pos.z).toBe(9);
    expect(sampleReplay(frames, -1, pose).pos.z).toBe(0);
    let looped = false;
    for (let s = 0; s < 200 && !looped; s++) looped = stepReplayClock(clock, frames, 1 / 60, 'show');
    expect(looped).toBe(true);
    expect(clock.replayT).toBe(0);
    expect(REPLAY_HOLD).toBeGreaterThan(0);
  });

  it('the reference Show replays as smoothly as it flew: drawn z second difference within 2× the live run', () => {
    const run = createRun('show'), ap = createAutopilot('show');
    while (run.phase !== 'done') stepRun(run, ap(run));
    const frames = run.frames;
    // Live at 60 Hz draws one 60 Hz frame per draw (the interpolated 240 Hz pose lands on them).
    const live = frames.map((f) => f[2]);
    const d2 = (a) => a.slice(2).map((v, i) => Math.abs(v - 2 * a[i + 1] + a[i]));
    const liveMax = Math.max(...d2(live));
    const clock = newReplayClock(), pose = newReplayPose(), z = [];
    // Over the flight itself: the hold on the last frame afterwards is a deliberate freeze (the run
    // ends rolling at under 1.2 m/s).
    for (let s = 0; s < 2 * frames.length; s++) {
      if (stepReplayClock(clock, frames, 1 / 60, 'show') || clock.replayT > frames.length - 1) break;
      z.push(sampleReplay(frames, clock.replayT, pose).pos.z);
    }
    const replayMax = Math.max(...d2(z));
    expect(replayMax).toBeLessThanOrEqual(2 * liveMax);
    // The old sampler on the same clock blew far past it (stall-and-jump at every boundary).
    let t = 0; const oz = [];
    for (let s = 0; s < 2 * frames.length && t < frames.length; s++) {
      const i0 = Math.min(frames.length - 1, Math.floor(t));
      t += frames[i0][1] > 3 ? 0.45 : 1;
      const i1 = Math.min(frames.length - 1, i0 + 1), k = Math.min(1, t - i0);
      oz.push(frames[i0][2] + (frames[i1][2] - frames[i0][2]) * k);
    }
    expect(Math.max(...d2(oz))).toBeGreaterThan(2 * liveMax);
    console.log(`replay d2z max: live ${liveMax.toFixed(4)} · new ${replayMax.toFixed(4)} · old ${Math.max(...d2(oz)).toFixed(4)} m`);
  });
});
