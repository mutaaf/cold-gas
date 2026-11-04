// 0145: the reveal's car hung still under the ledge for ≈ 10 s (docs/REVEAL_RESEARCH.md §2.1, rows 24–30,
// TELEMETRY). Before 0145 a car stopped on the deck for 6 s ended `stalled`, the aftermath cut the fan like a
// crash and the car fell 26 m, and the HUD called it CRASH: a newcomer who kept the thumb down on the ledge
// (what "hold to climb" tells them) got a 22. Now a fan-held hang on the ledge may last 20 s; a stall lower
// on the curl still ends at 6 s, and a `stalled` end keeps the fan on, so the car stays where it stopped.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, armAftermath, aftermathStep, HANG_STALL_TICKS, STALL_TICKS } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';
import { crashStep } from '../../src/ui.js';

const speedOf = (c) => Math.hypot(c.vel.x, c.vel.y, c.vel.z);

// The one-thumb Show as main.js flies it (thumb-lift.test.js's harness): the thumb goes down at the start and
// stays down up the curl. On the ledge, once the car stops, it stays down `holdS` more seconds (Infinity: never
// lifted), then lifts for 0.3 s and taps, and holds to the ground (0139).
function flyHang(holdS, { arm = false } = {}) {
  const run = createRun('show'), th = createOneThumb();
  if (arm) armAftermath(run);
  let released = false, stopT = -1, liftT = -1;
  const hold = Number.isFinite(holdS) ? Math.round(holdS * 240) : Infinity;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (liftT < 0 && stopT < 0 && thumbStage(run, released) === 'ledge' && speedOf(c) < 0.3) stopT = run.tick;
    if (stopT >= 0 && liftT < 0 && run.tick === stopT + hold) { th.up(); liftT = run.tick; }
    if (liftT >= 0 && run.tick === liftT + 72) th.down();
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return { run, stopT };
}

describe('a still hang under the ledge (0145)', () => {
  it('held 6, 10, 15 and 19 s after the car stops, then tapped: every flight lands, none stalls, within 1.0 of the 0 s hold', () => {
    const base = scoreRun(flyHang(0).run.t);
    expect(base.facts.crashed).toBe(false);
    for (const w of [6, 10, 15, 19]) {
      const { run } = flyHang(w), s = scoreRun(run.t);
      expect(run.t.endReason, `${w} s`).not.toBe('stalled');
      expect(s.facts.crashed, `${w} s`).toBe(false);
      expect(s.facts.jumped, `${w} s`).toBe(true);
      expect(Math.abs(s.total - base.total), `${w} s: ${s.total} vs ${base.total}`).toBeLessThanOrEqual(1.0);
    }
  }, 180000);

  it('held forever: ends `stalled` no sooner than 20 s still on the ledge; the timeline says Stalled, never Crash, and the car stays put', () => {
    expect(HANG_STALL_TICKS).toBeGreaterThanOrEqual(240 * 20);
    const { run, stopT } = flyHang(Infinity, { arm: true });
    expect(run.t.endReason).toBe('stalled');
    expect(run.offTicks).toBeGreaterThanOrEqual(240 * 20);   // stationary (< 0.5 m/s) on the deck that long
    expect(run.t.endTick - stopT).toBeGreaterThanOrEqual(240 * 20 - 24);   // (stopT waits for < 0.3 m/s)
    const s = scoreRun(run.t);
    expect(crashStep(s)).toBe('Stalled');
    // The aftermath keeps the fan and the brakes: no 26 m fall.
    const c = run.car, at = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
    let n = 0;
    while (!aftermathStep(run) && n < 240 * 10) n++;
    expect(Math.hypot(c.pos.x - at.x, c.pos.y - at.y, c.pos.z - at.z)).toBeLessThanOrEqual(0.5);
  }, 120000);

  it('a car stopped low on the curl (progress < 0.92) still ends `stalled` at 6 s', () => {
    expect(STALL_TICKS).toBe(240 * 6);
    // Crawl up the deck with the fan on, then stop part-way: no throttle, brakes on.
    const run = createRun('show');
    let stopT = -1;
    while (run.phase !== 'done' && run.tick < 240 * 60) {
      const inp = newInput();
      inp.fan = 1;
      const climbing = run.phase !== 'ramp' || run.t.progress < 0.5;
      if (climbing) inp.throttle = run.phase === 'ramp' ? 0.35 : 0.6;
      else inp.brake = 1;
      if (!climbing && stopT < 0 && speedOf(run.car) < 0.5) stopT = run.tick;
      stepRun(run, inp);
    }
    expect(run.t.endReason).toBe('stalled');
    expect(run.t.progress).toBeLessThan(0.92);
    expect(run.t.endTick - stopT).toBeLessThan(240 * 6 + 10);
    expect(run.offTicks).toBeGreaterThan(240 * 6);   // and no sooner
    expect(run.offTicks).toBeLessThanOrEqual(240 * 6 + 1);
    expect(crashStep(scoreRun(run.t))).toBe('Stalled');
  }, 120000);
});
