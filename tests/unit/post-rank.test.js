// 0141: before posting, the Post button names the rank the run would get today (one dry request, no retry).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { dryRank, rankLabel } from '../../src/panel.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });
const answer = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

describe('rankLabel (0141)', () => {
  it('names the rank, and nothing without one', () => {
    expect(rankLabel(1)).toBe('would be #1 today');
    expect(rankLabel(4)).toBe('would be #4 today');
    for (const r of [null, undefined, 0, -2, 1.5, '3', NaN]) expect(rankLabel(r)).toBe('');
  });
});

describe('dryRank (0141)', () => {
  const run = { log: [[0, 1]], t: { course: 'show' }, course: 'show' };

  it('sends the run as a dry post (log, telemetry, course; no initials, no score) and returns the rank', async () => {
    globalThis.fetch = answer(200, { rank: 1, dry: true, card: { total: 88 } });
    expect(await dryRank(run)).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/scores$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ log: run.log, t: run.t, course: 'show', dry: true });
  });

  it('is null on a refusal, a 503 (never retried), an answer that is not a dry one, or junk', async () => {
    for (const [status, body] of [[400, { error: 'implausible' }], [429, { error: 'slow down' }], [503, {}], [200, { rank: 2 }], [200, { rank: 0, dry: true }], [200, null]]) {
      globalThis.fetch = answer(status, body);
      expect(await dryRank(run)).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('is null when the board is offline or slower than its deadline', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await dryRank(run)).toBeNull();
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
    const p = dryRank(run, { ms: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toBeNull();
  });
});
