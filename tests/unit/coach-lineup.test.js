// 0367: a crashed Lineup run is never coached "Clean · nothing big to fix · try Pro". The coach names the row or the lift
// that never got over the roofs, with the run's own speed at the line and its LIFT hold, and no crash on any course is
// told to try Pro.
import { describe, it, expect, beforeAll } from 'vitest';
import { scoreRun } from '../../src/sim/judge.js';
import { SPEC } from '../../src/sim/spec.js';
import { COURSES } from '../../src/sim/courses.js';
import { coach, finish, KEY_WORDS, LINEUP_LINE } from '../../src/sim/coach.js';
import { coachWords, pointerText, pickPointer } from '../../src/pointer.js';
import { wreckCause, WRECK_EVENTS } from '../../src/obs/signature.js';
import { stream, flyKeysLineup, flyThumb, flyTouch, flyPro } from '../../scripts/lib/daily-reach.mjs';

const r1 = (x) => Math.round(x * 10) / 10;
const TRY_PRO = /Try Pro|try Pro/;
const KEYS = { device: 'key', scheme: 'classic', tier: 'assist', course: 'lineup' };

describe('0367: the Lineup keys population (flyKeysLineup × 200, seed 777)', () => {
  let crashes;
  beforeAll(() => {
    const r = stream(777);
    crashes = [];
    for (let i = 0; i < 200; i++) {
      const run = flyKeysLineup(r), card = scoreRun(run.t, { assist: true });
      card.tier = 'assist';
      if (card.facts.crashed) crashes.push({ run, card, c: coach(run.inputLog, 'lineup', card) });
    }
  }, 120000);

  it('no crash is coached clean or told to try Pro (it was 64 of 87)', () => {
    expect(crashes.length).toBeGreaterThan(60);
    for (const { c, card } of crashes) {
      expect(c.items.map((x) => x.id), card.verdict).not.toContain('clean');
      for (const x of c.items) expect(`${x.detail} ${x.fix}`).not.toMatch(TRY_PRO);
    }
  });

  it('a row hit leads with "row", a lift that never got over the roofs with "no-lift"', () => {
    const tallest = COURSES.lineup.tallest;
    const seen = { row: 0, 'no-lift': 0 };
    for (const { run, c } of crashes) {
      const t = run.t, apexH = t.airStartTick >= 0 ? t.apex - SPEC.comHeight : 0;
      const want = t.airStartTick < 0 || apexH < tallest ? 'no-lift' : t.contact ? 'row' : null;
      if (!want) continue;
      expect(c.items[0].id).toBe(want);
      seen[want]++;
    }
    expect(seen.row).toBeGreaterThan(30);
    expect(seen['no-lift']).toBeGreaterThan(10);
  });

  it("its numbers are the run's: the speed at the line, the LIFT hold, the peak", () => {
    for (const { run, c } of crashes) {
      const f = c.flight, top = c.items[0];
      // The speed at the line, measured independently: the input log's own replay crosses LINEUP_LINE once.
      expect(f.lineSpeed).toBeGreaterThan(0);
      const kmh = Math.round(f.lineSpeed * 3.6);
      expect(top.detail).toContain(`${kmh} km/h`);
      expect(top.detail).toContain(`held LIFT (Space) ${r1(f.liftHeld)} s`);
      // flyKeysLineup holds Space 0.35–0.5 s (P.hold), a reaction-free hold of whole ticks.
      expect(f.liftHeld).toBeGreaterThanOrEqual(0.34);
      expect(f.liftHeld).toBeLessThanOrEqual(0.51);
      const apexH = r1(Math.max(0, run.t.apex - SPEC.comHeight));
      expect(top.detail).toMatch(new RegExp(`${String(apexH).replace('.', '\\.')} m`));
      // The fix names LIFT and the half second; a hold under it says what was held.
      expect(top.fix).toMatch(/Hold LIFT \(Space\) at the line for about 0\.5 s/);
      if (f.liftHeld < 0.45) expect(top.fix).toContain(`(you held ${r1(f.liftHeld)} s)`);
      // ↑ held to the line (≈ 120 km/h): the fix says to ease off, with the band.
      if (kmh > 34) expect(top.fix).toContain(`Ease off ↑ before the line: between 25 km/h and 30 km/h, not ${kmh} km/h.`);
    }
  });

  it('the pointer (NEXT RUN) names the speed at the line and 25–30 km/h', () => {
    for (const { c, card } of crashes.slice(0, 20)) {
      const p = pickPointer(c.items, KEYS, { card, flight: c.flight, crashed: true });
      expect(p.text).toContain(`${Math.round(c.flight.lineSpeed * 3.6)} km/h at the line, aim for 25 km/h to 30 km/h`);
      expect(p.text).toContain('hold Space about 0.5 s');
      expect(p.text).not.toMatch(TRY_PRO);
    }
  });
});

