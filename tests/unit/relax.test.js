// Tyre relaxation length (SIM_VERSION 16, ticket 0015): a tyre's side force builds up over σ
// metres of rolling after a slip-angle step (Pacejka, Tyre and Vehicle Dynamics, ch. 7), instead of
// appearing in the same tick. σ is an ESTIMATE for the 295/30 R20 and 335/30 R21 tyres (spec.js).
import { describe, it, expect } from 'vitest';
import { createVehicle, step, newInput, relaxSlip, relaxLength, DT } from '../../src/sim/vehicle.js';
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
  it('σ grows with √load, bounded ×0.5–1.5', () => {
    expect(relaxLength(0.35, 5000, 5000)).toBeCloseTo(0.35, 9);
    expect(relaxLength(0.35, 20000, 5000)).toBeCloseTo(0.525, 9);
    expect(relaxLength(0.35, 0, 5000)).toBeCloseTo(0.175, 9);
  });
});

describe('the car rolls on relaxed tyres', () => {
  it('a step steer at 20 m/s: the front tyre reaches 63 % of its slip angle after σ metres (±15 %)', () => {
    const s = settled();
    s.vel.z = 20;
    const inp = newInput();
    for (let i = 0; i < 120; i++) { inp.throttle = s.vel.z < 20 ? 0.3 : 0; step(s, inp); }
    // The step: the rack jumps to 0.02 rad (held there: steer = target, so the slew has nothing to do).
    const lock = Math.min(0.5, (SPEC.wheelbase * SPEC.tyreMu * 9.81) / (s.vel.x ** 2 + s.vel.z ** 2) + 0.04);
    inp.steer = 0.02 / lock; inp.throttle = 0;
    s.steer = -0.02;
    const fl = s.wheels[0], z0 = s.pos.z;
    step(s, inp);
    expect(Math.abs(fl.slipAngle)).toBeLessThan(0.5 * Math.abs(fl.slipAngleKin));   // not there in one tick
    const sigma = fl.relax;
    expect(sigma).toBeGreaterThan(SPEC.tyreRelaxFront * 0.7);
    expect(sigma).toBeLessThan(SPEC.tyreRelaxFront * 1.3);
    while (s.pos.z - z0 < sigma) step(s, inp);
    const ratio = fl.slipAngle / fl.slipAngleKin, want = 1 - Math.exp(-(s.pos.z - z0) / sigma);
    expect(want).toBeGreaterThanOrEqual(0.632);
    expect(ratio).toBeGreaterThan(want * 0.85);
    expect(ratio).toBeLessThan(want * 1.15);
    // And it settles onto the kinematic slip angle within ≈5σ.
    while (s.pos.z - z0 < 6 * sigma) step(s, inp);
    expect(fl.slipAngle / fl.slipAngleKin).toBeGreaterThan(0.97);
  });

  it('a parked car stays parked (no creep from the lag at v → 0)', () => {
    const s = settled();
    const x = s.pos.x, z = s.pos.z;
    for (let i = 0; i < 240 * 5; i++) step(s, newInput());
    expect(Math.hypot(s.pos.x - x, s.pos.z - z)).toBeLessThan(0.002);
    for (const wh of s.wheels) expect(Number.isFinite(wh.slipAngle)).toBe(true);
  });

  it('a wheel off the ground springs back: it lands with no side deflection', () => {
    const s = settled();
    s.pos.y += 3; s.vel.x = 2; s.vel.z = 10;
    step(s, newInput());
    for (const wh of s.wheels) { expect(wh.contact).toBe(false); expect(wh.slipAngle).toBe(0); }
  });
});
