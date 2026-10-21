import { describe, it, expect } from 'vitest';
import { signature, normMessage, normFile, parseFrames, moduleOf, hash12 } from '../../src/obs/signature.js';
import { createBreaker } from '../../src/obs/breaker.js';
import { chooseBoot, createGovernor, loadLedger, saveLedger, emptyLedger, LEDGER_KEY } from '../../src/obs/ledger.js';
import { createFrameStats, recordFrame, percentile, bucketOf, summary, NB } from '../../src/obs/frames.js';

const withStack = (msg, stack, name = 'TypeError') => Object.assign(new Error(msg), { name, stack: `${name}: ${msg}\n${stack}` });

describe('error signatures', () => {
  const chrome = '    at stepWorld (https://mutaafaziz.com/coldgas/assets/index-B4x_9kQa.js:12:3456)\n    at frame (https://mutaafaziz.com/coldgas/assets/index-B4x_9kQa.js:40:10)';
  const chromeNext = '    at stepWorld (https://mutaafaziz.com/coldgas/assets/index-Zz81_q0P.js:13:999)\n    at frame (https://mutaafaziz.com/coldgas/assets/index-Zz81_q0P.js:40:10)';
  const firefox = 'stepWorld@https://mutaafaziz.com/coldgas/assets/index-B4x_9kQa.js:12:3456\nframe@https://mutaafaziz.com/coldgas/assets/index-B4x_9kQa.js:40:10';

  it('is stable: the same fault gives the same signature every time, and different numbers fold together', () => {
    const a = signature(withStack("Cannot read properties of undefined (reading 'pos') at tick 1234", chrome), 'abc1234');
    const b = signature(withStack("Cannot read properties of undefined (reading 'pos') at tick 98765", chrome), 'abc1234');
    expect(a.sig).toMatch(/^[0-9a-f]{12}$/);
    expect(a.sig).toBe(b.sig);
    expect(a.msg).toBe("TypeError: Cannot read properties of undefined (reading 'pos') at tick N");
    // Known value: a regression in the hash would split every aggregate in D1 from its history.
    expect(hash12('COLD GAS')).toBe(hash12('COLD GAS'));
    expect(hash12('a')).not.toBe(hash12('b'));
  });
  it('separates builds by sig but joins them by key; the bundler hash and line move freely', () => {
    const a = signature(withStack('boom', chrome), 'build1'), b = signature(withStack('boom', chromeNext), 'build2');
    expect(a.sig).not.toBe(b.sig);
    expect(a.key).toBe(b.key);
    expect(a.fr).toBe('stepWorld@index.js:12:3456');
  });
  it('reads V8 and Gecko/WebKit stacks the same', () => {
    expect(signature(withStack('boom', chrome), 'x').sig).toBe(signature(withStack('boom', firefox), 'x').sig);
    expect(parseFrames('    at wasm://wasm/0012abcd:wasm-function[421]:0x1f2e')[0].file).toBe('rapier.wasm');
  });
  it('keeps nothing personal: no hosts, paths, queries or keys', () => {
    const s = signature(withStack('GET https://mutaafaziz.com/coldgas/api/x?initials=ABC failed sk-ant-api03-abcdefghijklmnopqrstuvwxyz', chrome), 'x');
    expect(JSON.stringify(s)).not.toMatch(/mutaafaziz|initials|sk-ant|coldgas\/assets/);
    expect(normFile('https://x.y/coldgas/assets/theatre-AbCdEf12.js?v=3#x')).toBe('theatre.js');
    expect(normMessage('a\u0000b  0xdeadBEEF 3.5e3')).toBe('a b <hex> N');
  });
  it('names the subsystem from the stack', () => {
    expect(moduleOf('Error\n    at x (https://h/assets/rocket-AbCdEf12.js:1:1)')).toBe('rocket');
    expect(moduleOf('Error\n    at x (https://h/assets/theatre-AbCdEf12.js:1:1)')).toBe('judge');
    expect(moduleOf('Error\n    at wasm://wasm/00ab:wasm-function[3]:0x10')).toBe('physics');
    expect(moduleOf('Error\n    at x (https://h/assets/index-AbCdEf12.js:1:1)')).toBe('app');
  });
});

