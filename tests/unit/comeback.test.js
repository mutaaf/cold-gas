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
