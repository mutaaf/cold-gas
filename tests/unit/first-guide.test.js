// 0248: the first jump taught by playing it (src/guide.js). The reference flight is flown in Node with a hands-off half
// second on the mark first (a newcomer reading the screen), and the guide reads the run each tick as main.js does: one
// hint at a time, each only when its input is due, in flight order, gone once done; Skip and a returning player are
// main.js's (no guide at all), a wreck resumes from the step it missed.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { newInput, up } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { createOneThumb, thumbStage, markOffset, THUMB } from '../../src/onethumb.js';
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
  s.landHeld = inp.level > 0; s.landOn = s.landHeld || c.autoLand > 0; s.computerRolls = false;
  s.aimable = false;
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
    expect(stepsFor('show')[resumeFrom(g)]).toBe('land');   // 0263: not the aim, the step after it
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
    expect(guideWords('aim', 'thumb', 'show')).toBe('Hold, slide to the dot');
    expect(guideWords('aim', 'key', 'show')).toBe('');
    expect(guideWords('', 'thumb', 'show')).toBe('');
    expect(guideWords('go', '', 'show')).toBe('');
  });
});

// 0263: the guided first jump on one thumb, swept the way the critic's probe did (docs/critique/2026-11-14-0955): each
// press timed from its hint's appearance plus a reaction, with and without a press in the air during the roll. The
// situation is main.js guideCue's for the one thumb; the sight is src/thumb-aim.js's. Auto-land takes LAND before the
// roll-out ends, so "Hold to land" is never due; the aim step teaches the slide instead, while the slide can act.
// `obey`: at the aim hint (plus the reaction) the thumb presses and slides onto the sight's dot, re-reading it every
// 0.3 s and moving up to 0.25 s late (tests/unit/thumb-mastery.test.js's late thumb).
const REACTIONS = [0.15, 0.3, 0.5, 0.8, 1.2];
function guidedThumb(course, react, { landPress = false, obey = false } = {}) {
  const run = createRun(course), th = createOneThumb(), g = newGuide(course), s = {};
  const pr = newPrediction(), off = { x: 0, y: 0, m: 0 }, uw = { x: 0, y: 0, z: 0 }, lag = Math.round(react * 240);
  const seen = [], todo = [];
  let released = false, want = null, pend = null, next = 0, at = 0, aimFirst = -1, aimTicks = 0, td = -1;
  while (run.phase !== 'done' && run.tick < 240 * 60) {
    const c = run.car, stage = thumbStage(run, released);
    up(c, uw);
    s.phase = run.phase; s.held = th.held; s.released = released || th.driving || th.pending;
    s.ledge = stage === 'ledge'; s.nearLine = false; s.rising = c.vel.y > 0;
    s.tilted = uw.y < 0.85; s.rolled = Math.abs(run.t.rollAccum) > 0.3; s.rolledOut = Math.abs(run.t.rollAccum) > 5.6;
    s.landHeld = th.landing; s.landOn = th.landing || c.autoLand > 0; s.computerRolls = false;
    s.aimable = true; s.sight = run.phase === 'air' && stage === 'fly' && uw.y > th.aimUy;
    s.aimRoom = c.pos.y - SPEC.comHeight > THUMB.aimFloor + THUMB.aimFade;
    s.slid = s.sight && th.held && (th.aim.x !== 0 || th.aim.y !== 0);   // as main.js guideCue
    const step = guideStep(g, s);
    if (step === 'aim') { aimTicks++; if (aimFirst < 0) aimFirst = run.tick; }
    if (step && seen.at(-1) !== step) {
      seen.push(step);
      if (step === 'go') todo.push([run.tick + lag, 'down']);
      if (step === 'tap') todo.push([run.tick + lag, 'tap']);
      if (step === 'roll') { todo.push([run.tick + 20, 'up']); if (landPress) todo.push([run.tick + lag, 'down']); }
      if (step === 'aim' && obey) todo.push([run.tick + lag, 'aim']);
    }
    for (let i = 0; i < todo.length; i++) {
      const [t, act] = todo[i];
      if (t !== run.tick) continue;
      if (act === 'down') th.down();
      else if (act === 'up') th.up();
      else if (act === 'tap') { th.up(); todo.push([run.tick + 24, 'down'], [run.tick + 48, 'up']); }
      else if (act === 'aim') { if (!th.held) th.down(); want = { x: 0, y: 0 }; next = run.tick; }
    }
    if (want && run.phase === 'air') {
      if (pend && run.tick >= at) { want = pend; pend = null; }
      if (run.tick >= next) {
        predict(c, Math.max(0, c.pos.y - SPEC.comHeight), pr);
        markOffset(c, pr, course, off, th.ref, th.refA, th.canA);
        pend = { x: off.x, y: -off.y }; at = run.tick + Math.min(lag, 60); next = run.tick + 72;
      }
      th.move(want.x, want.y);
    }
    const inp = newInput();
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
    if (td < 0 && run.phase === 'landed') td = run.tick;
  }
  return { seen, g, card: scoreRun(run.t), aimLead: aimFirst < 0 ? 0 : (td - aimFirst) / 240, aimOn: aimTicks / 240 };
}
const landBit = (g) => g.done & (1 << g.steps.indexOf('land'));

