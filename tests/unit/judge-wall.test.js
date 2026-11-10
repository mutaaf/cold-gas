// 0182 (critique 2026-11-10-0950 §2): on the Wall the mark counts. The Wall read its mark on a straight line from 1 m to
// 20 m (a 6 m miss outside the 4 m ring kept 74 % of the marks) with precision weighing 0.16 · 0.06 · 0.14, so putting the
// car on the mark was worth 1.3–2 points and a touchdown 8.2 m off read "Perfect 10". The Wall now reads its mark off the
// painted rings the way the Show does, the panel weighs it, and outside the 4 m ring is never "Perfect 10".
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { WALL } from '../../src/sim/courses.js';

function fly(course) {
  const run = createRun(course), ap = createAutopilot(course);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run;
}

describe('on the Wall, the mark counts (0182)', () => {
  const ref = fly('wall').t;
  // The reference's own flight (soft, level, all its gas sense), moved to land `miss` m from the mark.
  const at = (miss) => scoreRun({ ...ref, lateral: miss, landZ: WALL.pad.z });

  it('precision reads the painted rings (2 · 4 · 7 m): full inside 3.5 m, under half at the outer ring', () => {
    const table = [[0, 10], [2, 10], [3.5, 10], [4, 9.5], [5, 8.5], [7, 4.5], [12, 1.5], [20, 0]];
    for (const [miss, p] of table) expect(at(miss).categories.precision, `${miss} m`).toBeCloseTo(p, 1);
  });

  it('a touchdown 4.1 m or more from the mark is never "Perfect 10", however good the rest', () => {
    expect(at(0).verdict).toBe('Perfect 10');
    expect(at(4).verdict).toBe('Perfect 10');
    for (const miss of [4.1, 4.5, 5, 6, 7, 8.2, 12]) {
      const card = at(miss);
      expect(card.verdict, `${miss} m`).not.toBe('Perfect 10');
      if (card.total >= 84) expect(card.verdict, `${miss} m`).toBe('Stuck it');
    }
  });

  it('the mark is worth points: on the mark against 7 m off, ≥ 8 points; against 11 m, ≥ 12', () => {
    expect(at(0).total - at(7).total).toBeGreaterThanOrEqual(8);
    expect(at(0).total - at(11).total).toBeGreaterThanOrEqual(12);
  });

  it('the Wall reference loses nothing (96.0 before); the Show and the Lineup score exactly as before', () => {
    expect(scoreRun(ref).total).toBe(97.7);   // the mark now pays: 96.0 → 97.7
    expect(scoreRun(fly('show').t).total).toBe(97.3);
    expect(scoreRun(fly('lineup').t).total).toBe(91.7);
  });
});
