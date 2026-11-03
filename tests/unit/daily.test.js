import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { setUnits } from '../../src/units.js';
import { OBJECTIVES, objectiveIndex, objectiveFor, evaluate, dayNumber, dayKey, keyToDay, readStreak, streakNow, complete,
  loadStreak, saveStreak, EPOCH, DAY_MS, missLine, titleHint } from '../../src/daily.js';

// The daily jump (src/daily.js): one objective a UTC day for everyone, judged from scoreRun's card,
// and a streak of consecutive UTC days.
const at = (iso) => Date.parse(iso);
const byId = (id) => OBJECTIVES.find((o) => o.id === id);

describe('the daily objective', () => {
  it('is the same for every caller on a UTC day, whatever the time of day or the order asked', () => {
    const a = objectiveFor(at('2026-10-30T00:00:00Z')), b = objectiveFor(at('2026-10-30T23:59:59.999Z'));
    expect(a).toBe(b);
    // Asked out of order (the memo walks forward; going back restarts from the epoch): same answers.
    const days = Array.from({ length: 400 }, (_, i) => EPOCH - 20 + i);
    const forward = days.map(objectiveIndex);
    const shuffled = [...days].reverse().map(objectiveIndex).reverse();
    expect(shuffled).toEqual(forward);
    expect(objectiveIndex(EPOCH + 3000)).toBe(objectiveIndex(EPOCH + 3000));
  });

  it('changes at UTC midnight, not local midnight (a phone in Tokyo and one in LA see the same)', () => {
    // 2026-10-30 23:30 in Los Angeles is 2026-10-31 06:30 UTC; 2026-10-31 08:00 in Tokyo is 2026-10-30 23:00 UTC.
    expect(dayKey(at('2026-10-30T23:30:00-07:00'))).toBe('2026-10-31');
    expect(dayKey(at('2026-10-31T08:00:00+09:00'))).toBe('2026-10-30');
    expect(objectiveFor(at('2026-10-31T08:00:00+09:00'))).toBe(objectiveFor(at('2026-10-30T12:00:00Z')));
  });

  it('never repeats on consecutive days, and every objective comes up over a season', () => {
    const seen = new Set();
    for (let d = EPOCH + 1; d < EPOCH + 730; d++) {
      expect(objectiveIndex(d)).not.toBe(objectiveIndex(d - 1));
      seen.add(objectiveIndex(d));
    }
    expect(seen.size).toBe(OBJECTIVES.length);
  });

  it('is pinned for known dates (a change to the pick is a change everyone sees: bump on purpose)', () => {
    const pins = ['2026-10-30', '2026-10-31', '2026-11-01', '2027-01-01'].map((k) => objectiveFor(Date.parse(`${k}T12:00:00Z`)).id);
    expect(pins).toMatchInlineSnapshot(`
      [
        "soft-wall",
        "roll-lineup",
        "soft-wall",
        "stick-wall",
      ]
    `);
  });

  it('every objective names its course and reads in the player’s units', () => {
    for (const o of OBJECTIVES) {
      expect(['show', 'wall', 'lineup']).toContain(o.course);
      expect(o.goal()).toMatch(/\S/);
    }
    expect(byId('mark-show').goal()).toBe('Land within 11.5 ft of the mark');
    setUnits('metric', { persist: false });
    expect(byId('mark-show').goal()).toBe('Land within 3.5 m of the mark');
    expect(byId('mark-lineup').goal()).toBe('Land within 7 m of the mark');
  });
  afterEach(() => setUnits('us', { persist: false }));
});

