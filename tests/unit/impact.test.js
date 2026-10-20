import { describe, it, expect } from 'vitest';
import { landingImpact, IMPACT } from '../../src/render/impact.js';

const snap = (sink, reduced) => ({ ...landingImpact(sink, reduced) });

describe('landing impact', () => {
  it('grows with sink rate, as energy (v²), and saturates at the hard limit', () => {
    let prev = -1;
    for (let v = 0; v <= 7; v += 0.25) {
      const s = landingImpact(v).strength;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(landingImpact(IMPACT.hardSink / 2).strength).toBeCloseTo(0.25);
    expect(landingImpact(IMPACT.hardSink).strength).toBe(1);
    expect(landingImpact(9).strength).toBe(1);
    expect(landingImpact(-2).strength).toBe(0);
  });

  it('makes a soft (<1.5 m/s) and a hard (>4 m/s) landing clearly different in every cue', () => {
    const soft = snap(1.4), hard = snap(4.2);
    expect(hard.strength).toBeGreaterThan(soft.strength * 5);
    expect(hard.dip).toBeGreaterThan(soft.dip * 3);
    expect(hard.fovPunch).toBeGreaterThan(soft.fovPunch * 2);
    expect(hard.shake).toBeGreaterThan(soft.shake * 5);
    expect(hard.mist).toBeGreaterThan(soft.mist * 2);
    expect(hard.thudGain).toBeGreaterThan(soft.thudGain * 2);
    expect(hard.thudHz).toBeLessThan(soft.thudHz - 40);   // deeper
    expect(soft.crunch).toBe(0);
    expect(hard.crunch).toBeGreaterThan(0);
  });

  it('turns off the dip, the FOV punch and the shake under reduced motion, but keeps sound and mist', () => {
    const full = snap(4.5), calm = snap(4.5, true);
    expect(calm.dip).toBe(0);
    expect(calm.fovPunch).toBe(0);
    expect(calm.shake).toBe(0);
    expect(calm.mist).toBe(full.mist);
    expect(calm.thudGain).toBe(full.thudGain);
  });
});
