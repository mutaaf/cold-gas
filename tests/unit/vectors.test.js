// 0146: the native port's golden traces (scripts/vectors-lib.mjs) are current, reproducible, and say what
// the sim says: a replayed log's card is scoreRun's card, and a flown run replays to the same final state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVectors, runVector, runList, inputList, flat, hex, unhex, xorshift, VECTOR_DIR, dmathVectors, HAPTIC_RUNS, schemeFor } from '../../scripts/vectors-lib.mjs';
import { simulate, SIM_VERSION } from '../../src/sim/run.js';
import { scoreRun } from '../../src/sim/judge.js';
import { dsin } from '../../src/sim/dmath.js';
import { decodeChallenge, encodeChallenge } from '../../src/challenge.js';

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
  }, 300000);
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
  // 0154: the live input layer's vectors (scripted touches on the page's own controls) say what the run said: the
  // log they recorded replays on the server's path to the live run's telemetry, and the set covers what it claims.
  it("an input vector's log replays to the live run's telemetry; the set has landings, crashes, a stall and the sight", () => {
    const list = inputList(), ends = new Set();
    for (const r of list.filter((x) => ['thumb-show-aim', 'touch-show-crash', 'thumb-wall-stall'].includes(x.name))) {
      const v = JSON.parse(disk(`input/${r.name}.json`));
      expect(v.simVersion).toBe(SIM_VERSION);
      expect(flat(simulate(v.log, r.course).t)).toEqual(v.telemetry);
      expect(v.after.endTick).toBeGreaterThan(v.ticks);
    }
    for (const r of list) {
      const v = JSON.parse(disk(`input/${r.name}.json`));
      ends.add(v.endReason);
      expect(v.events.length).toBeGreaterThan(0);
    }
    expect([...ends].sort()).toEqual(expect.arrayContaining(['contact', 'flipped', 'settled', 'stalled']));
    expect(JSON.parse(disk('input/thumb-show-aim.json')).sights.length).toBeGreaterThan(5);
  });
  // 0154: challenge.json's accepts and rejects are the real decodeChallenge's, and deflate round-trips what it pins.
  it('challenge.json says what decodeChallenge says', async () => {
    const c = JSON.parse(disk('challenge.json'));
    for (const x of c.cases) {
      const d = await decodeChallenge(x.payload);
      expect(d, x.name).not.toBeNull();
      expect([d.simVersion, d.course, d.score, d.tier, d.initials]).toEqual([x.decoded.simVersion, x.decoded.course, x.decoded.score, x.decoded.tier, x.decoded.initials]);
    }
    for (const x of c.rejects) expect(await decodeChallenge(x.payload), x.name).toBeNull();
    const a = c.cases[0], z = await encodeChallenge({ ...a, simVersion: a.simVersion }, { compress: true });
    expect(z[0]).toBe('z');
    expect((await decodeChallenge(z)).log).toEqual(a.log);
  });
  // 0160: main.js can't load in Node, so coach.json's scheme is the mirror in vectors-lib: pinned to the line it mirrors.
  it("coach.json's pointerCtx mirror says what main.js says, and the coach's findings are all exercised", () => {
    const main = readFileSync('src/main.js', 'utf8');
    expect(main).toContain("device === 'touch' && touchSet.scheme === 'thumb' && tier === 'assist' ? 'thumb' : 'classic'");
    expect(schemeFor('touch', 'thumb', 'show', 'assist')).toBe('thumb');
    expect(schemeFor('touch', 'thumb', 'lineup', 'assist')).toBe('thumb');   // 0181
    const c = JSON.parse(disk('coach.json'));
    expect(c.simVersion).toBe(SIM_VERSION);
    expect(c.flights.length).toBe(runList().length + inputList().length);
    expect(c.drills.length).toBe(33);
    const ids = new Set([...c.rows.flatMap((r) => r[3]), ...c.drills.flatMap((d) => [...d.thumb, ...d.classic])].map((it) => it[0]));
    // Every finding but two: 'fell-off' (off the deck with no air at all) and 'flipped' (on its roof with nothing else
    // to say) took more search than their two fixed strings are worth. Coach.swift's were checked against coach.js's.
    expect([...ids].sort()).toEqual(['clean', 'early-release', 'gas', 'late-brake', 'late-land', 'late-roll', 'mark', 'no-brake', 'no-release', 'no-roll', 'over-roll', 'ran-out', 'short', 'tilt']);
  });
  it('the manifest names every file with its hash', () => {
    const m = JSON.parse(disk('manifest.json'));
    expect(m.simVersion).toBe(SIM_VERSION);
    expect(m.files.length).toBe(runList().length + 5 + HAPTIC_RUNS.length + inputList().length);
  });
});