describe('0367: no crashed card on any course or device is told to try Pro', () => {
  const POPS = { thumb: flyThumb, touch: flyTouch, pro: flyPro };
  for (const course of ['show', 'wall', 'lineup']) {
    it(`${course}: thumb, touch and pro crashes`, () => {
      let n = 0;
      for (const [pop, fly] of Object.entries(POPS)) {
        const r = stream(4242);
        for (let i = 0; i < 20; i++) {
          const run = fly(course, r), card = scoreRun(run.t);
          if (!card.facts.crashed) continue;
          n++;
          const ctx = { device: pop === 'touch' ? 'touch' : pop === 'thumb' ? 'touch' : 'key', scheme: pop === 'thumb' ? 'thumb' : 'classic', tier: card.tier, course };
          const c = coach(run.inputLog, course, card, 0, coachWords(ctx));
          for (const x of c.items) {
            expect(x.id, `${pop} ${course}`).not.toBe('clean');
            expect(`${x.detail} ${x.fix}`).not.toMatch(TRY_PRO);
          }
          expect(pickPointer(c.items, ctx, { card, flight: c.flight, crashed: true }).text).not.toMatch(/^Clean/);
        }
      }
      expect(n).toBeGreaterThan(0);
    }, 180000);
  }
});

describe('0367: the words and the funnel', () => {
  it('a crash with no finding reads its own verdict, never "Clean"; a landing with none is still Clean', () => {
    const wrecked = finish([], {}, { verdict: 'Wrecked', tier: 'assist' }, true).items;
    expect(wrecked).toEqual([{ id: 'crash', weight: 0, title: 'Wrecked', detail: 'Wrecked: the replay names no single cause.', fix: 'Run it again and follow the cues: each one calls its step as you reach it.' }]);
    expect(pointerText('crash', KEYS)).toMatch(/^Run it again/);
    const landed = finish([], {}, { verdict: 'Stuck it', tier: 'assist' }, false).items;
    expect(landed[0].id).toBe('clean');
    expect(landed[0].fix).toMatch(/Try Pro/);
  });
  it('the pointer on every device: a thumb holds the pad, the others are told the speed and the hold', () => {
    const flight = { lineSpeed: 32.3 };
    expect(pointerText('no-lift', KEYS, flight)).toBe('Lift over the roofs: 116 km/h at the line, aim for 25 km/h to 30 km/h, then hold Space about 0.5 s');
    expect(pointerText('row', { ...KEYS, device: 'touch' }, { lineSpeed: 7.5 })).toBe('Over the row: 27 km/h at the line, aim for 25 km/h to 30 km/h, then hold LIFT about 0.5 s');
    expect(pointerText('row', { ...KEYS, device: 'pad' }, null)).toBe('Over the row: 25 km/h to 30 km/h at the line, then hold A about 0.5 s');
    expect(pointerText('row', { ...KEYS, device: 'touch', scheme: 'thumb' }, flight)).toBe('Over the row: hold the pad at the line for about 0.5 s');
  });
  it('the funnel files them: row is wreck-short (into the row), no-lift is its own wreck-lift', () => {
    expect(wreckCause([{ id: 'row' }])).toBe('wreck-short');
    expect(wreckCause([{ id: 'no-lift' }])).toBe('wreck-lift');
    expect(WRECK_EVENTS).toContain('wreck-lift');
    expect(wreckCause([{ id: 'crash' }])).toBe('wreck-other');
  });
  it('LINEUP_LINE is the cue line main.js lifts at', () => {
    expect(LINEUP_LINE).toBe(COURSES.lineup.lineupZ0 - 6.5);
    expect(KEY_WORDS.lift).toBe('LIFT (Space)');
  });
});

describe('0367: the words read in mph too (src/units.js has no ranges)', () => {
  it('every km/h in a row / no-lift line converts on its own', async () => {
    const { toUS } = await import('../../src/units.js');
    const lines = [
      pointerText('no-lift', KEYS, { lineSpeed: 32.3 }),
      'Ease off ↑ before the line: between 25 km/h and 30 km/h, not 116 km/h. Hold LIFT (Space) at the line for about 0.5 s, then roll.',
    ];
    for (const l of lines) {
      const us = toUS(l);
      expect(us, us).not.toMatch(/km\/h/);
      expect(us).not.toMatch(/\d–\d/);
    }
    expect(toUS(pointerText('no-lift', KEYS, { lineSpeed: 32.3 }))).toContain('aim for 16 mph to 19 mph');
  });
});
