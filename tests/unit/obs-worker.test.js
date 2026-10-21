import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../src/worker/index.js';
import { cleanObs, detectRegressions, detectFrameRegressions, resetObsMemo, OBS_LIMITS } from '../../src/worker/obs.js';
import { NB } from '../../src/obs/frames.js';
import { fakeD1 } from './helpers/d1.js';

const ctx = { waitUntil: (p) => p };
const hist = (bucket, n) => { const h = new Array(NB).fill(0); h[bucket] = n; return h; };
const err = (over = {}) => ({ sig: 'aaaaaaaaaaaa', key: 'bbbbbbbbbbbb', mod: 'physics', kind: 'trap', n: 1, msg: 'RuntimeError: unreachable', fr: 'step@rapier.wasm:0:0', st: 'step@rapier.wasm:0:0 < stepRun@index.js:1:2', ...over });
const batch = (over = {}) => ({ v: 1, build: 'abc1234', dc: 'desktop-hi', tier: 'high', scale: 0, first: true, errs: [err()], fr: { h: hist(4, 600), n: 600, hitch: 2, low: 0, drop: 0 }, rec: [{ kind: 'webgl', ok: true }], br: ['judge'], ...over });
const post = (body, headers = {}, ip = '1.2.3.4') => new Request('https://x/coldgas/api/obs', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const digest = (q = '') => new Request(`https://x/coldgas/api/obs/digest${q}`);

describe('POST /obs: validation and caps', () => {
  it('accepts a well-formed batch and drops malformed entries inside it', () => {
    const b = cleanObs(batch({ errs: [err(), err({ sig: 'NOT-HEX' }), err({ sig: 'cccccccccccc', mod: 'kernel' }), err({ sig: 'dddddddddddd', n: 0 })] }));
    expect(b.errs).toHaveLength(1);
    expect(b.fr.n).toBe(600);
    expect(b.br).toEqual(['judge']);
  });
  it('rejects a wrong shape: version, build, device class, tier, histogram sums, oversize arrays', () => {
    expect(cleanObs(batch({ v: 2 }))).toBeNull();
    expect(cleanObs(batch({ build: 'x'.repeat(30) }))).toBeNull();
    expect(cleanObs(batch({ build: '../etc' }))).toBeNull();
    expect(cleanObs(batch({ dc: 'Mozilla/5.0 (iPhone)' }))).toBeNull();
    expect(cleanObs(batch({ tier: 'ultra' }))).toBeNull();
    expect(cleanObs(batch({ fr: { h: hist(4, 600), n: 601, hitch: 0, low: 0, drop: 0 } }))).toBeNull();
    expect(cleanObs(batch({ fr: { h: [1, 2], n: 3, hitch: 0, low: 0, drop: 0 } }))).toBeNull();
    expect(cleanObs(batch({ errs: new Array(OBS_LIMITS.maxErrs + 1).fill(err()) }))).toBeNull();
    expect(cleanObs([])).toBeNull();
  });
  it('normalises and redacts messages again, and keeps only function@file frames (no URLs, no keys)', () => {
    const b = cleanObs(batch({ errs: [err({ msg: 'fetch https://evil.example/x?k=1 failed with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 at 1234', fr: 'https://host/a.js:1:2', st: 'a@b.js:1:2 < <script>alert(1)</script>' })] }));
    const e = b.errs[0];
    expect(e.msg).not.toMatch(/evil|sk-ant|1234/);
    expect(e.msg).toContain('<url>');
    expect(e.msg).toContain('[redacted]');
    expect(e.fr).toBe('');
    expect(e.st).toBe('a@b.js:1:2');
  });
  it('answers 413 over 8 kB, 400 on bad JSON, and stores nothing from the headers (BYOK key, UA)', async () => {
    const DB = fakeD1();
    resetObsMemo();
    expect((await worker.fetch(post('x'.repeat(9000)), { DB }, ctx)).status).toBe(413);
    expect((await worker.fetch(post('{not json'), { DB }, ctx)).status).toBe(400);
    expect((await worker.fetch(post(batch({ v: 9 })), { DB }, ctx)).status).toBe(400);
    const res = await worker.fetch(post(batch(), { 'x-cg-key': 'sk-ant-api03-SECRETSECRETSECRETSECRET', 'user-agent': 'Mozilla/5.0 Secret Phone' }), { DB }, ctx);
    expect(res.status).toBe(200);
    const dump = JSON.stringify(['obs_err', 'obs_ex', 'obs_frames', 'obs_evt', 'ai_usage'].map((t) => DB.raw.prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toMatch(/SECRET|Mozilla|1\.2\.3\.4/);
  });
  it('rate-limits a sender to 30 beacons an hour', async () => {
    const DB = fakeD1();
    resetObsMemo();
    let last;
    for (let i = 0; i < OBS_LIMITS.hourlyPerIp + 1; i++) last = await worker.fetch(post(batch({ first: false, errs: [], fr: null, rec: [], br: [] }), {}, '9.9.9.9'), { DB }, ctx);
    expect(last.status).toBe(429);
    // Someone else is unaffected.
    expect((await worker.fetch(post(batch(), {}, '8.8.8.8'), { DB }, ctx)).status).toBe(200);
  });
});

describe('POST /obs: aggregation', () => {
  it('sums counts per signature per day, histograms per device class and tier, and keeps one exemplar', async () => {
    const DB = fakeD1();
    resetObsMemo();
    for (let i = 0; i < 3; i++) await worker.fetch(post(batch({ errs: [err({ n: 2 })] }), {}, `10.0.0.${i}`), { DB }, ctx);
    const e = DB.raw.prepare('SELECT n, sessions FROM obs_err').all();
    expect(e).toEqual([{ n: 6, sessions: 3 }]);
    expect(DB.raw.prepare('SELECT COUNT(*) AS c FROM obs_ex').get().c).toBe(1);
    const f = DB.raw.prepare('SELECT h4, n, hitch FROM obs_frames').get();
    expect({ ...f }).toEqual({ h4: 1800, n: 1800, hitch: 6 });
    const ev = Object.fromEntries(DB.raw.prepare('SELECT name, n FROM obs_evt').all().map((r) => [r.name, r.n]));
    expect(ev).toMatchObject({ sessions: 3, beacons: 3, 'rec:webgl:ok': 3, 'br:judge': 3 });
  });
});

describe('GET /obs/digest', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); resetObsMemo(); });
  afterEach(() => vi.useRealTimers());

  it('flags new and regressed signatures against the previous build, and frame percentiles', async () => {
    const DB = fakeD1();
    const at = (d) => vi.setSystemTime(new Date(`${d}T12:00:00Z`));
    const steady = err({ sig: '111111111111', key: 'aaaa00000001', mod: 'app', kind: 'error', msg: 'steady', fr: 'f@index.js:1:1' });
    const worse = err({ sig: '222222222222', key: 'aaaa00000002', mod: 'judge', kind: 'fetch', msg: 'judge 503', fr: 'fetch@api.js:0:0' });
    // Build "old": 10 sessions, 2 of each.
    at('2026-10-18');
    for (let i = 0; i < 10; i++) {
      await worker.fetch(post(batch({ build: 'old', errs: i < 2 ? [steady, worse] : [], fr: { h: hist(4, 2000), n: 2000, hitch: 0, low: 0, drop: 0 } }), {}, `1.0.0.${i}`), { DB }, ctx);
    }
    // Build "new": 10 sessions; `worse` 5× as often, a brand-new trap, frames slower.
    at('2026-10-20');
    const fresh = err({ sig: '333333333333', key: 'aaaa00000003', n: 1 });
    for (let i = 0; i < 10; i++) {
      await worker.fetch(post(batch({ build: 'new', errs: [i < 2 ? steady : null, worse, i < 3 ? fresh : null].filter(Boolean), fr: { h: hist(8, 2000), n: 2000, hitch: 5, low: 1, drop: 0 } }), {}, `2.0.0.${i}`), { DB }, ctx);
    }
    const res = await worker.fetch(digest(), { DB }, ctx);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    const d = await res.json();
    expect(d.current.build).toBe('new');
    expect(d.previous.build).toBe('old');
    const by = Object.fromEntries(d.regressions.map((r) => [r.key, r]));
    expect(by.aaaa00000003.status).toBe('new');
    expect(by.aaaa00000003.severity).toBe('P0');
    expect(by.aaaa00000003.stacks[0].st).toContain('rapier.wasm');
    expect(by.aaaa00000002.status).toBe('regressed');
    expect(by.aaaa00000002.cur.rate).toBeGreaterThan(by.aaaa00000002.prev.rate * 2);
    expect(by.aaaa00000001).toBeUndefined();   // same rate in both builds: not a regression
    const fr = by['frames-desktop-hi-high'];
    expect(fr.type).toBe('frames');
    expect(fr.cur.p95).toBeGreaterThan(fr.prev.p95);
    expect(d.frames['desktop-hi'].high.new.p50).toBeGreaterThan(33);
    expect(d.top[0].n).toBeGreaterThanOrEqual(d.top[1].n);
    // Read-only and cached: a second call within a minute comes from memory.
    expect((await worker.fetch(digest(), { DB }, ctx)).headers.get('x-obs-digest')).toBe('memo');
  });
});

