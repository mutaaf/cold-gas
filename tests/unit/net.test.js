import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithDeadline, withDeadline, isTimeout, isAbort } from '../../src/net.js';
import { decideReload, entryOf, RELOAD_GAP_MS } from '../../src/obs/reload.js';
import { createIdbCache } from '../../src/world/cache.js';
import { boardRow } from '../../src/panel.js';

// A fetch that answers after `ms` (or never), and honours its signal like the real one.
function fakeFetch(ms = Infinity, res = { ok: true, status: 200 }) {
  return vi.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = ms === Infinity ? 0 : setTimeout(() => resolve(res), ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
  }));
}
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

describe('fetchWithDeadline (0048)', () => {
  it('answers when the server does, and clears its timer', async () => {
    vi.useFakeTimers();
    globalThis.fetch = fakeFetch(100);
    const p = fetchWithDeadline('/coldgas/x', { ms: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up at the deadline with a TimeoutError (a request that never answers)', async () => {
    vi.useFakeTimers();
    globalThis.fetch = fakeFetch(Infinity);
    const p = fetchWithDeadline('/coldgas/roads/stelvio.bin.gz', { ms: 2000 });
    const seen = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1999);
    expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await seen;
    expect(isTimeout(err)).toBe(true);
    expect(err.message).toMatch(/roads\/stelvio\.bin\.gz took longer than 2 s/);
  });

  it("the caller's signal cancels it (an AbortError, not a timeout), before or during", async () => {
    globalThis.fetch = fakeFetch(Infinity);
    const ctl = new AbortController();
    const p = fetchWithDeadline('/coldgas/x', { ms: 60_000, signal: ctl.signal });
    ctl.abort();
    const err = await p.catch((e) => e);
    expect(isAbort(err)).toBe(true);
    const pre = new AbortController(); pre.abort();
    expect(isAbort(await fetchWithDeadline('/coldgas/x', { signal: pre.signal }).catch((e) => e))).toBe(true);
  });

  it('withDeadline settles with the promise or a TimeoutError, never leaving a timer', async () => {
    vi.useFakeTimers();
    const never = new Promise(() => {});
    const p = withDeadline(never, 35_000, 'the judges’ chunk').catch((e) => e);
    await vi.advanceTimersByTimeAsync(35_000);
    const err = await p;
    expect(isTimeout(err)).toBe(true);
    expect(err.message).toMatch(/judges’ chunk took longer than 35 s/);
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the reload decision (0040)', () => {
  const built = (hash) => `<!doctype html><html><head><title>COLD GAS</title>\n  <script type="module" crossorigin src="/coldgas/assets/index-${hash}.js"></script>\n<link rel="modulepreload" crossorigin href="/coldgas/assets/three.core-x.js"></head><body><script>(function(){})()</script></body></html>`;
  const base = { online: true, current: '/coldgas/assets/index-AAAA.js', lastReload: 0, now: 10 * RELOAD_GAP_MS };

  it("reads the entry script from a built index.html (not an inline script, not a preload)", () => {
    expect(entryOf(built('BBBB'))).toBe('/coldgas/assets/index-BBBB.js');
    expect(entryOf('<script type="module" src="https://mutaafaziz.com/coldgas/assets/index-C.js"></script>')).toBe('/coldgas/assets/index-C.js');
    expect(entryOf('<script>x</script>')).toBeNull();
    expect(entryOf(null)).toBeNull();
  });

  it('offline: never reloads (the browser would show its "no internet" page)', () => {
    expect(decideReload({ ...base, online: false, probe: { ok: true, html: built('BBBB') }, needNewBuild: true })).toEqual({ reload: false, why: 'offline' });
  });

  it('the origin does not answer: no reload', () => {
    expect(decideReload({ ...base, probe: null, needNewBuild: true }).why).toBe('unreachable');
    expect(decideReload({ ...base, probe: { ok: false }, needNewBuild: false }).why).toBe('unreachable');
  });

  it('a missing chunk reloads only into a different build (same build: it was the network)', () => {
    expect(decideReload({ ...base, probe: { ok: true, html: built('AAAA') }, needNewBuild: true })).toEqual({ reload: false, why: 'same build' });
    expect(decideReload({ ...base, probe: { ok: true, html: built('BBBB') }, needNewBuild: true })).toEqual({ reload: true, why: 'new build' });
    expect(decideReload({ ...base, probe: { ok: true, html: '<html></html>' }, needNewBuild: true }).reload).toBe(false);
  });

  it('exactly once: not again within two minutes of the last reload', () => {
    const probe = { ok: true, html: built('BBBB') };
    expect(decideReload({ ...base, probe, needNewBuild: true, lastReload: base.now - 1000 })).toEqual({ reload: false, why: 'reloaded recently' });
    expect(decideReload({ ...base, probe, needNewBuild: true, lastReload: base.now - RELOAD_GAP_MS }).reload).toBe(true);
  });

  it('other reloads (a lost GPU, a trapped engine) need only a reachable origin', () => {
    expect(decideReload({ ...base, probe: { ok: true, html: built('AAAA') } })).toEqual({ reload: true, why: 'reachable' });
  });
});

describe('the endless tile cache (0048)', () => {
  it('an IndexedDB open that never answers turns the cache off after 1.5 s (tiles are built instead)', async () => {
    vi.useFakeTimers();
    const req = {};
    const idb = { open: vi.fn(() => req) };   // never fires onsuccess / onerror (WebKit hang)
    const cache = createIdbCache('t', 10, { idb });
    const got = cache.get('k');
    await vi.advanceTimersByTimeAsync(1499);
    let settled = false; got.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(got).resolves.toBeNull();
    await expect(cache.put('k', { a: 1 })).resolves.toBeUndefined();
    // A late open is closed, not used.
    const db = { close: vi.fn() };
    req.result = db; req.onsuccess();
    expect(db.close).toHaveBeenCalled();
  });
});

describe('board rows (0048)', () => {
  it('draws what it can: a malformed row is dropped or patched, never thrown', () => {
    expect(boardRow({ initials: 'abc', verdict: 'Clean', facts: { rollDeg: 360, sink: 0.6 }, total: 88.25 })).toEqual({ initials: 'ABC', verdict: 'Clean', facts: { rollDeg: 360, sink: 0.6 }, total: 88.25 });
    expect(boardRow({ initials: 'XYZ', total: '71.5' })).toEqual({ initials: 'XYZ', verdict: 'Judged', facts: { rollDeg: 0, sink: 0 }, total: 71.5 });
    expect(boardRow({ initials: 'XYZ', facts: null })).toBeNull();
    expect(boardRow(null)).toBeNull();
    expect(boardRow({ initials: '<b>', total: 1, facts: { rollDeg: 'x' } }).initials).toBe('B');
  });
});
