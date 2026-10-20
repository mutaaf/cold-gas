import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createVehicle, step, newInput, mix, NOZZLES, DT } from '../../src/sim/vehicle.js';
import { surface, WALL, wallProfile, LINEUP, LINEUP_BOXES } from '../../src/sim/courses.js';
import { SPEC } from '../../src/sim/spec.js';

function fly(course, opts) {
  const run = createRun(course);
  const ap = createAutopilot(course, opts);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run;
}
const settle = (course = 'lineup', x = 30) => {
  const s = createVehicle(course); s.pos.x = x;
  for (let i = 0; i < 480; i++) step(s, newInput());
  return s;
};

describe('vehicle: the numbers a car person checks', () => {
  it('sits at its ride height with the weight shared by four wheels', () => {
    const s = settle();
    expect(s.pos.y).toBeCloseTo(SPEC.comHeight, 2);
    const total = s.wheels.reduce((a, w) => a + w.load, 0);
    expect(total).toBeCloseTo((SPEC.dryMass + SPEC.gasMass) * 9.81, -2);
  });
  it('0–60 is traction-limited on tyres alone, much faster with fan and thrust', () => {
    const t60 = (extra) => {
      const s = settle(); const inp = { ...newInput(), throttle: 1, ...extra };
      for (let t = 0; t < 10; t += DT) { step(s, inp); if (Math.hypot(s.vel.x, s.vel.z) >= 26.82) return t; }
      return Infinity;
    };
    const tyres = t60({}), fan = t60({ fan: 1 }), all = t60({ fan: 1, thrust: 1 });
    // 2.45 t Rocket stunt car on μ 1.25 Trofeo RS (OFFICIAL grip): traction-limited RWD.
    expect(tyres).toBeGreaterThan(3.6); expect(tyres).toBeLessThan(5.6);
    expect(fan).toBeLessThan(tyres - 0.8);
    expect(all).toBeLessThan(fan);
  });
  it('ABS stops from 60 mph in under 32 m', () => {
    const s = settle(); const go = { ...newInput(), throttle: 1 };
    while (Math.hypot(s.vel.x, s.vel.z) < 26.82) step(s, go);
    const z0 = s.pos.z, b = { ...newInput(), brake: 1 };
    for (let i = 0; i < 2400 && Math.hypot(s.vel.x, s.vel.z) > 0.3; i++) step(s, b);
    expect(s.pos.z - z0).toBeLessThan(32);
  });
  it('the fan holds the car on a vertical wall; without it, it falls', () => {
    for (const fan of [1, 0]) {
      const s = createVehicle('wall');
      // Place the car where the curl is exactly vertical, wheels to the deck, nose up, parked.
      // On a concave arc the deck rises under each axle by the sagitta (≈wheelbase²/8R), so the
      // body sits that much further out than on flat ground.
      const p = wallProfile(WALL.r1 * Math.PI / 2);
      const sag = (SPEC.wheelbase * SPEC.wheelbase) / (8 * WALL.r1);
      const off = SPEC.comHeight + sag;
      s.pos.x = 0; s.pos.y = p.y + p.ny * off; s.pos.z = p.z + p.nz * off;
      // Body up = deck normal (−z), body forward = +y: rotate −90° about x.
      s.quat.x = -Math.SQRT1_2; s.quat.y = 0; s.quat.z = 0; s.quat.w = Math.SQRT1_2;
      s.fan = fan;   // already spooled up, as it is on the climb
      const inp = { ...newInput(), fan, brake: 1 };
      const y0 = s.pos.y;
      for (let i = 0; i < 480; i++) step(s, inp);
      if (fan) expect(Math.abs(s.pos.y - y0)).toBeLessThan(0.05);
      else expect(s.pos.y).toBeLessThan(y0 - 3);
    }
  });
  it('mixer gives attitude priority over lift and stays in [0,1]', () => {
    const out = new Float64Array(NOZZLES.length);
    mix({ lift: 1, thrust: 0, retro: 0 }, { x: 0, y: 0, z: -1 }, out);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(Math.abs(out[0] + out[2] - out[1] - out[3])).toBeGreaterThan(0.5);
  });
});