describe('regression rules (pure)', () => {
  const builds = [{ build: 'b2', first: '2026-10-20', sessions: 100 }, { build: 'b1', first: '2026-10-10', sessions: 100 }];
  it('needs at least two hits to call a signature new, and 2× the previous rate (≥ 3 hits) to call it regressed', () => {
    const rows = [
      { key: 'k1', build: 'b2', n: 1, s: 1, mod: 'app', kind: 'error' },
      { key: 'k2', build: 'b2', n: 2, s: 2, mod: 'app', kind: 'error' },
      { key: 'k3', build: 'b2', n: 5, s: 5, mod: 'app', kind: 'error' }, { key: 'k3', build: 'b1', n: 3, s: 3, mod: 'app', kind: 'error' },
      { key: 'k4', build: 'b2', n: 6, s: 6, mod: 'app', kind: 'error' }, { key: 'k4', build: 'b1', n: 3, s: 3, mod: 'app', kind: 'error' },
    ];
    const r = Object.fromEntries(detectRegressions(rows, builds, 'b2', 'b1').map((x) => [x.key, x.status]));
    expect(r).toEqual({ k2: 'new', k4: 'regressed' });
  });
  it('flags a p95 regression only with enough frames and a real margin', () => {
    const f = { 'phone-lo': { mid: { b2: { frames: 5000, p95: 30 }, b1: { frames: 5000, p95: 20 } } }, 'desktop-hi': { high: { b2: { frames: 500, p95: 60 }, b1: { frames: 5000, p95: 10 } } } };
    const r = detectFrameRegressions(f, 'b2', 'b1');
    expect(r.map((x) => x.key)).toEqual(['frames-phone-lo-mid']);
  });
});
