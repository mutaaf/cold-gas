import { describe, it, expect, beforeAll } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { decodeChallenge, vsFromHash, coarsen, VS_TARGET_CHARS } from '../../src/challenge.js';
import { createComeback } from '../../src/comeback.js';

// The link a Share carries (src/comeback.js prepare): lossless when it fits; a log too dense for ~2,000
// characters is sent coarsened only when the coarser run flies the same verdict within a point, with
// the score it really scores; else the long lossless link.
let ref, grid;   // the reference flight; the same flight on a 5-hundredths grid (its own run, flown)
beforeAll(() => {
  const run = createRun('show'), ap = createAutopilot('show');
  while (run.phase !== 'done') stepRun(run, ap(run));
  ref = { log: run.inputLog, card: scoreRun(run.t) };
  const log = coarsen(ref.log, 5);
  grid = { log, card: scoreRun(simulate(log, 'show').t) };
}, 60_000);

const BASE = 'https://mutaafaziz.com/coldgas/';
const linkOf = async (run, card) => {
  const cb = createComeback({ mount: null, resultMount: null, base: BASE, selectCourse() {}, getTier: () => 'assist', setTier() {}, jump() {}, ready: async () => {}, toast() {}, share() {} });
  cb.results(run, card);
  return cb.linkFor(card);
};
// A run on the 5-hundredths grid with a jitter laid over its first 3,000 ticks (a thumb that never sits
// still): ±2 hundredths on the pedals, the stick and LAND, every tick. Coarsened to 5 hundredths it is the grid run again.
let seed = 9;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function jittered(amp) {
  const at = new Map(grid.log.map((e) => [e[0], e]));
  const out = [];
  let cur = grid.log[0].slice(1);
  for (let t = 0; t <= grid.log.at(-1)[0]; t++) {
    if (at.has(t)) cur = at.get(t).slice(1);
    const e = [t, ...cur];
    if (t < 3000) for (const c of [0, 1, 2, 3, 4, 5, 9]) e[1 + c] = Math.max(-100, Math.min(100, cur[c] + Math.round((rnd() - 0.5) * 2 * amp))) || 0;   // pedals, steer, pitch, roll, yaw, level (never -0: a log is Int16)
    out.push(e);
  }
  return out.filter((e, i) => i === 0 || e.some((v, k) => k > 0 && v !== out[i - 1][k]));
}

describe('the share link', () => {
  it('carries a whole Show run losslessly, well under the target', async () => {
    const link = await linkOf({ inputLog: ref.log, course: 'show' }, ref.card);
    expect(link.length).toBeLessThan(VS_TARGET_CHARS);
    const d = await decodeChallenge(vsFromHash(link.slice(link.indexOf('#'))));
    expect(d.log).toEqual(ref.log);
    expect(d.score).toBe(ref.card.total);
  });

  it('a log too dense to fit is coarsened, re-flown and sent with the score it really scores', async () => {
    const dense = jittered(2);
    const link = await linkOf({ inputLog: dense, course: 'show' }, grid.card);
    expect(link.length).toBeLessThan(2000);
    const d = await decodeChallenge(vsFromHash(link.slice(link.indexOf('#'))));
    expect(d.log).toEqual(grid.log);         // coarsened to 5, the jitter is gone: the grid run again
    expect(d.score).toBe(grid.card.total);   // the score it really scores, re-flown
  }, 60_000);

  it('if no coarser log flies the same verdict, the long lossless link (browsers take it), never a wrong score', async () => {
    const dense = jittered(2);
    const link = await linkOf({ inputLog: dense, course: 'show' }, { ...grid.card, verdict: 'Something else' });
    const d = await decodeChallenge(vsFromHash(link.slice(link.indexOf('#'))));
    expect(link.length).toBeGreaterThan(2000);
    expect(d.log).toEqual(dense);
  }, 120_000);

  it('no run (the reference jump, a drill): the plain address', async () => {
    const cb = createComeback({ mount: null, resultMount: null, base: BASE, selectCourse() {}, getTier: () => 'assist', setTier() {}, jump() {}, ready: async () => {}, toast() {}, share() {} });
    cb.results({ inputLog: ref.log, course: 'show' }, ref.card, { autopilot: true });
    expect(await cb.linkFor(ref.card)).toBe(BASE);
  });
});

