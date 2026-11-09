// 0174 (critique 2026-11-09-1540 §2): on the Show the sight's along-the-run dot arrived in one frame when the slide
// could start to act along the run (`canA`): 0 → 13.9 px on a thumb held from the tap, 0 → 8.6 px on one pressed
// again 1 s after it. The pad now draws the dot gliding onto the target (`glideStep`, src/thumb-aim.js) while
// `data-ey` keeps the target, so scripts read what the control measures. The sim, markOffset and the log are untouched.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput, up } from '../../src/sim/vehicle.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { createOneThumb, thumbStage, markOffset } from '../../src/onethumb.js';
import { glideStep, newGlide, GLIDE_JUMP, GLIDE_VMAX } from '../../src/thumb-aim.js';

const FRAME = 1 / 60;

// The Show the way main.js flies it on one thumb (thumb-mastery.test.js's flyThumb, no slide): held from the tap, or
// lifted 20 ticks after it and pressed again `again` s after it. Returns the sight's target y per 60 Hz frame while
// the pad draws it (src/thumb-aim.js: in the air, roof up past the thumb's aimUy), and the frame `canA` opened.
function targetSeries(again = -1) {
  const run = createRun('show'), th = createOneThumb(), pr = newPrediction(), off = { x: 0, y: 0, m: 0 }, uw = { x: 0, y: 0, z: 0 };
  let released = false, ledgeT = -1, tapT = -1, wasA = false, openAt = -1;
  const ys = [];
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (again >= 0 && tapT > 0) {
      if (run.tick === tapT + 20) th.up();
      if (run.tick === tapT + Math.round(again * 240)) th.down();
    }
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
    if (run.tick % 4 === 0 && run.phase === 'air') {
      up(run.car, uw);
      if (uw.y > th.aimUy) {
        predict(run.car, Math.max(0, run.car.pos.y - SPEC.comHeight), pr);
        markOffset(run.car, pr, 'show', off, th.ref, th.refA, th.canA);
        if (th.canA && !wasA && openAt < 0) openAt = ys.length;
        ys.push(off.y);
      } else if (ys.length) ys.push(NaN);   // the sight goes out: the pad hides it
      wasA = th.canA;
    }
  }
  return { ys, openAt };
}

// Feeds a target series to the glide as the pad does (a NaN frame hides the sight; it reappears on its target).
function drawn(ys, dt = FRAME) {
  const g = newGlide(), out = [];
  for (const t of ys) {
    if (t !== t) { g.on = false; out.push(NaN); continue; }
    out.push(glideStep(g, t, dt));
  }
  return out;
}

// Every frame: ≤ 3 px a 60 Hz frame, never past the target, never the opposite way to it.
function expectGlides(ys, shown, label) {
  for (let i = 1; i < ys.length; i++) {
    if (shown[i] !== shown[i] || shown[i - 1] !== shown[i - 1]) continue;
    const step = shown[i] - shown[i - 1], toward = ys[i] - shown[i - 1];
    if (Math.abs(ys[i] - ys[i - 1]) > GLIDE_JUMP || Math.abs(step) > GLIDE_JUMP) {
      expect(Math.abs(step), `${label} frame ${i}: ${shown[i - 1].toFixed(2)} → ${shown[i].toFixed(2)} (target ${ys[i].toFixed(2)})`).toBeLessThanOrEqual(GLIDE_JUMP);
    }
    if (step !== 0) expect(Math.sign(step), `${label} frame ${i}: moved away from the target`).toBe(Math.sign(toward));
    expect(Math.abs(step), `${label} frame ${i}: overshot`).toBeLessThanOrEqual(Math.abs(toward) + 1e-9);
  }
}

// From frame `at`, how long until the drawn dot sits on the target (rounded to the pad's pixel) and stays there
// while the target holds still to within a pixel a frame.
function settle(ys, shown, at) {
  for (let i = at; i < ys.length; i++) if (Math.abs(shown[i] - ys[i]) < 0.5) return (i - at) * FRAME;
  return Infinity;
}