describe('the daily, judged from real runs', () => {
  const cards = {};
  beforeAll(() => {
    for (const course of ['show', 'wall', 'lineup']) {
      const run = createRun(course), ap = createAutopilot(course);
      while (run.phase !== 'done') stepRun(run, ap(run));
      cards[course] = scoreRun(run.t);
    }
    // A crash on the Show: full throttle into the Wall, never let go (it never reaches the row).
    const run = createRun('show');
    while (run.phase !== 'done') stepRun(run, { throttle: 1, assist: 1 });
    cards.idle = scoreRun(run.t);
  }, 60_000);   // four flights: well under a second alone, longer beside the whole suite

  it('counts only on the objective’s course', () => {
    expect(evaluate(byId('mark-show'), cards.wall, 'wall')).toBeNull();
    expect(evaluate(byId('pro-wall'), { ...cards.show, tier: 'pro' }, 'show')).toBeNull();
    expect(evaluate(byId('soft-wall'), cards.show, 'show')).toBeNull();
  });

  it('the reference flights complete what a clean, precise Assist flight should', () => {
    // The Show's reference: 1.5 m from the mark, 48 % gas, 94.0 on Assist, clean.
    expect(evaluate(byId('mark-show'), cards.show, 'show')).toEqual({ ok: true, miss: '' });
    expect(evaluate(byId('gas-show'), cards.show, 'show').ok).toBe(true);
    expect(evaluate(byId('ninety-show'), cards.show, 'show').ok).toBe(true);
    expect(evaluate(byId('scratch-show'), cards.show, 'show').ok).toBe(true);
    expect(evaluate(byId('soft-wall'), cards.wall, 'wall').ok).toBe(true);
    expect(evaluate(byId('stick-wall'), cards.wall, 'wall').ok).toBe(true);
    expect(evaluate(byId('roll-lineup'), cards.lineup, 'lineup').ok).toBe(true);
    expect(evaluate(byId('mark-lineup'), cards.lineup, 'lineup').ok).toBe(true);
  });

  it('says why not, with the number', () => {
    // Pro or better: the reference is an Assist run.
    expect(evaluate(byId('pro-wall'), cards.wall, 'wall')).toEqual({ ok: false, miss: 'fly it on Pro or Advanced' });
    // The roofs: the reference clears them by 5.1 m.
    expect(evaluate(byId('skim-show'), cards.show, 'show')).toEqual({ ok: false, miss: 'cleared by 16.7 ft' });
    // A run that never got there.
    expect(evaluate(byId('mark-show'), cards.idle, 'show')).toEqual({ ok: false, miss: 'no clean landing yet' });
    expect(evaluate(byId('ninety-show'), cards.idle, 'show').miss).toMatch(/^\d+\.\d, need 90$/);
    // A miss off the mark, in the player's units.
    const off = { ...cards.show, facts: { ...cards.show.facts, padMiss: 4.3 } };
    setUnits('metric', { persist: false });
    expect(evaluate(byId('mark-show'), off, 'show')).toEqual({ ok: false, miss: '4.3 m off the mark' });
    expect(evaluate(byId('pro-wall'), { ...cards.wall, tier: 'pro', total: 79.4 }, 'wall').miss).toBe('79.4, need 85');
    expect(evaluate(byId('pro-wall'), { ...cards.wall, tier: 'advanced', total: 85 }, 'wall').ok).toBe(true);
    // 0135's bars, at their edges: the mark at 3.5 m (Show) and 7 m (Lineup), gas over 25 %.
    const withFacts = (card, f) => ({ ...card, facts: { ...card.facts, ...f } });
    expect(evaluate(byId('mark-show'), withFacts(cards.show, { padMiss: 3.5 }), 'show').ok).toBe(true);
    expect(evaluate(byId('mark-show'), withFacts(cards.show, { padMiss: 3.6 }), 'show')).toEqual({ ok: false, miss: '3.6 m off the mark' });
    expect(evaluate(byId('mark-lineup'), withFacts(cards.lineup, { padMiss: 7 }), 'lineup').ok).toBe(true);
    expect(evaluate(byId('mark-lineup'), withFacts(cards.lineup, { padMiss: 7.1 }), 'lineup').ok).toBe(false);
    expect(evaluate(byId('gas-show'), withFacts(cards.show, { airPct: 26 }), 'show').ok).toBe(true);
    expect(evaluate(byId('gas-show'), withFacts(cards.show, { airPct: 25 }), 'show')).toEqual({ ok: false, miss: '25 % gas left, need 26 %', fix: true });
  });
  afterEach(() => setUnits('us', { persist: false }));
});

