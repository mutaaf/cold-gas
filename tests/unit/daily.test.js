import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { setUnits } from '../../src/units.js';
import { OBJECTIVES, objectiveIndex, objectiveFor, evaluate, dayNumber, dayKey, keyToDay, readStreak, streakNow, complete,
  loadStreak, saveStreak, EPOCH, DAY_MS, missLine, titleHint, dailyCoach, dailyItems } from '../../src/daily.js';
import { newInput } from '../../src/sim/vehicle.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { createOneThumb, thumbStage, markOffset, THUMB } from '../../src/onethumb.js';
import { COURSES } from '../../src/sim/courses.js';
import { coach } from '../../src/sim/coach.js';
import { coachWords, pickPointer } from '../../src/pointer.js';

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
    expect(byId('mark-lineup').goal()).toBe('Roll two turns and land within 4 m of the mark');
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
    // 0198: the Lineup's days ask for two turns; its reference flies the reveal's one.
    expect(cards.lineup.facts.rotations).toBe(1);
    expect(evaluate(byId('roll-lineup'), cards.lineup, 'lineup')).toEqual({ ok: false, miss: `rolled ${cards.lineup.facts.rollDeg}°, need 720°`, fix: true, turns: true });
    expect(evaluate(byId('mark-lineup'), cards.lineup, 'lineup').ok).toBe(false);
  });

  it('says why not, with the number', () => {
    // Pro or better: the reference is an Assist run.
    expect(evaluate(byId('pro-wall'), cards.wall, 'wall')).toEqual({ ok: false, miss: 'fly it on Pro or Advanced' });
    // The roofs: the reference clears them by 5.1 m.
    expect(evaluate(byId('skim-show'), cards.show, 'show')).toEqual({ ok: false, miss: 'cleared by 16.7 ft', fix: true });
    // A run that never got there.
    expect(evaluate(byId('mark-show'), cards.idle, 'show')).toEqual({ ok: false, miss: 'no clean landing yet' });
    expect(evaluate(byId('ninety-show'), cards.idle, 'show').miss).toMatch(/^\d+\.\d, need 90$/);
    // A miss off the mark, in the player's units.
    const off = { ...cards.show, facts: { ...cards.show.facts, padMiss: 4.3 } };
    setUnits('metric', { persist: false });
    expect(evaluate(byId('mark-show'), off, 'show')).toEqual({ ok: false, miss: '4.3 m off the mark', fix: true });
    expect(evaluate(byId('pro-wall'), { ...cards.wall, tier: 'pro', total: 71.9 }, 'wall').miss).toBe('71.9, need 72');
    expect(evaluate(byId('pro-wall'), { ...cards.wall, tier: 'advanced', total: 72 }, 'wall').ok).toBe(true);
    // 0135's bars, at their edges: the mark at 3.5 m (Show) and 7 m (Lineup), gas over 25 %.
    const withFacts = (card, f) => ({ ...card, facts: { ...card.facts, ...f } });
    expect(evaluate(byId('mark-show'), withFacts(cards.show, { padMiss: 3.5 }), 'show').ok).toBe(true);
    expect(evaluate(byId('mark-show'), withFacts(cards.show, { padMiss: 3.6 }), 'show')).toEqual({ ok: false, miss: '3.6 m off the mark', fix: true });
    // 0198: the Lineup's mark day at its edge: two turns within 4 m.
    expect(evaluate(byId('mark-lineup'), withFacts(cards.lineup, { rotations: 2, padMiss: 4 }), 'lineup').ok).toBe(true);
    expect(evaluate(byId('mark-lineup'), withFacts(cards.lineup, { rotations: 2, padMiss: 4.1 }), 'lineup')).toEqual({ ok: false, miss: '4.1 m off the mark', fix: true });
    expect(evaluate(byId('mark-lineup'), withFacts(cards.lineup, { rotations: 2, padMiss: 1, contact: true }), 'lineup').miss).toBe('no clean landing yet');
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
    expect(missLine(gas, short, thumb)).toBe('Daily: 24 % gas left, need 26 % · hold the pad from the tap to the ground; letting go and then sliding costs gas');
  });
  it('on keys or classic touch it names their own controls, never the pad', () => {
    const k = missLine(gas, short, keys), c = missLine(gas, short, classic), pro = missLine(gas, short, { ...keys, tier: 'pro' });
    for (const line of [k, c, pro]) { expect(line).not.toMatch(/pad/); expect(line).toMatch(/^Daily: 24 % gas left, need 26 % · shorter BOOST/); }
    expect(k).toContain('BOOST (F)'); expect(k).toContain('LAND (Shift)');
    expect(c).toContain('one late LAND'); expect(c).not.toContain('(');
    expect(pro).toContain('LIFT (Space)');
  });
  it('a miss before the number ("land clean first") and the objectives with nothing to change keep "try again"', () => {
    expect(missLine(gas, gas.check({}, {}), thumb)).toBe('Daily: clear the row and land clean first — try again');
    const stick = byId('stick-wall');
    expect(missLine(stick, stick.check({ total: 80 }, { jumped: true }), thumb)).toMatch(/need 84 — try again$/);
    expect(missLine(gas, short, undefined)).toMatch(/^Daily: 24 % gas left, need 26 % · shorter BOOST/);   // no ctx: no throw
  });
  it('the title card hints only on one thumb, only on the days that name a choice (gas, skim; the Lineup’s call, 0198)', () => {
    expect(titleHint(gas, thumb)).toBe('Hold the pad from the tap');
    expect(titleHint(gas, thumb, true)).toBe('Hold the pad from the tap to the ground');   // the countdown's tip
    expect(titleHint(gas, keys)).toBe('');
    expect(titleHint(gas, classic)).toBe('');
    for (const o of OBJECTIVES.filter((x) => x !== gas && !['skim-show', 'roll-lineup', 'mark-lineup'].includes(x.id))) expect(titleHint(o, thumb)).toBe('');
  });
});