describe('the first-jump guide teaches the slide (0263)', () => {
  it('Show, one thumb: the aim hint shows on every swept thumb, ≥ 1 s before touchdown; a thumb that obeys it lands ≤ 2 m from the mark and scores no less; one that ignores it still sticks it', () => {
    let near = 0;
    for (const react of REACTIONS) for (const landPress of [true, false]) {
      const label = `${react} s${landPress ? ', pressed in the roll' : ''}`;
      const ignore = guidedThumb('show', react, { landPress });
      expect(ignore.seen, label).toEqual(['go', 'keep', 'tap', 'roll', 'aim']);
      expect(ignore.aimOn, label).toBeGreaterThanOrEqual(1);   // up the whole time it can act: ≈ 2.3 s
      expect(ignore.aimLead, label).toBeGreaterThanOrEqual(1);
      expect(ignore.card.facts.crashed, label).toBe(false);
      expect(ignore.card.verdict, label).toBe('Stuck it');
      // Hands off in the air, auto-land took LAND: the landing wasn't taught (a wreck from here picks up at it). A thumb
      // pressed in the roll held LAND itself.
      expect(landBit(ignore.g) !== 0, label).toBe(landPress);
      const obey = guidedThumb('show', react, { landPress, obey: true });
      expect(obey.seen, label).toEqual(['go', 'keep', 'tap', 'roll', 'aim']);
      expect(obey.g.shown, label).toBe('');
      expect(obey.card.facts.crashed, label).toBe(false);
      expect(obey.card.total, label).toBeGreaterThanOrEqual(ignore.card.total);
      if (obey.card.facts.padMiss <= 2) near++;
      expect(obey.card.facts.padMiss, label).toBeLessThan(ignore.card.facts.padMiss - 2);
    }
    expect(near).toBeGreaterThanOrEqual(8);   // the ticket's bar (today: 10/10, 0.7–1.7 m)
  }, 120000);

  it('the Wall has no aim step (its slide up or down doesn\'t pay yet), and still flies go, keep, tap, roll', () => {
    for (const react of [0.15, 0.8]) {
      const r = guidedThumb('wall', react);
      expect(r.seen, `${react} s`).toEqual(['go', 'keep', 'tap', 'roll']);
      expect(r.aimOn).toBe(0);
      expect(r.card.facts.crashed).toBe(false);
    }
  }, 60000);

  it('keys have no aim step, and auto-land doesn\'t count as the landing taught', () => {
    const { seq, g } = fly('show');
    expect(seq).not.toContain('aim');
    expect(g.done & (1 << g.steps.indexOf('aim'))).not.toBe(0);   // not theirs: done, never due
    // The reference holds LAND (the player's) from the release: taught.
    expect(landBit(g)).not.toBe(0);
    // Auto-land alone, hands off in the air: not.
    const h = newGuide('show'), s = { phase: 'air', rising: false, tilted: false, landOn: true, landHeld: false, aimable: false };
    expect(guideStep(h, s)).toBe('');
    expect(landBit(h)).toBe(0);
    s.landHeld = true;
    guideStep(h, s);
    expect(landBit(h)).not.toBe(0);
  });

  it('the aim hint is due only while the sight is up and the slide can act, and goes once the held thumb slides', () => {
    const g = newGuide('show', stepsFor('show').indexOf('aim'));
    const s = { phase: 'air', rising: false, tilted: false, landOn: true, landHeld: false, aimable: true, sight: false, aimRoom: true, slid: false };
    expect(guideStep(g, s)).toBe('');           // roof not up yet: no sight
    s.sight = true;
    expect(guideStep(g, s)).toBe('aim');
    s.held = true;
    expect(guideStep(g, s)).toBe('aim');        // held, not slid: still asks for the slide
    s.aimRoom = false;
    expect(guideStep(g, s)).toBe('');           // below the slide's floor: nothing to ask
    s.aimRoom = true; s.slid = true;
    expect(guideStep(g, s)).toBe('');
    s.slid = false;
    expect(guideStep(g, s)).toBe('');           // done: never again this run
  });

  it('a held thumb that drifts on the run-up or in the roll hasn\'t done the aim (review)', () => {
    const g = newGuide('show', stepsFor('show').indexOf('roll'));
    const s = { phase: 'air', rising: false, tilted: true, landOn: true, landHeld: true, aimable: true, sight: false, aimRoom: true, slid: true, held: true };
    guideStep(g, s);   // still rolling, the thumb slid past the dead zone: no sight, not the lesson
    s.tilted = false; s.sight = true; s.slid = false;
    expect(guideStep(g, s)).toBe('aim');
  });

  it('a wreck with the landing held but the aim undone resumes at the landing, not the aim (review)', () => {
    const g = newGuide('show');
    g.done = (1 << stepsFor('show').indexOf('aim')) - 1;   // go … land done, aim not
    expect(stepsFor('show')[resumeFrom(g)]).toBe('land');
    expect(wreckLine(g)).toBe('Hold sooner to land');
  });
});
