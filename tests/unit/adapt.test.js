// Adapt to me (0079, src/adapt.js): the performance model behind "harder or easier based on how you
// fly". Pure: outcomes in, a decision out; storage that never throws.
import { describe, it, expect } from 'vitest';
import { newPerf, outcomeOf, record, decide, afterChange, struggling, coachLive, stepDownOf, stepUpOf, stepDownBanner, offerWords,
  loadPerf, savePerf, loadFlown, saveFlown, loadAdapt, saveAdapt, STEP_DOWN_AFTER, STEP_UP_AFTER, NEW_PLAYER_RUNS } from '../../src/adapt.js';
import { offerRookie } from '../../src/rookie.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const crash = { verdict: 'Contact', total: 12, tier: 'pro', facts: { course: 'show', crashed: true, jumped: true, contact: true, sink: 6 } };
const soft = { verdict: 'Stuck it', total: 88, tier: 'assist', facts: { course: 'show', crashed: false, jumped: true, crossedRow: true, sink: 1.2, tiltDeg: 3 } };
const firm = { verdict: 'Rough landing', total: 60, tier: 'assist', facts: { course: 'show', crashed: false, jumped: true, crossedRow: true, sink: 2.6, tiltDeg: 4 } };
const short = { verdict: 'Short of the row', total: 30, tier: 'assist', facts: { course: 'show', crashed: false, jumped: true, crossedRow: false, sink: 1 } };
const fly = (p, cards, best = null) => cards.reduce((q, c) => record(q, outcomeOf(c, { best })), p);

describe('an outcome', () => {
  it('a crash, a clean landing in the green, a clean but firm one, a short one', () => {
    expect(outcomeOf(crash)).toMatchObject({ crashed: true, clean: false, good: false });
    expect(outcomeOf(soft)).toMatchObject({ crashed: false, clean: true, good: true });
    expect(outcomeOf(firm)).toMatchObject({ clean: true, good: false });
    expect(outcomeOf(short)).toMatchObject({ crashed: false, clean: false, good: false });   // the Show: short of the row isn't clean
  });
  it('a firm landing that beats the player’s best is good too', () => {
    expect(outcomeOf(firm, { best: 55 }).good).toBe(true);
    expect(outcomeOf(firm, { best: 70 }).good).toBe(false);
  });
});

describe('easier: the step down', () => {
  it(`steps Pro down to Assist after ${STEP_DOWN_AFTER} crashes in a row, not before; Advanced to Pro`, () => {
    let p = newPerf();
    for (let k = 1; k < STEP_DOWN_AFTER; k++) { p = fly(p, [crash]); expect(decide(p, { tier: 'pro' }).stepDown).toBe(null); }
    p = fly(p, [crash]);
    expect(decide(p, { tier: 'pro' }).stepDown).toBe('assist');
    expect(decide(p, { tier: 'advanced' }).stepDown).toBe('pro');
    expect(decide(p, { tier: 'assist' }).stepDown).toBe(null);   // nowhere lower
  });
  it('only while Adapt to me is on', () => {
    const p = fly(newPerf(), [crash, crash, crash]);
    expect(decide(p, { tier: 'pro', adapt: false }).stepDown).toBe(null);
  });
  it('a clean run, or a change of tier, starts the count over', () => {
    let p = fly(newPerf(), [crash, crash, soft, crash, crash]);
    expect(decide(p, { tier: 'pro' }).stepDown).toBe(null);
    p = afterChange(fly(newPerf(), [crash, crash]));
    expect(decide(fly(p, [crash]), { tier: 'pro' }).stepDown).toBe(null);
  });
  it('the sheet that steps down shows no Rookie offer; the next crash does', () => {
    let p = fly(newPerf(), [crash, crash, crash]);
    expect(decide(p, { tier: 'pro', level: 'standard' })).toMatchObject({ stepDown: 'assist', rookie: false });
    p = afterChange(p);   // the step happened (tier crashes reset); Rookie's streak keeps going
    p = fly(p, [crash]);
    expect(decide(p, { tier: 'assist', level: 'standard' })).toMatchObject({ stepDown: null, rookie: true });
  });
  it('Rookie mode is exactly 0074’s offer when nothing steps down', () => {
    for (let n = 0; n < 6; n++) {
      const p = fly(newPerf(), Array(n).fill(crash));
      for (const [level, tier] of [['standard', 'assist'], ['easy', 'assist'], ['easy', 'pro'], ['advanced', 'advanced']]) {
        expect(decide(p, { tier, level, adapt: false }).rookie).toBe(offerRookie(n, level, tier));
      }
    }
  });
});

