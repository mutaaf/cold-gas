// 0133: the descent band is green on a descent that lands soft. Amber is the caution colour: it means this
// descent, flown on as it is, lands firmer than SINK_SOFT, or the stop hasn't started and has to start within
// WARN s. A brake already lifting on a plan that sets down soft is nominal. Read the way the HUD reads it:
// `predict` + `steadyStatus` every air tick, height = pos.y − comHeight. Not scored: predict.js never changes a run.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput, createVehicle, step } from '../../src/sim/vehicle.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { predict, newPrediction, newBand, steadyStatus, SINK_SOFT } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';

const hOf = (c) => Math.max(0, c.pos.y - SPEC.comHeight);

// Every air tick before the touchdown: the steady band, the height and whether the car is roof up.
function watch() {
  const pr = newPrediction(), band = newBand(), ticks = [];
  return {
    ticks,
    // `inp`: this tick's input, so LAND reads engaged the way main.js passes it (held, or auto-land, in Assist).
    see(run, inp) {
      if (run.phase !== 'air') return;
      const c = run.car, h = hOf(c);
      predict(c, h, pr, inp.assist > 0 && (inp.level > 0 || c.autoLand > 0));
      ticks.push({ s: steadyStatus(band, pr, run.tick / 240), h, up: pr.upY >= 0.85 });
    },
  };
}
// Share of the air ticks after the car is first roof up that read green.
function greenAfterUp(ticks) {
  const i = ticks.findIndex((t) => t.up);
  const after = ticks.slice(i);
  return after.filter((t) => t.s === 'green').length / after.length;
}

function flyReference() {
  const run = createRun('show'), ap = createAutopilot('show'), w = watch();
  while (run.phase !== 'done') { const inp = ap(run); w.see(run, inp); stepRun(run, inp); }
  return { run, ticks: w.ticks };
}

// The Show on one thumb as main.js flies it (tests/unit/thumb-mastery.test.js): hold up the curl, stop on
// the ledge, a tap to let go and, held from the tap, the pad's LAND to the ground.
function flyThumb() {
  const run = createRun('show'), th = createOneThumb(), w = watch();
  let released = false, ledgeT = -1, tapT = -1;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    w.see(run, inp);
    stepRun(run, inp);
  }
  return { run, ticks: w.ticks };
}

describe('the descent band on a soft landing (0133)', () => {
  it('the reference reads green on ≥ 80 % of its air after roof up, and never amber in the last 10 m', () => {
    const { run, ticks } = flyReference();
    expect(run.t.sink).toBeLessThan(SINK_SOFT);
    expect(greenAfterUp(ticks)).toBeGreaterThanOrEqual(0.8);
    expect(ticks.filter((t) => t.h < 10 && t.s !== 'green').length).toBe(0);
  });

  it('one thumb, the pad held from the tap, reads green on ≥ 80 % of its air after roof up', () => {
    const { run, ticks } = flyThumb();
    expect(run.t.sink).toBeLessThan(SINK_SOFT);
    expect(greenAfterUp(ticks)).toBeGreaterThanOrEqual(0.8);
  });

  // A car let go 20 m over the ground, roof up and falling at 2 m/s, on Pro with nothing held (no auto-land).
  const drop = () => { const s = createVehicle('lineup'); s.pos.x = 30; s.pos.y = SPEC.comHeight + 20; s.vel.y = -2; return s; };

  // (predict's own band: the HUD's shows it BAND_HOLD s later, as it does every change.)
  it('a free fall with no brake still goes amber ≥ 0.6 s before the BRAKE line, and red before the ground', () => {
    const s = drop(), pr = newPrediction();
    let amberT = -1, lineT = -1, redH = -1;
    for (let i = 0; i < 240 * 4 && hOf(s) > 0.35; i++) {
      const h = hOf(s);
      predict(s, h, pr);
      const st = pr.status;
      if (amberT < 0 && st !== 'green') amberT = i / 240;
      if (lineT < 0 && pr.margin <= 0) lineT = i / 240;
      if (redH < 0 && st === 'red') redH = h;
      step(s, { ...newInput(), assist: 0 });
    }
    expect(amberT).toBeGreaterThan(0);
    expect(lineT).toBeGreaterThan(0);
    expect(lineT - amberT).toBeGreaterThanOrEqual(0.6 - 1 / 240 - 1e-9);
    expect(redH).toBeGreaterThan(1);
  });

  it('a brake started below the BRAKE line lands firm, and reads amber or red from the brake to the ground', () => {
    const s = drop(), pr = newPrediction(), band = newBand(), seen = [];
    let braking = false, td = -1;
    for (let i = 0; i < 240 * 5; i++) {
      const h = hOf(s);
      // The wheels: the car stands at ≈ 0.3 m on its suspension.
      if (h <= 0.35) { td = -s.vel.y; break; }
      predict(s, h, pr);
      const st = steadyStatus(band, pr, i / 240);
      // Late: the brake starts 5.5 m under the BRAKE line, then full lift to the ground.
      if (!braking && pr.margin < -5.5) braking = true;
      if (braking) seen.push(st);
      step(s, { ...newInput(), assist: 0, lift: braking ? 1 : 0 });
    }
    expect(td).toBeGreaterThan(SINK_SOFT);
    expect(td).toBeLessThan(6);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.filter((st) => st === 'green')).toEqual([]);
  });
});