// 0150: the skim day asks one thumb for the opposite of the gas day: let go right after the tap and stay off. Held from the
// tap (the gas day's hint, and the sheet's "holding the pad in the air"), the computer carries the car 4.5 m over the roofs.
// The mark and ninety days' misses name the aim (one thumb: the slide onto the amber dot; keys and classic: the lean).
// Each hint is flown here literally, as a player would read it, with the page's own one-thumb code.
describe('the skim, mark and ninety days name the choice that meets them (0150)', () => {
  const thumb = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'show' };
  const keys = { device: 'key', scheme: 'classic', tier: 'assist', course: 'show' };
  const classic = { device: 'touch', scheme: 'classic', tier: 'assist', course: 'show' };
  const skim = byId('skim-show'), ninety = byId('ninety-show'), mark = byId('mark-show');
  // The Show on one thumb as main.js flies it (thumb-lift.test.js's harness): hold up the curl, stop on the ledge, tap and
  // hold; `lift` ticks after the tap the thumb comes off (-1: never); `aim`: holding in the air, follow the sight's dot.
  function flyThumb({ lift = -1, aim = false } = {}) {
    const run = createRun('show'), th = createOneThumb(), pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
    let released = false, ledgeT = -1, tapT = -1, next = 0, want = null;
    th.down();
    while (run.phase !== 'done') {
      const c = run.car, inp = newInput();
      if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
        if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
        if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
      }
      if (tapT > 0 && lift >= 0 && run.tick === tapT + lift) th.up();
      // "slide onto the amber dot, following it down": on the dot a reaction late, re-read every 0.3 s.
      if (aim && released && run.phase === 'air' && th.held) {
        if (run.tick >= next) {
          predict(c, Math.max(0, c.pos.y - SPEC.comHeight), pr);
          markOffset(c, pr, 'show', off, th.ref, th.refA, th.canA);
          want = { x: off.x, y: -off.y, at: run.tick + 60 };
          next = run.tick + 72;
        }
        if (want && run.tick >= want.at) th.move(want.x, want.y);
      }
      th.sample(run, released, inp);
      if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
      inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
      stepRun(run, inp);
    }
    return run;
  }
  let held, heldRun;
  beforeAll(() => { heldRun = flyThumb(); held = scoreRun(heldRun.t); });

  it('held from the tap (the gas day\'s way) misses the skim, and the miss names the thumb\'s choice, not "try again"', () => {
    const r = evaluate(skim, held, 'show');
    expect(r.ok).toBe(false);
    expect(held.facts.clearance).toBeGreaterThan(4);
    const line = missLine(skim, r, thumb);
    expect(line).toMatch(/^Daily: cleared by 14\.\d ft · let go of the pad right after the tap and stay off it/);
    expect(line).not.toMatch(/try again/);
  });

  it('flown as the hint says (let go 0.1–0.5 s after the tap, stay off), every flight meets the skim', () => {
    for (let lift = 24; lift <= 120; lift += 12) {
      const s = scoreRun(flyThumb({ lift }).t);
      expect(evaluate(skim, s, 'show').ok, `lift ${lift} ticks after the tap: ${s.facts.clearance} m`).toBe(true);
      expect(s.facts.sink, `lift ${lift}`).toBeLessThanOrEqual(1.5);
    }
    // The window "right after the tap" names: lifted at 0.7 s, the car is carried high again.
    expect(evaluate(skim, scoreRun(flyThumb({ lift: 168 }).t), 'show').ok).toBe(false);
  }, 120000);

  it('keys and classic touch name their own controls (a short BOOST, a late LAND), never the pad', () => {
    const r = skim.check({}, { jumped: true, crossedRow: true, clearance: 4.5 });
    const k = missLine(skim, r, keys), c = missLine(skim, r, classic);
    expect(k).toBe('Daily: cleared by 14.8 ft · one short BOOST (F) burst, not to the cue, and LAND (Shift) late, once you’re low over the pad');
    expect(c).toBe('Daily: cleared by 14.8 ft · one short BOOST burst, not to the cue, and LAND late, once you’re low over the pad');
    for (const line of [k, c]) expect(line).not.toMatch(/the pad from|let go of the pad|try again/);
    // Off Assist, LAND isn't the brake: the hint names LIFT, as the gas day's does.
    expect(missLine(skim, r, { ...keys, tier: 'pro' })).toMatch(/and LIFT \(Space\) late/);
    expect(missLine(skim, r, { ...classic, tier: 'advanced' })).toMatch(/and the four down-jet pads late/);
  });

  it('on a missed skim, the sheet\'s NEXT RUN line never tells one thumb to hold the pad in the air', () => {
    const r = evaluate(skim, held, 'show');
    const items = coach(heldRun.inputLog, 'show', held, 0, coachWords(thumb)).items;
    expect(pickPointer(items, thumb, { card: held }).text).toMatch(/hold/i);   // what it says without the Daily
    const p = pickPointer(items, thumb, { card: held, daily: dailyCoach(skim, r, thumb) });
    expect(p.text).toBe('For the Daily: let go of the pad right after the tap and stay off it');
    expect(p.text).not.toMatch(/\bhold/i);
    // And the "What happened" list under it: no item says to hold the pad either.
    expect(items.some((it) => /hold the pad/i.test(it.fix))).toBe(true);   // what it says without the Daily
    const shown = dailyItems(items, dailyCoach(skim, r, thumb));
    for (const it of shown) expect(it.fix, it.id).not.toMatch(/\bhold(ing)? the pad/i);
    expect(shown.map((it) => it.id)).toEqual(items.map((it) => it.id));
    expect(dailyItems(items, '')).toBe(items);
    // Met, or not a skim day, or not one thumb: the coach's own line.
    expect(dailyCoach(skim, { ok: true, miss: '' }, thumb)).toBe('');
    expect(dailyCoach(skim, r, keys)).toBe('');
    expect(dailyCoach(byId('gas-show'), byId('gas-show').check({}, { jumped: true, crossedRow: true, airPct: 20 }), thumb)).toBe('');
    expect(dailyCoach(skim, skim.check({}, {}), thumb)).toBe('');   // "land clean first": no fix to stand in for
  });

  it('the skim day\'s title hint is short on the card and whole in the countdown, on one thumb only', () => {
    expect(titleHint(skim, thumb)).toBe('Let go right after the tap');
    expect(titleHint(skim, thumb, true)).toBe('Let go right after the tap and stay off the pad');
    expect(titleHint(skim, keys)).toBe('');
    expect(titleHint(skim, classic)).toBe('');
  });

  it('mark and ninety: a clean landing 6 m off names the slide on one thumb and the lean on keys and classic touch', () => {
    expect(held.facts.padMiss).toBeGreaterThan(5);
    expect(held.total).toBeLessThan(90);
    for (const o of [mark, ninety]) {
      const r = evaluate(o, held, 'show');
      expect(r.ok).toBe(false);
      expect(missLine(o, r, thumb)).toMatch(/ · hold the pad in the air and slide onto the amber dot, following it down$/);
      for (const ctx of [keys, classic]) {
        const line = missLine(o, r, ctx);
        expect(line).toContain(' · lean toward the pad (pitch or roll) above');
        expect(line).not.toMatch(/amber dot|try again/);
      }
    }
    // A crash, or a landing on the mark that scored under 90 for something else: nothing to aim, "try again".
    expect(missLine(ninety, ninety.check({ total: 60 }, { jumped: true, crashed: true, padMiss: 9 }), thumb)).toBe('Daily: 60.0, need 90 — try again');
    expect(missLine(ninety, ninety.check({ total: 84 }, { jumped: true, crossedRow: true, padMiss: 2 }), thumb)).toBe('Daily: 84.0, need 90 — try again');
    // Off the mark but also scraped the row, or touched down hard: the aim isn't what cost it.
    expect(missLine(ninety, ninety.check({ total: 70 }, { jumped: true, crossedRow: true, contact: true, padMiss: 6 }), thumb)).toBe('Daily: 70.0, need 90 — try again');
    expect(missLine(ninety, ninety.check({ total: 72 }, { jumped: true, crossedRow: true, padMiss: 6, sink: 2.4 }), thumb)).toBe('Daily: 72.0, need 90 — try again');
    expect(missLine(mark, mark.check({}, {}), thumb)).toBe('Daily: no clean landing yet — try again');
  });

  it('flown as the aim hint says (held, following the amber dot down), one thumb meets ninety and lands nearer the mark', () => {
    const s = scoreRun(flyThumb({ aim: true }).t);
    expect(s.facts.crashed).toBe(false);
    expect(evaluate(ninety, s, 'show').ok, `${s.total} at ${s.facts.padMiss} m`).toBe(true);
    // The mark day's 3.5 m is the slide's precision (a reaction-late thumb lands 2.0–4.5 m: 0164, 0165), not its direction.
    expect(s.facts.padMiss).toBeLessThan(held.facts.padMiss - 1);
  }, 60000);
  afterEach(() => setUnits('us', { persist: false }));
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

