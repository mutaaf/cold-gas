import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { packFrames, ghostAt, isBetter, newGhostPose } from '../../src/ghost.js';

// A synthetic ghost: frame i sits at x = i, z = -i, identity attitude.
function synthetic(n) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = new Float32Array(25);
    f[0] = i; f[1] = 1; f[2] = -i;
    f[6] = 1;
    frames.push(f);
  }
  return packFrames(frames, 50);
}

describe('ghost', () => {
  it('packs frames into one flat array with the run layout', () => {
    const g = synthetic(5);
    expect(g.n).toBe(5);
    expect(g.stride).toBe(25);
    expect(g.data).toBeInstanceOf(Float32Array);
    expect(g.data.length).toBe(125);
    expect(g.total).toBe(50);
  });

  it('maps a sim tick to its replay frame (frame i is recorded at tick 4(i+1))', () => {
    const g = synthetic(10);
    const out = newGhostPose();
    expect(ghostAt(g, 4, out)).toBe(true);
    expect(out.x).toBeCloseTo(0);
    ghostAt(g, 12, out);
    expect(out.x).toBeCloseTo(2);
    expect(out.z).toBeCloseTo(-2);
  });

  it('interpolates between frames and clamps at both ends', () => {
    const g = synthetic(10);
    const out = newGhostPose();
    ghostAt(g, 6, out);
    expect(out.x).toBeCloseTo(0.5);
    ghostAt(g, 0, out);
    expect(out.x).toBeCloseTo(0);
    ghostAt(g, 10_000, out);
    expect(out.x).toBeCloseTo(9);
    expect(out.qw).toBeCloseTo(1);
  });

  it('returns false and leaves the pose alone without a ghost', () => {
    const out = newGhostPose();
    expect(ghostAt(null, 40, out)).toBe(false);
    expect(ghostAt({ n: 0, stride: 25, data: new Float32Array(0) }, 40, out)).toBe(false);
  });

  it('moves in lockstep with the live run tick', () => {
    const run = createRun();
    const ap = createAutopilot();
    const at = new Map();
    while (run.phase !== 'done') {
      stepRun(run, ap(run));
      if (run.tick % 240 === 0) at.set(run.tick, { ...run.car.pos });
    }
    const g = packFrames(run.frames, 80);
    const out = newGhostPose();
    for (const [tick, pos] of at) {
      ghostAt(g, tick, out);
      expect(out.x).toBeCloseTo(pos.x, 4);
      expect(out.y).toBeCloseTo(pos.y, 4);
      expect(out.z).toBeCloseTo(pos.z, 4);
    }
  });

  it('keeps the better run, and your own run always beats the reference', () => {
    const run = (total, ref = false) => ({ total, ref });
    expect(isBetter(null, run(10))).toBe(true);
    expect(isBetter(null, run(80, true))).toBe(true);
    expect(isBetter(run(60), run(59.9))).toBe(false);
    expect(isBetter(run(60), run(60.1))).toBe(true);
    expect(isBetter(run(85, true), run(20))).toBe(true);
    expect(isBetter(run(20), run(85, true))).toBe(false);
  });

  it('marks the reference jump', () => {
    expect(synthetic(2).ref).toBe(false);
    expect(packFrames([new Float32Array(25)], 80, true).ref).toBe(true);
  });

  it('nlerps attitude along the short arc and stays unit length', () => {
    const a = new Float32Array(25), b = new Float32Array(25);
    a[6] = 1;
    const h = Math.SQRT1_2;
    b[4] = -h; b[6] = -h;   // 90° about y, stored with the opposite sign
    const out = newGhostPose();
    ghostAt(packFrames([a, b], 1), 6, out);
    expect(Math.hypot(out.qx, out.qy, out.qz, out.qw)).toBeCloseTo(1, 6);
    expect(Math.abs(2 * Math.acos(Math.abs(out.qw)))).toBeCloseTo(Math.PI / 4, 2);
  });
});
