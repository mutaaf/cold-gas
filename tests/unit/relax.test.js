// Tyre relaxation length (SIM_VERSION 16, ticket 0015): a tyre's side force builds up over σ
// metres of rolling after a slip-angle step (Pacejka, Tyre and Vehicle Dynamics, ch. 7), instead of
// appearing in the same tick. σ is an ESTIMATE for the 295/30 R20 and 335/30 R21 tyres (spec.js).
import { describe, it, expect } from 'vitest';
import { createVehicle, step, newInput, relaxSlip, relaxLength, relaxWeight, DT, rackLock } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

// A settled car on the Lineup's open concrete, well clear of the row.
function settled() {
  const s = createVehicle('lineup'); s.pos.x = 30;
  for (let i = 0; i < 480; i++) step(s, newInput());
  return s;
}

describe('relaxSlip, the lag on its own', () => {
  it('a step reaches 1 − 1/e after σ metres of rolling (±15 %), at any speed', () => {
    for (const v of [5, 20, 60]) {
      const sigma = 0.35;
      let a = 0, d = 0;
      while (d < sigma - 1e-9) { a = relaxSlip(a, 0.05, v, sigma, DT); d += v * DT; }
      // Linear in the tyre's linear range: 63 % of the slip angle is 63 % of the steady force. The
      // last tick can carry it past σ (0.25 m at 60 m/s), so compare with 1 − e^(−d/σ) at the d rolled.
      const want = 1 - Math.exp(-d / sigma);
      expect(want).toBeGreaterThanOrEqual(0.632);
      expect(a / 0.05).toBeGreaterThan(want * 0.85);
      expect(a / 0.05).toBeLessThan(want * 1.15);
    }
  });
  it('never overshoots, even when σ is crossed in one tick (100 m/s)', () => {
    let a = 0;
    for (let i = 0; i < 20; i++) { a = relaxSlip(a, 0.1, 100, 0.2, DT); expect(a).toBeLessThanOrEqual(0.1); }
    expect(a).toBeCloseTo(0.1, 6);
  });
  it('stays finite at a standstill: the speed is clamped, so the lag is σ / 1.5 m/s at most', () => {
    let a = 0;
    for (let i = 0; i < 240; i++) a = relaxSlip(a, 0.05, 0, 0.35, DT);
    expect(Number.isFinite(a)).toBe(true);
    expect(a / 0.05).toBeCloseTo(1 - Math.exp(-1 / (0.35 / 1.5)), 2);   // 1 s at a 0.23 s time constant
  });
  it('fades out at a crawl: full lag from 4.5 m/s, none at 1.5 m/s and below', () => {
    expect(relaxWeight(0)).toBe(0); expect(relaxWeight(1.5)).toBe(0); expect(relaxWeight(-3)).toBeCloseTo(0.5, 9);
    expect(relaxWeight(4.5)).toBe(1); expect(relaxWeight(30)).toBe(1);
  });
  it('σ grows with √load, bounded ×0.5–1.5', () => {
    expect(relaxLength(0.35, 5000, 5000)).toBeCloseTo(0.35, 9);
    expect(relaxLength(0.35, 20000, 5000)).toBeCloseTo(0.525, 9);
    expect(relaxLength(0.35, 0, 5000)).toBeCloseTo(0.175, 9);
  });
});

describe('the car rolls on relaxed tyres', () => {
  it('a step steer at 20 m/s: the front tyre follows σ·dα\'/dt = |vx|·(α − α\'), 63 % of the step after σ metres', () => {
    const s = settled();
    s.vel.z = 20;
    const inp = newInput();
    for (let i = 0; i < 120; i++) { inp.throttle = s.vel.z < 20 ? 0.3 : 0; step(s, inp); }
    // The step: the rack jumps to 0.02 rad (held there: steer = target, so the slew has nothing to do).
    const lock = rackLock(s.vel.x ** 2 + s.vel.z ** 2);
    inp.steer = 0.02 / lock; inp.throttle = 0;
    s.steer = -0.02;
    const fl = s.wheels[0], z0 = s.pos.z;
    // The reference: the exact first-order lag, e^(−Δd/σ) per tick, fed the kinematic slip angle
    // the car actually saw (it falls as the car yaws into the turn).
    let ref = fl.slipAngle, step0 = 0, at63 = null;
    for (let k = 0; s.pos.z - z0 < 6 * SPEC.tyreRelaxFront; k++) {
      const zb = s.pos.z;
      step(s, inp);
      if (k === 0) { step0 = fl.slipAngleKin; expect(Math.abs(fl.slipAngle)).toBeLessThan(0.5 * Math.abs(step0)); }
      ref = fl.slipAngleKin + (ref - fl.slipAngleKin) * Math.exp(-(s.pos.z - zb) / fl.relax);
      // Two-sided, every tick: within 5 % of the step (the discrete step is e^−x to second order).
      expect(Math.abs(fl.slipAngle - ref)).toBeLessThan(0.05 * Math.abs(step0));
      if (at63 === null && s.pos.z - z0 >= fl.relax) at63 = { r: fl.slipAngle / step0, want: 1 - Math.exp(-(s.pos.z - z0) / fl.relax) };
    }
    expect(fl.relax).toBeGreaterThan(SPEC.tyreRelaxFront * 0.7);
    expect(fl.relax).toBeLessThan(SPEC.tyreRelaxFront * 1.3);
    expect(at63.want).toBeGreaterThanOrEqual(0.632);
    expect(at63.r).toBeGreaterThan(at63.want * 0.85);
    expect(at63.r).toBeLessThan(at63.want * 1.15);
  });

  // A shove sideways: 1 m/s across the car at a given forward speed, no input. The relaxed tyre is a
  // spring in series with the slip damper, so once rolling the car swings back past zero (the
  // carcass) and settles; at a crawl the first-order model is no longer valid and the force fades
  // back to the kinematic slip angle (before that fade the swing at 3 m/s was 0.43 m/s).
  // Measured before relaxation (SIM_VERSION 15): −0.07 m/s at every speed.
  it('a sideways shove settles: no extra swing at a crawl, a bounded carcass swing once rolling', () => {
    for (const [vf, swing] of [[0, 0.08], [3, 0.2], [6, 0.35]]) {
      const s = settled();
      s.vel.z = vf; s.vel.x = 1;
      let min = 1, late = 0;
      for (let i = 0; i < 480; i++) { step(s, newInput()); min = Math.min(min, s.vel.x); if (i > 120) late = Math.max(late, Math.abs(s.vel.x)); }
      expect(min).toBeGreaterThan(-swing);
      expect(late).toBeLessThan(0.02);   // settled within 0.5 s
    }
  });

  it('a parked car nudged sideways comes to rest and stays there (no creep from the lag at v → 0)', () => {
    const s = settled();
    s.vel.x = 0.3;
    for (let i = 0; i < 480; i++) step(s, newInput());
    const x = s.pos.x, z = s.pos.z;
    for (let i = 0; i < 240 * 4; i++) step(s, newInput());
    expect(Math.hypot(s.pos.x - x, s.pos.z - z)).toBeLessThan(0.001);
    for (const wh of s.wheels) expect(Number.isFinite(wh.slipAngle)).toBe(true);
  });

  it('a wheel off the ground springs back: it lands with no side deflection', () => {
    const s = settled();
    s.pos.y += 3; s.vel.x = 2; s.vel.z = 10;
    step(s, newInput());
    for (const wh of s.wheels) { expect(wh.contact).toBe(false); expect(wh.slipAngle).toBe(0); }
  });
});
