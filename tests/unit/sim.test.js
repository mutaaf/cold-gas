import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createVehicle, step, newInput, mix, NOZZLES } from '../../src/sim/vehicle.js';
import { groundAt, LINEUP, obstaclePenetration } from '../../src/sim/course.js';

function fly(opts) {
  const run = createRun();
  const ap = createAutopilot(opts);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run;
}

describe('vehicle', () => {
  it('rests on its springs without drifting', () => {
    const s = createVehicle();
    const y0 = s.pos.y;
    for (let i = 0; i < 480; i++) step(s, newInput());
    expect(Math.abs(s.pos.y - y0)).toBeLessThan(0.02);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThan(0.05);
  });

  it('full lift out-thrusts gravity with a full tank', () => {
    const s = createVehicle();
    const inp = { ...newInput(), lift: 1 };
    for (let i = 0; i < 240; i++) step(s, inp);
    expect(s.pos.y).toBeGreaterThan(2);
    expect(s.air).toBeLessThan(250);
  });

  it('mixer gives attitude priority over lift and stays in [0,1]', () => {
    const out = new Float64Array(NOZZLES.length);
    mix({ lift: 1, thrust: 0, retro: 0 }, { x: 0, y: 0, z: -1 }, out);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    const left = out[0] + out[2], right = out[1] + out[3];
    expect(Math.abs(left - right)).toBeGreaterThan(0.5);
  });
});

describe('course', () => {
  it('ramp rises smoothly to the lip', () => {
    expect(groundAt(0, -12)).toBe(0);
    expect(groundAt(0, 0)).toBeCloseTo(1.2);
    expect(groundAt(10, -1)).toBe(0);
  });
  it('detects points inside the parked lineup', () => {
    const n = { x: 0, y: 0, z: 0 };
    const b = LINEUP[2];
    expect(obstaclePenetration({ x: 0, y: b.h - 0.1, z: b.cz }, n)).toBeGreaterThan(0);
    expect(n.y).toBe(1);
    expect(obstaclePenetration({ x: 0, y: b.h + 0.1, z: b.cz }, n)).toBe(0);
  });
});

describe('the reference jump', () => {
  const run = fly();
  const s = scoreRun(run.t);
  it('clears the lineup, rolls 360 and sticks the landing', () => {
    expect(run.t.contact).toBe(false);
    expect(run.t.minClearance).toBeGreaterThan(0.5);
    expect(s.facts.rotations).toBe(1);
    expect(Math.abs(s.facts.rollDeg - 360)).toBeLessThan(15);
    expect(run.t.sink).toBeLessThan(2.5);
    expect(run.t.tiltDeg).toBeLessThan(6);
    expect(run.t.settledUpright).toBe(true);
    expect(s.total).toBeGreaterThan(75);
    expect(s.total).toBeLessThan(95);  // a human can beat the reference
  });
  it('replays bit-exactly from its input log', () => {
    const re = simulate(run.inputLog);
    expect(re.tick).toBe(run.tick);
    expect(re.car.pos).toEqual(run.car.pos);
    expect(scoreRun(re.t)).toEqual(s);
  });
});

describe('judging', () => {
  it('a jump that hits the lineup is a contact, capped low', () => {
    const run = fly({ apex: 2.5 });
    const s = scoreRun(run.t);
    expect(run.t.contact).toBe(true);
    expect(s.verdict).toBe('Contact');
    expect(s.total).toBeLessThan(40);
  });
  it('no roll is no trick', () => {
    const s = scoreRun(fly({ rolls: 0 }).t);
    expect(s.verdict).toBe('No trick');
    expect(s.categories.rotation).toBe(0);
  });
  it('driving straight through without jumping scores zero', () => {
    const run = createRun();
    const inp = { ...newInput(), throttle: 1 };
    while (run.phase !== 'done') stepRun(run, inp);
    expect(scoreRun(run.t).total).toBeLessThan(35);
  });
});
