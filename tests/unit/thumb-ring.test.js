// 0371: one thumb's clean line and the coach's clean fix name the 2 m bullseye when the card marked the touchdown down
// for missing it (0360: SHOW_PRECISION pays full marks only inside 2.05 m, on the Show and the Wall). Pro stays the next
// step only once Precision is 10. The two must agree (0156): What happened and NEXT RUN name one step.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun, SHOW_MARK_RING } from '../../src/sim/judge.js';
import { COURSES } from '../../src/sim/courses.js';
import { coach, finish } from '../../src/sim/coach.js';
import { ringMiss } from '../../src/sim/aim-words.js';
import { coachWords, pickPointer, pointerText } from '../../src/pointer.js';
import { toUS } from '../../src/units.js';

const refs = {};
beforeAll(() => {
  for (const c of ['show', 'wall', 'lineup']) {
    const run = createRun(c), ap = createAutopilot(c);
    while (run.phase !== 'done') stepRun(run, ap(run));
    refs[c] = { t: run.t, log: run.inputLog };
  }
}, 120000);

// The same flight set down `miss` m from the mark (straight across it): only the card's padMiss and Precision move.
function at(course, miss, tier = 'assist') {
  const { t, log } = refs[course];
  const card = scoreRun({ ...t, tier, lateral: miss, landZ: COURSES[course].pad.z });
  const ctx = { device: 'touch', scheme: 'thumb', tier, course };
  // The Show's reference sets down 1.5 m out, so the coach re-flies it to "Clean" and its clean fix reads the card. The
  // Wall's sets down 3.5 m out (0360), which the coach names as the mark from the replay: there the clean item is
  // finish()'s, the coach's own last step, over the same card.
  const flown = coach(log, course, card, 0, coachWords(ctx));
  const c = course === 'show' ? flown : finish([], flown.flight, card);
  const flight = { ...c.flight, touch: { ...c.flight.touch, padMiss: miss } };
  return { card, ctx, c, flight, p: pickPointer(c.items, ctx, { card, flight }) };
}

describe('one thumb, a touchdown just outside the 2 m ring (0371)', () => {
  for (const [course, inside, outside] of [['show', 1.2, 2.2], ['wall', 1.5, 3.0]]) {
    it(`${course}: ${inside} m says Pro, ${outside} m names the ${SHOW_MARK_RING} m ring and the miss; both agree with What happened`, () => {
      const a = at(course, inside), b = at(course, outside);
      expect(a.card.facts.crashed).toBe(false);
      expect(a.card.categories.precision).toBe(10);
      expect(b.card.categories.precision).toBeLessThan(10);
      // Inside the ring: today's line, Pro.
      expect(a.c.items[0].id).toBe('clean');
      expect(a.p.id).toBe('clean');
      expect(a.p.text).toBe(`Clean, ${inside.toFixed(1)} m from the mark. Next: try Pro and fly the landing yourself`);
      expect(a.c.items[0].fix).toMatch(/Try Pro/);
      // Outside it: the ring and this run's distance, never Pro, on both surfaces.
      expect(b.c.items[0].id).toBe('clean');
      expect(b.p.id).toBe('clean');
      expect(b.p.text).toBe(`Clean, ${outside.toFixed(1)} m from the mark: inside the 2 m ring pays full marks. Next: slide onto the amber dot`);
      expect(b.p.text).not.toMatch(/Pro/);
      expect(b.c.items[0].fix).toBe(`Land inside the 2 m ring for full marks: this one was ${outside} m from the mark.`);
      expect(b.c.items[0].fix).not.toMatch(/Pro/);
      // The units layer converts each number with its own unit (LESSONS 2026-11-24).
      expect(toUS(b.p.text)).toMatch(/6\.6 ft/);
    });
  }

  it('the ring is the step only on Assist on the rings: Pro and Advanced, the Lineup, a crash and no card keep their lines', () => {
    expect(ringMiss(at('show', 2.2, 'pro').card)).toBe(-1);
    expect(ringMiss(at('show', 2.2, 'advanced').card)).toBe(-1);
    expect(ringMiss(null)).toBe(-1);
    const lineup = scoreRun({ ...refs.lineup.t, lateral: 2.2, landZ: COURSES.lineup.pad.z });
    expect(ringMiss(lineup)).toBe(-1);
    // A crash never reads clean (0367), whatever its precision.
    const crashed = { ...at('show', 2.2).card, facts: { ...at('show', 2.2).card.facts, crashed: true } };
    expect(finish([], {}, crashed, true).items[0].id).toBe('crash');
    // No card (a drill): the old line.
    const ctx = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'show' };
    expect(pointerText('clean', ctx, { touch: { padMiss: 2.2 } }, null)).toMatch(/try Pro/);
  });

  it('the edge: 2.0 m (full marks at the card\'s 0.1) says Pro; 2.1 m names the ring', () => {
    expect(at('show', 2.0).p.text).toMatch(/try Pro/);
    expect(at('show', 2.1).p.text).toMatch(/^Clean, 2\.1 m from the mark: inside the 2 m ring/);
  });
});