// 0136: the players' funnel tells a Daily met from a Daily missed (daily-run, kept one release, meant a miss).
describe('the daily in the funnel', () => {
  const MARK_DAY = 20770 * 86_400_000 + 3_600_000;   // a UTC day whose objective is mark-show (asserted below)
  const cbAt = (ms) => createComeback({ mount: null, resultMount: null, base: BASE, selectCourse() {}, getTier: () => 'assist', setTier() {}, jump() {}, ready: async () => {}, toast() {}, share() {}, now: () => ms });
  const counted = async (card, course = 'show') => {
    const { obs } = await import('../../src/obs/index.js');
    obs.sendEnabled = false;
    obs.flush('test', { force: true });
    cbAt(MARK_DAY).results({ inputLog: ref.log, course }, card);
    const p = { ...obs.payload().play };
    obs.flush('test', { force: true });
    return p;
  };
  it('the day is a mark-show day', async () => {
    const { objectiveFor } = await import('../../src/daily.js');
    expect(objectiveFor(MARK_DAY).id).toBe('mark-show');
  });
  it('a met Daily counts daily-done, and no miss', async () => {
    expect(ref.card.facts.padMiss).toBeLessThanOrEqual(3);   // the reference lands on the mark
    expect(await counted(ref.card)).toEqual({ 'daily-done': 1 });
  });
  it('a missed Daily counts daily-miss, and still daily-run for one release', async () => {
    const card = { ...ref.card, facts: { ...ref.card.facts, padMiss: 6 } };
    expect(await counted(card)).toEqual({ 'daily-miss': 1, 'daily-run': 1 });
  });
  it('a run on another course is not a Daily run', async () => {
    expect(await counted(ref.card, 'wall')).toEqual({});
  });
  it('the new names are funnel events; an unknown one is still dropped', async () => {
    const { PLAY_EVENTS } = await import('../../src/obs/signature.js');
    expect(PLAY_EVENTS).toEqual(expect.arrayContaining(['daily-start', 'daily-miss', 'daily-done', 'daily-run']));
    const { obs } = await import('../../src/obs/index.js');
    obs.sendEnabled = false;
    obs.flush('test', { force: true });
    obs.play('daily-start'); obs.play('daily-started');
    expect(obs.payload().play).toEqual({ 'daily-start': 1 });
    obs.flush('test', { force: true });
  });
});

// 0139: the results' Daily line on a gas day says what to change, in the words of the device the run was flown on.
describe('the gas day’s miss line', () => {
  const GAS_DAY = Date.parse('2026-11-15T12:00:00Z');
  const stub = () => ({ innerHTML: '', replaceChildren() { this.innerHTML = ''; }, querySelector: () => null });
  const lineOf = (card, ctx) => {
    const resultMount = stub(), asked = [];
    const cb = createComeback({ mount: null, resultMount, base: BASE, selectCourse() {}, getTier: () => 'assist', setTier() {}, jump() {}, ready: async () => {}, toast() {}, share() {}, now: () => GAS_DAY,
      how: (course, tier) => { asked.push([course, tier]); return { ...ctx, tier, course }; } });
    cb.results({ inputLog: ref.log, course: 'show' }, card);
    return { line: resultMount.innerHTML.replace(/<[^>]+>/g, ''), asked };
  };
  const short = () => ({ ...ref.card, facts: { ...ref.card.facts, airPct: 24 } });
  it('the day is a gas-show day', async () => {
    const { objectiveFor } = await import('../../src/daily.js');
    expect(objectiveFor(GAS_DAY).id).toBe('gas-show');
  });
  it('flown on one thumb, a miss names the pad and the hold; on keys it names no pad', () => {
    const t = lineOf(short(), { device: 'touch', scheme: 'thumb' });
    expect(t.line).toBe('Daily: 24 % gas left, need 26 % · hold the pad from the tap to the ground; lifting and sliding costs gas');
    expect(t.asked).toEqual([['show', ref.card.tier]]);   // asked for the run's course and tier
    const k = lineOf(short(), { device: 'key', scheme: 'classic' });
    expect(k.line).not.toMatch(/pad/);
    expect(k.line).toContain('BOOST (F)');
  });
  it('a met gas Daily is unchanged', () => {
    expect(ref.card.facts.airPct).toBeGreaterThan(25);
    expect(lineOf(ref.card, { device: 'touch', scheme: 'thumb' }).line).toMatch(/^Daily ✓ complete · streak \d+$/);
  });
});