// 0139: a missed gas day names the choice that meets it, in this device's words (human-phone.mjs --daily's split: held
// from the tap 37/39 met, lifted and slid 5/80). Only the gas number gets the hint; "land clean first" stays as it was.
describe('what a miss can change (0139)', () => {
  const gas = byId('gas-show');
  const thumb = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'show' };
  const keys = { device: 'key', scheme: 'classic', tier: 'assist', course: 'show' };
  const classic = { device: 'touch', scheme: 'classic', tier: 'assist', course: 'show' };
  const short = gas.check({}, { jumped: true, crossedRow: true, airPct: 24 });
  it('on one thumb, a gas miss names the pad and the hold, and what costs it', () => {
    expect(missLine(gas, short, thumb)).toBe('Daily: 24 % gas left, need 26 % · hold the pad from the tap to the ground; lifting and sliding costs gas');
  });
  it('on keys or classic touch it names their own controls, never the pad', () => {
    const k = missLine(gas, short, keys), c = missLine(gas, short, classic), pro = missLine(gas, short, { ...keys, tier: 'pro' });
    for (const line of [k, c, pro]) { expect(line).not.toMatch(/pad/); expect(line).toMatch(/^Daily: 24 % gas left, need 26 % · shorter BOOST/); }
    expect(k).toContain('BOOST (F)'); expect(k).toContain('LAND (Shift)');
    expect(c).toContain('one late LAND'); expect(c).not.toContain('(');
    expect(pro).toContain('LIFT (Space)');
  });
  it('a miss before the number ("land clean first") and the other objectives keep "try again"', () => {
    expect(missLine(gas, gas.check({}, {}), thumb)).toBe('Daily: clear the row and land clean first — try again');
    const mark = byId('mark-show');
    expect(missLine(mark, mark.check({}, { jumped: true, padMiss: 5 }), thumb)).toMatch(/off the mark — try again$/);
    expect(missLine(gas, short, undefined)).toMatch(/^Daily: 24 % gas left, need 26 % · shorter BOOST/);   // no ctx: no throw
  });
  it('the title card hints only on one thumb, only on the gas day', () => {
    expect(titleHint(gas, thumb)).toBe('Hold the pad from the tap to the ground');
    expect(titleHint(gas, keys)).toBe('');
    expect(titleHint(gas, classic)).toBe('');
    for (const o of OBJECTIVES.filter((x) => x !== gas)) expect(titleHint(o, thumb)).toBe('');
  });
});

describe('the streak (UTC days)', () => {
  const d0 = at('2026-10-30T10:00:00Z');
  it('starts at 1, counts once a day, carries over consecutive UTC days, restarts after a gap', () => {
    let s = readStreak(null);
    expect(streakNow(s, d0)).toEqual({ streak: 0, doneToday: false, best: 0 });
    s = complete(s, d0);
    expect(s).toEqual({ last: '2026-10-30', streak: 1, best: 1 });
    expect(complete(s, d0 + 3600_000)).toBe(s);                      // twice the same day: once
    s = complete(s, at('2026-10-31T00:00:01Z'));                    // just past UTC midnight
    expect(s.streak).toBe(2);
    s = complete(s, at('2026-11-01T23:59:59Z'));
    expect(s).toEqual({ last: '2026-11-01', streak: 3, best: 3 });
    expect(streakNow(s, at('2026-11-02T12:00:00Z'))).toEqual({ streak: 3, doneToday: false, best: 3 });   // alive: yesterday counts
    expect(streakNow(s, at('2026-11-03T00:00:00Z')).streak).toBe(0);                                      // lapsed
    s = complete(s, at('2026-11-03T08:00:00Z'));
    expect(s).toEqual({ last: '2026-11-03', streak: 1, best: 3 });
  });

  it('a local evening and the next local morning are the same UTC day for a player west of Greenwich', () => {
    // 2026-10-30 20:00 and 2026-10-31 07:00 in UTC−5 are 2026-10-31 01:00 and 12:00 UTC: one day, one count.
    const s = complete(readStreak(null), at('2026-10-30T20:00:00-05:00'));
    expect(complete(s, at('2026-10-31T07:00:00-05:00'))).toBe(s);
  });

  it('crosses month and year ends', () => {
    let s = complete(readStreak(null), at('2026-12-31T12:00:00Z'));
    s = complete(s, at('2027-01-01T12:00:00Z'));
    expect(s.streak).toBe(2);
    expect(keyToDay('2027-01-01') - keyToDay('2026-12-31')).toBe(1);
    expect(dayNumber(at('2027-01-01T00:00:00Z')) * DAY_MS).toBe(at('2027-01-01T00:00:00Z'));
  });

  it('reads anything stored defensively, and storage that throws never breaks it', () => {
    expect(readStreak('not json')).toEqual({ last: '', streak: 0, best: 0 });
    expect(readStreak('{"last":"yesterday","streak":4}')).toEqual({ last: '', streak: 0, best: 0 });
    expect(readStreak('{"last":"2026-10-30","streak":-3,"best":"x"}')).toEqual({ last: '2026-10-30', streak: 0, best: 0 });
    expect(readStreak('{"last":"2026-10-30","streak":4,"best":2}')).toEqual({ last: '2026-10-30', streak: 4, best: 4 });
    const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(loadStreak(bad)).toEqual({ last: '', streak: 0, best: 0 });
    expect(() => saveStreak({ last: '2026-10-30', streak: 1, best: 1 }, bad)).not.toThrow();
    const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    saveStreak({ last: '2026-10-30', streak: 2, best: 5 }, store);
    expect(mem.has('coldgas_daily')).toBe(true);
    expect(loadStreak(store)).toEqual({ last: '2026-10-30', streak: 2, best: 5 });
  });
});
