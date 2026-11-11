// 0188: on one thumb, a press in the air once Assist's auto-land flies changes nothing but the aim, so the pad
// stops asking for it ("Hold · Land", the amber pulse) and names what the hold does: the slide ("Aim").
// The flights here are the ones thumb-mastery.test.js flies: hold up the curl, stop on the ledge, a short tap,
// lift 20 ticks later, press again N s after the tap, no slide.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';
import { padState, padWords, THUMB_WORDS } from '../../src/thumb-words.js';

// `again`: s after the tap the thumb presses again (−1: never). Records the first tick auto-land flies, and the pad's
// state (worst case: the band never green) on every air tick with the thumb as it is.
function flyTapped(course, again = -1) {
  const run = createRun(course), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1, autoAt = -1;
  const pads = [];
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (tapT > 0 && run.tick === tapT + 20) th.up();
    if (again >= 0 && tapT > 0 && run.tick === tapT + Math.round(again * 240)) th.down();
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
    if (autoAt < 0 && run.car.autoLand) autoAt = run.tick;
    const stage = thumbStage(run, released);
    if (stage === 'fly' && run.phase === 'air') {
      pads.push({ auto: run.car.autoLand, landing: th.landing, held: th.held,
        ...padState({ stage, held: th.held, landing: th.landing, autoLand: run.car.autoLand, green: false }) });
    }
  }
  const s = scoreRun(run.t);
  return { run, tapT, autoAt, pads, end: { x: run.car.pos.x, z: run.car.pos.z, gas: run.car.air, total: s.total } };
}

describe('one thumb: a LAND press once auto-land flies changes nothing (0188)', () => {
  for (const course of ['show', 'wall']) {
    it(`${course}: pressed again at every 0.1 s from 1.2 to 2.5 s after the tap, the end state is never pressing's`, () => {
      const never = flyTapped(course);
      expect(never.tapT).toBeGreaterThan(0);
      expect(never.autoAt).toBeGreaterThan(never.tapT);
      // Auto-land is flying by 1.2 s after the tap (critique 2026-11-10: 1.17 s on the Show, 1.19 s on the Wall).
      expect(never.autoAt - never.tapT).toBeLessThanOrEqual(Math.round(1.2 * 240));
      for (let k = 12; k <= 25; k++) {
        const f = flyTapped(course, k / 10);
        expect(f.end, `${course} pressed at ${k / 10} s`).toEqual(never.end);
      }
    });

    it(`${course}: once auto-land flies, the pad never says Land and never pulses; before, it asks as it did`, () => {
      const never = flyTapped(course);
      const after = never.pads.filter((p) => p.auto), before = never.pads.filter((p) => !p.auto && !p.held && !p.landing);
      expect(after.length).toBeGreaterThan(100);
      expect(before.length).toBeGreaterThan(0);
      for (const p of after) { expect(p.warn).toBe(false); expect(padWords(p.word)[1]).not.toBe('Land'); }
      for (const p of before) { expect(p.warn).toBe(true); expect(padWords(p.word)).toEqual(['Hold', 'Land']); }
      // Pressed again after auto-land: the held pad reads "Slide · Aim", never Land.
      const pressed = flyTapped(course, 1.5);
      const held = pressed.pads.filter((p) => p.held);
      expect(held.length).toBeGreaterThan(0);
      for (const p of held) { expect(padWords(p.word)).toEqual(['Slide', 'Aim']); expect(p.warn).toBe(false); }
    });
  }
});

describe('the pad\'s word and warn as a pure decision (0188)', () => {
  const W = (o) => padState({ stage: 'fly', ...o });
  for (const lineup of [false, true]) {
    for (const held of [false, true]) {
      for (const green of [false, true]) {
        it(`${lineup ? 'lineup' : 'show/wall'}, ${held ? 'held' : 'not held'}, band ${green ? 'green' : 'off green'}`, () => {
          const base = { held, green, lineup, rolled: true };
          // Auto-land flying, or the thumb held LAND once: calm, and the words name the aim.
          for (const on of [{ autoLand: 1 }, { landing: true }]) {
            const p = W({ ...base, ...on });
            expect(p.warn).toBe(false);
            expect(padWords(p.word, lineup)).toEqual(held ? ['Slide', 'Aim'] : ['Hold', 'Aim']);
          }
          // Before LAND flies: as before 0188 (Hold · Land, amber while off green and not held).
          const p = W({ ...base, autoLand: 0, landing: false });
          expect(p.warn).toBe(!held && !green);
          expect(padWords(p.word, lineup)).toEqual(held ? ['Slide', 'Aim'] : ['Hold', 'Land']);
        });
      }
    }
  }
  it('the climb, the ledge, the drive-off and the Lineup\'s kickflip keep their words', () => {
    expect(padWords(padState({ stage: 'climb', held: true }).word)).toEqual(['Holding', 'Climb']);
    expect(padWords(padState({ stage: 'climb' }).word)).toEqual(['Hold', 'Climb']);
    expect(padWords(padState({ stage: 'ledge' }).word)).toEqual(['Tap', 'Let go']);
    const going = padState({ stage: 'ledge', going: true });
    expect(padWords(going.word)).toEqual(['Letting', 'Go']);
    expect(going.stage).toBe('going');
    expect(padWords(padState({ stage: 'climb', held: true, lineup: true }).word, true)).toEqual(['Holding', 'Drive']);
    expect(padWords(padState({ stage: 'climb', lineup: true, lifting: true, airborne: true }).word, true)).toEqual(['', 'Lifting']);
    const roll = padState({ stage: 'fly', lineup: true, lifting: true, airborne: true, rolling: true, green: false });
    expect(padWords(roll.word, true)).toEqual(['', 'Rolling']);
    expect(roll.warn).toBe(false);   // the computer's roll
    expect(padWords(padState({ stage: 'landed' }).word)).toEqual(['', 'Stopping']);
  });
  it('no word in the air reads Land once LAND flies, and out is reused', () => {
    expect(Object.entries(THUMB_WORDS).filter(([, [, a]]) => a === 'Land').map(([k]) => k)).toEqual(['fly']);
    const out = { word: '', stage: '', warn: false };
    expect(padState({ stage: 'fly', autoLand: 1 }, out)).toBe(out);
  });
});