describe('the sight glides its along-the-run dot onto the target (0174)', () => {
  it('a 13.9 px step: ≤ 3 px a frame, on the target within 0.25 s, no overshoot', () => {
    const ys = [0, 0, 0, ...Array(40).fill(13.9)], shown = drawn(ys);
    expectGlides(ys, shown, 'step');
    expect(settle(ys, shown, 3)).toBeLessThanOrEqual(0.25);
    expect(Math.max(...shown)).toBeLessThanOrEqual(13.9);
    expect(shown[3]).toBeGreaterThan(0);   // it starts to move at once
  });

  it('the held Show flight: the target jumps when canA opens, the drawn dot glides', () => {
    const { ys, openAt } = targetSeries();
    expect(openAt, 'canA opens in the sight').toBeGreaterThan(0);
    const jump = ys[openAt] - ys[openAt - 1];
    expect(Math.abs(jump), 'the jump the critic measured (0 → 13.9 px)').toBeGreaterThan(GLIDE_JUMP * 3);
    const shown = drawn(ys);
    expectGlides(ys, shown, 'held');
    expect(settle(ys, shown, openAt)).toBeLessThanOrEqual(0.25);
  });

  it('the tapped Show flights (pressed again 1, 1.5, 2.5 s): every frame glides, none jumps', () => {
    for (const again of [1, 1.5, 2.5]) {
      const { ys, openAt } = targetSeries(again);
      expect(openAt, `again ${again} s`).toBeGreaterThan(0);
      const shown = drawn(ys);
      expectGlides(ys, shown, `again ${again} s`);
      for (let i = 1; i < ys.length; i++) if (Math.abs(ys[i] - ys[i - 1]) > GLIDE_JUMP && shown[i] === shown[i] && shown[i - 1] === shown[i - 1]) {
        expect(settle(ys, shown, i), `again ${again} s, frame ${i}`).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it('a target that moves ≤ 3 px a frame is drawn where it is (a thumb on the dot follows it as before)', () => {
    const ys = Array.from({ length: 60 }, (_, i) => 10 * Math.sin(i / 10)), shown = drawn(ys);
    for (let i = 0; i < ys.length; i++) expect(shown[i]).toBeCloseTo(ys[i], 9);
  });

  it('the sight coming on draws the dot on its target, and a target that turns back mid-glide is never left behind', () => {
    const g = newGlide();
    expect(glideStep(g, 20, FRAME)).toBe(20);   // first frame: no glide from nowhere
    const ys = [20, 20, 0, 0, 0, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12];
    const h = newGlide(), shown = ys.map((t) => glideStep(h, t, FRAME));
    expectGlides(ys, shown, 'turn back');
    expect(shown.at(-1)).toBe(12);
  });

  it('a long frame (back from a pause) draws the target; a stalled one holds; a NaN target never sticks', () => {
    const g = newGlide();
    glideStep(g, 0, FRAME);
    const a = glideStep(g, 40, 0.1);   // the longest frame that still glides: one bounded step
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(GLIDE_VMAX * 0.1 + 1e-9);
    expect(glideStep(g, 40, 0)).toBe(a);   // no time passed: no move
    expect(glideStep(g, 40, 0.5)).toBe(40);   // a 0.5 s gap: the dot is where the target is
    const n = newGlide();
    glideStep(n, 0, FRAME); glideStep(n, 14, FRAME);
    expect(glideStep(n, NaN, FRAME)).toBeNaN();
    expect(glideStep(n, 14, FRAME)).toBe(14);   // the next good frame draws the target, not NaN for the rest of the flight
    for (let i = 0; i < 20; i++) expect(Number.isFinite(glideStep(n, 14 + i, FRAME))).toBe(true);
  });
});