// 0198: on a phone the Lineup's Daily asks for the one thumb's choice (0191), not a thumb that only held the pad. Held from
// Go and never moved, the computer flies a clean 360 1.3 m off the mark: it met both old days. Now it meets neither; slid
// up on the run-up for two turns and brought onto the mark, it meets both. Each miss says what to do in the pad's words.
describe('the Lineup’s Daily on one thumb (0198)', () => {
  const thumb = { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'lineup' };
  const keys = { device: 'key', scheme: 'classic', tier: 'assist', course: 'lineup' };
  const roll = byId('roll-lineup'), mark = byId('mark-lineup');
  // One thumb down a reaction after Go; `slides`: [z, dy px] — at each z the held thumb is moved to dy px up the glass.
  const fly = (slides = []) => {
    const run = createRun('lineup'), th = createOneThumb();
    let next = 0;
    while (run.phase !== 'done') {
      const inp = newInput();
      if (run.tick === 60) th.down();
      while (th.held && next < slides.length && run.car.pos.z > slides[next][0]) th.move(0, slides[next++][1]);
      th.sample(run, false, inp);
      stepRun(run, inp);
    }
    return scoreRun(run.t);
  };
  let held, called, aimed;
  beforeEach(() => setUnits('metric', { persist: false }));
  afterEach(() => setUnits('us', { persist: false }));
  beforeAll(() => {
    held = fly();
    called = fly([[-60, THUMB.aimPx]]);
    aimed = fly([[-60, THUMB.aimPx], [COURSES.lineup.lineupEnd + 1, 0]]);
  }, 60_000);

  it('held from Go and never moved: a clean 360 near the mark, and neither Lineup objective', () => {
    expect(held.facts.rotations).toBe(1);
    expect(held.facts.contact).toBe(false);
    expect(held.facts.padMiss).toBeLessThan(2);
    for (const o of [roll, mark]) {
      const r = evaluate(o, held, 'lineup');
      expect(r.ok, o.id).toBe(false);
      expect(r.miss, o.id).toBe(`rolled ${held.facts.rollDeg}°, need 720°`);
      expect(missLine(o, r, thumb), o.id).toBe(`Daily: rolled ${held.facts.rollDeg}°, need 720° · slide up on the run-up for two turns`);
      expect(dailyCoach(o, r, thumb), o.id).toBe('For the Daily: slide up on the run-up for two turns');
    }
  });

  it('slid up on the run-up: two turns meet the roll day; never aimed, the 720 is off the mark and the miss names the dot', () => {
    expect(called.facts.rotations).toBe(2);
    expect(evaluate(roll, called, 'lineup').ok).toBe(true);
    const r = evaluate(mark, called, 'lineup');
    expect(called.facts.padMiss).toBeGreaterThan(4);
    expect(r).toEqual({ ok: false, miss: `${called.facts.padMiss} m off the mark`, fix: true });
    expect(missLine(mark, r, thumb)).toBe(`Daily: ${called.facts.padMiss} m off the mark · hold the pad in the air and slide onto the amber dot, following it down`);
    expect(dailyCoach(mark, r, thumb)).toBe('');   // the coach's own aim line stays
  });

  it('two turns slid onto the mark meet both', () => {
    expect(aimed.facts.rotations).toBe(2);
    expect(aimed.facts.padMiss).toBeLessThanOrEqual(4);
    for (const o of [roll, mark]) expect(evaluate(o, aimed, 'lineup'), o.id).toEqual({ ok: true, miss: '' });
  });

  it('the title says the call on one thumb; keys and two thumbs get no way that isn’t modelled (phone-first)', () => {
    expect(titleHint(roll, thumb)).toBe('Slide up on the run-up');
    expect(titleHint(roll, thumb, true)).toBe('Slide up on the run-up for two turns');
    expect(titleHint(mark, thumb, true)).toBe('Slide up on the run-up, then onto the amber dot');
    const r = evaluate(roll, held, 'lineup');
    expect(missLine(roll, r, keys)).toBe(`Daily: rolled ${held.facts.rollDeg}°, need 720° — try again`);
    expect(titleHint(roll, keys)).toBe('');
    expect(dailyCoach(roll, r, keys)).toBe('');
  });
});