describe('courses', () => {
  const n = {};
  it('the Wall is an exact surface: on the profile, the distance is zero', () => {
    for (let s = 0; s <= WALL.length; s += 1.7) {
      const p = wallProfile(s);
      expect(Math.abs(surface(WALL, 0, p.y, p.z, n))).toBeLessThan(1e-6);
      expect(surface(WALL, 0, p.y + p.ny * 0.5, p.z + p.nz * 0.5, n)).toBeCloseTo(0.5, 5);
    }
  });
  it('off the side of the deck there is no deck', () => {
    const p = wallProfile(20);
    expect(surface(WALL, WALL.width / 2 + 0.5, p.y, p.z, n)).toBeGreaterThan(1);
  });
  it('the Lineup knows its parked cars', () => {
    const b = LINEUP_BOXES[2];
    expect(surface(LINEUP, 0, b.h - 0.1, b.cz, n)).toBeLessThan(0);
    expect(n.obstacle).toBe(true);
  });
});

describe('the reference runs land, and replay bit-exactly', () => {
  for (const course of ['wall', 'lineup']) {
    const run = fly(course);
    const card = scoreRun(run.t, { assist: true });
    it(`${course}: lands upright and soft`, () => {
      expect(run.t.endReason).toBe('settled');
      expect(run.t.settledUpright).toBe(true);
      expect(run.t.sink).toBeLessThan(2);
      expect(run.t.tiltDeg).toBeLessThan(10);
      expect(card.total).toBeGreaterThan(65);
      expect(card.total).toBeLessThan(95);
    });
    it(`${course}: replays exactly from its input log`, () => {
      const re = simulate(run.inputLog, course);
      expect(re.tick).toBe(run.tick);
      expect(re.car.pos).toEqual(run.car.pos);
      expect(scoreRun(re.t, { assist: true })).toEqual(card);
    });
  }
  it('the Wall reference climbs the whole curl and hangs inverted', () => {
    const t = fly('wall').t;
    expect(t.progress).toBe(1);
    expect(t.maxRampHeight).toBeGreaterThan(17);   // the sourced lip is ≈19.8 m
    expect(t.invertedTime).toBeGreaterThan(1.5);     // it hangs on the ledge like the reveal
  });
});

describe('judging', () => {
  it('a Lineup jump that hits the cars is a contact, capped low', () => {
    const run = fly('lineup', { apex: 2.5 });
    const s = scoreRun(run.t);
    expect(run.t.contact).toBe(true);
    expect(s.total).toBeLessThan(40);
  });
  it('a Wall run that never leaves the wall scores low', () => {
    const run = createRun('wall');
    const inp = { ...newInput(), throttle: 1 };
    for (let i = 0; i < 240 * 20 && run.phase !== 'done'; i++) stepRun(run, inp);
    expect(scoreRun(run.t).total).toBeLessThan(40);
  });
});

// The reference runs must keep matching what the reveal's livestream showed
// (docs/REVEAL_RESEARCH.md). If physics changes break these, the sim has drifted from reality.
describe('reveal fidelity', () => {
  const wall = fly('wall').t, lineup = fly('lineup').t;
  it('the Wall: release to touchdown ≈4.5 s, a ~180° roll-out, braking ≈3.3 G, soft on four wheels', () => {
    const air = (wall.touchTick - wall.airStartTick) / 240;
    expect(air).toBeGreaterThan(3.5); expect(air).toBeLessThan(5.5);
    const roll = Math.abs(wall.rollAccum) * 180 / Math.PI;
    expect(roll).toBeGreaterThan(150); expect(roll).toBeLessThan(220);
    expect(wall.maxG).toBeGreaterThan(2.5); expect(wall.maxG).toBeLessThan(4.6);
    expect(wall.launchHeight).toBeGreaterThan(18); expect(wall.launchHeight).toBeLessThan(21.5);
    expect(wall.sink).toBeLessThan(1.5);
    expect(wall.wheelSpreadMs).toBeLessThan(80);
  });
  it('the Lineup: lift-off from flat ground, peak ≈7–8 m, a clean 360° over the cars', () => {
    expect(lineup.apex).toBeGreaterThan(6.5); expect(lineup.apex).toBeLessThan(9.5);
    expect(lineup.contact).toBe(false);
    expect(Math.abs(Math.abs(lineup.rollAccum) * 180 / Math.PI - 360)).toBeLessThan(20);
  });
  it('0–60 mph with fan and rear thrusters lands near the live run (0.67 s net)', () => {
    const s = settle(); const inp = { ...newInput(), throttle: 1, fan: 1, thrust: 1 };
    let t = 0; while (Math.hypot(s.vel.x, s.vel.z) < 26.82 && t < 3) { step(s, inp); t += DT; }
    expect(t).toBeGreaterThan(0.45); expect(t).toBeLessThan(0.95);
  });
});
