// COLD GAS Worker: only /coldgas/api/* runs here; everything else is static assets.
//
//   POST /coldgas/api/judge/stream  { log, t?, assist, provider?, model? } (+ x-cg-key for BYOK)
//        → text/event-stream: verify → prompt → reasoning/token… → done | error
//        The server scores the run (from its telemetry `t`, or by replaying the log for a client
//        that doesn't send one), then streams the AI panel's words.
//   POST /coldgas/api/models  { provider } + x-cg-key → { models, suggested } (BYOK connect)
//   POST /coldgas/api/quest  { provider?, model?, arena, wish, seed } (+ x-cg-key for BYOK)
//        → text/event-stream: prompt → reasoning/token… → done { quest | null, errors } | error
//        The AI designs a side quest as JSON; the server validates it against the schema
//        (src/build/quest-schema.js) before it leaves. Data, never code.
//   GET  /coldgas/api/providers → providers and the edge default
//   POST /coldgas/api/scores  { log, t, course, initials, dry? } → board entry scored from the run's telemetry
//        (scoreRun on the server, after plausibility checks; no replay). `dry: true` runs every check and
//        answers the card and the rank it would get, storing nothing (scripts/board-probe.mjs).
//   GET  /coldgas/api/scores?board=today|all[&course=show|wall|lineup] → top 20 (every course without one)
//   POST /coldgas/api/obs  the client's observability batch (src/obs/ → src/worker/obs.js)
//   GET  /coldgas/api/obs/digest → top signatures, regressions vs the previous build, frame percentiles
//
// The client never sends a score: the board and the judges both score the run's telemetry (the client's
// own run of the same deterministic sim, src/sim/) with the server's `scoreRun`. A replay of the whole log
// costs ≈150 ms of CPU against the free plan's 10 ms (Cloudflare answers 1102 past it), so the board
// checks the telemetry for plausibility against the log instead (boardCheck). The AI writes words, never
// numbers.
// Bring-your-own keys are used for one call and never stored or logged.
// Operator-owned (agents/control.json → frozen_paths).
import { simulate, MAX_TICKS, INPUT_KEYS, isLogEntryLength, SIM_VERSION } from '../sim/run.js';
import { scoreRun } from '../sim/judge.js';
import { CAR } from '../sim/vehicle.js';
import { SYSTEM, userPrompt, parseWords, estimateTokens } from './ai/prompt.js';
import { PROVIDERS, EDGE_MODELS, streamJudge, listModels, pickModel, costUsd, describeError } from './ai/providers.js';
import { detectProvider } from '../ai/detect.js';
import { validateQuest, extractJson } from '../build/quest-schema.js';
import { questSystem, questUser, QUEST_MAX_TOKENS } from './ai/quest.js';
import { physicsReady } from '../sim/engine.js';
import { postObs, obsDigest } from './obs.js';

