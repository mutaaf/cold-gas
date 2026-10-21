// Observability, server side (src/obs/ is the client).
//
//   POST /coldgas/api/obs          a batch from sendBeacon: error signatures with counts, a frame-time
//                                  histogram, recoveries and tripped breakers. ≤ 8 kB, strictly
//                                  validated, rate-limited, aggregated into D1 by day and build.
//   GET  /coldgas/api/obs/digest   top signatures, new and regressed ones vs the previous build, frame
//                                  percentiles per device class and tier. Read-only, cached 5 min.
//                                  scripts/heal.mjs turns its regressions into backlog tickets.
//
// Free plan: a beacon is one JSON.parse of ≤ 8 kB, a loop over ≤ 16 entries and one D1 batch
// (≈0.3 ms of CPU); the digest is five grouped queries and a small fold, cached. No PII: the IP is
// only ever the daily salted hash in a rate-limit bucket (as for the judges), no user agent, no
// headers read (so a BYOK `x-cg-key` can't reach a row), and every message is normalised and redacted
// again here, whatever the client did.
import { normMessage, redact, MODULE_IDS, KIND_IDS } from '../obs/signature.js';
import { EDGES, NB, percentile } from '../obs/frames.js';

export const OBS_LIMITS = { maxBytes: 8192, maxErrs: 16, maxRec: 8, hourlyPerIp: 30, dailyCap: 3000, windowDays: 14 };
const DCS = ['phone-lo', 'phone-mid', 'phone-hi', 'desktop-lo', 'desktop-mid', 'desktop-hi'];
const TIERS = ['low', 'mid', 'high'];
const REC_KINDS = ['webgl', 'physics', 'frame', 'reload', 'rocket', 'world', 'nerds', 'degrade', 'recover-up', 'net-retry', 'judge', 'audio'];
const BREAKERS = ['judge', 'audio', 'world', 'rocket', 'physics'];
const HEX12 = /^[0-9a-f]{12}$/;
const BUILD_RE = /^[0-9a-z.-]{1,24}$/i;
const FRAME_RE = /^[\w$.<>[\]-]{1,40}@[\w.-]{1,48}(?::\d{1,7}:\d{1,7})?$/;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const H = Array.from({ length: NB }, (_, i) => `h${i}`);

const cleanFrame = (f) => (typeof f === 'string' && FRAME_RE.test(f) ? f : '');
const cleanStack = (st) => (typeof st === 'string' ? st.split(' < ').slice(0, 6).map(cleanFrame).filter(Boolean).join(' < ').slice(0, 400) : '');

// → a clean batch, or null when the shape is wrong. Bad entries inside a good batch are dropped.
export function cleanObs(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || b.v !== 1) return null;
  if (typeof b.build !== 'string' || !BUILD_RE.test(b.build) || !DCS.includes(b.dc) || !TIERS.includes(b.tier)) return null;
  const out = { build: b.build.toLowerCase(), dc: b.dc, tier: b.tier, first: b.first === true, errs: [], fr: null, rec: [], br: [] };
  if (b.errs !== undefined && (!Array.isArray(b.errs) || b.errs.length > OBS_LIMITS.maxErrs)) return null;
  const seen = new Set();
  for (const e of b.errs || []) {
    if (!e || typeof e !== 'object' || !HEX12.test(e.sig) || !HEX12.test(e.key) || seen.has(e.sig)) continue;
    if (!MODULE_IDS.includes(e.mod) || !KIND_IDS.includes(e.kind) || !int(e.n, 1, 10_000) || typeof e.msg !== 'string') continue;
    seen.add(e.sig);
    out.errs.push({ sig: e.sig, key: e.key, mod: e.mod, kind: e.kind, n: e.n, msg: normMessage(redact(e.msg.slice(0, 400))) || e.kind, fr: cleanFrame(e.fr), st: cleanStack(e.st) });
  }
  if (b.fr != null) {
    const f = b.fr;
    if (typeof f !== 'object' || !Array.isArray(f.h) || f.h.length !== NB || !f.h.every((c) => int(c, 0, 1e6))) return null;
    const n = f.h.reduce((a, c) => a + c, 0);
    if (f.n !== n || n > 1e6 || !int(f.hitch, 0, n) || !int(f.low, 0, n) || !int(f.drop, 0, 1e7)) return null;
    if (n > 0) out.fr = { h: f.h.slice(), n, hitch: f.hitch, low: f.low, drop: f.drop };
  }
  if (b.rec !== undefined && (!Array.isArray(b.rec) || b.rec.length > OBS_LIMITS.maxRec)) return null;
  for (const r of b.rec || []) if (r && REC_KINDS.includes(r.kind) && typeof r.ok === 'boolean') out.rec.push({ kind: r.kind, ok: r.ok });
  if (b.br !== undefined && (!Array.isArray(b.br) || b.br.length > 8)) return null;
  for (const n of b.br || []) if (BREAKERS.includes(n) && !out.br.includes(n)) out.br.push(n);
  return out;
}

