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

// 0129: the tap on the ledge answers at once. The pad reads `driving` (the drive-off under way) and
// `pending` (a press not yet sampled) to show "Letting go" on the frame of the tap; the sim is unchanged.
describe('one-thumb: the tap on the ledge (0129)', () => {
  // Climb to the ledge and stop there, then tap once (or twice, the second during the drive-off).
  function ledgeTap({ taps = [0] } = {}) {
    const run = createRun('show'), th = createOneThumb();
    let released = false, ledgeT = -1;
    const seen = { drivingBeforeTap: false, pendingAfterTap: null, drivingAfterTap: [], releaseTick: -1 };
    th.down();
    while (run.phase !== 'done' && run.tick < 240 * 30) {
      const c = run.car, inp = newInput();
      if (!released && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3 && ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (ledgeT >= 0 && !released) {
        const k = taps.indexOf(run.tick - ledgeT - 120);
        if (k >= 0) {
          th.down(); th.up();
          if (k === 0) seen.pendingAfterTap = th.pending;
        } else if (run.tick - ledgeT < 120 && th.driving) seen.drivingBeforeTap = true;
      }
      th.sample(run, released, inp);
      if (ledgeT >= 0 && run.tick >= ledgeT + 120 + taps[0] && !released) seen.drivingAfterTap.push(th.driving);
      if (!released && ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air')) { released = true; seen.releaseTick = run.tick; }
      inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
      stepRun(run, inp);
    }
    return { run, seen, tapTick: ledgeT + 120 + taps[0] };
  }

  it('driving turns on with the sample that takes the tap, and stays on until the release', () => {
    const { seen, tapTick } = ledgeTap();
    expect(seen.drivingBeforeTap).toBe(false);
    expect(seen.pendingAfterTap).toBe(true);    // the press is visible before any tick has read it
    expect(seen.drivingAfterTap.length).toBeGreaterThan(0);
    expect(seen.drivingAfterTap.every(Boolean)).toBe(true);
    // The drive-off itself is unchanged: ≈ 0.9 s from the tap to the push-off.
    expect((seen.releaseTick - tapTick) / 240).toBeGreaterThan(0.6);
    expect((seen.releaseTick - tapTick) / 240).toBeLessThan(1.3);
  });

  it('a second tap during the drive-off changes nothing (same release tick, same input log)', () => {
    const one = ledgeTap();
    const two = ledgeTap({ taps: [0, 60] });
    expect(two.seen.releaseTick).toBe(one.seen.releaseTick);
    expect(two.run.inputLog).toEqual(one.run.inputLog);
  });

  it('a hold that never taps never drives, and a press on the climb is not a tap', () => {
    const run = createRun('show'), th = createOneThumb();
    th.down();
    for (let i = 0; i < 240 * 20 && run.phase !== 'air'; i++) {
      const inp = newInput();
      th.sample(run, false, inp);
      inp.fan = 1;
      stepRun(run, inp);
      expect(th.driving).toBe(false);
    }
    expect(th.pending).toBe(false);
  });
});