const EDGE_DAILY_CAP = 700;         // free-allowance judgings per UTC day (≈13 neurons each, 10k free)
const EDGE_HOURLY_PER_IP = 40;
const BYOK_HOURLY_PER_IP = 90;
const QUEST_EDGE_HOURLY_PER_IP = 12;   // side quests on the free model: ≈3× a judging's neurons each
const QUEST_EDGE_DAILY_CAP = 250;
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
    db.prepare('CREATE TABLE IF NOT EXISTS replays (k TEXT PRIMARY KEY, card TEXT NOT NULL, ticks INTEGER NOT NULL, created INTEGER NOT NULL)'),
  ]);
  // The board's course and tier (2026-10-30): added to a `scores` table made before them, once. Rows from
  // before carry their course in their facts (the Wall's and the Show's) or are the Lineup's.
  const cols = new Set(((await db.prepare('PRAGMA table_info(scores)').all()).results || []).map((c) => c.name));
  const add = [];
  if (!cols.has('course')) add.push(db.prepare('ALTER TABLE scores ADD COLUMN course TEXT'));
  if (!cols.has('tier')) add.push(db.prepare('ALTER TABLE scores ADD COLUMN tier TEXT'));
  if (add.length) {
    await db.batch(add).catch((err) => { if (!/duplicate column/i.test(String(err?.message))) throw err; });   // a racing isolate added it
    await db.prepare("UPDATE scores SET course = COALESCE(json_extract(facts, '$.course'), 'lineup') WHERE course IS NULL").run();
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS scores_course_day ON scores(course, day, total DESC)').run();
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

// Validate a client input log → { log, course } or null. Entries carry every channel of
// src/sim/run.js INPUT_KEYS (v11: 23 incl. Advanced's ten valves) or the 12 of an older client, whose
// missing channels replay as zero.
function parseRun(body) {
  const log = body?.log;
  if (!Array.isArray(log) || log.length === 0 || log.length > MAX_LOG) return null;
  let last = -1;
  for (const e of log) {
    if (!Array.isArray(e) || !isLogEntryLength(e.length)) return null;
    if (!Number.isInteger(e[0]) || e[0] < last || e[0] > MAX_TICKS) return null;
    last = e[0];
    for (let i = 1; i < e.length; i++) if (!Number.isInteger(e[i]) || e[i] < -100 || e[i] > 100) return null;
  }
  return { log, course: ['show', 'wall', 'lineup'].includes(body?.course) ? body.course : 'show' };
}

// Validate and replay a client input log → { run, card } or null. The tier (Assist / Pro / Advanced)
// comes from the replayed inputs themselves, never from a flag the client sends.
export function verify(body) {
  const p = parseRun(body);
  if (!p) return null;
  const run = simulate(p.log, p.course);
  const assist = p.log.some((e) => e[INPUT_KEYS.indexOf('assist') + 1] !== 0);
  return { run, card: scoreRun(run.t, { assist }) };
}

// --- Replays, once per run --------------------------------------------------------------------------
// A replay is the costliest thing this Worker does: ≈150 ms of CPU for the Show on the rigid-body
// engine, where the free plan budgets 10 ms a request and tolerates only the odd heavy one (past
// that, Cloudflare answers 1102 "exceeded resource limits"). Only an old client's judging (no `t`)
// still replays; a log judged twice reads the card the first replay earned. The key is the exact
// log, course and SIM_VERSION, and only the server writes entries, so a client can only ever find
// the card its own log earned. The board never replays (boardCheck).
const memo = new Map();
export const replayStats = { replays: 0 };
const MEMO_MAX = 64, REPLAY_TTL_MS = 2 * 86400e3;

async function replayKey(p) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${SIM_VERSION}|${p.course}|${JSON.stringify(p.log)}`));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// → { card, ticks } or null for a malformed log. `db` (optional) shares cards across isolates.
async function verified(body, db) {
  const p = parseRun(body);
  if (!p) return null;
  const k = await replayKey(p);
  let hit = memo.get(k);
  if (!hit && db) {
    const row = await db.prepare('SELECT card, ticks FROM replays WHERE k = ?').bind(k).first();
    if (row) hit = { card: JSON.parse(row.card), ticks: row.ticks };
  }
  if (!hit) {
    // The replay runs on the rigid-body engine's WASM: started once per isolate, on the first replay.
    if (!physicsReady()) await (await import('./physics.js')).startPhysics();
    const v = verify(body);
    replayStats.replays++;
    hit = { card: v.card, ticks: v.run.tick };
    if (db) {
      await db.prepare('INSERT OR REPLACE INTO replays (k, card, ticks, created) VALUES (?, ?, ?, ?)').bind(k, JSON.stringify(hit.card), hit.ticks, Date.now()).run();
      // Cards are only needed between a run's judgings: keep two days of them.
      await db.prepare('DELETE FROM replays WHERE created < ?').bind(Date.now() - REPLAY_TTL_MS).run().catch(() => {});
    }
  }
  memo.delete(k);
  memo.set(k, hit);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  return hit;
}

// --- The judges' card, without a replay -------------------------------------------------------------
// The free plan can't afford a replay per judging (≈170 ms of CPU against a 10 ms budget: past the
// first few, Cloudflare answers 1102). The judges only write words, so they work from the run's
// telemetry (`run.t`, the client's own replay of the same deterministic sim), scored here by the
// same `scoreRun`. Only numbers come from the client: every name, verdict, category and line of the
// prompt is the server's. The board (POST /scores) scores the same way, after boardCheck (below).
const T_KEY = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const T_ENUMS = { course: ['show', 'wall', 'lineup'], tier: ['assist', 'pro', 'advanced'] };
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
function cleanValue(k, v, depth) {
  if (finite(v) || typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'string') {
    if (T_ENUMS[k]) return T_ENUMS[k].includes(v) ? v : undefined;
    return /^[a-z][a-z-]{0,23}$/.test(v) ? v : undefined;   // an end reason ('settled', 'no-jump', …)
  }
  if (Array.isArray(v)) return v.length <= 8 && v.every((x) => finite(x) || x === null) ? v.slice() : undefined;
  if (v && typeof v === 'object' && depth < 2) return cleanTelemetry(v, depth + 1);
  return undefined;
}
export function cleanTelemetry(t, depth = 0) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(t)) {
    if (!T_KEY.test(k) || ++n > 160) continue;
    const c = cleanValue(k, v, depth);
    if (c !== undefined) out[k] = c;
  }
  return out;
}
// → { card, ticks } from the client's telemetry, or null when it doesn't score to a sane card.
function telemetryCard(body, p) {
  const t = cleanTelemetry(body?.t);
  if (!t || t.course !== p.course) return null;
  try {
    // The tier is the log's, as on the board (tierFromLog), never the client's own word for it.
    const tier = isInt(t.endTick) ? tierFromLog(p.log, t) : null;
    const assist = p.log.some((e) => e[INPUT_KEYS.indexOf('assist') + 1] !== 0);
    const card = scoreRun(tier ? { ...t, tier } : t, { assist });
    if (!Number.isFinite(card.total) || card.total < 0 || card.total > 100) return null;
    return { card, ticks: finite(t.endTick) ? t.endTick : null, replayed: false };
  } catch { return null; }
}

// --- The board, from telemetry ------------------------------------------------------------------
// The owner's decision (2026-10-30): the board is scored from the client's telemetry exactly as the
// judges are, with no replay on the submit path. The telemetry can't be proven without a replay, so it
// has to be *plausible*: consistent with the input log it came with and inside what the car can
// physically do (src/sim/spec.js). Every bound is generous against the references (scripts/fly.mjs: the
// Show scores 94.0 with sink 0.817 m/s, 4.2 s of air, 27.4 m apex, 5 rad/s peak rotation) so no honest
// run is ever refused; a forged one has to stay inside them and agree with its own log.
const AIR_MAX_S = 20;          // ≤ 10 s of hover on all 297 kg of N2 at Isp 72 s (2,150 kg dry), plus the fall
const APEX_MAX = 300;          // m: the lip (≈27 m) plus every kilogram of gas fired straight up (78 kN down-jets)
// m/s, any speed (sink included): a run-up (≤ 25 m/s), plus every kilogram of gas as ideal Δv (Isp 72 s ·
// g0 · ln(2,447 / 2,150) ≈ 91 m/s; the 80 kN rear jets reach ≈ 94 m/s), plus a free fall from APEX_MAX (≈ 77 m/s).
const SPEED_MAX = 200;
const SPIN_MAX = 10;           // rad/s of roll or pitch, averaged over the flight: twice the references' 5 rad/s peak
const SPAN_MAX = 500;          // m: past any course's runout
const isInt = (v) => Number.isInteger(v);
const within = (v, lo, hi) => finite(v) && v >= lo && v <= hi;

// The tier the log itself was flown in, as src/sim/run.js decides it (any Assist tick: Assist; manual on
// every tick from the ramp (or the release) to touchdown: Advanced; else Pro). The window comes from the
// telemetry's ticks, which have to agree with the log; the client's own `tier` is never read.
export function tierFromLog(log, t) {
  const A = INPUT_KEYS.indexOf('assist') + 1, M = INPUT_KEYS.indexOf('manual') + 1;
  const from = t.rampTick >= 0 ? t.rampTick : t.airStartTick, to = t.touchTick >= 0 ? t.touchTick : t.endTick;
  let assist = false, manual = false, pro = false;
  for (let i = 0; i < log.length && log[i][0] <= t.endTick; i++) {
    const e = log[i], a = e[A] || 0, m = e[M] || 0, next = i + 1 < log.length ? log[i + 1][0] : t.endTick + 1;
    if (a) assist = true;
    else if (m) manual = true;
    else if (from >= 0 && e[0] <= to && next > from) pro = true;
  }
  return assist ? 'assist' : manual && !pro ? 'advanced' : 'pro';
}

// → { card, tier, course } or { error[, why] } for a board entry: the log (parsed), its telemetry, the
// plausibility checks, then the server's own scoreRun.
export function boardCheck(body) {
  if (!body || typeof body !== 'object') return { error: 'bad run' };
  if (!T_ENUMS.course.includes(body.course)) return { error: 'course' };
  const p = parseRun(body);
  if (!p || p.log[0][0] !== 0) return { error: 'bad run' };
  if (body.t == null) return { error: 'update' };   // a client from before the board scored telemetry
  const t = cleanTelemetry(body.t);
  const bad = (why) => ({ error: 'implausible', why });
  if (!t || t.course !== p.course) return bad('course');
  const lastTick = p.log[p.log.length - 1][0];
  // The run's clock: it ended inside the cap, after its last logged input (the aftermath is never logged).
  if (!isInt(t.endTick) || t.endTick <= 0 || t.endTick > MAX_TICKS || lastTick > t.endTick) return bad('endTick');
  if (!isInt(t.airStartTick) || !isInt(t.touchTick)) return bad('ticks');
  if (!(t.airStartTick >= 0 && t.touchTick > t.airStartTick && t.touchTick <= t.endTick)) return { error: 'no jump' };
  const rampTick = t.rampTick ?? -1;
  if (!isInt(rampTick) || rampTick > t.airStartTick + 24) return bad('rampTick');
  const airS = (t.touchTick - t.airStartTick) / 240;
  if (airS > AIR_MAX_S) return bad('air');
  // Every number the scorer reads, finite and inside the car's envelope.
  const gasTouch = t.airAtTouch ?? t.airEnd;
  const checks = {
    sink: within(t.sink, 0, SPEED_MAX), tiltDeg: within(t.tiltDeg, 0, 180), headingDeg: within(t.headingDeg, -180, 180),
    wheelSpreadMs: within(t.wheelSpreadMs, 0, 1000), apex: within(t.apex, -5, APEX_MAX),
    rollAccum: finite(t.rollAccum) && Math.abs(t.rollAccum) <= SPIN_MAX * airS + 0.5,
    pitchAccum: finite(t.pitchAccum) && Math.abs(t.pitchAccum) <= SPIN_MAX * airS + 0.5,
    offAxis: within(t.offAxis ?? 0, 0, 1e3), lateral: within(t.lateral, -SPAN_MAX, SPAN_MAX), landZ: within(t.landZ, -SPAN_MAX, SPAN_MAX),
    gas: within(t.airEnd, 0, CAR.airMass) && within(gasTouch, t.airEnd - 0.5, CAR.airMass) && within(t.airAtLaunch ?? CAR.airMass, gasTouch - 0.5, CAR.airMass + 0.01),
    speed: within(t.maxSpeed ?? 0, 0, SPEED_MAX) && within(t.launchSpeed, 0, (t.maxSpeed ?? SPEED_MAX) + 0.5),
    clearance: t.minClearance == null || within(t.minClearance, -5, APEX_MAX),
    progress: within(t.progress ?? 0, 0, 1.05), invertedTime: within(t.invertedTime ?? 0, 0, t.endTick / 240),
    height: within(t.maxRampHeight ?? 0, 0, APEX_MAX) && within(t.launchHeight ?? 0, -5, APEX_MAX),
    damage: t.damage == null || within(t.damage.pct, 0, 100),
  };
  for (const [k, ok] of Object.entries(checks)) if (!ok) return bad(k);
  // The tier is the log's: the multiplier can't be claimed, only flown.
  const tier = tierFromLog(p.log, t);
  let card;
  try { card = scoreRun({ ...t, tier }, { assist: tier === 'assist' }); } catch { return bad('score'); }
  if (!Number.isFinite(card.total) || card.total < 0 || card.total > 100) return bad('total');
  if (!card.facts.jumped || card.total <= 0) return { error: 'no jump' };
  return { card, tier, course: p.course };
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
  const db = env.DB;
  if (db) await ensureTables(db);
  // A client that sends its telemetry is judged from it (no replay); an older one is replayed.
  const p = parseRun(body);
  if (!p) return json({ error: 'bad run' }, 400);
  const v = (body?.t && telemetryCard(body, p)) || await verified(body, db);
  if (!v) return json({ error: 'bad run' }, 400);

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
    s.send('verify', { ms: Date.now() - t0, card: v.card, ticks: v.ticks, replayed: v.replayed !== false });
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

// --- The quest designer ----------------------------------------------------------------------------
// One call to the chosen provider (the free edge model, or the player's key for this call only),
// streamed to the theatre; the answer is parsed and validated here, and only a valid quest leaves.
async function questStream(req, env, ctx) {
  const t0 = Date.now();
  const body = await req.json().catch(() => null);
  const provider = PROVIDERS[body?.provider] ? body.provider : 'edge';
  const key = req.headers.get('x-cg-key') || '';
  if (PROVIDERS[provider].needsKey && !KEY_RE.test(key)) return json({ error: 'key' }, 400);
  if (body?.model && !MODEL_RE.test(body.model)) return json({ error: 'model' }, 400);
  const arena = body?.arena === 'road' ? 'road' : 'sandbox';
  const wish = typeof body?.wish === 'string' ? body.wish.slice(0, 140) : '';
  const seed = String(body?.seed ?? '').replace(/[^\w-]/g, '').slice(0, 24) || '0';

  const db = env.DB;
  if (db) await ensureTables(db);
  const ip = await ipHash(req);
  let allowed;
  if (provider === 'edge') allowed = (await bump(db, `quest-edge:${ip}:${hour()}`)) <= QUEST_EDGE_HOURLY_PER_IP && (await bump(db, `quest-day:${day()}`)) <= QUEST_EDGE_DAILY_CAP && !!env.AI;
  else allowed = (await bump(db, `byok:${ip}:${hour()}`)) <= BYOK_HOURLY_PER_IP;
  if (!allowed) return json({ error: 'slow down' }, 429);

  const s = sse(ctx);
  const colo = req.cf?.colo || null;
  ctx.waitUntil((async () => {
    const system = questSystem(arena), user = questUser({ arena, wish, seed });
    const model = provider === 'edge' ? (EDGE_MODELS.includes(body?.model) ? body.model : EDGE_MODELS[0]) : (body?.model || PROVIDERS[provider].fallbackModel);
    if (!model) { s.send('error', { message: 'Pick a model first.', fallback: true }); return s.close(); }
    s.send('prompt', {
      provider, providerLabel: PROVIDERS[provider].label, vendor: PROVIDERS[provider].vendor, model, colo,
      where: provider === 'edge' ? `Cloudflare ${colo || 'edge'}` : PROVIDERS[provider].label,
      system, user, inTokensEst: estimateTokens(system) + estimateTokens(user),
    });
    const tCall = Date.now();
    let ttft = null, text = '', reasoning = '', usage = { inTokens: 0, outTokens: 0, neurons: 0 };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    try {
      const tryModels = provider === 'edge' ? [model, ...EDGE_MODELS.filter((m) => m !== model)] : [model];
      let lastErr = null;
      for (const m of tryModels) {
        try {
          const it = streamJudge({ provider, env, key, model: m, system, user, signal: abort.signal, maxTokens: QUEST_MAX_TOKENS });
          let r;
          while (!(r = await it.next()).done) {
            const c = r.value;
            if (ttft === null) ttft = Date.now() - tCall;
            if (c.type === 'reasoning') { reasoning += c.text; s.send('reasoning', { t: c.text }); }
            else { text += c.text; s.send('token', { t: c.text }); }
          }
          usage = r.value || usage;
          usage.model = m;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (text) break;
        }
      }
      if (lastErr) throw lastErr;
      const used = usage.model || model;
      const inTokens = usage.inTokens || estimateTokens(system) + estimateTokens(user);
      const outTokens = usage.outTokens || estimateTokens(text + reasoning);
      const totalMs = Date.now() - tCall;
      const parsed = extractJson(text);
      const v = parsed ? validateQuest(parsed, { arena }) : { ok: false, errors: ['the answer had no JSON object'] };
      s.send('done', {
        quest: v.ok ? v.quest : null, errors: v.ok ? null : v.errors,
        provider, model: used, colo, ttftMs: ttft, totalMs, verifyMs: tCall - t0,
        inTokens, outTokens, neurons: usage.neurons ? Math.round(usage.neurons * 100) / 100 : null,
        tokensPerSec: totalMs > 0 ? Math.round((outTokens / Math.max(0.05, (totalMs - (ttft || 0)) / 1000)) * 10) / 10 : null,
        costUsd: costUsd(used, inTokens, outTokens), billedTo: provider === 'edge' ? 'COLD GAS (free allowance)' : `your ${PROVIDERS[provider].label} key`,
        raw: text.slice(0, 6000),
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

  if (path === '/obs' && req.method === 'POST') { if (env.DB) await ensureTables(env.DB); return postObs(req, env, ctx, { json, ipHash, day, hour }); }
  if (path === '/obs/digest' && req.method === 'GET') return obsDigest(req, env, ctx, { json });

  if (path === '/quest' && req.method === 'POST') return questStream(req, env, ctx);

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
    const dry = body?.dry === true;
    const initials = String(body?.initials || (dry ? 'DRY' : '')).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (initials.length !== 3) return json({ error: 'initials' }, 400);
    const v = boardCheck(body);
    if (v.error) return json(v, 400);
    if ((await bump(db, `${dry ? 'dry' : 'submit'}:${await ipHash(req)}:${hour()}`)) > 60) return json({ error: 'slow down' }, 429);
    const { card, tier, course } = v;
    if (!dry) {
      await db.prepare('INSERT INTO scores (day, initials, total, verdict, facts, created, course, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(day(), initials, card.total, card.verdict, JSON.stringify(card.facts), Date.now(), course, tier).run();
    }
    // The rank today on this course (a dry run: the rank it would get).
    const rank = await db.prepare('SELECT COUNT(*) AS r FROM scores WHERE day = ? AND course = ? AND total > ?').bind(day(), course, card.total).first();
    return json({ card, course, tier, rank: (rank?.r ?? 0) + 1, dry });
  }

  if (path === '/scores' && req.method === 'GET') {
    if (!db) return json({ rows: [] });
    await ensureTables(db);
    const board = url.searchParams.get('board') === 'all' ? 'all' : 'today';
    const course = T_ENUMS.course.includes(url.searchParams.get('course')) ? url.searchParams.get('course') : null;
    const where = [], args = [];
    if (board === 'today') { where.push('day = ?'); args.push(day()); }
    if (course) { where.push('course = ?'); args.push(course); }
    const q = db.prepare(`SELECT initials, total, verdict, facts, day, course, tier FROM scores${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY total DESC, created ASC LIMIT 20`);
    const { results } = await (args.length ? q.bind(...args) : q).all();
    return json({ board, course, rows: results.map((r) => ({ ...r, facts: JSON.parse(r.facts) })) });
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
    try {
      return await handle(req, env, ctx);
    }
    catch (err) { console.error('worker error', err?.name, err?.status); return json({ error: 'server' }, 500); }
  },
};
