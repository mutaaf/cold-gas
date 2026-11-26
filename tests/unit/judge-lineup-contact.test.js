// 0369: a Lineup run that leaves the ground and ends on the row (t.contact, no wheel touchdown) is never judged
// "No jump", and nothing on its sheet says the car never left the ground. The fix is the verdict and the words, not the
// score: `facts.jumped` (air *and* a touchdown) still gates the board and the landed paths, and a row hit's apex is the
// bounce after the hit, so paying Height for it would pay for the crash.
import { describe, it, expect, beforeAll } from 'vitest';
import { scoreRun } from '../../src/sim/judge.js';
import { createRun, stepRun } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { coach, LINEUP_LINE } from '../../src/sim/coach.js';
import { localWords } from '../../src/panel.js';
import { crashNote } from '../../src/ui.js';
import { stream, flyKeysLineup, flyTouch } from '../../scripts/lib/daily-reach.mjs';

const NEVER = /never left the ground|Restraint/;

const POPS = { keys: (r) => flyKeysLineup(r), touch: (r) => flyTouch('lineup', r) };
const pops = {};
beforeAll(() => {
  for (const [name, fly] of Object.entries(POPS)) {
    const r = stream(777), runs = [];
    for (let i = 0; i < 200; i++) {
      const run = fly(r), card = scoreRun(run.t, { assist: true });
      card.tier = 'assist';
      runs.push({ run, card });
    }
    pops[name] = runs;
  }
}, 240000);

describe('0369: the populations (flyKeysLineup and flyTouch lineup × 200, seed 777)', () => {
  for (const name of Object.keys(POPS)) {
    it(`${name}: no run that left the ground is judged "No jump" (it was 13 keys, 21 touch)`, () => {
      let rowHits = 0;
      for (const { run, card } of pops[name]) {
        if (run.t.airStartTick >= 0) expect(card.verdict).not.toBe('No jump');
        if (run.t.airStartTick >= 0 && run.t.contact && run.t.touchTick < 0) {
          rowHits++;
          expect(['Contact', 'Wrecked']).toContain(card.verdict);
          // The verdict only: the card's numbers and its `jumped` (the board's gate) are as before.
          expect(card.facts.jumped).toBe(false);
          expect(card.categories.height).toBe(0);
          expect(card.categories.rotation).toBe(0);
          expect(crashNote(card.facts, card.verdict)).not.toMatch(/No jump/);
        }
      }
      expect(rowHits).toBeGreaterThan(10);
    });

    it(`${name}: no card with apex > 1 m or roll > 90° is told the car never left the ground (it was 6 keys)`, () => {
      for (const { card } of pops[name]) {
        if (!(card.facts.apex > 1 || card.facts.rollDeg > 90)) continue;
        const w = localWords(card);
        expect(`${w.headline} ${w.engineer} ${w.coordinator} ${w.designer}`, card.verdict).not.toMatch(NEVER);
      }
    });

    it(`${name}: a row hit on the way up is said as one, never "came down on the roofs"`, () => {
      let into = 0;
      for (const { run, card } of pops[name]) {
        if (!run.t.contact) continue;
        const c = coach(run.inputLog, 'lineup', card), f = c.flight, top = c.items[0];
        expect(f.contactH).toBeGreaterThanOrEqual(0);
        if (f.contactH < 1 && f.contactVy >= 0) {
          into++;
          expect(top.id).toBe('no-lift');   // never over the roofs: the funnel's wreck-lift
          expect(top.title).toBe('Into the row');
          expect(top.detail).not.toMatch(/came down on the roofs|peaked/);
          expect(top.detail).toContain(`${Math.round(f.contactSpeed * 3.6)} km/h`);
          if (f.contactH >= 0.1) expect(top.detail).toContain(`${Math.round(f.contactH * 10) / 10} m up`);
        }
      }
      // keys 41, touch 3 (measured 0–1.1 m up); since 0363's run-up limit keys 12, touch 0: the touch players' 3 were run-ups
      // past the limit, and none of them reaches the row that low now. Keys still carries the finding.
      if (name === 'keys') expect(into).toBeGreaterThan(2);
      else expect(into).toBe(0);   // pinned: a touch run that reaches the row that low again shows up here
    }, 240000);
  }
});

