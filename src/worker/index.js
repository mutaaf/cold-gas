// COLD GAS Worker: only /coldgas/api/* runs here; everything else is static assets.
//
//   POST /coldgas/api/judge/stream  { log, assist, provider?, model? } (+ x-cg-key for BYOK)
//        → text/event-stream: verify → prompt → reasoning/token… → done | error
//        The server replays the log, scores it, then streams the AI panel's words.
//   POST /coldgas/api/models  { provider } + x-cg-key → { models, suggested } (BYOK connect)
//   GET  /coldgas/api/providers → providers and the edge default
//   POST /coldgas/api/scores  { log, assist, initials } → verified board entry
//   GET  /coldgas/api/scores?board=today|all → top 20
//
// The client never sends a score: the server replays the input log through the same
// deterministic sim (src/sim/) and scores it itself. The AI writes words, never numbers.
// Bring-your-own keys are used for one call and never stored or logged.
// Operator-owned (agents/control.json → frozen_paths).
import { simulate, MAX_TICKS, INPUT_KEYS } from '../sim/run.js';
import { scoreRun } from '../sim/judge.js';
import { SYSTEM, userPrompt, parseWords, estimateTokens } from './ai/prompt.js';
import { PROVIDERS, EDGE_MODELS, streamJudge, listModels, pickModel, costUsd, describeError } from './ai/providers.js';
import { detectProvider } from '../ai/detect.js';

const EDGE_DAILY_CAP = 700;         // free-allowance judgings per UTC day (≈13 neurons each, 10k free)
const EDGE_HOURLY_PER_IP = 40;
const BYOK_HOURLY_PER_IP = 90;
const MAX_LOG = 6000;
const KEY_RE = /^[\w\-.:+/=]{8,400}$/;
const MODEL_RE = /^[\w\-.:/@]{1,120}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const day = () => new Date().toISOString().slice(0, 10);
const hour = () => new Date().toISOString().slice(0, 13);

let tablesReady = false;
async function ensureTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, initials TEXT NOT NULL, total REAL NOT NULL, verdict TEXT NOT NULL, facts TEXT NOT NULL, created INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS scores_day ON scores(day, total DESC)'),
    db.prepare('CREATE TABLE IF NOT EXISTS ai_usage (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL)'),
  ]);
  tablesReady = true;
}

async function bump(db, bucket) {
  if (!db) return 1;
  const row = await db.prepare('INSERT INTO ai_usage (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n').bind(bucket).first();
  return row?.n ?? 1;
}

