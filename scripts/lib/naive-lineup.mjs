// The Lineup by keys (or a pad, or the page's touch buttons) with Assist, flown as the page cues it (0362): drive up at a
// run-up speed, "Space at the line" (pressed at `pressZ`, held `liftS` s), then ← to roll for `rollS` s (0: no roll),
// then hold LAND (Shift) to the ground and brake once down. A person holds a key for a habitual length, not until the
// apex looks right (docs/LESSONS.md 2026-11-03), so the grid sweeps the hold. Sim only, deterministic.
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { dhypot } from '../../src/sim/dmath.js';

// docs/REVEAL_RESEARCH.md §2.2: the kickflip ran in at 7–9 m/s; the grid adds a slower 6. Holds from a tap to 3 s.
export const GRID = { speeds: [6, 7.5, 9], pressZ: [-6, -4, -2, 0, 1], liftS: [0.3, 0.5, 1, 1.5, 3], rollS: [0, 0.8, 1.4] };

/** The player as a controller: (run) → this tick's input (a fresh object each tick). */
export function naiveController({ speed, pressZ, liftS, rollS, tier = 'assist' }) {
  let tLift = -1, tRoll = -1;
  return (run) => {
    const c = run.car, now = run.tick / 240, inp = newInput();
    inp.assist = tier === 'assist' ? 1 : 0;
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    const v = dhypot(c.vel.x, c.vel.z);
    if (tLift < 0 && c.pos.z >= pressZ) tLift = now;
    if (tLift < 0) inp.throttle = v < speed ? 1 : 0;
    else if (now - tLift < liftS) { inp.lift = 1; inp.throttle = run.phase === 'drive' && v < speed ? 1 : 0; }
    else if (run.phase === 'air') {
      if (tRoll < 0) tRoll = now;
      if (now - tRoll < rollS) inp.roll = -1; else inp.level = 1;
    } else inp.brake = 1;
    return inp;
  };
}

/** Fly one player. `landed`: upright on its wheels and not scored Wrecked. */
export function flyNaive({ simVersion, ...p }) {
  const run = createRun('lineup', simVersion), pilot = naiveController(p);
  let apex = 0;
  while (run.phase !== 'done') { stepRun(run, pilot(run)); if (run.car.pos.y > apex) apex = run.car.pos.y; }
  const t = run.t, card = scoreRun(t, { assist: p.tier !== 'pro' });
  const upright = !!(t.settledUpright && t.touchTick > 0 && !t.fellOff);
  return { apex, upright, landed: upright && card.verdict !== 'Wrecked', verdict: card.verdict, total: card.total, sink: t.sink, end: t.endReason, run, card };
}

export function* grid(g = GRID) {
  for (const speed of g.speeds) for (const pressZ of g.pressZ) for (const liftS of g.liftS) for (const rollS of g.rollS) yield { speed, pressZ, liftS, rollS };
}