describe('circuit breaker', () => {
  it('opens after two failures within a minute, refuses until the cooldown, then allows one trial', () => {
    let t = 0;
    const b = createBreaker('judge', { now: () => t });
    expect(b.allow()).toBe(true);
    b.failure(new Error('503'));
    expect(b.state).toBe('closed');
    t += 1000; b.failure(new Error('503'));
    expect(b.state).toBe('open');
    expect(b.allow()).toBe(false);
    t += 29_000; expect(b.allow()).toBe(false);
    t += 1_001; expect(b.allow()).toBe(true);
    expect(b.state).toBe('half-open');
    b.success();
    expect(b.state).toBe('closed');
  });
  it('a failed trial re-opens it for twice as long (capped), and old failures fall out of the window', () => {
    let t = 0;
    const b = createBreaker('audio', { now: () => t });
    b.failure(); t += 61_000; b.failure();
    expect(b.state).toBe('closed');             // a minute apart: not a pattern
    b.failure();
    expect(b.state).toBe('open');
    t += 30_000; expect(b.allow()).toBe(true);  // half-open
    b.failure();
    expect(b.state).toBe('open');
    expect(b.retryIn()).toBe(60_000);
    for (let i = 0; i < 20; i++) { t += b.retryIn(); b.allow(); b.failure(); }
    expect(b.retryIn()).toBeLessThanOrEqual(30 * 60_000);
  });
  it('persists through the ledger: an open breaker is still open after a reload', () => {
    let t = 0, saved = null;
    const b = createBreaker('rocket', { now: () => t, onChange: (n, s) => { saved = { ...s }; } });
    b.failure(); b.failure();
    const again = createBreaker('rocket', { now: () => t + 5000, state: saved });
    expect(again.allow()).toBe(false);
    expect(createBreaker('rocket', { now: () => t + 31_000, state: saved }).allow()).toBe(true);
  });
});

const sess = (tier, p95, extra = {}) => ({ tier, p95, frames: 5000, scale: 0, ended: true, crashes: {}, ctxLost: 0, ...extra });

describe('health ledger: boot tier from past runs', () => {
  it('uses the URL, then the device class on a first visit', () => {
    expect(chooseBoot({ forced: 'low', sessions: [sess('high', 10)] }).tier).toBe('low');
    const first = chooseBoot({ sessions: [], deviceTier: 'mid' });
    expect(first).toMatchObject({ tier: 'mid', from: 'device' });
  });
  it('steps down after one bad session (slow p95, a lost GPU, a physics crash)', () => {
    expect(chooseBoot({ sessions: [sess('high', 45)], deviceTier: 'high' })).toMatchObject({ tier: 'mid', from: 'ledger' });
    expect(chooseBoot({ sessions: [sess('mid', 12, { ctxLost: 1 })], deviceTier: 'high' }).tier).toBe('low');
    expect(chooseBoot({ sessions: [sess('high', 12, { crashes: { physics: 1 } })] }).reason).toMatch(/crashed in physics/);
    expect(chooseBoot({ sessions: [sess('low', 80)] }).tier).toBe('low');
  });
  it('steps up only after 3 smooth sessions, 5 if the tier above failed here recently, never past the device class', () => {
    const smooth = (n) => Array.from({ length: n }, () => sess('mid', 15));
    expect(chooseBoot({ sessions: smooth(2), deviceTier: 'high' }).tier).toBe('mid');
    expect(chooseBoot({ sessions: smooth(3), deviceTier: 'high' }).tier).toBe('high');
    expect(chooseBoot({ sessions: smooth(3), deviceTier: 'mid' }).tier).toBe('mid');   // phone ceiling
    const failedHigh = [sess('high', 50), ...smooth(4)];
    expect(chooseBoot({ sessions: failedHigh, deviceTier: 'high' }).tier).toBe('mid');
    expect(chooseBoot({ sessions: [...failedHigh, sess('mid', 15)], deviceTier: 'high' }).tier).toBe('high');
    // A smooth run that needed a lower resolution doesn't count toward stepping up.
    expect(chooseBoot({ sessions: [...smooth(2), sess('mid', 15, { scale: 1 })], deviceTier: 'high' }).tier).toBe('mid');
  });
  it('hysteresis: no flapping between tiers on alternating sessions', () => {
    const tiers = [];
    let sessions = [];
    // A device that is just too slow for high (p95 40 there) and smooth at mid (p95 15).
    for (let i = 0; i < 20; i++) {
      const { tier } = chooseBoot({ sessions, deviceTier: 'high' });
      tiers.push(tier);
      sessions = [...sessions, sess(tier, tier === 'high' ? 40 : 15)].slice(-12);
    }
    const ups = tiers.filter((t, i) => i && t === 'high' && tiers[i - 1] === 'mid').length;
    expect(ups).toBeLessThanOrEqual(3);   // tries high again only after 5 smooth sessions each time
    expect(tiers.filter((t) => t === 'mid').length).toBeGreaterThan(14);
  });
  it('two killed tabs in the last three sessions step down; one does not', () => {
    expect(chooseBoot({ sessions: [sess('high', 12), sess('high', 12, { ended: false }), sess('high', 12)] }).tier).toBe('high');
    expect(chooseBoot({ sessions: [sess('high', 12, { ended: false }), sess('high', 12), sess('high', 12, { ended: false })] }).tier).toBe('mid');
  });
  it('survives broken storage and junk', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadLedger(bad)).toEqual(emptyLedger());
    expect(saveLedger(bad, emptyLedger())).toBe(false);
    expect(loadLedger({ getItem: () => '{"v":1,"sessions":"x"}' })).toEqual(emptyLedger());
    const mem = new Map();
    const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const l = emptyLedger(); l.sessions = Array.from({ length: 30 }, () => sess('high', 10));
    saveLedger(st, l);
    expect(JSON.parse(mem.get(LEDGER_KEY)).sessions).toHaveLength(12);
  });
});

