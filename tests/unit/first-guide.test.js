// 0248: the first jump taught by playing it (src/guide.js). The reference flight is flown in Node with a hands-off half
// second on the mark first (a newcomer reading the screen), and the guide reads the run each tick as main.js does: one
// hint at a time, each only when its input is due, in flight order, gone once done; Skip and a returning player are
// main.js's (no guide at all), a wreck resumes from the step it missed.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { newInput } from '../../src/sim/vehicle.js';
import { newGuide, guideStep, guideWords, guideMode, resumeFrom, wreckLine, stepsFor } from '../../src/guide.js';

// The situation main.js builds for keys and a pad (the one thumb reads the same moments off the pad).
function situation(run, inp, st, s = {}) {
  const c = run.car, lineup = run.course === 'lineup';
  if (!lineup && ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air')) st.released = true;
  if (lineup && run.phase === 'air') st.released = true;
  s.phase = run.phase; s.held = inp.throttle > 0; s.released = st.released;
  s.ledge = !lineup && run.phase === 'ramp' && run.t.progress >= 0.92;
  s.nearLine = lineup && c.pos.z > -14; s.rising = c.vel.y > 0;
  s.tilted = !lineup && 1 - 2 * (c.quat.x * c.quat.x + c.quat.z * c.quat.z) < 0.85;
  s.rolled = Math.abs(run.t.rollAccum) > 0.3; s.rolledOut = Math.abs(run.t.rollAccum) > 5.6;
  s.landOn = inp.level > 0 || c.autoLand > 0; s.computerRolls = false;
  return s;
}
function fly(course, { from = 0, stopAt = Infinity } = {}) {
  const run = createRun(course), ap = createAutopilot(course), g = newGuide(course, from), idle = newInput();
  const seq = [], st = { released: false }, s = {};
  while (run.phase !== 'done' && run.tick < stopAt) {
    const inp = run.tick < 120 ? idle : ap(run);
    stepRun(run, inp);
    const step = guideStep(g, situation(run, inp, st, s));
    if (step && seq.at(-1) !== step) seq.push(step);
  }
  return { seq, g };
}
const inOrder = (seq, steps) => seq.every((x, i) => i === 0 || steps.indexOf(x) > steps.indexOf(seq[i - 1]));

describe('the first-jump guide', () => {
  for (const course of ['show', 'wall']) {
    it(`${course}: go, keep, tap, roll, land, in flight order, each once`, () => {
      const { seq, g } = fly(course);
      expect(seq[0]).toBe('go');
      expect(seq).toEqual(expect.arrayContaining(['go', 'keep', 'tap']));   // the reference holds LAND from the release: no roll or land hint is due
      expect(inOrder(seq, stepsFor(course))).toBe(true);
      expect(new Set(seq).size).toBe(seq.length);
      expect(g.shown).toBe('');   // nothing left on screen at the end
    });
  }
  it('the Lineup on keys: go, the line, the roll, in order', () => {
    const { seq } = fly('lineup');
    expect(seq[0]).toBe('go');
    expect(seq).toEqual(expect.arrayContaining(['go', 'line']));
    expect(inOrder(seq, stepsFor('lineup'))).toBe(true);
  });
  it('a later attempt starts where the last one missed', () => {
    const cut = fly('show', { stopAt: 1200 });   // 5 s in, still climbing: it stopped short of the ledge
    const from = resumeFrom(cut.g);
    expect(stepsFor('show')[from]).toBe('keep');
    expect(wreckLine(cut.g)).toBe('Hold all the way up');
    const again = fly('show', { from });
    expect(again.seq[0]).toBe('keep');
    expect(again.seq).not.toContain('go');
    expect(again.seq).toContain('tap');
  });
  it('a run that did every step and still came down hard is told about the landing', () => {
    const g = newGuide('show');
    g.done = (1 << stepsFor('show').length) - 1;
    expect(stepsFor('show')[resumeFrom(g)]).toBe('land');
    expect(wreckLine(g)).toBe('Hold sooner to land');
  });
  it('speaks each device’s controls in five words or fewer, and only on one thumb, keys and a pad', () => {
    expect(guideMode({ device: 'touch', scheme: 'thumb' })).toBe('thumb');
    expect(guideMode({ device: 'touch', scheme: 'classic' })).toBe('');
    expect(guideMode({ device: 'key' })).toBe('key');
    expect(guideMode({ device: 'pad' })).toBe('pad');
    expect(guideWords('go', 'thumb', 'show')).toBe('Hold to go');
    expect(guideWords('tap', 'key', 'wall')).toBe('Space to let go');
    expect(guideWords('land', 'pad', 'show')).toBe('Hold B to land');
    expect(guideWords('roll', 'key', 'lineup')).toBe('← → to roll');
    for (const mode of ['thumb', 'key', 'pad']) for (const course of ['show', 'lineup']) for (const step of stepsFor(course)) {
      const w = guideWords(step, mode, course);
      expect(w.split(/\s+/).filter(Boolean).length, `${mode} ${step}`).toBeLessThanOrEqual(5);
    }
    expect(guideWords('', 'thumb', 'show')).toBe('');
    expect(guideWords('go', '', 'show')).toBe('');
  });
});
