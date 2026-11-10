// 0181: on a phone the Lineup flies the one-thumb pad, as the Show and the Wall do. Before, a phone was dropped to the
// classic two thumbs there, and the modelled careful two-thumb player (scripts/lib/daily-reach.mjs flyTouch) landed clean
// 32 % of the time and wrecked 30 %. Hold to drive (let go to stop); at the line it lifts, burns to the reference's apex
// and rolls one turn; in the air the thumb is LAND and the slide (src/onethumb.js). A seeded careful population
// (flyThumbLineup) must land clean ≥ 90 % and wreck ≤ 5 %; a flight replays bit-exactly from its input log.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage } from '../../src/onethumb.js';
import { flyThumbLineup, flyTouch, stream } from '../../scripts/lib/daily-reach.mjs';
import { OBJECTIVES, evaluate } from '../../src/daily.js';
import { howtoRows, pointerText } from '../../src/pointer.js';
import { COURSES } from '../../src/sim/courses.js';

const CLEAN = /Perfect 10|Stuck it|Clean|Rough landing/;
const WRECK = /Wrecked|Rolled over|Crash/;
const split = (fly, n, seed) => {
  const r = stream(seed), out = { clean: 0, wreck: 0, n };
  for (let i = 0; i < n; i++) {
    const v = scoreRun(fly(r).t).verdict;
    if (CLEAN.test(v)) out.clean++;
    if (WRECK.test(v)) out.wreck++;
  }
  return out;
};

// One thumb down from Go, lifted at `upZ` (and pressed again once the car is nearly stopped, `again`), held otherwise.
function flyHeld(upZ = Infinity, again = false) {
  const run = createRun('lineup'), th = createOneThumb();
  let lifted = false, pressed = false;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (!lifted && c.pos.z > upZ) { th.up(); lifted = true; }
    if (again && lifted && !pressed && Math.hypot(c.vel.x, c.vel.z) < 0.5) { th.down(); pressed = true; }
    th.sample(run, false, inp);
    stepRun(run, inp);
  }
  return run;
}

describe('the Lineup on one thumb (0181)', () => {
  it('a careful phone population lands clean ≥ 90 % and wrecks ≤ 5 % (two thumbs: about a third each way)', () => {
    const one = split(flyThumbLineup, 40, 777);
    expect(one.clean / one.n).toBeGreaterThanOrEqual(0.9);
    expect(one.wreck / one.n).toBeLessThanOrEqual(0.05);
    const two = split((r) => flyTouch('lineup', r), 40, 777);
    expect(two.clean).toBeLessThan(one.clean);
  }, 120_000);

  it('a held thumb flies the kickflip: lifts at the line, rolls 360°, lands on the mark, and meets both Lineup Dailies', () => {
    const run = flyHeld(), card = scoreRun(run.t);
    expect(card.verdict).toMatch(/Stuck it|Perfect 10/);
    expect(card.facts.rollDeg).toBeGreaterThanOrEqual(330);
    expect(card.facts.padMiss).toBeLessThan(3.5);
    for (const id of ['roll-lineup', 'mark-lineup']) expect(evaluate(OBJECTIVES.find((o) => o.id === id), card, 'lineup').ok).toBe(true);
    // The input log replays to the same card (the Worker scores it this way).
    expect(scoreRun(simulate(run.inputLog, 'lineup').t).total).toBe(card.total);
  });

  it('let go on the run-up, it stops short of the row; pressed again, it drives on and still lands clean', () => {
    const stop = flyHeld(-20);
    expect(stop.t.airStartTick).toBe(-1);
    expect(stop.t.contact).toBe(false);
    expect(stop.car.pos.z).toBeLessThan(COURSES_LINE);
    const again = scoreRun(flyHeld(-20, true).t);
    expect(again.verdict).toMatch(/Stuck it|Perfect 10/);
  });

  it('a nervous thumb let go just short of the line, stopped and pressed again, drives up before it lifts and clears the row', () => {
    for (const z of [-3, -2.8, -2.7, -2.6, -2.4, -2.1, -1.5]) {
      const run = flyHeld(z, true), card = scoreRun(run.t);
      expect(run.t.contact, `let go at ${z}`).toBe(false);
      expect(card.verdict, `let go at ${z}`).toMatch(/Stuck it|Perfect 10|Clean/);
      expect(run.t.landZ, `let go at ${z}`).toBeGreaterThan(COURSES.lineup.lineupEnd);   // past the row, not short of it
    }
  });

  it('the how-to card and the pointer speak the Lineup on one thumb (no let-go)', () => {
    const ctx = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'lineup' };
    expect(howtoRows(ctx).map((r) => r.phase)).toEqual(['Drive', 'Lift & roll', 'Land', 'Aim & brake']);
    for (const id of ['no-brake', 'late-land']) expect(pointerText(id, ctx)).not.toMatch(/let go/);
  });

  it('a thumb lifted at the line, or in the air and never pressed again, still lands (the lift commits; auto-LAND)', () => {
    for (const z of [0, 3, 15]) expect(scoreRun(flyHeld(z).t).verdict).toMatch(/Stuck it|Perfect 10|Clean/);
  });

  it('the run-up is the climb stage; the air is fly', () => {
    const run = createRun('lineup');
    expect(thumbStage(run, false)).toBe('climb');
    run.phase = 'air';
    expect(thumbStage(run, false)).toBe('fly');
  });
});
const COURSES_LINE = 0.5;   // the lift-off line (COURSES.lineup.lineupZ0 − 6.5)
