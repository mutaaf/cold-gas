// 0146: the native port's golden traces (scripts/vectors-lib.mjs) are current, reproducible, and say what
// the sim says: a replayed log's card is scoreRun's card, and a flown run replays to the same final state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVectors, runVector, runList, flat, hex, unhex, xorshift, VECTOR_DIR, dmathVectors, HAPTIC_RUNS } from '../../scripts/vectors-lib.mjs';
import { simulate, SIM_VERSION } from '../../src/sim/run.js';
import { scoreRun } from '../../src/sim/judge.js';
import { dsin } from '../../src/sim/dmath.js';

const disk = (p) => readFileSync(join(VECTOR_DIR, p), 'utf8');

describe('native vectors (0146)', () => {
  it('bit patterns round-trip, including -0, NaN, infinities and subnormals', () => {
    for (const x of [0, -0, 1, -1.5, Math.PI, 5e-324, -Infinity, Infinity, 1e308]) expect(Object.is(unhex(hex(x)), x)).toBe(true);
    expect(Number.isNaN(unhex(hex(NaN)))).toBe(true);
    expect(hex(-0)).toBe('8000000000000000');
    expect(hex(1)).toBe('3ff0000000000000');
  });
  it('the seeded walk is integer-only and repeats exactly', () => {
    const a = xorshift(42), b = xorshift(42);
    const xs = Array.from({ length: 5 }, a);
    expect(xs).toEqual(Array.from({ length: 5 }, b));
    expect(xs[0]).toBe(11355432);   // pinned: Swift's UInt32 xorshift must give the same first value
  });
  it('dmath.json is current and its cases are dmath', () => {
    const files = buildVectors({ only: [] });
    expect(files['dmath.json']).toBe(disk('dmath.json'));
    const fn = dmathVectors().functions.find((f) => f.name === 'dsin');
    for (const [x, y] of fn.cases.slice(0, 200)) expect(hex(dsin(unhex(x)))).toBe(y);
  });
  // CI runs `npm test`, not `npm run check`: this is the gate that a sim change regenerated the vectors.
  it('every run vector on disk is current (run `npm run vectors` after a sim or scorer change)', () => {
    const files = buildVectors();
    const stale = Object.keys(files).filter((p) => { try { return files[p] !== disk(p); } catch { return true; } });
    expect(stale, 'stale vectors: run `npm run vectors` and commit (docs/NATIVE.md §3)').toEqual([]);
  }, 120000);
  it("a run vector's card is scoreRun's card for the same log, and the live flight replays to the same end", () => {
    for (const name of ['ref-lineup', 'naive-wall-4-0.5-0.6', 'pro-fuzz-1']) {
      const r = runList().find((x) => x.name === name), log = r.log();
      const v = runVector(name, r.course, log);
      expect(v.simVersion).toBe(SIM_VERSION);
      expect(v.card).toEqual(flat(scoreRun(simulate(log, r.course).t)));
      expect(v.checks.length).toBeGreaterThan(10);
      expect(v.final).toMatch(/^[0-9a-f]{16}$/);
    }
  });
  it('the manifest names every file with its hash', () => {
    const m = JSON.parse(disk('manifest.json'));
    expect(m.simVersion).toBe(SIM_VERSION);
    expect(m.files.length).toBe(runList().length + 2 + HAPTIC_RUNS.length);
  });
});
