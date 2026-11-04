// 0140: on one thumb, a thumb off the pad during the roll-out never throws the car long. The thumb holds
// from the tap (as 0139 tells it), then flinches off N ticks later. Before 0140, lifting it mid-roll left
// LAND's roll-out half done: the rate loop stopped the car on its side, the down-jets braking the roll
// pushed it sideways, and it landed up to 21 m off the mark, 17 m over the roofs. Now a roll-out the
// thumb started is finished, and once roof up the fall is Assist's auto-land (an early lift's flight).
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';

// The Show the way main.js flies it on one thumb (as thumb-gas.test.js): hold up the curl, stop on the
// ledge, tap and keep holding, lift `lift` ticks after the tap, and press again `repress` ticks after that.
function flyLift(lift, repress = -1) {
  const run = createRun('show'), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (tapT > 0 && run.tick === tapT + lift) th.up();
    if (tapT > 0 && repress >= 0 && run.tick === tapT + lift + repress) th.down();
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return run;
}
const sound = (f) => { expect(f.crashed).toBe(false); expect(f.contact).toBe(false); };

describe('a thumb off the pad in the roll-out (0140)', () => {
  it('lifted 24–720 ticks after the tap, never pressed again: every flight lands ≤ 8 m from the mark, ≤ 6 m over the roofs, and neighbours agree within 3 m', () => {
    let prev = null;
    for (let lift = 24; lift <= 720; lift += 24) {
      const f = scoreRun(flyLift(lift).t).facts;
      sound(f);
      expect(f.padMiss, `lift at ${lift}`).toBeLessThanOrEqual(8);
      expect(f.clearance, `lift at ${lift}`).toBeGreaterThan(0);
      expect(f.clearance, `lift at ${lift}`).toBeLessThanOrEqual(6);
      if (prev !== null) expect(Math.abs(f.padMiss - prev), `lift at ${lift}`).toBeLessThanOrEqual(3);
      prev = f.padMiss;
    }
  }, 60000);

  it('pressed again 0.25–2 s after the lift, LAND takes over from where the car is: every flight lands ≤ 8 m from the mark', () => {
    for (const repress of [60, 120, 240, 480]) {
      for (let lift = 24; lift <= 720; lift += 48) {
        const f = scoreRun(flyLift(lift, repress).t).facts;
        sound(f);
        expect(f.padMiss, `lift at ${lift}, back on ${repress} later`).toBeLessThanOrEqual(8);
      }
    }
  }, 120000);

  it('the worst flinch before 0140 (lifted 1.25 s after the tap) replays and scores the same on the Worker path', () => {
    const run = flyLift(300), s = scoreRun(run.t);
    expect(s.facts.padMiss).toBeLessThanOrEqual(8);
    const again = scoreRun(simulate(run.inputLog, 'show').t);
    expect(again.total).toBe(s.total);
    expect(again.facts.padMiss).toBe(s.facts.padMiss);
  });
});
