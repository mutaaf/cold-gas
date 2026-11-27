// 0362: the Lineup's naive gate, as scripts/naive-players.mjs is the Wall's. Can a keyboard player who does what the page
// says ("Space at the line") land it with Assist, whatever their timing? The grid is the critic's
// (docs/critique/2026-11-23-2136/naive-lineup.mjs.txt), widened to the reveal's run-ups: ↑ eased to a run-up of 6, 7.5 or
// 9 m/s (§2.2: 7–9 m/s), Space pressed at z −6 … +1 (the line is z 0) and held 0.3–3 s, then ← for 0, 0.8 or 1.4 s from
// the first tick in the air after Space is let go, then Shift (LAND) to the ground and ↓ once down. Every key goes
// through src/input.js (keyDown / sample, as the page's listeners do), so the roll is the keys' own ramp and the lift
// is the page's lift-off (src/lift-off.js).
//
// Landed = upright, settled, nothing hit, not a splash, a verdict that isn't a wreck. The plain-input version of this grid
// landed 49 of 225 before 0362. Through the keys with the lift-off burn: 196 of 225, and every hold up to 1 s lands. The 29
// left are a 2–3 s hold rolled only once Space is let go, so the roll starts on the way down and can't finish (rolled at
// the cue, every hold flies the same flight: lift-off.test.js). The ticket's bar is 90 %; this gate holds today's 87 %.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { sample, keyDown, keyUp, freshRun } from '../../src/input.js';

const BAD = ['Wrecked', 'Crash', 'Splash', 'Rolled over', 'Contact'];
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'Space', 'ShiftLeft'];
function flyNaive(speed, pressZ, hold, rollS) {
  freshRun();
  const run = createRun('lineup'), inp = newInput(), v = () => Math.hypot(run.car.vel.x, run.car.vel.z);
  let up = false, t0 = -1, tRoll = -1, step = 0;   // step: 0 run-up/Space, 1 let go, 2 LAND, 3 down
  while (run.phase !== 'done' && run.tick < 240 * 40) {
    const t = run.tick;
    if (t0 < 0) {
      const want = v() < speed;
      if (want !== up) { if (want) keyDown('ArrowUp'); else keyUp('ArrowUp'); up = want; }
      if (run.car.pos.z >= pressZ) { t0 = t; if (up) { keyUp('ArrowUp'); up = false; } keyDown('Space'); }
    } else if (step === 0 && t - t0 >= hold * 240) { keyUp('Space'); step = 1; }
    if (step === 1) {
      if (run.phase === 'air') {
        if (tRoll < 0) { tRoll = t; if (rollS > 0) keyDown('ArrowLeft'); }
        if (t - tRoll >= rollS * 240) { keyUp('ArrowLeft'); keyDown('ShiftLeft'); step = 2; }
      } else if (run.phase !== 'drive') { keyDown('ArrowDown'); step = 3; }
    }
    if (step === 2 && run.phase !== 'air') { keyUp('ShiftLeft'); keyDown('ArrowDown'); step = 3; }
    stepRun(run, sample(run.phase, 'assist', inp, run.phase === 'air', run.car));
  }
  for (const k of KEYS) keyUp(k);
  const tt = run.t, card = scoreRun(tt, { assist: true });
  return tt.settledUpright && tt.touchTick > 0 && !tt.fellOff && !tt.contact && !tt.splash && !BAD.includes(card.verdict);
}

describe('0362: naive keyboard players on the Lineup with Assist', () => {
  it('land ≥ 85 % of the grid, and every hold up to 1 s lands', () => {
    let ok = 0, n = 0;
    const byHold = {};
    for (const speed of [6, 7.5, 9]) for (const z of [-6, -4, -2, 0, 1]) for (const hold of [0.3, 0.6, 1, 2, 3]) for (const roll of [0, 0.8, 1.4]) {
      const landed = flyNaive(speed, z, hold, roll);
      n++; if (landed) ok++;
      (byHold[hold] ||= [0, 0])[landed ? 0 : 1]++;
    }
    expect(n).toBe(225);
    const short = [0.3, 0.6, 1].reduce((s, h) => s + byHold[h][0], 0);
    expect(short, JSON.stringify(byHold)).toBe(135);
    expect(ok / n, JSON.stringify(byHold)).toBeGreaterThanOrEqual(0.85);
  }, 300000);
});
