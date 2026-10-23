// The ground-effect ceiling (0080): the free modes' jets hop and hover near the ground; nothing flies
// the car into the sky. Mode layer only (src/build/ceiling.js): src/sim is untouched.
import { describe, it, expect } from 'vitest';
import { liftFade, climbLimit, createCeiling, CEILING } from '../../src/build/ceiling.js';
import { createArenaCourse } from '../../src/build/arena.js';
import { createVehicle, step, DT, newInput, CAR } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

describe('liftFade', () => {
  it('is full near the ground and nothing above the band', () => {
    expect(liftFade(-2)).toBe(1);
    expect(liftFade(0)).toBe(1);
    expect(liftFade(CEILING.FULL)).toBe(1);
    expect(liftFade(CEILING.ZERO)).toBe(0);
    expect(liftFade(500)).toBe(0);
    expect(liftFade(NaN)).toBe(1);   // no surface found: the jets aren't stranded
  });
  it('falls smoothly and monotonically, with no step at either end', () => {
    let prev = 1;
    for (let h = 0; h <= 15; h += 0.05) {
      const f = liftFade(h);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - f).toBeLessThan(0.02);   // ≤ 2 % per 5 cm: no cliff anywhere in the band
      prev = f;
    }
    expect(liftFade((CEILING.FULL + CEILING.ZERO) / 2)).toBeCloseTo(0.5, 6);
  });
  it('climbLimit is gravity’s speed to the top, and nothing above it', () => {
    expect(climbLimit(0)).toBeCloseTo(Math.sqrt(2 * 9.81 * CEILING.TOP), 6);
    expect(climbLimit(CEILING.TOP)).toBe(0);
    expect(climbLimit(CEILING.TOP + 40)).toBe(0);
  });
});

// The Sandbox's apron, the car on it, a pilot holding LIFT (Assist, as Free Drive starts): the peak height.
function fly({ secs = 25, lift = 1, assist = 1, refill = 0, kick = 0, ceiling = true } = {}) {
  const course = createArenaCourse();
  const car = createVehicle(course);
  car.pos.y = SPEC.comHeight + 0.04;
  const ceil = createCeiling(() => course.sdf);
  const inp = newInput();
  let peak = 0, settled = 0;
  for (let t = 0; t < secs * 240; t++) {
    for (const k in inp) inp[k] = 0;
    inp.assist = assist; inp.lift = lift;
    if (refill && t % (refill * 240) === 0) car.air = CAR.airMass;
    if (t === 10 && kick) car.vel.y = kick;
    if (ceiling) ceil.preStep(car, inp);
    step(car, inp);
    if (ceiling) ceil.postStep(car, DT);
    const h = car.pos.y - SPEC.comHeight;
    peak = Math.max(peak, h);
    if (t === 4 * 240) settled = h;
  }
  return { peak, settled, rescue: ceil.takeRescue() };
}

describe('the ceiling on the car', () => {
  it('without it a tank of LIFT climbs past 100 m (the bug)', () => {
    expect(fly({ ceiling: false }).peak).toBeGreaterThan(100);
  });
  it('a full tank of LIFT hovers within the band, a little overshoot at most', () => {
    const { peak, settled } = fly();
    expect(peak).toBeLessThanOrEqual(CEILING.ZERO + 0.5);
    expect(settled).toBeGreaterThan(CEILING.FULL);   // it does hover, not just hop
    expect(settled).toBeLessThan(CEILING.ZERO);
  });
  it('Pro (no Assist) the same', () => {
    expect(fly({ assist: 0 }).peak).toBeLessThanOrEqual(CEILING.ZERO + 0.5);
  });
  it('a refill every two seconds never adds height', () => {
    expect(fly({ refill: 2, secs: 30 }).peak).toBeLessThanOrEqual(CEILING.ZERO + 0.5);
  });
  it('a ramp-sized launch flies its own ballistic arc', () => {
    const { peak } = fly({ lift: 0, kick: 20, secs: 8 });
    expect(peak).toBeGreaterThan(19.5);   // v²/2g = 20.4 m: well above the band
    expect(peak).toBeLessThan(21);
  });
  it('an absurd launch coasts no higher than TOP, and no rescue is needed', () => {
    const { peak, rescue } = fly({ lift: 0, kick: 100, secs: 12 });
    expect(peak).toBeLessThanOrEqual(CEILING.TOP + 1);
    expect(rescue).toBe(false);
  });
  it('a car somehow far above the ground asks the mode for its reset', () => {
    const course = createArenaCourse();
    const car = createVehicle(course);
    car.pos.y = CEILING.ABSURD + 50;
    const ceil = createCeiling(() => course.sdf);
    const inp = newInput();
    ceil.preStep(car, inp); step(car, inp); ceil.postStep(car, DT);
    expect(ceil.takeRescue()).toBe(true);
    expect(ceil.takeRescue()).toBe(false);   // once
  });
});
