// The set-down follows the fall it ends (SIM_VERSION 18, ticket 0014). After the 20 m drop the
// reveal braked hard and then spent 2.0 s below 3 m (run 2 ALTITUDE, TELEMETRY); after the kickflip
// it was upright at ≈t0 + 2.2 s and on its wheels by ≈t0 + 3 s, 20–25 m on, just beyond the last
// vehicle (docs/REVEAL_RESEARCH.md §2.1.4, §2.2): no hover after a low stunt.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { LINEUP } from '../../src/sim/courses.js';
import { up, setdownTop, HOVER, profileVy, SETDOWN, createVehicle, step, newInput } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

// Fly a reference: lift-off, the last time it comes roof-up after the roll, the time below 3 m,
// gas and position at the first wheel contact.
function fly(course) {
  const run = createRun(course), ap = createAutopilot(course), u = { x: 0, y: 0, z: 0 };
  let tipped = false, upright = -1, below3 = 0, lift = null, touch = null;
  while (run.phase !== 'done') {
    stepRun(run, ap(run));
    const c = run.car;
    if (run.phase === 'air' && !lift) lift = { x: c.pos.x, z: c.pos.z, gas: c.air };
    if (touch) continue;
    up(c, u);
    if (u.y < 0.5) tipped = true;
    if (tipped && upright < 0 && u.y > 0.95) upright = run.tick;
    if (run.phase === 'air' && c.pos.y - SPEC.comHeight < 3) below3++;
    if (run.t.touchTick >= 0) touch = { x: c.pos.x, z: c.pos.z, gas: c.air };
  }
  return { run, t: run.t, upright, below3: below3 / 240, lift, touch };
}

describe('the set-down follows the fall it ends', () => {
  const lineup = fly('lineup'), wall = fly('wall');

  it('sizes the set-down to the hardest sink of the flight: full after the Wall, a flare after the kickflip', () => {
    expect(setdownTop({ fallPeak: 0 })).toBeLessThan(0.2);
    expect(setdownTop({ fallPeak: 7.5 })).toBeLessThan(0.2);
    expect(setdownTop({ fallPeak: 16 })).toBe(HOVER);
    for (let v = 0; v < 20; v += 0.5) expect(setdownTop({ fallPeak: v + 0.5 })).toBeGreaterThanOrEqual(setdownTop({ fallPeak: v }));
    // Whatever the top, the wheels meet the ground at SETDOWN.
    for (const top of [0.1, 1, HOVER]) expect(-profileVy(0, 5, top)).toBeCloseTo(SETDOWN, 6);
  });

  it('Lineup: upright to wheels ≤ 1.8 s, lift-off to touchdown ≤ 3.8 s, ≤ 30 m airborne (reveal ≈0.8 s, 3.0 s, 20–25 m)', () => {
    const { t, upright, lift, touch } = lineup;
    expect(upright).toBeGreaterThan(t.airStartTick);
    expect((t.touchTick - upright) / 240).toBeLessThanOrEqual(1.8);
    expect((t.touchTick - t.airStartTick) / 240).toBeLessThanOrEqual(3.8);
    expect(Math.hypot(touch.x - lift.x, touch.z - lift.z)).toBeLessThanOrEqual(30);
  });

  it('Lineup: lands inside the 4 m ring of the mark just past the row, soft, on ≤ 130 kg', () => {
    const { t, run, lift, touch } = lineup;
    expect(LINEUP.pad.z).toBeGreaterThan(LINEUP.lineupEnd + 7);   // the 7 m ring clears the row
    expect(LINEUP.pad.z).toBeLessThanOrEqual(29);
    expect(Math.hypot(touch.x - LINEUP.pad.x, touch.z - LINEUP.pad.z)).toBeLessThanOrEqual(4);
    expect(t.sink).toBeLessThanOrEqual(1.5);
    expect(lift.gas - touch.gas).toBeLessThanOrEqual(130);
    const card = scoreRun(run.t);
    expect(card.facts.crashed).toBeFalsy();
    expect(card.categories.landing).toBeGreaterThan(8);
  });

  it('the Wall keeps its telemetry set-down: 1.6–2.4 s below 3 m (run 2: 2.0 s)', () => {
    expect(wall.below3).toBeGreaterThanOrEqual(1.6);
    expect(wall.below3).toBeLessThanOrEqual(2.4);
    expect(wall.t.sink).toBeLessThanOrEqual(1.5);
  });

  it('a slow LAND descent from 4.5 m (peak sink under 8 m/s) flares onto its wheels softly, and the next flight starts from zero', () => {
    const s = createVehicle('lineup');
    s.pos.x = 40; s.pos.z = 40; s.pos.y = 4.5 + SPEC.comHeight;
    const inp = newInput(); inp.assist = 1; inp.level = 1;
    let peak = 0, touchSink = -1;
    for (let i = 0; i < 240 * 8 && touchSink < 0; i++) {
      const vy = s.vel.y;
      step(s, inp);
      if (s.grounded > 0) touchSink = -vy; else peak = Math.max(peak, s.fallPeak);
    }
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThan(8);
    expect(touchSink).toBeGreaterThan(0);
    expect(touchSink).toBeLessThanOrEqual(1.5);
    expect(s.fallPeak).toBe(0);   // on the wheels: the next hop is sized afresh
  });
});
