// 0370: a Lineup LIFT pressed past the line is named as late, with how far; a crashed run is never told "fly it the same
// again" (the sim is deterministic: the same run crashes the same way). The population is the critic's: flyKeysLineup
// × 200, seed 777 (docs/critique/2026-11-25-2200/late-lift.mjs.txt), whose 7 in-band crashes all pressed 1.29–1.91 m late.
// Since 0363 (Assist's run-up limit) no keys run-up of it is floored: its in-band crashes are 9, all pressed 1.36–1.99 m late.
import { describe, it, expect, beforeAll } from 'vitest';
import { scoreRun } from '../../src/sim/judge.js';
import { simulate } from '../../src/sim/run.js';
import { coach, LINEUP_LINE } from '../../src/sim/coach.js';
import { pickPointer, coachWords } from '../../src/pointer.js';
import { toUS } from '../../src/units.js';
import { stream, flyKeysLineup, flyThumb } from '../../scripts/lib/daily-reach.mjs';

const r1 = (x) => Math.round(x * 10) / 10;
const SAME = /same again/;
const KEYS = { device: 'key', scheme: 'classic', tier: 'assist', course: 'lineup' };
const LATE = [21, 90, 121, 130, 131, 139, 152, 176, 182];   // 0363; [1, 6, 90, 139, 152, 176, 182] before

// Where the counted press of LIFT began, measured on its own replay (not readFlight's): the first press that ends no
// more than 5 m short of the line (LINEUP_TAP_BEFORE), as the car's centre was on its first tick.
function pressAt(log) {
  let from = -1, fromZ = NaN, at = NaN;
  simulate(log, 'lineup', undefined, (r, inp) => {
    if (!Number.isNaN(at)) return;
    if (inp.lift > 0.5 && from < 0) { from = r.tick; fromZ = r.car.pos.z; }
    else if (!(inp.lift > 0.5) && from >= 0) { if (r.car.pos.z >= LINEUP_LINE - 5) at = fromZ - LINEUP_LINE; from = -1; }
  });
  return at;
}

describe('0370: the keys population (flyKeysLineup × 200, seed 777)', () => {
  let rows;
  beforeAll(() => {
    const r = stream(777);
    rows = [];
    for (let i = 0; i < 200; i++) {
      const run = flyKeysLineup(r), card = scoreRun(run.t, { assist: true });
      card.tier = 'assist';
      rows.push({ i, run, card, crashed: card.facts.crashed, c: coach(run.inputLog, 'lineup', card) });
    }
  }, 180000);

  it('no crashed card is told to fly it the same again, in the coach or the pointer (7 were)', () => {
    let crashes = 0;
    for (const { card, c, crashed } of rows) {
      if (!crashed) continue;
      crashes++;
      for (const x of c.items) expect(`${x.detail} ${x.fix}`, card.verdict).not.toMatch(SAME);
      const p = pickPointer(c.items, KEYS, { card, flight: c.flight, crashed: true });
      expect(p.text).not.toMatch(/the same run-up/);
    }
    expect(crashes).toBeGreaterThan(50);
  });

  it("today's 9 lead with the late press and its metres past the line", () => {
    for (const i of LATE) {
      const { c, card, run } = rows[i], f = c.flight, top = c.items[0];
      expect(card.facts.crashed).toBe(true);
      expect(f.liftAtZ).toBeGreaterThan(1.25);   // LINEUP_LIFT_LATE
      expect(f.liftAtZ).toBeLessThanOrEqual(2);
      // readFlight's liftAtZ is the press as the replay saw it, to 0.1 m.
      expect(Math.abs(f.liftAtZ - pressAt(run.inputLog))).toBeLessThan(0.1);
      expect(top.fix, `#${i}`).toContain(`Press LIFT (Space) on the line, not ${r1(f.liftAtZ)} m past it`);
      // In-band speed: no speed fix ahead of it.
      expect(top.fix).not.toMatch(/km\/h/);
      const p = pickPointer(c.items, KEYS, { card, flight: c.flight, crashed: true });
      expect(p.text).toMatch(new RegExp(`: press Space on the line, not ${String(r1(f.liftAtZ)).replace('.', '\\.')} m past it$`));
    }
  });

  it('every timed crash that pressed 1.25 m or more late names the press; an earlier press never does', () => {
    let named = 0;
    for (const { c, crashed } of rows) {
      const f = c.flight, top = c.items[0];
      if (!['row', 'no-lift'].includes(top.id)) continue;
      const late = f.liftHeld >= 0 && f.liftAtZ > 1.25;
      if (late && crashed) { named++; expect(top.fix).toContain(`on the line, not ${r1(f.liftAtZ)} m past it`); }
      if (!late) expect(top.fix).not.toMatch(/on the line, not/);
      // A speed off the band is still named first.
      if (late && Math.round(f.lineSpeed * 3.6) > 34) expect(top.fix.indexOf('Ease off')).toBe(0);
    }
    expect(named).toBeGreaterThan(15);   // 20 since 0363 (32 before, with the floored run-ups)
  });

  it('a landed card never reads the late-press or the crash line', () => {
    for (const { c, crashed } of rows) {
      if (crashed) continue;
      for (const x of c.items) expect(x.fix).not.toMatch(/on the line, not|follow the cues/);
    }
  });

  it('the words read in mph too: one number, one unit', () => {
    const { c } = rows[LATE[0]];
    expect(toUS(c.items[0].fix)).toMatch(/not \d+(\.\d)? ft past it/);
  });
});

describe('0370: one thumb', () => {
  it('the pad commits the lift itself: a thumb card is never told about a late press', () => {
    const r = stream(777);
    for (let i = 0; i < 60; i++) {
      const run = flyThumb('lineup', r), card = scoreRun(run.t, { assist: true });
      card.tier = 'assist';
      const c = coach(run.inputLog, 'lineup', card, 0, coachWords({ device: 'touch', scheme: 'thumb', tier: 'assist', course: 'lineup' }));
      for (const x of c.items) expect(x.fix).not.toMatch(/on the line, not|same again/);
    }
  }, 120000);
});
