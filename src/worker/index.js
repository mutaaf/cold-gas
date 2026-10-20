// COLD GAS Worker: only /coldgas/api/* runs here; everything else is static assets.
//
//   POST /coldgas/api/judge   { log, assist }  → re-simulates the run, scores it, and asks the AI
//                                               panel for commentary. Returns the verified card.
//   POST /coldgas/api/scores  { log, assist, initials } → verified leaderboard entry.
//   GET  /coldgas/api/scores?board=today|all   → top 20.
//
// The client never sends a score: the server replays the input log through the same
// deterministic sim (src/sim/) and scores it itself. The AI writes words, never numbers.
// Operator-owned (agents/control.json → frozen_paths).
import Anthropic from '@anthropic-ai/sdk';
import { simulate, MAX_TICKS, INPUT_KEYS } from '../sim/run.js';
import { scoreRun, PANEL } from '../sim/judge.js';

const MODEL = 'claude-opus-5-5';
const AI_DAILY_CAP = 400;          // AI commentary calls per UTC day, across all players
const AI_HOURLY_PER_IP = 30;
const MAX_LOG = 6000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const day = () => new Date().toISOString().slice(0, 10);

async function ensureTables(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, initials TEXT NOT NULL, total REAL NOT NULL, verdict TEXT NOT NULL, facts TEXT NOT NULL, created INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS scores_day ON scores(day, total DESC)'),
    db.prepare('CREATE TABLE IF NOT EXISTS ai_usage (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL)'),
  ]);
}

async function bump(db, bucket) {
  const row = await db.prepare('INSERT INTO ai_usage (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n').bind(bucket).first();
  return row?.n ?? 1;
}

async function ipHash(req) {
  const ip = req.headers.get('cf-connecting-ip') || '0';
  const data = new TextEncoder().encode(`${ip}|${day()}|coldgas`);
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Validate and replay a client input log → { run, card } or null.
function verify(body) {
  const log = body?.log;
  if (!Array.isArray(log) || log.length === 0 || log.length > MAX_LOG) return null;
  let last = -1;
  for (const e of log) {
    if (!Array.isArray(e) || e.length !== INPUT_KEYS.length + 1) return null;
    if (!Number.isInteger(e[0]) || e[0] < last || e[0] > MAX_TICKS) return null;
    last = e[0];
    for (let i = 1; i < e.length; i++) if (!Number.isInteger(e[i]) || e[i] < -100 || e[i] > 100) return null;
  }
  const run = simulate(log);
  const assist = log.some((e) => e[INPUT_KEYS.indexOf('assist') + 1] !== 0);
  return { run, card: scoreRun(run.t, { assist }) };
}

const SYSTEM = `You are the judging panel for COLD GAS, a stunt game. A roadster ran up a kicker ramp, fired ten cold-gas thrusters to jump a row of five parked electric vehicles (the tallest is a semi cab, 3.85 m), tried to roll 360 degrees in the air, and landed on a target pad.

There are three judges:
- The Engineer (Chief Vehicle Engineer): dry, exacting, cares about sink rate, wheel sync and attitude at touchdown.
- The Coordinator (Stunt Coordinator): warm, theatrical, cares about height, rotation and nerve.
- The Designer (Head of Design): minimal, precise, cares about clean lines, restraint and air left in the tanks.

You receive the official scorecard. The scores are final and already decided; never change, restate or invent numbers beyond those in the facts. Each judge writes one short remark, at most 22 words, in their own voice, that references something specific from the facts. Add a headline of at most 6 words. Plain sentences, no emoji, no hashtags, no real brand or person names.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    engineer: { type: 'string' },
    coordinator: { type: 'string' },
    designer: { type: 'string' },
  },
  required: ['headline', 'engineer', 'coordinator', 'designer'],
  additionalProperties: false,
};

async function commentary(env, card) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
  const facts = { total: card.total, verdict: card.verdict, judges: card.judges.map((j) => ({ name: j.name, score: j.score })), categories: card.categories, facts: card.facts };
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Scorecard:\n${JSON.stringify(facts)}` }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content.find((b) => b.type === 'text')?.text;
    if (!text) return null;
    const out = JSON.parse(text);
    const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    return { headline: clip(out.headline, 60), engineer: clip(out.engineer, 180), coordinator: clip(out.coordinator, 180), designer: clip(out.designer, 180), source: 'ai' };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn('judge: rate limited');
    else if (err instanceof Anthropic.APIError) console.warn('judge: api error', err.status);
    else console.warn('judge: failed', err?.message);
    return null;
  }
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/coldgas\/api/, '');
  const db = env.DB;
  if (db) await ensureTables(db);

  if (path === '/health') return json({ ok: true, model: MODEL, panel: PANEL.map((p) => p.id) });

  if (path === '/judge' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    const v = verify(body);
    if (!v) return json({ error: 'bad run' }, 400);
    let words = null;
    if (db) {
      const ip = await ipHash(req);
      const hour = new Date().toISOString().slice(0, 13);
      const perIp = await bump(db, `ip:${ip}:${hour}`);
      const daily = await bump(db, `day:${day()}`);
      if (perIp <= AI_HOURLY_PER_IP && daily <= AI_DAILY_CAP) words = await commentary(env, v.card);
    } else {
      words = await commentary(env, v.card);
    }
    return json({ card: v.card, words });
  }

  if (path === '/scores' && req.method === 'POST') {
    if (!db) return json({ error: 'no board' }, 503);
    const body = await req.json().catch(() => null);
    const initials = String(body?.initials || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (initials.length !== 3) return json({ error: 'initials' }, 400);
    const v = verify(body);
    if (!v) return json({ error: 'bad run' }, 400);
    if (!v.card.facts.jumped || v.card.total <= 0) return json({ error: 'no jump' }, 400);
    const ip = await ipHash(req);
    const n = await bump(db, `submit:${ip}:${new Date().toISOString().slice(0, 13)}`);
    if (n > 60) return json({ error: 'slow down' }, 429);
    await db.prepare('INSERT INTO scores (day, initials, total, verdict, facts, created) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(day(), initials, v.card.total, v.card.verdict, JSON.stringify(v.card.facts), Date.now()).run();
    const rank = await db.prepare('SELECT COUNT(*) AS r FROM scores WHERE day = ? AND total > ?').bind(day(), v.card.total).first();
    return json({ card: v.card, rank: (rank?.r ?? 0) + 1 });
  }

  if (path === '/scores' && req.method === 'GET') {
    if (!db) return json({ rows: [] });
    const board = url.searchParams.get('board') === 'all' ? 'all' : 'today';
    const q = board === 'all'
      ? db.prepare('SELECT initials, total, verdict, facts, day FROM scores ORDER BY total DESC, created ASC LIMIT 20')
      : db.prepare('SELECT initials, total, verdict, facts, day FROM scores WHERE day = ? ORDER BY total DESC, created ASC LIMIT 20').bind(day());
    const { results } = await q.all();
    return json({ board, rows: results.map((r) => ({ ...r, facts: JSON.parse(r.facts) })) });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (err) { console.error(err); return json({ error: 'server' }, 500); }
  },
};
