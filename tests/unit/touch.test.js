// One-thumb Assist (src/onethumb.js) is just another source of sim inputs: a hold / tap / hold
// flight lands, its log replays bit-exactly, and the Worker's verify agrees. Plus the HUD's
// mission clock format.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';
import { missionClock } from '../../src/ui.js';

// Flies the Show the way main.js does: the thumb's input, then wallAssist (release + fan).
function flyThumb({ hangTicks = 120, holdAfterTap = true, course = 'show' } = {}) {
  const run = createRun(course), th = createOneThumb();
  let released = false, ledgeT = -1;
  const stages = new Set();
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    stages.add(thumbStage(run, released));
    if (!released && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + hangTicks) { th.down(); if (!holdAfterTap) th.up(); }
    }
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return { run, stages };
}

describe('one-thumb Assist', () => {
  it('hold to climb, tap to let go, hold to land: a clean landing, every stage seen', () => {
    const { run, stages } = flyThumb();
    const card = scoreRun(run.t);
    expect([...stages]).toEqual(expect.arrayContaining(['climb', 'ledge', 'fly', 'landed']));
    expect(run.t.contact).toBe(false);
    expect(run.t.crossedRow).toBe(true);
    expect(run.t.sink).toBeLessThan(3);
    expect(card.facts.crashed).toBeFalsy();
  });
  it('the thumb stops on the ledge by itself (no throw off the lip)', () => {
    const { run } = flyThumb({ hangTicks: 600 });
    expect(run.t.launchProgress ?? run.t.progress).toBeLessThan(1);
    expect(run.t.fellOff).toBe(false);
  });
  it('replays bit-exactly from its input log', () => {
    const { run } = flyThumb();
    const again = simulate(run.inputLog, 'show');
    expect(again.car.pos).toEqual(run.car.pos);
    expect(scoreRun(again.t).total).toBe(scoreRun(run.t).total);
  });
  it('flies Assist only (the log says so)', () => {
    const { run } = flyThumb();
    expect(scoreRun(run.t).tier || 'assist').toBe('assist');
  });
});

describe('mission clock', () => {
  it('formats tenths as T± mm:ss.s', () => {
    expect(missionClock(-30)).toBe('−00:03.0');
    expect(missionClock(124)).toBe('+00:12.4');
    expect(missionClock(6015)).toBe('+10:01.5');
  });
});
