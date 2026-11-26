// 0361: a wrecked car shuts its valves. The crash sensor latches the tick the damage reaches WRECK_PCT (when the HUD
// says WRECKED) and every valve is shut from the next tick to the end of the aftermath: no jet fires from a dead car.
// A run flown before WRECK_VERSION replays as it was (its jets kept firing), and a crash short of a wreck keeps its jets.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, armAftermath, aftermathStep, simulate, simVersionOf, replayable, WRECK_VERSION, MARK_VERSION, SURFACE_VERSION, SIM_VERSION } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { newInput } from '../../src/sim/vehicle.js';
import { WRECK_PCT } from '../../src/sim/judge.js';

// The critic's wreck (docs/critique/2026-11-23-0400): the Show reference to the first air tick, then Pro with nothing held.
// `zeroPro` false flies the autopilot throughout. Records, from 8 ticks after the wreck to the aftermath's end, every
// tick's largest throttle and the gas.
function fly(course, { opts = {}, zeroPro = true, v } = {}) {
  const run = armAftermath(createRun(course, v)), ap = createAutopilot(course, opts);
  const zero = newInput(); zero.assist = 0;
  let wreck = -1, pro = false;
  const after = [], air = [];
  const look = () => {
    // The HUD's WRECKED (src/main.js) and the card (damage.pct) read the damage rounded: from 59.5 %.
    if (wreck < 0 && Math.round(run.damage.total) >= WRECK_PCT) wreck = run.tick;
    if (wreck >= 0 && run.tick >= wreck + 8) { after.push(Math.max(...run.car.throttles)); air.push(run.car.air); }
  };
  while (run.phase !== 'done') {
    if (zeroPro && run.phase === 'air') pro = true;
    stepRun(run, pro ? zero : ap(run));
    look();
  }
  const log = run.inputLog, t = run.t;
  while (!aftermathStep(run)) look();
  return { run, t, log, wreck, after, air };
}

describe('0361: a wrecked car shuts its valves', () => {
  const w = fly('show');

  it('the critic\'s Show wreck reaches WRECKED in the air phase or after', () => {
    expect(w.wreck).toBeGreaterThan(0);
    expect(w.run.damage.total).toBeGreaterThanOrEqual(WRECK_PCT);
    expect(w.after.length).toBeGreaterThan(200);
  });

  it('from 8 ticks after the wreck to the aftermath\'s end every throttle is 0 and no gas is used', () => {
    expect(w.after.every((x) => x === 0)).toBe(true);
    expect(w.air.every((a) => a === w.air[0])).toBe(true);
    expect(w.t.airEnd).toBe(w.air[0]);
  });

  it('the valves shut the tick after the HUD says WRECKED, which reads the damage rounded (self-review: 59.5 %)', () => {
    // These Lineup crashes pass 59.5 % 24 and 11 ticks before 60 %: the jets must not run through the gap.
    for (const opts of [{ speed: 7, apex: 2.5, rolls: 2 }, { speed: 9, apex: 1.5, rolls: 2 }]) {
      const run = createRun('lineup'), ap = createAutopilot('lineup', opts);
      let hud = -1;
      while (run.phase !== 'done') {
        stepRun(run, ap(run));
        if (hud < 0 && Math.round(run.damage.total) >= WRECK_PCT) { hud = run.tick; expect(run.car.valvesShut).toBe(true); }
        if (hud >= 0 && run.tick > hud) expect(Math.max(...run.car.throttles)).toBe(0);
      }
      expect(hud).toBeGreaterThan(0);
    }
  });

  it('the latch is on the run (the HUD and the plumes read it)', () => {
    expect(w.run.car.valvesShut).toBe(true);
  });

  it('the same wreck flown before WRECK_VERSION replays as it was: its jets kept firing', () => {
    const old = fly('show', { v: MARK_VERSION });
    expect(old.wreck).toBeGreaterThan(0);
    expect(old.after.filter((x) => x > 0.05).length).toBeGreaterThan(100);
    expect(old.air[0] - old.air[old.air.length - 1]).toBeGreaterThan(20);
    // and the log replays to the same end at its own version
    const re = simulate(old.log, 'show', undefined, null, MARK_VERSION);
    expect(re.t.airEnd).toBe(old.t.airEnd);
    expect(re.t.endTick).toBe(old.t.endTick);
  });

  it('today\'s log replays at today\'s version to the same shut valves (the Worker\'s re-simulation)', () => {
    const re = simulate(w.log, 'show');
    expect(re.t.airEnd).toBe(w.t.airEnd);
    expect(re.t.endReason).toBe(w.t.endReason);
    expect(re.t.endTick).toBe(w.t.endTick);
    expect(re.t.damage).toEqual(w.t.damage);
  });

  it('a crash that is not a wreck keeps its jets, bit for bit', () => {
    for (const [course, opts, was] of [['show', { carry: 5 }, MARK_VERSION], ['lineup', { speed: 9, apex: 2.8, rolls: 2 }, SURFACE_VERSION]]) {
      const now = fly(course, { opts, zeroPro: false }), old = fly(course, { opts, zeroPro: false, v: was });
      expect(now.wreck).toBe(-1);
      expect(now.t.contact).toBe(true);
      expect(now.run.car.valvesShut).toBe(false);
      expect(now.t.airEnd).toBe(old.t.airEnd);
      expect(now.t.endTick).toBe(old.t.endTick);
      expect(now.run.car.pos.x).toBe(old.run.car.pos.x);
    }
  });
});

describe('0361: the version', () => {
  it('every course flies at WRECK_VERSION today', () => {
    expect(WRECK_VERSION).toBe(35);
    for (const c of ['show', 'wall', 'lineup']) expect(simVersionOf(c)).toBe(WRECK_VERSION);
  });
  it('a run from the version before replays and stays a mark (landed runs are the same bits)', () => {
    expect(replayable('show', MARK_VERSION)).toBe(true);
    expect(replayable('wall', MARK_VERSION)).toBe(true);
    expect(replayable('lineup', SURFACE_VERSION)).toBe(true);
    expect(replayable('lineup', SIM_VERSION)).toBe(true);
    // what was stale stays stale
    expect(replayable('show', SURFACE_VERSION)).toBe(false);
    expect(replayable('wall', SIM_VERSION)).toBe(false);
    expect(replayable('lineup', MARK_VERSION)).toBe(false);
  });
});
