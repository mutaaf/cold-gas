// 0132: the coach names the way the touchdown missed. A one-thumb first run with no slide lands ≈5.3 m to the side
// and only ≈2.7 m past the mark; "Long of the mark" sent the player sliding down the pad. Now the title names the
// bigger part (Wide / Long / Short), the detail gives both, and the side word agrees with the pad's sight (the amber
// dot is on the side to slide toward). Only the words change: the weight and the points are markCost's, as before.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { COURSES } from '../../src/sim/courses.js';
import { coach, markMiss, markCost, KEY_WORDS } from '../../src/sim/coach.js';
import { coachWords } from '../../src/pointer.js';
import { createOneThumb, thumbStage, markOffset } from '../../src/onethumb.js';

const PAD = COURSES.show.pad;
const THUMB_WORDS = coachWords({ device: 'touch', scheme: 'thumb', tier: 'assist', course: 'show' });

// The Show on one thumb with no slide, the way main.js flies it: hold up the curl, stop on the ledge, tap `tapAfter`
// ticks after stopping, then hold to the ground. `sight` records the pad's markOffset the first tick the car is
// 3 m up on the way down (what the player sees on the held pad then).
function flyThumb(tapAfter) {
  const run = createRun('show'), th = createOneThumb(), pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
  let released = false, ledgeT = -1, tapT = -1, sight = null;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + tapAfter) { th.down(); tapT = run.tick; }
    }
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    if (!sight && run.phase === 'air' && c.vel.y < 0 && c.pos.y - SPEC.comHeight < 3) {
      predict(c, Math.max(0, c.pos.y - SPEC.comHeight), pr);
      sight = { ...markOffset(c, pr, 'show', off) };
    }
    stepRun(run, inp);
  }
  return { run, sight };
}

describe('the coach names the side the touchdown missed on (0132)', () => {
  // A tap 0.25 s after the stop and one 0.5 s after land on opposite sides of the mark.
  let flights;
  beforeAll(() => { flights = [60, 120].map((d) => ({ d, ...flyThumb(d) })); });

  it('a mostly-sideways miss reads "Wide of the mark", with the side and both distances; the mirror names the other side', () => {
    const sides = [];
    for (const { d, run } of flights) {
      const t = run.t, along = t.landZ - PAD.z;
      expect(Math.abs(t.lateral), `tap +${d}`).toBeGreaterThan(5);
      expect(Math.abs(t.lateral)).toBeGreaterThan(Math.abs(along));
      expect(along).toBeLessThan(0);   // past it, a little
      const card = scoreRun(t);
      for (const say of [THUMB_WORDS, KEY_WORDS]) {
        const m = coach(run.inputLog, 'show', card, 0, say).items.find((i) => i.id === 'mark');
        expect(m, `tap +${d}`).toBeTruthy();
        expect(m.title).toBe('Wide of the mark');
        const side = t.lateral > 0 ? 'right' : 'left';
        expect(m.detail).toContain(`(${(Math.round(Math.abs(t.lateral) * 10) / 10)} m ${side} of it, ${Math.round(-along * 10) / 10} m past)`);
        // The points are still markCost's.
        expect(m.detail).toMatch(new RegExp(`about ${Math.round(markCost(t))} points`));
        sides.push(side);
      }
    }
    expect(new Set(sides)).toEqual(new Set(['left', 'right']));
  });

  it('the side named agrees with the sight: the amber dot sits on the other side of centre, the side to slide toward', () => {
    for (const { d, run, sight } of flights) {
      expect(sight, `tap +${d}`).toBeTruthy();
      const { side } = markMiss({ x: run.t.lateral, along: run.t.landZ - PAD.z });
      expect(Math.abs(sight.x)).toBeGreaterThan(1);
      expect(Math.sign(sight.x)).toBe(side === 'right' ? -1 : 1);
    }
  });

  it('a miss mostly along the run still says Long (past) or Short (before), and the Wall and the Lineup keep "Off"', () => {
    expect(markMiss({ x: 1.2, along: -6 }).title).toBe('Long of the mark');
    expect(markMiss({ x: 1.2, along: -6 }).where).toBe(' (6 m past it, 1.2 m right)');
    expect(markMiss({ x: -0.2, along: -6 }).where).toBe(' (6 m past it)');
    expect(markMiss({ x: 5.31, along: -5.28 }).title).toBe('Long of the mark');   // equal as printed: not "Wide"
    expect(markMiss({ x: -1.5, along: 5 }).title).toBe('Short of the mark');
    expect(markMiss({ x: -1.5, along: 5 }).where).toBe(' (5 m short of it, 1.5 m left)');
    expect(markMiss({ x: 6, along: 0.3 }).where).toBe(' (6 m right of it)');
    expect(markMiss({ x: 6, along: -6 }, false)).toEqual({ title: 'Off the mark', where: '', side: null });
    // Through coach() itself: the autopilot's Show at a 10 m/s carry lands ≈17.8 m past and ≈0.4 m across.
    const run = createRun('show'), ap = createAutopilot('show', { carry: 10 });
    while (run.phase !== 'done') stepRun(run, ap(run));
    const along = run.t.landZ - PAD.z;
    expect(along).toBeLessThan(-10);
    expect(Math.abs(run.t.lateral)).toBeLessThan(Math.abs(along));
    const m = coach(run.inputLog, 'show', scoreRun(run.t)).items.find((i) => i.id === 'mark');
    expect(m.title).toBe('Long of the mark');
    expect(m.detail).toMatch(/m from the mark \(\d+(\.\d)? m past it\)/);
  });
});