describe('0369: what stays', () => {
  it('a Lineup run that never leaves the ground (no LIFT, ↑ let go before the line) is still "No jump"', () => {
    const run = createRun('lineup'), inp = newInput();
    while (run.phase !== 'done' && run.tick < 240 * 30) {
      const c = run.car, v = Math.hypot(c.vel.x, c.vel.z);
      inp.throttle = c.pos.z < LINEUP_LINE - 20 && v < 7.5 ? 1 : 0;
      inp.brake = c.pos.z >= LINEUP_LINE - 20 ? 1 : 0;
      stepRun(run, inp);
    }
    expect(run.t.airStartTick).toBe(-1);
    const card = scoreRun(run.t, { assist: true });
    expect(card.verdict).toBe('No jump');
    expect(localWords(card).headline).toBe('No jump recorded');
    expect(crashNote(card.facts, card.verdict)).toBe('No jump · not a mark yet');
  });

  it('a car driven into the row on its wheels (↑ held, LIFT never pressed) is "No jump" on every surface', () => {
    const run = createRun('lineup'), inp = newInput();
    while (run.phase !== 'done' && run.tick < 240 * 30) {
      inp.throttle = Math.hypot(run.car.vel.x, run.car.vel.z) < 4 ? 1 : 0;   // slow enough not to wreck (a wreck reads Wrecked first)
      stepRun(run, inp);
    }
    expect(run.t.contact).toBe(true);
    expect(run.t.airStartTick).toBe(-1);
    const card = scoreRun(run.t, { assist: true });
    card.tier = 'assist';
    expect(card.verdict).toBe('No jump');
    expect(crashNote(card.facts, card.verdict)).toBe('No jump · not a mark yet');
    expect(localWords(card).headline).toBe('No jump recorded');
    const top = coach(run.inputLog, 'lineup', card).items[0];
    expect(top.id).toBe('no-lift');
    expect(top.detail).toMatch(/^You never got off the ground/);
    expect(top.detail).not.toMatch(/into the row/);
  });

  it('a run that hits the row without a touchdown gets row words with its speed, never the ramp or restraint', () => {
    const facts = { course: 'lineup', jumped: false, contact: true, crashed: true, apex: 7.4, rollDeg: 368, launchKmh: 63, damagePct: 22, sink: 0, tiltDeg: 0, padMiss: 0 };
    const w = localWords({ verdict: 'Contact', facts });
    expect(w.headline).toBe('Into the row');
    expect(w.engineer).toContain('63 km/h');
    expect(`${w.engineer} ${w.coordinator} ${w.designer}`).not.toMatch(/ramp|Restraint|never left|height/);
    // A car driven into the row on its wheels is judged No jump, and keeps the no-jump lines.
    expect(localWords({ verdict: 'No jump', facts: { ...facts, launchKmh: 0 } }).headline).toBe('No jump recorded');
    // Without a take-off speed the line names none.
    expect(localWords({ verdict: 'Contact', facts: { ...facts, launchKmh: 0 } }).engineer).not.toMatch(/km\/h/);
  });

  it('the run line: a crash that hit the row says Crashed or Wrecked, a run with no jump and no hit says No jump', () => {
    expect(crashNote({ jumped: false, contact: true, damagePct: 20 })).toBe('Crashed · not a mark yet');
    expect(crashNote({ jumped: false, contact: true, damagePct: 70 })).toBe('Wrecked · not a mark yet');
    expect(crashNote({ jumped: false, contact: false, damagePct: 0 })).toBe('No jump · not a mark yet');
    expect(crashNote({ jumped: false, contact: true, damagePct: 20 }, 'No jump')).toBe('No jump · not a mark yet');
    expect(crashNote({ jumped: true, crashed: true, damagePct: 10 })).toBe('Crashed · not a mark yet');
  });
});
