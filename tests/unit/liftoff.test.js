// 0362: on the Lineup, Assist's LIFT held from the ground is a lift-off command, not a throttle (src/sim/vehicle.js
// liftOffBurn). The keys' "Space at the line" had flown one held second to 45 m and wrecked; a tap came down on the row.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate, SURFACE_VERSION, LIFTOFF_VERSION, simVersionOf } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { LIFTOFF_COMMIT, LIFTOFF_CUT } from '../../src/sim/vehicle.js';
import { flyNaive, naiveController, grid } from '../../scripts/lib/naive-lineup.mjs';

const hold = (liftS, more = {}) => flyNaive({ speed: 7.5, pressZ: -4, liftS, rollS: 0.8, ...more });

describe('the Lineup lift-off burn (0362)', () => {
  it('is the Lineup run version, and Show and Wall runs are as they were', () => {
    expect(simVersionOf('lineup')).toBe(LIFTOFF_VERSION);
    expect(createRun('lineup').car.liftOff).toBe(1);
    expect(createRun('lineup', SURFACE_VERSION).car.liftOff).toBe(0);
    expect(createRun('show').car.liftOff).toBe(0);
    expect(createRun('wall').car.liftOff).toBe(0);
  });

  it('a held Space stops by itself: 0.4–1.0 s holds peak at 7–10 m and stick it (was 45 m and Wrecked at 1.0 s)', () => {
    for (const s of [0.4, 0.6, 1.0]) {
      const r = hold(s);
      expect(r.apex, `hold ${s}`).toBeGreaterThan(7);
      expect(r.apex, `hold ${s}`).toBeLessThan(10);
      expect(r.landed, `hold ${s}: ${r.verdict}`).toBe(true);
      expect(r.sink, `hold ${s}`).toBeLessThanOrEqual(2);
    }
    // However long the key stays down, the burn ends at the same height.
    expect(hold(1.5).apex).toBeCloseTo(hold(3).apex, 6);
    expect(hold(3).apex).toBeLessThan(9);
  });

  it('a 0.3 s tap is carried on to the reference cut and clears the row (it used to hit it)', () => {
    const r = hold(0.3);
    expect(r.landed, r.verdict).toBe(true);
    const old = flyNaive({ speed: 7.5, pressZ: -4, liftS: 0.3, rollS: 0.8, simVersion: SURFACE_VERSION });
    expect(old.landed).toBe(false);
  });

  it('a shorter tap and an at-once roll: the committed burn ends roof down or on contact, never worse than v33 (the review)', () => {
    const rank = (r) => (r.landed ? 1 : 0);   // never loses a landing v33 had
    for (const speed of [6, 7.5, 9]) for (const liftS of [0.05, 0.1, 0.2]) {
      const p = { speed, pressZ: -4, liftS, rollS: 0.8 };
      const now = flyNaive(p), old = flyNaive({ ...p, simVersion: SURFACE_VERSION });
      expect(rank(now), `${speed} m/s, ${liftS} s: ${now.verdict} vs ${old.verdict}`).toBeGreaterThanOrEqual(rank(old));
      expect(now.run.car.liftBurn, `${speed} m/s, ${liftS} s`).toBe(0);
    }
  });

  it('a LIFT pressed again in the air is LIFT: the second press climbs past the cut', () => {
    const run = createRun('lineup'), pilot = naiveController({ speed: 7.5, pressZ: -4, liftS: 0.4, rollS: 0 });
    let apex = 0, t0 = -1;
    while (run.phase !== 'done' && run.tick < 240 * 20) {
      const inp = pilot(run);
      if (run.phase === 'air') { if (t0 < 0) t0 = run.tick; const dt = (run.tick - t0) / 240; if (dt > 0.6 && dt < 1.3) { inp.lift = 1; inp.level = 0; } }
      stepRun(run, inp);
      apex = Math.max(apex, run.car.pos.y);
    }
    expect(apex).toBeGreaterThan(12);
  });

  it('Pro is unchanged: a held second still flies past 30 m', () => {
    const r = flyNaive({ speed: 7.5, pressZ: -4, liftS: 1, rollS: 0.8, tier: 'pro' });
    expect(r.apex).toBeGreaterThan(30);
  });

  it('a v33 Lineup log replays as it was flown (45 m), and a v34 one to its bits', () => {
    const old = flyNaive({ speed: 7.5, pressZ: -4, liftS: 1, rollS: 0.8, simVersion: SURFACE_VERSION });
    expect(old.apex).toBeGreaterThan(30);
    const re = simulate(old.run.inputLog, 'lineup', undefined, null, SURFACE_VERSION);
    expect(re.car.pos).toEqual(old.run.car.pos);
    const now = hold(1);
    expect(simulate(now.run.inputLog, 'lineup').car.pos).toEqual(now.run.car.pos);
  });

  it('the reference flies as before (it lets go at the commit height, below the cut)', () => {
    expect(LIFTOFF_COMMIT).toBeLessThan(LIFTOFF_CUT);
    const run = createRun('lineup'), ap = createAutopilot('lineup');
    while (run.phase !== 'done') stepRun(run, ap(run));
    const old = createRun('lineup', SURFACE_VERSION), ap0 = createAutopilot('lineup');
    while (old.phase !== 'done') stepRun(old, ap0(old));
    expect(run.inputLog).toEqual(old.inputLog);
    expect(run.car.pos).toEqual(old.car.pos);
    expect(scoreRun(run.t, { assist: true }).total).toBe(scoreRun(old.t, { assist: true }).total);
  });

  // scripts/naive-lineup.mjs: 225 keyboard players. Before the burn 70 landed upright and unwrecked; with it 190. The rest
  // hold Space through the apex and roll on the way down over the row (≥ 1.5 s holds): a follow-up, not this burn.
  it('the naive Lineup gate: ≥ 190 of 225 keyboard players land upright and unwrecked (70 before)', () => {
    let ok = 0, n = 0;
    for (const p of grid()) { n++; if (flyNaive(p).landed) ok++; }
    expect(n).toBe(225);
    expect(ok).toBeGreaterThanOrEqual(190);
  }, 120_000);
});
