import { describe, it, expect, beforeAll } from 'vitest';
import { createRun, stepRun, simulate, SIM_VERSION, MAX_TICKS } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { packBytes, unpackBytes, encodeChallenge, decodeChallenge, toB64url, fromB64url, vsFromHash, challengeUrl, compare,
  createReplay, replayAsync, coarsen, VS_TARGET_CHARS, VS_MAX_CHARS, CHANNELS } from '../../src/challenge.js';

// Challenge links (src/challenge.js): a run in the URL fragment, small, bounded, and a rematch that
// replays to the same score.
let show;   // the reference flight on the Show: its log and its card
beforeAll(() => {
  const run = createRun('show'), ap = createAutopilot('show');
  while (run.phase !== 'done') stepRun(run, ap(run));
  show = { log: run.inputLog, card: scoreRun(run.t), frames: run.frames.length };
});
const src = () => ({ log: show.log, course: 'show', score: show.card.total, tier: show.card.tier, initials: 'ABC' });
const entry = (tick, vals = {}) => { const e = [tick, ...new Array(CHANNELS).fill(0)]; for (const [k, v] of Object.entries(vals)) e[1 + +k] = v; return e; };

describe('challenge payload', () => {
  it('round-trips a whole run: log, course, score, tier, initials (compressed and plain)', async () => {
    for (const compress of [true, false]) {
      const p = await encodeChallenge(src(), { compress });
      expect(p[0]).toBe(compress ? 'z' : 'r');
      const d = await decodeChallenge(p);
      expect(d).toMatchObject({ simVersion: SIM_VERSION, stale: false, course: 'show', score: show.card.total, tier: show.card.tier, initials: 'ABC' });
      expect(d.log).toEqual(show.log);
    }
  });

  it('keeps a Show run short: the whole URL well under 2,000 characters', async () => {
    const p = await encodeChallenge(src());
    const url = challengeUrl('https://mutaafaziz.com/coldgas/', 'show', p);
    expect(p.length).toBeLessThan(VS_TARGET_CHARS);
    expect(url.length).toBeLessThan(2000);
    expect(url).toMatch(/^https:\/\/mutaafaziz\.com\/coldgas\/\?play=jump&course=show#vs=z[A-Za-z0-9_-]+$/);
  });

  it('pads a 12-channel log from an older client to today’s channels, as simulate reads it', () => {
    const legacy = [[0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100], [30, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100]];
    const d = unpackBytes(packBytes({ log: legacy, course: 'wall', score: 12.3 }));
    expect(d.log[1]).toEqual([30, 0, 50, ...new Array(9).fill(0), 100, ...new Array(11).fill(0)]);
    expect(d.log[1].length).toBe(CHANNELS + 1);
  });

  it('no initials, or anything but three letters, travels as none', () => {
    for (const initials of ['', 'ab', 'ABCD', '12C', undefined]) {
      expect(unpackBytes(packBytes({ ...src(), initials })).initials).toBe('');
    }
  });

  it('base64url both ways, and rejects what isn’t', () => {
    const b = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const n of [0, 1, 2, 3, 4, 255, 256]) expect([...fromB64url(toB64url(b.subarray(0, n)))]).toEqual([...b.subarray(0, n)]);
    expect(fromB64url('ab+c')).toBeNull();
    expect(fromB64url('abcde')).toBeNull();   // 4n+1 characters can't be bytes
    expect(fromB64url('é')).toBeNull();
  });

  it('a stale SIM_VERSION decodes, marked stale (the page says it’s from an older version)', async () => {
    const d = await decodeChallenge(`r${toB64url(packBytes({ ...src(), simVersion: SIM_VERSION - 1 }))}`);
    expect(d.stale).toBe(true);
  });
});

