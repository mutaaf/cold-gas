// The first jump, taught by playing it (0248). Pure: no DOM, no storage, no clock. src/main.js reads the run each live
// frame into a situation, asks `guideStep` which hint is due, and draws its words (`guideWords`) on the cue line.
//
// One hint at a time, only when its input is due, gone the moment it's done: no card, no pause, no sentence over five
// words. The steps follow the flight; each has a "due" and a "done" reading of the situation, and a done step never
// shows again in that run. `from` starts the guide at a later step (a wreck's next attempt picks up where the last one
// missed). It runs on a player's first runs only, on one-thumb touch, keys and a pad (two-thumb touch keeps its cues).
//
// Nothing here flies anything: the Assist flight computer's own help (auto-land, LAND's roll-out, the line hold, the
// carry over the row) is what makes the landing achievable. No sim or scorer change.

// The steps, in flight order. The Show and the Wall: go → keep → tap → roll → land. The Lineup: go → line → roll → land
// (one thumb has no line to call: the computer lifts there).
export const STEPS = { show: ['go', 'keep', 'tap', 'roll', 'land'], lineup: ['go', 'line', 'roll', 'land'] };
export const stepsFor = (course) => (course === 'lineup' ? STEPS.lineup : STEPS.show);

// The words per device. ≤ 5 words each, the device's own controls (src/pointer.js names them the same way).
const WORDS = {
  thumb: { go: 'Hold to go', keep: 'Keep holding', tap: 'Tap to let go', roll: 'Let it roll', land: 'Hold to land', line: '' },
  key: { go: 'Hold ↑ to go', keep: 'Keep holding ↑', tap: 'Space to let go', roll: 'Let it roll', land: 'Hold Shift to land', line: 'Space at the line' },
  pad: { go: 'Hold RT to go', keep: 'Keep holding RT', tap: 'A to let go', roll: 'Let it roll', land: 'Hold B to land', line: 'A at the line' },
};
// The Lineup's roll is the player's on keys and a pad.
const LINEUP_ROLL = { key: '← → to roll', pad: 'Stick to roll' };

// Which way of flying this is: 'thumb' | 'key' | 'pad', or '' where the guide doesn't run (two-thumb touch, a tier the
// one thumb doesn't fly, the reference, a drill).
export function guideMode({ device, scheme }) {
  if (device === 'touch') return scheme === 'thumb' ? 'thumb' : '';
  return device === 'pad' ? 'pad' : device === 'key' ? 'key' : '';
}

export function guideWords(step, mode, course) {
  if (!step || !WORDS[mode]) return '';
  if (step === 'roll' && course === 'lineup' && LINEUP_ROLL[mode]) return LINEUP_ROLL[mode];
  return WORDS[mode][step] || '';
}

/** A guide for one run. `from`: the first step to teach (0 = all). */
export function newGuide(course, from = 0) {
  const steps = stepsFor(course);
  let done = 0;
  for (let i = 0; i < Math.min(from, steps.length); i++) done |= 1 << i;
  return { course, steps, done, shown: '', reached: Math.min(from, steps.length) };
}

// The situation, read from the run each frame (main.js fills one object and reuses it):
//   phase      run.phase ('drive' | 'ramp' | 'air' | 'landed' | 'done')
//   ledge      on the Wall's ledge, where the release is due (one thumb: thumbStage 'ledge'; keys: progress ≥ 0.92)
//   held       the go control is held (the thumb, ↑, RT)
//   released   let go of the Wall (or the tap was taken), or the Lineup's lift-off called
//   nearLine   the Lineup: the car is near the lift line
//   rising     in the air, still going up (vy > 0)
//   tilted     the Show and the Wall: off the Wall and not yet rolled upright (up.y < 0.85, the cue line's own reading)
//   rolled     the Lineup: the roll has started (|rollAccum| > 0.3 rad)
//   rolledOut  the Lineup: the roll is nearly round (|rollAccum| > 5.6 rad)
//   landOn     LAND is flying (held, the thumb's hold, or auto-land)
//   computerRolls  the Lineup on one thumb: the computer lifts and rolls
const DUE = {
  go: (s) => s.phase === 'drive' && !s.held && !s.released,
  keep: (s) => (s.phase === 'drive' || s.phase === 'ramp') && s.held && !s.ledge && !s.released,
  tap: (s) => s.ledge && !s.released,
  line: (s) => !s.computerRolls && s.phase === 'drive' && s.nearLine && !s.released,
  roll: (s, course) => s.phase === 'air' && (course === 'lineup' ? !s.rolled || s.computerRolls : s.tilted) && !s.landOn,
  land: (s, course) => s.phase === 'air' && !s.rising && !s.landOn && (course === 'lineup' ? s.rolledOut || s.computerRolls : !s.tilted),
};
const DONE = {
  go: (s) => s.held || s.released || s.phase !== 'drive',
  keep: (s) => s.ledge || s.released || s.phase === 'air',
  tap: (s) => s.released || s.phase === 'air',
  line: (s) => s.released || s.phase === 'air' || !!s.computerRolls,
  roll: (s, course) => s.landOn || (course === 'lineup' ? s.rolledOut || (!s.computerRolls && s.rolled) : s.phase === 'air' && !s.tilted),
  land: (s) => s.landOn || s.phase === 'landed' || s.phase === 'done',
};

/**
 * One frame of the guide: marks what's done and returns the step to show ('' for none). Allocation-free.
 * The Wall-only steps (keep, tap) don't apply on the Lineup and the Lineup's line doesn't on the Wall: stepsFor().
 */
export function guideStep(g, s) {
  const course = g.course;
  let show = '';
  for (let i = 0; i < g.steps.length; i++) {
    const bit = 1 << i, id = g.steps[i];
    if (g.done & bit) continue;
    if (DONE[id](s, course)) { g.done |= bit; if (i + 1 > g.reached) g.reached = i + 1; continue; }
    if (!show && DUE[id](s, course)) show = id;
  }
  g.shown = show;
  return show;
}

// Where the next attempt picks up after a wreck: the first step this run didn't get done; with every step done (it came
// down hard all the same), the landing.
export function resumeFrom(g) {
  for (let i = 0; i < g.steps.length; i++) if (!(g.done & (1 << i))) return i;
  return g.steps.length - 1;
}

// The one line on a first jump's wreck (≤ 5 words): what to do sooner, from the step it missed.
export function wreckLine(g) {
  const step = g.steps[resumeFrom(g)];
  return { go: 'Hold to go', keep: 'Hold all the way up', tap: 'Tap on the ledge', line: 'Lift at the line', roll: 'Let it roll', land: 'Hold sooner to land' }[step] || 'Hold sooner to land';
}
