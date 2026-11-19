// The keyboard newcomer the guide creates (0275): the player who does exactly what the cue line says. "Hold ↑ to go",
// "Keep holding ↑", "Space to let go"; nothing ever said to let go of ↑, so they keep holding it through the air (where
// ↑ is nose down) and past the touchdown (where it is throttle again). Every key goes through src/input.js's own
// mapping (keyDown / keyUp / sample, as the browser's handlers call them) and the live step's wall assist
// (src/main.js wallAssist: the fan up the curl, the release), on Assist.
//
// 36 players per course: Space at 0.90 / 0.95 / 1.00 of the curl, F held 0 / 0.3 / 0.6 s from the release, Shift
// pressed at 0.5 / 1.5 / 2.5 s of air or never (auto-land). `up`: when ↑ is let go: 'release' (the gates' model),
// 'touchdown' (held through the air) or 'never' (held to the end: the literal reading).
//
//   node scripts/keys-literal.mjs [show|wall] [release|touchdown|never]   (no args: both courses, every hold)
//
// A landing: upright, on its wheels, not on the ramp, not fallen off, no contact with the row (the critic's
// keysnew-probe, docs/critique/2026-11-18-0400/).
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput } from '../src/sim/vehicle.js';
import { initPhysics } from '../src/sim/engine.js';
import { sample, keyDown, keyUp, freshRun } from '../src/input.js';

const DT = 1 / 240;
export const RELEASE_AT = [0.9, 0.95, 1.0], BOOST = [0, 0.3, 0.6], SHIFT_AT = [Infinity, 0.5, 1.5, 2.5];

/** One player. Returns the run's telemetry and whether it landed. */
export function flyLiteral(course, { releaseAt, boost, shiftAt, up = 'never' }) {
  freshRun();
  const run = createRun(course), inp = newInput();
  let released = false, airT = 0, spaceT = -1, fT = -1, shift = false, upHeld = true;
  keyDown('ArrowUp');
  while (run.phase !== 'done') {
    const c = run.car;
    if (!released && run.phase === 'ramp' && wallProgress(c.pos) >= releaseAt && spaceT < 0) {
      keyDown('Space'); spaceT = 0;
      if (boost > 0) { keyDown('KeyF'); fT = 0; }
      if (up === 'release') { keyUp('ArrowUp'); upHeld = false; }
    }
    if (spaceT >= 0 && (spaceT += DT) > 0.15) { keyUp('Space'); spaceT = -2; }
    if (fT >= 0 && (fT += DT) > boost) { keyUp('KeyF'); fT = -2; }
    if (released && (run.phase === 'air' || run.phase === 'ramp')) {
      airT += DT;
      if (!shift && airT > shiftAt) { keyDown('ShiftLeft'); shift = true; }
    }
    if (upHeld && up === 'touchdown' && (run.phase === 'landed')) { keyUp('ArrowUp'); upHeld = false; }
    const o = sample(run.phase, 'assist', inp, released, c);
    // src/main.js wallAssist + noteRelease
    if (!released && ((run.phase === 'ramp' && o.lift > 0) || run.phase === 'air')) released = true;
    o.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, o);
  }
  for (const code of ['ArrowUp', 'Space', 'KeyF', 'ShiftLeft']) keyUp(code);
  const t = run.t;
  return { t, landed: !!(t.settledUpright && !t.landedOnRamp && !t.fellOff && t.touchTick > 0 && !t.contact) };
}

/** The 36 players on one course. */
export function sweep(course, up = 'never') {
  let landed = 0, n = 0;
  for (const releaseAt of RELEASE_AT) for (const boost of BOOST) for (const shiftAt of SHIFT_AT) {
    n++;
    if (flyLiteral(course, { releaseAt, boost, shiftAt, up }).landed) landed++;
  }
  return { course, up, landed, n };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await initPhysics();
  const a = process.argv.slice(2);
  const courses = a.filter((x) => x === 'show' || x === 'wall');
  const ups = a.filter((x) => ['release', 'touchdown', 'never'].includes(x));
  for (const course of courses.length ? courses : ['show', 'wall']) {
    for (const up of ups.length ? ups : ['release', 'touchdown', 'never']) {
      const r = sweep(course, up);
      console.log(`${course.padEnd(5)} ↑ let go at ${up.padEnd(9)} ${r.landed}/${r.n}`);
    }
  }
}