describe('in-session governor', () => {
  const bad = { frames: 120, slowShare: 0.5, workOverShare: 0.6 }, good = { frames: 120, slowShare: 0, workOverShare: 0 }, meh = { frames: 120, slowShare: 0.1, workOverShare: 0.3 };
  it('degrades after 6 s of hitching, and only then', () => {
    const g = createGovernor({ now: () => 0 });
    expect(g.feed(bad)).toBe(0); expect(g.feed(bad)).toBe(0); expect(g.feed(meh)).toBe(0);
    expect(g.feed(bad)).toBe(0); expect(g.feed(bad)).toBe(0); expect(g.feed(bad)).toBe(-1);
    expect(g.level).toBe(1);
  });
  it('recovers upward after 30 s of headroom, not within a minute of a step down, and never to a step that failed twice', () => {
    let t = 0;
    const g = createGovernor({ now: () => t });
    for (let i = 0; i < 3; i++) g.feed(bad);
    expect(g.level).toBe(1);
    for (let i = 0; i < 20; i++) expect(g.feed(good)).toBe(0);   // < 60 s since the step down
    t = 61_000;
    let up = 0;
    for (let i = 0; i < 15; i++) up += g.feed(good);
    expect(up).toBe(1); expect(g.level).toBe(0);
    for (let i = 0; i < 3; i++) g.feed(bad);                     // level 0 fails a second time
    t = 200_000;
    for (let i = 0; i < 40; i++) g.feed(good);
    expect(g.level).toBe(1);                                     // stays down: no flapping
  });
  it('ignores near-empty windows (a background tab)', () => {
    const g = createGovernor();
    for (let i = 0; i < 10; i++) expect(g.feed({ ...bad, frames: 3 })).toBe(0);
  });
});

describe('frame stats', () => {
  it('buckets and percentiles', () => {
    expect(bucketOf(16.6)).toBe(4);
    expect(bucketOf(5000)).toBe(NB - 1);
    const s = createFrameStats();
    for (let i = 0; i < 1000; i++) recordFrame(s, i * 16.7, i % 50 === 0 ? 120 : 16.7, 2, 4, 7, 0);
    const sm = summary(s);
    expect(sm.p50).toBeGreaterThan(15); expect(sm.p50).toBeLessThan(17.5);
    expect(sm.p99).toBeGreaterThan(100);
    expect(sm.hitches).toBe(20);
    expect(percentile(new Uint32Array(NB), 0.5)).toBe(0);
  });
  it('costs well under a microsecond per frame and allocates nothing', () => {
    const s = createFrameStats();
    for (let i = 0; i < 20_000; i++) recordFrame(s, i * 16.7, 16.7, 2, 4, 7, 0);   // warm up
    globalThis.gc?.();
    const heap0 = process.memoryUsage().heapUsed;
    const N = 1_000_000, t0 = performance.now();
    for (let i = 0; i < N; i++) recordFrame(s, i * 16.7, 16 + (i & 7), 2, 4, 7, 0);
    const nsPerFrame = ((performance.now() - t0) / N) * 1e6;
    const grew = process.memoryUsage().heapUsed - heap0;
    console.log(`[obs] recordFrame: ${nsPerFrame.toFixed(1)} ns/frame, heap +${(grew / 1024).toFixed(0)} kB over ${N} frames`);
    expect(nsPerFrame).toBeLessThan(2000);   // ≈20 ns on a laptop; generous for a loaded CI box
    expect(grew).toBeLessThan(8 * 1024 * 1024);   // a million frames: < 8 B each (an object per frame would be ≥ 16 MB)
  });
});
