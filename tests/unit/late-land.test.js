// A player who presses LAND late still lands (ticket 0067, SIM_VERSION 26). From the Show reference's
// release state, a pilot who lets go of everything and presses LAND only when the floor is 8 m or
// 4 m over the pad (and a person's 0.3 s after that) can't be stopped by the brake alone: at 4 m the
// car is falling ≈19 m/s, 0.2 s from the concrete. Assist's auto-land starts LAND at the last moment
// the stop still fits, and the carry over the row takes it past the roofs first.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { newInput } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

function lateLand(landAt, { assist = 1, lag = 0.3 } = {}) {
  const run = createRun('show'), ap = createAutopilot('show');
  while (run.phase !== 'air') stepRun(run, ap(run));
  let seen = -1, autoTick = -1;
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    inp.assist = assist;
    if (seen < 0 && c.pos.y - SPEC.comHeight < landAt) seen = run.tick;
    if (seen >= 0 && run.tick - seen >= lag * 240) inp.level = 1;
    if (autoTick < 0 && c.autoLand) autoTick = run.tick;
    if (run.phase === 'landed') inp.brake = 1;
    stepRun(run, inp);
  }
  return { t: run.t, autoTick, seen };
}

describe('a late LAND still lands (Assist)', () => {
  for (const h of [8, 4]) {
    it(`LAND pressed at ${h} m over the pad: touches down < 3 m/s, clear of the row`, () => {
      const { t, autoTick, seen } = lateLand(h);
      expect(t.touchTick).toBeGreaterThan(0);
      expect(t.contact).toBe(false);
      expect(t.flipped).toBeFalsy();
      expect(t.sink).toBeLessThan(3);
      // The computer started it, before the player did.
      expect(autoTick).toBeGreaterThan(0);
      expect(autoTick).toBeLessThan(seen);
    });
  }

  it('Pro has no auto-land: the same late LIFT-less flight hits hard', () => {
    const { t, autoTick } = lateLand(4, { assist: 0 });
    expect(autoTick).toBe(-1);
    expect(t.contact || t.sink > 6).toBe(true);
  });
});