async function ipHash(req) {
  const ip = req.headers.get('cf-connecting-ip') || '0';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${day()}|coldgas`));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Validate and replay a client input log → { run, card } or null.
export function verify(body) {
  const log = body?.log;
  if (!Array.isArray(log) || log.length === 0 || log.length > MAX_LOG) return null;
  let last = -1;
  for (const e of log) {
    if (!Array.isArray(e) || e.length !== INPUT_KEYS.length + 1) return null;
    if (!Number.isInteger(e[0]) || e[0] < last || e[0] > MAX_TICKS) return null;
    last = e[0];
    for (let i = 1; i < e.length; i++) if (!Number.isInteger(e[i]) || e[i] < -100 || e[i] > 100) return null;
  }
  const course = ['show', 'wall', 'lineup'].includes(body?.course) ? body.course : 'show';
  const run = simulate(log, course);
  const assist = log.some((e) => e[INPUT_KEYS.indexOf('assist') + 1] !== 0);
  return { run, card: scoreRun(run.t, { assist }) };
}

// --- The streaming judge ------------------------------------------------------------------------
function sse(ctx) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event, data) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  return { readable, send, close: () => writer.close().catch(() => {}), ctx };
}

async function judgeStream(req, env, ctx) {
  const t0 = Date.now();
  const body = await req.json().catch(() => null);
  const provider = PROVIDERS[body?.provider] ? body.provider : 'edge';
  const key = req.headers.get('x-cg-key') || '';
  if (PROVIDERS[provider].needsKey && !KEY_RE.test(key)) return json({ error: 'key' }, 400);
  if (body?.model && !MODEL_RE.test(body.model)) return json({ error: 'model' }, 400);
  const v = verify(body);
  if (!v) return json({ error: 'bad run' }, 400);

  const db = env.DB;
  if (db) await ensureTables(db);
  const ip = await ipHash(req);
  let allowed = true;
  if (provider === 'edge') {
    allowed = (await bump(db, `edge:${ip}:${hour()}`)) <= EDGE_HOURLY_PER_IP && (await bump(db, `edge-day:${day()}`)) <= EDGE_DAILY_CAP && !!env.AI;
  } else {
    allowed = (await bump(db, `byok:${ip}:${hour()}`)) <= BYOK_HOURLY_PER_IP;
  }

  const s = sse(ctx);
  const colo = req.cf?.colo || null;
  ctx.waitUntil((async () => {
    s.send('verify', { ms: Date.now() - t0, card: v.card, ticks: v.run.tick });
    const user = userPrompt(v.card);
    const model = provider === 'edge' ? (EDGE_MODELS.includes(body?.model) ? body.model : EDGE_MODELS[0]) : (body?.model || PROVIDERS[provider].fallbackModel);
    if (!model) { s.send('error', { message: 'Pick a model first.', fallback: true }); return s.close(); }
    s.send('prompt', {
      provider, providerLabel: PROVIDERS[provider].label, vendor: PROVIDERS[provider].vendor, model, colo,
      where: provider === 'edge' ? `Cloudflare ${colo || 'edge'}` : PROVIDERS[provider].label,
      system: SYSTEM, user, inTokensEst: estimateTokens(SYSTEM) + estimateTokens(user),
    });
    if (!allowed) {
      s.send('error', { message: provider === 'edge' ? 'The free edge allowance is used up for now.' : 'Too many calls from here this hour.', fallback: true });
      return s.close();
    }
    const tCall = Date.now();
    let ttft = null, text = '', reasoning = '', usage = { inTokens: 0, outTokens: 0, neurons: 0 };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    try {
      const tryModels = provider === 'edge' ? [model, ...EDGE_MODELS.filter((m) => m !== model)] : [model];
      let lastErr = null;
      for (const m of tryModels) {
        try {
          const it = streamJudge({ provider, env, key, model: m, system: SYSTEM, user, signal: abort.signal });
          let r;
          while (!(r = await it.next()).done) {
            const c = r.value;
            if (ttft === null) ttft = Date.now() - tCall;
            if (c.type === 'reasoning') { reasoning += c.text; s.send('reasoning', { t: c.text }); }
            else { text += c.text; s.send('token', { t: c.text }); }
          }
          usage = r.value || usage;
          if (m !== model) s.send('note', { message: `Fell back to ${m}.`, model: m });
          lastErr = null;
          usage.model = m;
          break;
        } catch (err) {
          lastErr = err;
          if (text) break;   // never splice two models' output together
        }
      }
      if (lastErr) throw lastErr;
      const used = usage.model || model;
      const inTokens = usage.inTokens || estimateTokens(SYSTEM) + estimateTokens(user);
      const outTokens = usage.outTokens || estimateTokens(text + reasoning);
      const totalMs = Date.now() - tCall;
      s.send('done', {
        words: { ...parseWords(text), source: 'ai' },
        provider, model: used, colo, ttftMs: ttft, totalMs, verifyMs: tCall - t0,
        inTokens, outTokens, neurons: usage.neurons ? Math.round(usage.neurons * 100) / 100 : null,
        tokensPerSec: totalMs > 0 ? Math.round((outTokens / Math.max(0.05, (totalMs - (ttft || 0)) / 1000)) * 10) / 10 : null,
        costUsd: costUsd(used, inTokens, outTokens), billedTo: provider === 'edge' ? 'COLD GAS (free allowance)' : `your ${PROVIDERS[provider].label} key`,
        raw: text,
      });
    } catch (err) {
      s.send('error', { message: describeError(provider, err), fallback: true });
    } finally {
      clearTimeout(timer);
      s.close();
    }
  })());
  return new Response(s.readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}

// --- Routes ---------------------------------------------------------------------------------------
async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/coldgas\/api/, '');

  if (path === '/health') return json({ ok: true, edge: EDGE_MODELS[0], ai: !!env.AI });

  if (path === '/providers' && req.method === 'GET') {
    return json({ default: { provider: 'edge', model: EDGE_MODELS[0] }, providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, vendor: p.vendor, needsKey: p.needsKey })) });
  }

  if (path === '/judge/stream' && req.method === 'POST') return judgeStream(req, env, ctx);

  if (path === '/models' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    const key = req.headers.get('x-cg-key') || '';
    // "auto": work out the provider from the key itself (src/ai/detect.js).
    const detected = body?.provider === 'auto' ? detectProvider(key) : null;
    if (detected && !detected.provider) return json({ error: detected.reason || 'Unrecognised key.' }, 400);
    const provider = detected ? detected.provider : body?.provider;
    if (!PROVIDERS[provider]?.needsKey || !KEY_RE.test(key)) return json({ error: 'That doesn’t look like a complete key.' }, 400);
    if (env.DB) { await ensureTables(env.DB); if ((await bump(env.DB, `models:${await ipHash(req)}:${hour()}`)) > 30) return json({ error: 'slow down' }, 429); }
    try {
      const models = (await listModels(provider, key)).sort();
      return json({ provider, models, suggested: pickModel(provider, models) || PROVIDERS[provider].fallbackModel || null });
    } catch (err) {
      return json({ error: describeError(provider, err) }, err?.status === 401 || err?.status === 403 ? 401 : 502);
    }
  }

  const db = env.DB;
  if (path === '/scores' && req.method === 'POST') {
    if (!db) return json({ error: 'no board' }, 503);
    await ensureTables(db);
    const body = await req.json().catch(() => null);
    const initials = String(body?.initials || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (initials.length !== 3) return json({ error: 'initials' }, 400);
    const v = verify(body);
    if (!v) return json({ error: 'bad run' }, 400);
    if (!v.card.facts.jumped || v.card.total <= 0) return json({ error: 'no jump' }, 400);
    if ((await bump(db, `submit:${await ipHash(req)}:${hour()}`)) > 60) return json({ error: 'slow down' }, 429);
    await db.prepare('INSERT INTO scores (day, initials, total, verdict, facts, created) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(day(), initials, v.card.total, v.card.verdict, JSON.stringify(v.card.facts), Date.now()).run();
    const rank = await db.prepare('SELECT COUNT(*) AS r FROM scores WHERE day = ? AND total > ?').bind(day(), v.card.total).first();
    return json({ card: v.card, rank: (rank?.r ?? 0) + 1 });
  }

  if (path === '/scores' && req.method === 'GET') {
    if (!db) return json({ rows: [] });
    await ensureTables(db);
    const board = url.searchParams.get('board') === 'all' ? 'all' : 'today';
    const q = board === 'all'
      ? db.prepare('SELECT initials, total, verdict, facts, day FROM scores ORDER BY total DESC, created ASC LIMIT 20')
      : db.prepare('SELECT initials, total, verdict, facts, day FROM scores WHERE day = ? ORDER BY total DESC, created ASC LIMIT 20').bind(day());
    const { results } = await q.all();
    return json({ board, rows: results.map((r) => ({ ...r, facts: JSON.parse(r.facts) })) });
  }

  return json({ error: 'not found' }, 404);
}

// --- The page itself ------------------------------------------------------------------------------
// The HTML carries `Cache-Control: no-transform` so the zone's analytics beacon is never injected
// (AGENTS.md §3.3). That also stops Cloudflare compressing it, so the Worker gzips it here and
// hands the bytes over as-is (encodeBody: 'manual'): 37 kB of inlined CSS goes out as ≈10 kB.
const PAGES = new Set(['/coldgas/', '/coldgas/index.html']);
async function page(req, env) {
  const res = await env.ASSETS.fetch(req);
  const type = res.headers.get('content-type') || '';
  if (res.status !== 200 || !type.startsWith('text/html') || !/\bgzip\b/.test(req.headers.get('accept-encoding') || '')) return res;
  const headers = new Headers(res.headers);
  headers.set('content-encoding', 'gzip');
  headers.append('vary', 'accept-encoding');
  headers.delete('content-length');
  const etag = headers.get('etag');
  if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`);   // a different byte stream
  return new Response(req.method === 'HEAD' ? null : res.body.pipeThrough(new CompressionStream('gzip')), { status: 200, headers, encodeBody: 'manual' });
}

export default {
  async fetch(req, env, ctx) {
    if (PAGES.has(new URL(req.url).pathname) && (req.method === 'GET' || req.method === 'HEAD')) return page(req, env);
    try { return await handle(req, env, ctx); }
    catch (err) { console.error('worker error', err?.name, err?.status); return json({ error: 'server' }, 500); }
  },
};
