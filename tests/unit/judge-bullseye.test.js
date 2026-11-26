// 0360 (critique 2026-11-23-0400): the pad's 2 m bullseye pays. SHOW_PRECISION gave full marks out to 3.5 m, so the
// innermost painted ring (2 m, courses.js `pad.rings[0]`) was decoration: a careful one-thumb touchdown inside it scored a
// lower median (93.7) than one between 2 and 3.5 m (94.7), and a sloppy thumb's best beat a careful one's. Precision is
// now full only inside the 2 m ring and falls across the 2–4 m band, on the Show and the Wall alike. Scores only: the
// flights are the same bits, and a run flown before is a version behind (MARK_VERSION, src/sim/run.js).
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simVersionOf, replayable, WRECK_VERSION, MARK_VERSION, SURFACE_VERSION, SIM_VERSION } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun, SHOW_PRECISION, SHOW_MARK_RING } from '../../src/sim/judge.js';
import { COURSES } from '../../src/sim/courses.js';

function fly(course) {
  const run = createRun(course), ap = createAutopilot(course);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run;
}

describe('the 2 m bullseye pays (0360)', () => {
  for (const course of ['show', 'wall']) {
    const ref = fly(course).t, pad = COURSES[course].pad;
    // The reference's own flight, moved so it touches down `miss` m short of the mark along the approach (only landZ).
    const at = (miss) => scoreRun({ ...ref, lateral: 0, landZ: pad.z + miss });

    it(`${course}: full marks end at the painted 2 m ring (to 2.05 m, where the card still reads 2.0), not 3.5 m`, () => {
      expect(SHOW_MARK_RING).toBe(pad.rings[0]);
      expect(SHOW_PRECISION[0][0]).toBe(pad.rings[0] + 0.05);
      expect(at(1.0).categories.precision).toBe(10);
      expect(at(2.0).categories.precision).toBe(10);
      // A card that reads 2.0 m (r1) is never marked down for the mark; one that reads 2.1 m is.
      expect(at(2.049).facts.padMiss).toBe(2.0);
      expect(at(2.049).categories.precision).toBe(10);
      expect(at(2.1).facts.padMiss).toBe(2.1);
      expect(at(2.1).categories.precision).toBeLessThan(10);
      expect(at(3.0).categories.precision).toBeLessThan(10);
    });

    it(`${course}: inside the ring outscores the 2–4 m band, and no step out ever pays`, () => {
      const t = (m) => at(m).total;
      // Past the painted line is 2.4–2.9 points (the careful thumbs that land 10–20 cm outside it measured 2.1–2.2 m).
      expect(t(2.05) - t(2.15)).toBeGreaterThanOrEqual(2);
      expect(t(1.0) - t(3.0)).toBeGreaterThanOrEqual(2.5);
      for (let m = 0; m < 20; m += 0.25) expect(t(m + 0.25), `${m} → ${m + 0.25} m`).toBeLessThanOrEqual(t(m));
      expect(at(3.0).categories.precision).toBeLessThan(at(2.0).categories.precision);
    });
  }

  it('the Show reference (1.5 m off the mark) keeps full marks for it and scores ≥ 97', () => {
    const card = scoreRun(fly('show').t);
    expect(card.facts.padMiss).toBeLessThanOrEqual(2);
    expect(card.categories.precision).toBe(10);
    expect(card.total).toBeGreaterThanOrEqual(97);
  });

  it('the Show and the Wall are scored at MARK_VERSION; a run from before is stale; the Lineup is untouched', () => {
    expect(MARK_VERSION).toBeGreaterThan(SURFACE_VERSION);
    // 0361: every course flies at WRECK_VERSION since (a wreck shuts its valves); MARK_VERSION runs still replay.
    for (const c of ['show', 'wall', 'lineup']) expect(simVersionOf(c)).toBe(WRECK_VERSION);
    for (const v of [SIM_VERSION, SURFACE_VERSION]) {
      expect(replayable('show', v), `show v${v}`).toBe(false);
      expect(replayable('wall', v), `wall v${v}`).toBe(false);
      expect(replayable('lineup', v), `lineup v${v}`).toBe(true);
    }
    expect(replayable('show', MARK_VERSION) && replayable('wall', MARK_VERSION)).toBe(true);
    expect(replayable('lineup', MARK_VERSION)).toBe(false);
  });
});
