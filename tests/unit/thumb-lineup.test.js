// 0181: on a phone the Lineup flies the one-thumb pad, as the Show and the Wall do. Before, a phone was dropped to the
// classic two thumbs there, and the modelled careful two-thumb player (scripts/lib/daily-reach.mjs flyTouch) landed clean
// 32 % of the time and wrecked 30 %. Hold to drive (let go to stop); at the line it lifts, burns to the reference's apex
// and rolls one turn; in the air the thumb is LAND and the slide (src/onethumb.js). A seeded careful population
// (flyThumbLineup) must land clean ≥ 90 % and wreck ≤ 5 %; a flight replays bit-exactly from its input log.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createOneThumb, thumbStage, THUMB } from '../../src/onethumb.js';
import { medalFor } from '../../src/medals.js';
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
// 0191: `slides` is [z, dy px] pairs: at each z (on the run-up or in the air) the held thumb is moved to dy px up the glass
// from where it pressed.
function flyHeld(upZ = Infinity, again = false, slides = []) {
  const run = createRun('lineup'), th = createOneThumb();
  let lifted = false, pressed = false, next = 0;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    while (next < slides.length && c.pos.z > slides[next][0]) th.move(0, slides[next++][1]);
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

// 0191: the one thumb picks the trick. Held from Go it flies the kickflip for you (onto the mark): that is the silver. Slid
// up on the run-up it calls a second turn (src/onethumb.js LINEUP_TWICE), and the 720 flown onto the mark is the gold.
describe('the Lineup on one thumb: the thumb picks the trick (0191)', () => {
  const card = (run) => scoreRun(run.t);
  it('held from Go, no slide: a clean 360 on the mark, and Silver (it was Gold on run 1)', () => {
    const c = card(flyHeld());
    expect(c.facts.rotations).toBe(1);
    expect(c.verdict).toMatch(/Stuck it|Perfect 10/);
    expect(medalFor('lineup', 'assist', c.total)).toBe('silver');
  });

  it('slid up on the run-up calls two turns: the 720 lands clean, and slid onto the mark it is Gold', () => {
    // The call at places along the run-up (early, half way, the last place it's taken), the thumb left up there.
    for (const z of [-60, -30, -10, -6.5]) {
      const c = card(flyHeld(Infinity, false, [[z, THUMB.aimPx]]));
      expect(c.facts.rotations, `called at ${z}`).toBe(2);
      expect(c.verdict, `called at ${z}`).toMatch(/Stuck it|Perfect 10/);
      expect(c.facts.sink, `called at ${z}`).toBeLessThan(1.3);
    }
    // In the air the slide is measured from where the call left the thumb: brought back down the glass past it (shorter),
    // the touchdown comes onto the mark.
    const aimed = flyHeld(Infinity, false, [[-60, THUMB.aimPx], [COURSES.lineup.lineupEnd + 1, 0]]), c = card(aimed);
    expect(c.facts.rotations).toBe(2);
    expect(c.facts.padMiss).toBeLessThan(1.5);
    expect(medalFor('lineup', 'assist', c.total)).toBe('gold');
    // The input log replays to the same card (the Worker scores the 720 this way too).
    expect(scoreRun(simulate(aimed.inputLog, 'lineup').t).total).toBe(c.total);
  });

  it('wherever it was called, the 720 lifts at its own speed: the same flight, and aimed it is Gold with a soft touchdown (the review)', () => {
    // A call late on the run-up lifted at the 360's 7.5 m/s: 8–12 m long unaimed, and 2.7 m/s of sink aimed short.
    const totals = new Set();
    for (const z of [-60, -30, -20, -10, -6.5]) {
      const c = card(flyHeld(Infinity, false, [[z, THUMB.aimPx], [COURSES.lineup.lineupEnd + 1, 0]]));
      expect(c.facts.rotations, `called at ${z}`).toBe(2);
      expect(c.facts.sink, `called at ${z}`).toBeLessThan(1.3);
      expect(medalFor('lineup', 'assist', c.total), `called at ${z}`).toBe('gold');
      totals.add(c.total);
    }
    expect(totals.size).toBe(1);
  });

  it('too near the line to slow down, a slide up is no call: the 360 flies as before, and the pad stops offering it', () => {
    for (const z of [-5, -3, 0]) {
      const c = card(flyHeld(Infinity, false, [[z, THUMB.aimPx]]));
      expect(c.facts.rotations, `slid at ${z}`).toBe(1);
      expect(c.verdict, `slid at ${z}`).toMatch(/Stuck it|Perfect 10/);
    }
    const run = createRun('lineup'), th = createOneThumb(), offer = [];
    th.down();
    while (run.phase === 'drive') { const inp = newInput(); th.sample(run, false, inp); offer.push([run.car.pos.z, th.offer]); stepRun(run, inp); }
    expect(offer.filter(([z]) => z < -7).every(([, o]) => o)).toBe(true);
    expect(offer.filter(([z]) => z > -5).every(([, o]) => !o)).toBe(true);
  });

  it('the call is latched on the run-up: slid back to the middle it holds, slid down it is taken back', () => {
    expect(card(flyHeld(Infinity, false, [[-60, THUMB.aimPx], [-50, 0]])).facts.rotations).toBe(2);
    expect(card(flyHeld(Infinity, false, [[-60, THUMB.aimPx], [-40, -THUMB.aimPx], [-30, 0]])).facts.rotations).toBe(1);
    // A slide under half of a full one is a resting thumb's wobble plus a little: no call.
    expect(card(flyHeld(Infinity, false, [[-60, THUMB.aimPx * 0.4]])).facts.rotations).toBe(1);
  });

  it('a careful population: every flight lands clean, no wrecks, and Gold is the aimed 720s only (≤ 50 %)', () => {
    const r = stream(12345), n = 60, tot = [];
    let gold = 0, clean = 0, wreck = 0, twice = 0;
    for (let i = 0; i < n; i++) {
      const c = card(flyThumbLineup(r));
      tot.push(c.total);
      if (CLEAN.test(c.verdict)) clean++;
      if (WRECK.test(c.verdict)) wreck++;
      if (c.facts.rotations === 2) twice++;
      if (medalFor('lineup', 'assist', c.total) === 'gold') { gold++; expect(c.facts.rotations).toBe(2); }
    }
    expect(clean / n).toBeGreaterThanOrEqual(0.9);
    expect(wreck / n).toBeLessThanOrEqual(0.05);
    expect(twice).toBeGreaterThan(0);
    expect(gold).toBeGreaterThan(0);
    expect(gold / n).toBeLessThanOrEqual(0.5);
  }, 180_000);
});