describe('challenge payload: bounds and rejection', () => {
  const plain = (bytes) => `r${toB64url(Uint8Array.from(bytes))}`;
  const good = [...packBytes({ log: [entry(0, { 0: 100 }), entry(10, { 0: 0, 2: -40 })], course: 'show', score: 50 })];

  it('a good tiny payload decodes', async () => {
    expect(await decodeChallenge(plain(good))).toMatchObject({ course: 'show', score: 50 });
  });

  it.each([
    ['empty', ''], ['one char', 'z'], ['unknown kind', `q${toB64url(Uint8Array.from(good))}`], ['bad base64', 'r!!!!'],
    ['not deflate', 'zAAAA'], ['too long', `r${'A'.repeat(VS_MAX_CHARS + 4)}`], ['not a string', 42],
  ])('rejects %s', async (_, p) => { expect(await decodeChallenge(p)).toBeNull(); });

  it('rejects a payload with any byte out of bounds', async () => {
    const at = (i, v) => { const b = good.slice(); b[i] = v; return plain(b); };
    expect(await decodeChallenge(at(0, 2))).toBeNull();           // unknown format
    expect(await decodeChallenge(at(2, 3))).toBeNull();           // course index past the enum
    expect(await decodeChallenge(at(5, 9))).toBeNull();           // tier
    expect(await decodeChallenge(at(6, 97))).toBeNull();          // initials: 'a' (lowercase) with zeros
    expect(await decodeChallenge(plain([...good, 0]))).toBeNull();          // trailing byte
    expect(await decodeChallenge(plain(good.slice(0, -1)))).toBeNull();     // truncated
  });

  it('rejects a score past 100, an out-of-order or too-late tick, a channel past the last, a value past ±100', () => {
    const head = (score10 = 500, n = 1) => [1, SIM_VERSION, 0, ...(score10 < 128 ? [score10] : [(score10 & 127) | 128, score10 >> 7]), 0, 0, 0, 0, n];
    expect(() => unpackBytes(Uint8Array.from([...head(1001), 0, 0xff]))).toThrow();
    expect(() => unpackBytes(Uint8Array.from([...head(500), 0, 0xff]))).not.toThrow();
    // two entries at the same tick (delta 0)
    expect(() => unpackBytes(Uint8Array.from([...head(500, 2), 0, 0xff, 0, 0xff]))).toThrow(/tick/);
    // a tick at MAX_TICKS: varint of 21600
    const big = []; let n = MAX_TICKS; while (n >= 128) { big.push((n & 127) | 128); n >>= 7; } big.push(n);
    expect(() => unpackBytes(Uint8Array.from([...head(500), ...big, 0xff]))).toThrow(/tick/);
    expect(() => unpackBytes(Uint8Array.from([...head(500), 0, 0x80 | CHANNELS, 2]))).toThrow(/channel/);
    expect(() => unpackBytes(Uint8Array.from([...head(500), 0, 0x80 | 0, 202, 1]))).toThrow(/value/);   // +101
    // the same channel twice in one entry
    expect(() => unpackBytes(Uint8Array.from([...head(500), 0, 0, 2, 0x80 | 0, 2]))).toThrow(/channel/);
    // an entry count past MAX_TICKS
    expect(() => unpackBytes(Uint8Array.from([1, SIM_VERSION, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x7f]))).toThrow(/entries/);
  });

  it('a decompression bomb stops at the cap', async () => {
    const zeros = new Uint8Array(1024 * 1024);
    const reader = new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw')).getReader();
    const parts = []; for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(...value); }
    expect(parts.length).toBeLessThan(VS_MAX_CHARS);
    expect(await decodeChallenge(`z${toB64url(Uint8Array.from(parts))}`)).toBeNull();
  });
});

describe('the challenge link in a URL', () => {
  it('reads #vs= from a fragment, alone or among other keys', () => {
    expect(vsFromHash('#vs=zAbC_-9')).toBe('zAbC_-9');
    expect(vsFromHash('#b=xyz&vs=rQQ')).toBe('rQQ');
    expect(vsFromHash('#b=xyz')).toBeNull();
    expect(vsFromHash('')).toBeNull();
    expect(vsFromHash(`#vs=${'A'.repeat(VS_MAX_CHARS + 100)}`)).toBeNull();
  });
  it('compares to one decimal, both ways', () => {
    expect(compare(90.5, 88.4, 'ABC')).toMatchObject({ won: true, text: 'You beat ABC by 2.1' });
    expect(compare(85.4, 88.4, 'ABC')).toMatchObject({ won: false, text: 'ABC still leads by 3.0' });
    expect(compare(88.4, 88.4, 'ABC')).toMatchObject({ tie: true, text: 'Dead level with ABC' });
    expect(compare(80, 88.4, '').text).toBe('Your challenger still leads by 8.4');
  });
});

describe('the challenger’s run, replayed', () => {
  it('a sliced replay of a decoded log is simulate(), tick for tick: the same score and frames', async () => {
    const d = await decodeChallenge(await encodeChallenge(src()));
    const ref = simulate(d.log, 'show');
    const rp = createReplay(d.log, 'show');
    let slices = 0;
    while (!rp.step(97)) slices++;
    expect(slices).toBeGreaterThan(10);
    expect(rp.card().total).toBe(scoreRun(ref.t).total);
    expect(rp.card().total).toBe(show.card.total);
    expect(rp.run.frames.length).toBe(ref.frames.length);
    expect(rp.run.frames.length).toBe(show.frames);
    expect([...rp.run.frames.at(-1)]).toEqual([...ref.frames.at(-1)]);
  });

  it('replayAsync yields between slices and ends with the card', async () => {
    let yields = 0, t = 0;
    const rp = await replayAsync(show.log, 'show', { budgetMs: 1, now: () => (t += 0.5), yieldFn: async () => { yields++; } });
    expect(yields).toBeGreaterThan(5);
    expect(rp.card().total).toBe(show.card.total);
  });

  it('coarsen rounds every channel to a step, keeps on/off channels exact and drops the entries that change nothing', () => {
    const log = [entry(0, { 0: 100, 11: 100 }), entry(5, { 0: 100, 2: 3, 11: 100 }), entry(9, { 0: 100, 2: 37, 11: 100 }), entry(12, { 0: 100, 2: -38, 11: 100 })];
    const c = coarsen(log, 10);
    expect(c.map((e) => [e[0], e[1], e[3], e[12]])).toEqual([[0, 100, 0, 100], [9, 100, 40, 100], [12, 100, -40, 100]]);
  });
});