describe('harder: the offer', () => {
  it(`every ${STEP_UP_AFTER} good runs in a row: Easy → Standard driving first, then Assist → Pro, then Pro → Advanced`, () => {
    let p = fly(newPerf(), [soft, soft]);
    expect(decide(p, { tier: 'assist', level: 'easy' })).toMatchObject({ offerLevel: null, offerTier: null });
    p = fly(p, [soft]);
    expect(decide(p, { tier: 'assist', level: 'easy' })).toMatchObject({ offerLevel: 'standard', offerTier: null });
    expect(decide(p, { tier: 'assist', level: 'standard' })).toMatchObject({ offerLevel: null, offerTier: 'pro' });
    expect(decide(p, { tier: 'pro', level: 'standard' }).offerTier).toBe('advanced');
    expect(decide(p, { tier: 'advanced', level: 'standard' }).offerTier).toBe(null);
    // Not every run after: the fourth is quiet, the sixth asks again.
    p = fly(p, [soft]);
    expect(decide(p, { tier: 'assist' }).offerTier).toBe(null);
    p = fly(p, [soft, soft]);
    expect(decide(p, { tier: 'assist' }).offerTier).toBe('pro');
  });
  it('a firm landing or a crash breaks the good streak; offered regardless of Adapt to me (never forced)', () => {
    expect(decide(fly(newPerf(), [soft, soft, firm]), { tier: 'assist' }).offerTier).toBe(null);
    expect(decide(fly(newPerf(), [soft, crash, soft, soft]), { tier: 'assist' }).offerTier).toBe(null);
    expect(decide(fly(newPerf(), [soft, soft, soft]), { tier: 'assist', adapt: false }).offerTier).toBe('pro');
  });
  it('the words name the factor', () => {
    expect(offerWords({ offerTier: 'pro' }).label).toBe('Ready for Pro? ×1.08');
    expect(offerWords({ offerTier: 'advanced' }).label).toBe('Ready for Advanced? ×1.15');
    expect(offerWords({ offerLevel: 'standard' }).label).toMatch(/standard driving/i);
    expect(stepDownBanner('pro', 'assist')).toBe('AI Assist turned on: 3 crashes in a row on Pro.');
    expect(stepDownBanner('advanced', 'pro')).toBe('Pro turned on: 3 crashes in a row on Advanced.');
  });
});

describe('who gets live pointers', () => {
  it(`a new player's first ${NEW_PLAYER_RUNS} runs, or two crashes in a row with Adapt to me on`, () => {
    expect(coachLive(newPerf(), 0)).toBe(true);
    expect(coachLive(newPerf(), NEW_PLAYER_RUNS - 1)).toBe(true);
    expect(coachLive(newPerf(), NEW_PLAYER_RUNS)).toBe(false);
    const p = fly(newPerf(), [crash, crash]);
    expect(struggling(p)).toBe(true);
    expect(coachLive(p, 50)).toBe(true);
    expect(coachLive(p, 50, false)).toBe(false);
  });
  it('the ladder', () => {
    expect([stepDownOf('advanced'), stepDownOf('pro'), stepDownOf('assist')]).toEqual(['pro', 'assist', null]);
    expect([stepUpOf('assist'), stepUpOf('pro'), stepUpOf('advanced')]).toEqual(['pro', 'advanced', null]);
  });
});

describe('storage', () => {
  it('keeps the counts; blocked or junk storage is a fresh start, never a throw', () => {
    const s = memStore();
    const p = fly(newPerf(), [crash, crash]);
    savePerf(p, s);
    expect(loadPerf(s)).toMatchObject({ crashes: 2, tierCrashes: 2, good: 0, runs: 2 });
    s.setItem('coldgas_perf', '{nope');
    expect(loadPerf(s)).toEqual(newPerf());
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadPerf(blocked)).toEqual(newPerf());
    expect(() => savePerf(p, blocked)).not.toThrow();
    expect(loadFlown(blocked)).toBe(0);
    saveFlown(7, s); expect(loadFlown(s)).toBe(7);
  });
  it('Adapt to me is on unless it was turned off', () => {
    const s = memStore();
    expect(loadAdapt(s)).toBe(true);
    saveAdapt(false, s); expect(loadAdapt(s)).toBe(false);
    saveAdapt(true, s); expect(loadAdapt(s)).toBe(true);
    expect(loadAdapt({ getItem: () => { throw new Error('x'); } })).toBe(true);
  });
});
