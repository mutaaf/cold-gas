// 0134: the gas Daily (`gas-show`) is meetable on one thumb, the way most players fly the Show (a phone,
// Assist). The one-thumb flight's nitrogen is the computer's up to the release; after it, what the player
// chooses is when to hold the pad, and holding it from the tap (LAND from the release, the reveal's way)
// is what lands with the most gas. So the bar sits between those two flights, set on the phone population
// (scripts/human-phone.mjs --daily): a thumb held from the tap meets it, one that waits for the fall
// doesn't, and the reference flight still does.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';
import { OBJECTIVES, evaluate } from '../../src/daily.js';

// The Show the way main.js flies it on one thumb (as thumb-mastery.test.js): hold up the curl, stop on
// the ledge, a short tap to let go, then hold in the air from the tap (`holdAt: 'tap'`) or from a height.
function flyThumb(holdAt = 'tap') {
  const run = createRun('show'), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (tapT > 0 && run.tick === tapT + 24 && holdAt !== 'tap') th.up();
    if (released && holdAt !== 'tap' && !th.held && c.vel.y < 0 && c.pos.y < holdAt) th.down();
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return run;
}
const gasShow = OBJECTIVES.find((o) => o.id === 'gas-show');

describe('the gas Daily on one thumb (0134)', () => {
  it('a thumb held from the tap clears the row and meets it, and the run replays and scores the same', () => {
    const run = flyThumb('tap');
    const s = scoreRun(run.t);
    expect(s.facts.crashed).toBe(false);
    expect(s.facts.contact).toBe(false);
    expect(s.facts.clearance).toBeGreaterThanOrEqual(3);
    expect(evaluate(gasShow, s, 'show')).toEqual({ ok: true, miss: '' });
    const again = simulate(run.inputLog, 'show');   // the Worker's path
    expect(scoreRun(again.t).facts.airPct).toBe(s.facts.airPct);
  });

  it('a thumb that waits for the fall to hold lands with less and is told the number it needs', () => {
    const tap = scoreRun(flyThumb('tap').t), late = scoreRun(flyThumb(12).t);
    expect(late.facts.crashed).toBe(false);
    expect(late.facts.airPct).toBeLessThan(tap.facts.airPct);
    const r = evaluate(gasShow, late, 'show');
    expect(r.ok).toBe(false);
    expect(r.miss).toBe(`${late.facts.airPct} % gas left, need 31 %`);
  });

  it('the goal names the new bar, and the reference flight (48 %) still meets it', () => {
    expect(gasShow.goal()).toBe('Clear the row with more than 30 % gas left');
    const run = createRun('show'), ap = createAutopilot('show');
    while (run.phase !== 'done') stepRun(run, ap(run));
    expect(evaluate(gasShow, scoreRun(run.t), 'show').ok).toBe(true);
  });
});
