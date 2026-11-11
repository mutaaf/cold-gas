// 0189: a thumb lifted on the climb stops the car on the curl. The coach (and the pointer it feeds) must say
// "stopped on the climb, keep holding to the ledge", not "Never let go · you hung 0 s inverted". A thumb that does
// reach the ledge and hangs there without a tap keeps the old "Never let go" line.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage, THUMB as PAD } from '../../src/onethumb.js';
import { HANG_AT } from '../../src/sim/run.js';
import { wreckCause } from '../../src/obs/signature.js';
import { coach, KEY_WORDS } from '../../src/sim/coach.js';
import { coachWords, pickPointer, pointerText } from '../../src/pointer.js';

// One thumb held from Go. `liftAt` (m): lifted once the car is that high up the curl, never pressed again;
// 'ledge': lifted once it sits still on the ledge (thumbStage 'ledge'), never tapped.
function flyThumb(course, liftAt) {
  const run = createRun(course), th = createOneThumb();
  let released = false, lifted = false;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (!lifted && liftAt !== 'ledge' && run.phase === 'ramp' && c.pos.y - SPEC.comHeight >= liftAt) { th.up(); lifted = true; }
    if (!lifted && liftAt === 'ledge' && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) { th.up(); lifted = true; }
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return run;
}
const THUMB = (course) => ({ device: 'touch', scheme: 'thumb', tier: 'assist', course });
const CLASSIC = (course) => ({ device: 'touch', scheme: 'classic', tier: 'assist', course });
const KEYS = (course) => ({ device: 'key', scheme: 'thumb', tier: 'assist', course });

describe('0189: stopped on the climb is not "never let go"', () => {
  for (const course of ['show', 'wall']) {
    const run = flyThumb(course, 7), card = scoreRun(run.t);
    const items = coach(run.inputLog, course, card, 0, coachWords(THUMB(course))).items;

    it(`${course}: lifted 7 m up the curl, the top fix names the stop and says keep holding to the ledge`, () => {
      expect(run.t.airStartTick).toBe(-1);
      const top = items[0];
      expect(top.id).toBe('stopped-climb');
      expect(top.title).not.toMatch(/Never let go/);
      expect(top.title).toBe('Stopped on the climb');
      const m = top.detail.match(/stopped ([\d.]+) m up the curl/);
      expect(m).not.toBeNull();
      expect(Math.abs(Number(m[1]) - 7)).toBeLessThanOrEqual(1);
      expect(top.detail).not.toMatch(/inverted/);
      expect(top.fix).toBe('Keep holding the pad until you\'re upside down on the ledge.');
    });

    it(`${course}: the NEXT RUN pointer says the same`, () => {
      const p = pickPointer(items, THUMB(course), { card });
      expect(p.id).toBe('stopped-climb');
      expect(p.text).toMatch(/keep holding the pad until you’re upside down/i);
      expect(p.text).not.toMatch(/Let go on the ledge/);
    });

    it(`${course}: classic touch and keys read their own control`, () => {
      const classic = coach(run.inputLog, course, card, 0, coachWords(CLASSIC(course))).items[0];
      expect(classic.fix).toBe('Keep holding GO until you\'re upside down on the ledge.');
      expect(pointerText('stopped-climb', CLASSIC(course))).toMatch(/hold GO until you’re upside down/);
      const keys = coach(run.inputLog, course, card, 0, coachWords(KEYS(course))).items[0];
      expect(keys.fix).toBe('Keep holding ↑ until you\'re upside down on the ledge.');
      expect(coach(run.inputLog, course).items[0].fix).toBe(keys.fix);   // the default words are a keyboard's
      expect(pointerText('stopped-climb', KEYS(course))).toMatch(/hold ↑ until you’re upside down on it/);
      const pad = coach(run.inputLog, course, card, 0, coachWords({ device: 'pad', scheme: 'classic', tier: 'assist', course })).items[0];
      expect(pad.fix).toBe('Keep holding RT until you\'re upside down on the ledge.');
    });

    it(`${course}: a thumb that hangs on the ledge and never taps still reads "Never let go"`, () => {
      const hang = flyThumb(course, 'ledge');
      const top = coach(hang.inputLog, course, scoreRun(hang.t), 0, coachWords(THUMB(course))).items[0];
      expect(top.id).toBe('no-release');
      expect(top.title).toBe('Never let go');
      expect(top.detail).toMatch(/You hung [\d.]+ s inverted but never released\./);
      expect(hang.t.invertedTime).toBeGreaterThan(5);
    });
  }

  it('a car that never reached the Wall is not told how high it climbed', () => {
    const run = createRun('wall');
    const inp = newInput();
    while (run.phase !== 'done') stepRun(run, inp);   // nothing pressed: it never leaves the start
    const top = coach(run.inputLog, 'wall').items[0];
    expect(top.id).toBe('stopped-climb');
    expect(top.detail).toBe('You stopped before the Wall.');
  });

  it('the split is where the pad lets go, and the funnel counts it on its own', () => {
    expect(PAD.tapAt).toBe(HANG_AT);   // "stopped short" is exactly where a tap could not have let go
    expect(wreckCause([{ id: 'stopped-climb' }])).toBe('wreck-climb');
    expect(wreckCause([{ id: 'no-release' }])).toBe('wreck-release');
  });

  it('the keyboard default words name the drive key', () => {
    expect(KEY_WORDS.drive).toBe('↑');
    expect(coachWords(THUMB('show')).drive).toBe('the pad');
    expect(coachWords(CLASSIC('show')).drive).toBe('GO');
    expect(coachWords({ device: 'pad', scheme: 'classic', tier: 'pro' }).drive).toBe('RT');
  });
});