let obsTablesReady = false;
export async function ensureObsTables(db) {
  if (obsTablesReady) return;
  await db.batch([
    // The rate-limit buckets share the judges' table (same schema as index.js ensureTables).
    db.prepare('CREATE TABLE IF NOT EXISTS ai_usage (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS obs_err (day TEXT NOT NULL, build TEXT NOT NULL, sig TEXT NOT NULL, key TEXT NOT NULL, mod TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, sessions INTEGER NOT NULL, msg TEXT NOT NULL, fr TEXT NOT NULL, PRIMARY KEY (day, sig))'),
    db.prepare('CREATE INDEX IF NOT EXISTS obs_err_key ON obs_err(day, key)'),
    db.prepare('CREATE TABLE IF NOT EXISTS obs_ex (sig TEXT PRIMARY KEY, key TEXT NOT NULL, build TEXT NOT NULL, mod TEXT NOT NULL, kind TEXT NOT NULL, msg TEXT NOT NULL, fr TEXT NOT NULL, st TEXT NOT NULL, created INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS obs_frames (day TEXT NOT NULL, build TEXT NOT NULL, dc TEXT NOT NULL, tier TEXT NOT NULL, ${H.map((h) => `${h} INTEGER NOT NULL DEFAULT 0`).join(', ')}, n INTEGER NOT NULL, hitch INTEGER NOT NULL, low INTEGER NOT NULL, dropped INTEGER NOT NULL, PRIMARY KEY (day, build, dc, tier))`),
    db.prepare('CREATE TABLE IF NOT EXISTS obs_evt (day TEXT NOT NULL, build TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, build, name))'),
  ]);
  obsTablesReady = true;
}

// --- POST /obs ---------------------------------------------------------------------------------------
export async function postObs(req, env, ctx, { json, ipHash, day, hour }) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > OBS_LIMITS.maxBytes) return json({ error: 'too large' }, 413);
  const text = await req.text().catch(() => '');
  if (!text || text.length > OBS_LIMITS.maxBytes) return json({ error: text ? 'too large' : 'empty' }, text ? 413 : 400);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  const b = cleanObs(body);
  if (!b) return json({ error: 'bad batch' }, 400);
  const db = env.DB;
  if (!db) return json({ ok: true, stored: false });
  await ensureObsTables(db);
  const d = day();
  const [perIp, perDay] = await db.batch([
    db.prepare('INSERT INTO ai_usage (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n').bind(`obs:${await ipHash(req)}:${hour()}`),
    db.prepare('INSERT INTO ai_usage (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n').bind(`obs-day:${d}`),
  ]);
  if ((perIp?.results?.[0]?.n ?? 1) > OBS_LIMITS.hourlyPerIp) return json({ error: 'slow down' }, 429);
  if ((perDay?.results?.[0]?.n ?? 1) > OBS_LIMITS.dailyCap) return json({ ok: true, stored: false, sampled: true }, 202);

  const st = [];
  const evt = (name, n = 1) => st.push(db.prepare('INSERT INTO obs_evt (day, build, name, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, build, name) DO UPDATE SET n = n + excluded.n').bind(d, b.build, name, n));
  evt('beacons');
  if (b.first) evt('sessions');
  for (const e of b.errs) {
    st.push(db.prepare('INSERT INTO obs_err (day, build, sig, key, mod, kind, n, sessions, msg, fr) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(day, sig) DO UPDATE SET n = n + excluded.n, sessions = sessions + 1')
      .bind(d, b.build, e.sig, e.key, e.mod, e.kind, e.n, e.msg, e.fr));
    if (e.st) st.push(db.prepare('INSERT OR IGNORE INTO obs_ex (sig, key, build, mod, kind, msg, fr, st, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(e.sig, e.key, b.build, e.mod, e.kind, e.msg, e.fr, e.st, Date.now()));
  }
  if (b.fr) {
    const f = b.fr;
    st.push(db.prepare(`INSERT INTO obs_frames (day, build, dc, tier, ${H.join(', ')}, n, hitch, low, dropped) VALUES (?, ?, ?, ?, ${H.map(() => '?').join(', ')}, ?, ?, ?, ?) ON CONFLICT(day, build, dc, tier) DO UPDATE SET ${H.map((h) => `${h} = ${h} + excluded.${h}`).join(', ')}, n = n + excluded.n, hitch = hitch + excluded.hitch, low = low + excluded.low, dropped = dropped + excluded.dropped`)
      .bind(d, b.build, b.dc, b.tier, ...f.h, f.n, f.hitch, f.low, f.drop));
  }
  for (const r of b.rec) evt(`rec:${r.kind}:${r.ok ? 'ok' : 'fail'}`);
  for (const n of b.br) evt(`br:${n}`);
  await db.batch(st);
  // Keep a month of aggregates and two weeks of exemplars (pruned on about one beacon in fifty).
  if (Math.random() < 0.02) {
    const cut = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    ctx?.waitUntil?.(db.batch([
      db.prepare('DELETE FROM obs_err WHERE day < ?').bind(cut), db.prepare('DELETE FROM obs_frames WHERE day < ?').bind(cut),
      db.prepare('DELETE FROM obs_evt WHERE day < ?').bind(cut), db.prepare('DELETE FROM obs_ex WHERE created < ?').bind(Date.now() - 14 * 86400e3),
    ]).catch(() => {}));
  }
  return json({ ok: true, stored: true, errs: b.errs.length, frames: b.fr?.n ?? 0 });
}

// --- Regressions (pure: unit-tested) -------------------------------------------------------------------
// errRows: [{ key, build, mod, kind, n, s (sessions), msg, fr, sig }], one per (key, build) over the window.
// builds: newest first, [{ build, first, sessions }]. → [{ status: 'new' | 'regressed', … }]
export const REGRESSION = { minNew: 2, minRegressed: 3, factor: 2 };
const FATAL = new Set(['trap', 'ctxlost', 'frame', 'unclean']);
export function detectRegressions(errRows, builds, cur, prev) {
  const curB = builds.find((x) => x.build === cur);
  if (!curB) return [];
  const prevB = builds.find((x) => x.build === prev);
  const older = new Set(builds.filter((x) => x.build !== cur && x.first <= curB.first).map((x) => x.build));
  const byKey = new Map();
  for (const r of errRows) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  const out = [];
  for (const [key, rows] of byKey) {
    const c = rows.find((r) => r.build === cur);
    if (!c) continue;
    const p = prev ? rows.find((r) => r.build === prev) : null;
    const seenBefore = rows.some((r) => r.build !== cur && older.has(r.build));
    const curRate = c.n / Math.max(1, curB.sessions);
    const base = { key, sig: c.sig, mod: c.mod, kind: c.kind, msg: c.msg, fr: c.fr, cur: { build: cur, n: c.n, sessions: c.s, rate: round3(curRate) } };
    const severity = FATAL.has(c.kind) || c.mod === 'physics' || c.mod === 'webgl' || curRate >= 0.1 ? 'P0' : 'P1';
    if (!seenBefore && c.n >= REGRESSION.minNew) { out.push({ status: 'new', severity, ...base, prev: null }); continue; }
    if (p && prevB && c.n >= REGRESSION.minRegressed) {
      const prevRate = p.n / Math.max(1, prevB.sessions);
      if (curRate >= REGRESSION.factor * prevRate) out.push({ status: 'regressed', severity, ...base, prev: { build: prev, n: p.n, sessions: p.s, rate: round3(prevRate) } });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.cur.rate - a.cur.rate : a.severity < b.severity ? -1 : 1));
}
const round3 = (x) => Math.round(x * 1000) / 1000;

// Frame regressions: p95 worse by > 20 % and > 2 ms, with ≥ 1,000 frames in both builds.
export function detectFrameRegressions(frames, cur, prev) {
  const out = [];
  if (!prev) return out;
  for (const [dc, tiers] of Object.entries(frames)) {
    for (const [tier, byBuild] of Object.entries(tiers)) {
      const c = byBuild[cur], p = byBuild[prev];
      if (!c || !p || c.frames < 1000 || p.frames < 1000) continue;
      if (c.p95 > p.p95 * 1.2 && c.p95 - p.p95 > 2) out.push({ status: 'regressed', severity: c.p95 > 33.4 ? 'P0' : 'P1', type: 'frames', key: `frames-${dc}-${tier}`, dc, tier, cur: { build: cur, ...c }, prev: { build: prev, ...p } });
    }
  }
  return out;
}

export function frameStats(r) {
  const h = H.map((k) => r[k] || 0);
  const n = r.n || 0;
  return { frames: n, p50: percentile(h, 0.5), p95: percentile(h, 0.95), p99: percentile(h, 0.99), hitchesPerKFrames: n ? Math.round((r.hitch / n) * 10000) / 10 : 0, lowFpsWindows: r.low || 0, droppedTicks: r.dropped || 0, hist: h };
}

// --- GET /obs/digest -------------------------------------------------------------------------------------
const digestMemo = { at: 0, key: '', body: null };
export async function obsDigest(req, env, ctx, { json }) {
  const url = new URL(req.url);
  const want = url.searchParams.get('build');
  if (want && !BUILD_RE.test(want)) return json({ error: 'build' }, 400);
  const cacheKey = `${url.origin}${url.pathname}?build=${want || ''}`;
  if (digestMemo.key === cacheKey && Date.now() - digestMemo.at < 60_000) return digestResponse(digestMemo.body, 'memo');
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(cacheKey).catch(() => null); if (hit) return hit; }
  const db = env.DB;
  if (!db) return json({ error: 'no store' }, 503);
  await ensureObsTables(db);
  const since = new Date(Date.now() - OBS_LIMITS.windowDays * 86400e3).toISOString().slice(0, 10);
  const builds = (await db.prepare("SELECT build, MIN(day) AS first, MAX(day) AS last, SUM(n) AS sessions FROM obs_evt WHERE name = 'sessions' AND day >= ? GROUP BY build ORDER BY first DESC, last DESC LIMIT 8").bind(since).all()).results || [];
  const ci = want ? builds.findIndex((x) => x.build === want) : 0;
  const cur = builds[ci]?.build || null, prev = ci >= 0 ? builds[ci + 1]?.build || null : null;
  const rows = (await db.prepare('SELECT key, build, MAX(mod) AS mod, MAX(kind) AS kind, SUM(n) AS n, SUM(sessions) AS s, MAX(msg) AS msg, MAX(fr) AS fr, MAX(sig) AS sig FROM obs_err WHERE day >= ? GROUP BY key, build ORDER BY n DESC LIMIT 600').bind(since).all()).results || [];
  const frRows = cur ? ((await db.prepare(`SELECT build, dc, tier, ${H.map((h) => `SUM(${h}) AS ${h}`).join(', ')}, SUM(n) AS n, SUM(hitch) AS hitch, SUM(low) AS low, SUM(dropped) AS dropped FROM obs_frames WHERE day >= ? AND build IN (?, ?) GROUP BY build, dc, tier`).bind(since, cur, prev || cur).all()).results || []) : [];
  const evts = cur ? ((await db.prepare("SELECT build, name, SUM(n) AS n FROM obs_evt WHERE day >= ? AND build IN (?, ?) AND name <> 'sessions' GROUP BY build, name").bind(since, cur, prev || cur).all()).results || []) : [];

  const frames = {};
  for (const r of frRows) ((frames[r.dc] ??= {})[r.tier] ??= {})[r.build] = frameStats(r);
  const regressions = [...detectRegressions(rows, builds, cur, prev), ...detectFrameRegressions(frames, cur, prev)];
  // Exemplar stacks for the flagged signatures (the builder fixes from these).
  const keys = regressions.filter((r) => !r.type).map((r) => r.key).slice(0, 20);
  if (keys.length) {
    const ex = (await db.prepare(`SELECT key, build, st FROM obs_ex WHERE key IN (${keys.map(() => '?').join(', ')}) ORDER BY created DESC LIMIT 60`).bind(...keys).all()).results || [];
    for (const r of regressions) r.stacks = ex.filter((x) => x.key === r.key).slice(0, 3).map((x) => ({ build: x.build, st: x.st }));
  }
  const totals = new Map();
  for (const r of rows) {
    const t = totals.get(r.key) || { key: r.key, sig: r.sig, mod: r.mod, kind: r.kind, msg: r.msg, fr: r.fr, n: 0, sessions: 0, builds: [] };
    t.n += r.n; t.sessions += r.s; t.builds.push(r.build);
    totals.set(r.key, t);
  }
  const events = {};
  for (const e of evts) (events[e.build] ??= {})[e.name] = e.n;
  const body = {
    generated: new Date().toISOString(), windowDays: OBS_LIMITS.windowDays, edges: EDGES,
    current: cur ? builds[ci] : null, previous: prev ? builds[ci + 1] : null, builds,
    top: [...totals.values()].sort((a, b) => b.n - a.n).slice(0, 20),
    regressions, frames, events,
  };
  digestMemo.at = Date.now(); digestMemo.key = cacheKey; digestMemo.body = body;
  const res = digestResponse(body, 'fresh');
  if (cache) ctx?.waitUntil?.(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
}
function digestResponse(body, src) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-obs-digest': src } });
}
export function resetObsMemo() { digestMemo.at = 0; digestMemo.key = ''; obsTablesReady = false; }
