// Observability, client side: every error and every frame, cheaply, and the health ledger that
// lets the next session (and the agents) heal from this one.
//
//   obs.init({ tier, scale, reason, deviceClass })  once, at boot (installs the global listeners)
//   obs.error(module, err, kind)    capture (deduped by signature: one entry per fault, with a count)
//   obs.fail(name, err) / obs.ok(name)   a breaker-guarded subsystem failed / worked
//   obs.breaker(name)               the circuit breaker for a subsystem (src/obs/breaker.js)
//   obs.frame(now, dt, sim, render, work, dropped, govern)   once per frame: zero allocations
//   obs.recovery(kind, ok, detail)  a self-heal happened (or failed)
//   obs.snapshot()                  for the For nerds panel's Health section
//   obs.payload() / obs.flush()     the batch sent to POST /coldgas/api/obs (sendBeacon)
//
// What leaves the device: error signatures (normalised message, top frame as function@file, the
// build), counts, a frame-time histogram, the graphics tier and a coarse device class
// ('phone-lo' … 'desktop-hi'). No URLs beyond a file's name, no user agent, no keys, no ids.
import { signature, moduleOf, redact, MODULE_IDS, KIND_IDS } from './signature.js';
import { createBreaker } from './breaker.js';
import { createFrameStats, recordFrame, summary, NB } from './frames.js';
import { loadLedger, saveLedger, chooseBoot, createGovernor, SCALES, TIER_IDS } from './ledger.js';

export const BUILD = (import.meta.env?.VITE_CG_BUILD || 'dev').replace(/[^0-9a-z.-]/gi, '').slice(0, 24) || 'dev';
const API = `${import.meta.env?.BASE_URL ?? '/coldgas/'}api/obs`;
const MAX_SIGS = 32;          // distinct faults kept per session (the rest are counted, not kept)
const MAX_SEND_ERRS = 16;     // per beacon
const MIN_FLUSH_MS = 30_000;  // at most one beacon per 30 s…
const MAX_BEACONS = 6;        // …and six per session
const SAVE_EVERY_MS = 10_000; // the ledger's session record is refreshed this often (never per frame)
const storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();

// A coarse device class: form factor × a memory/cores bucket. Nothing finer.
export function deviceClass(nav = globalThis.navigator, coarse = globalThis.matchMedia?.('(pointer: coarse)').matches, kind = coarse ? 'phone' : 'desktop') {
  const mem = nav?.deviceMemory || 8, cores = nav?.hardwareConcurrency || 8;
  const b = mem <= 4 || cores <= 4 ? 'lo' : mem >= 8 && cores >= 8 ? 'hi' : 'mid';
  return `${kind}-${b}`;   // phone | tablet | desktop (src/gfx-tier.js deviceKind)
}

function createObs() {
  const o = {
    build: BUILD, started: false, deviceClass: 'desktop-mid', tier: 'high', tierReason: '', tierFrom: 'device', scale: 0,
    errs: new Map(),          // sig → entry
    errCount: 0, dropped: 0,  // all captured / beyond MAX_SIGS
    frames: createFrameStats(),
    breakers: {},
    recoveries: [],           // this session's, newest last
    ledger: null, session: null,
    governor: null, onScale: null,
    beacons: 0, lastFlush: 0, sentErr: new Map(), sendEnabled: false,
    glLost: false, listeners: [],
  };

  const log1 = new Set();
  // One fault object is one report: a failed import reaches us as vite:preloadError, then perhaps as
  // an unhandled rejection, then from the caller's own catch. Count it once.
  const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
  o.error = (module, err, kind = 'error') => {
    try {
      if (seen && err && typeof err === 'object') { if (seen.has(err)) return null; seen.add(err); }
      const mod = MODULE_IDS.includes(module) ? module : moduleOf(err?.stack);
      const k = KIND_IDS.includes(kind) ? kind : 'error';
      const s = signature(err, o.build, k);
      o.errCount++;
      let e = o.errs.get(s.sig);
      if (!e) {
        if (o.errs.size >= MAX_SIGS) { o.dropped++; return null; }
        e = { ...s, mod, kind: k, n: 0, first: performance.now(), last: 0 };
        o.errs.set(s.sig, e);
        if (!log1.has(s.sig)) { log1.add(s.sig); emit('error', e); }
      }
      e.n++; e.last = performance.now();
      if (o.session) o.session.crashes[mod] = (o.session.crashes[mod] || 0) + (['trap', 'ctxlost', 'frame'].includes(k) ? 1 : 0);
      if (o.session) o.session.errors = (o.session.errors || 0) + 1;
      return e;
    } catch { return null; }
  };

  o.breaker = (name) => (o.breakers[name] ??= createBreaker(name, {
    state: o.ledger?.breakers?.[name] || null,
    onChange: (n, s) => { if (o.ledger) { o.ledger.breakers[n] = { ...s }; persist(); } emit('breaker', { name: n, ...s }); },
  }));
  o.fail = (name, err, kind = 'error') => { o.breaker(name).failure(err); return o.error(name, err, kind); };
  // A lazy chunk failed (a deploy replaced the build, or the network dropped it): recorded once, and
  // the self-heal decides what to do (src/obs/heal.js: probe the build, reload only into a new one).
  const lazySeen = seen ? new WeakSet() : null;
  o.lazyFailed = (err) => {
    const e = err instanceof Error ? err : new Error(String(err || 'lazy chunk failed'));
    if (lazySeen) { if (lazySeen.has(e)) return; lazySeen.add(e); }
    o.error('lazy', e, 'lazy');
    emit('lazy', e);
  };
  o.ok = (name) => { o.breakers[name]?.success(); };

  o.recovery = (kind, ok, detail = '') => {
    const r = { kind, ok: !!ok, detail: redact(String(detail)).slice(0, 120), at: Date.now() };
    o.recoveries.push(r);
    if (o.recoveries.length > 16) o.recoveries.shift();
    if (o.ledger) { o.ledger.recoveries.push(r); persist(); }
    emit('recovery', r);
    return r;
  };

  // --- Frames: the hot path ---------------------------------------------------------------------
  let nextSave = 0;
  o.frame = (now, dtMs, simMs, renMs, workMs, dropped, govern = true) => {
    const w = recordFrame(o.frames, now, dtMs, simMs, renMs, workMs, dropped);
    if (w !== null && o.governor && govern) {
      const step = o.governor.feed(w);
      if (step !== 0) setScale(o.governor.level, step < 0 ? 'hitching' : 'headroom');
    }
    if (now >= nextSave) { nextSave = now + SAVE_EVERY_MS; if (o.started) saveSession(); }
  };
  function setScale(level, why) {
    o.scale = level;
    o.recovery(why === 'hitching' ? 'degrade' : 'recover-up', true, `resolution ${Math.round(SCALES[level] * 100)} % (${why})`);
    try { o.onScale?.(SCALES[level], level); } catch (err) { o.error('render', err); }
  }

  // --- The ledger ---------------------------------------------------------------------------------
  function persist() { if (o.ledger) saveLedger(storage, o.ledger); }
  function saveSession() {
    const x = o.session;
    if (!x) return;
    const sm = summary(o.frames);
    x.frames = sm.frames; x.p50 = sm.p50; x.p95 = sm.p95; x.p99 = sm.p99; x.hitches = sm.hitches; x.slow = sm.slowShare;
    x.scale = Math.max(x.scale || 0, o.scale);   // the lowest resolution this session needed
    x.ctxLost = o.session.ctxLost || 0;
    persist();
  }

  // Boot: pick the tier from this device's past sessions (or the URL, or the device class).
  o.boot = ({ forced = null, deviceTier = 'high' } = {}) => {
    o.ledger = loadLedger(storage);
    const pick = chooseBoot({ sessions: o.ledger.sessions, deviceTier, forced: TIER_IDS.includes(forced) ? forced : null });
    o.tier = pick.tier; o.tierReason = pick.reason; o.tierFrom = pick.from; o.scale = pick.scale;
    return pick;
  };

  o.init = ({ deviceClass: dc = deviceClass(), send = null } = {}) => {
    if (o.started) return o;
    o.started = true;
    o.deviceClass = dc;
    o.ledger ??= loadLedger(storage);
    o.governor = createGovernor({ level: o.scale });
    o.session = { t: Date.now(), build: o.build, tier: o.tier, scale: o.scale, dc, frames: 0, p50: 0, p95: 0, p99: 0, hitches: 0, crashes: {}, errors: 0, ctxLost: 0, ended: false };
    // The previous session never said goodbye: count it (a killed tab or a crashed renderer).
    const prev = o.ledger.sessions[o.ledger.sessions.length - 1];
    if (prev && prev.ended === false && (prev.frames || 0) > 600) o.error('page', Object.assign(new Error('previous session ended without pagehide'), { stack: '' }), 'unclean');
    o.ledger.sessions.push(o.session);
    persist();
    // Beacons go to production only (or with ?obs=1): a dev server or a test runner has no Worker.
    const host = globalThis.location?.hostname || '';
    o.sendEnabled = send ?? (!['localhost', '127.0.0.1', ''].includes(host) || /[?&]obs=1\b/.test(globalThis.location?.search || ''));
    install();
    return o;
  };

  // --- Global capture -----------------------------------------------------------------------------
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); o.listeners.push([target, type, fn, opts]); }
  function install() {
    if (typeof addEventListener !== 'function') return;
    on(globalThis, 'error', (e) => {
      // A failed <script>/<link> load is an Event with a target, not an ErrorEvent.
      if (!(e instanceof ErrorEvent) && e.target && e.target !== globalThis) {
        // A modulepreload hint that failed is the same fault as the import it was warming, which
        // reports itself (vite:preloadError): one failed chunk, one report.
        if (e.target.tagName === 'LINK' && /modulepreload/i.test(e.target.rel || '')) return;
        o.error('lazy', new Error(`resource failed: ${e.target.tagName || '?'}`), 'lazy');
        return;
      }
      const err = e.error || new Error(e.message || 'script error');
      if (!e.error && e.filename) err.stack = `    at ${e.filename}:${e.lineno}:${e.colno}`;
      o.error(classify(err), err, isTrap(err) ? 'trap' : 'error');
    }, true);
    on(globalThis, 'unhandledrejection', (e) => {
      const r = e.reason, err = r instanceof Error ? r : new Error(typeof r === 'string' ? r : 'unhandled rejection');
      if (isLazy(err)) { o.lazyFailed(err); return; }
      o.error(classify(err), err, isTrap(err) ? 'trap' : 'rejection');
    });
    // Vite's own event for a failed dynamic import (a chunk gone after a deploy, a dropped network).
    on(globalThis, 'vite:preloadError', (e) => { o.lazyFailed(e.payload || new Error('preload failed')); });
    on(globalThis, 'pagehide', () => { if (o.session) { o.session.ended = true; saveSession(); } o.flush('pagehide'); });
    on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') { saveSession(); o.flush('hidden'); } });
    wrapFetch();
  }
  const isTrap = (err) => (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) || /\bunreachable\b|memory access out of bounds|recursive use of an object|RuntimeError/i.test(`${err?.name} ${err?.message}`);
  const isLazy = (err) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|preload/i.test(err?.message || '');
  const classify = (err) => (isTrap(err) ? 'physics' : moduleOf(err?.stack));
  o.isTrap = isTrap;

  // Every fetch: a network failure or a 5xx is recorded by route (path only: never the query,
  // never a header, so a BYOK key in `x-cg-key` can't reach the log). Behaviour is unchanged.
  function wrapFetch() {
    const raw = globalThis.fetch;
    if (typeof raw !== 'function' || raw.__obs) return;
    const route = (input) => {
      try {
        const u = new URL(typeof input === 'string' ? input : input?.url ?? String(input), globalThis.location?.href);
        return u.pathname.replace(/^.*\/api\//, '/api/').replace(/\/[0-9a-f-]{8,}/gi, '/:id').slice(0, 60);
      } catch { return '?'; }
    };
    const wrapped = function (input, init) {
      const p = raw.call(this, input, init);
      p.then((res) => {
        const r = route(input);
        if (res.status >= 500) noteFetch(r, res.status);
        else if (r.startsWith('/api/judge')) o.ok('judge');
      }, (err) => { if (err?.name !== 'AbortError') noteFetch(route(input), 0, err); });
      return p;
    };
    wrapped.__obs = true;
    globalThis.fetch = wrapped;
  }
  function noteFetch(r, status, err) {
    const e = new Error(`fetch ${r} ${status || 'network error'}`);
    e.stack = `    at fetch (${r.replace(/[^\w/.-]/g, '')}:0:0)`;
    if (r.startsWith('/api/judge')) o.fail('judge', e, 'fetch'); else o.error('net', e, 'fetch');
    void err;
  }

  // --- Sending ------------------------------------------------------------------------------------
  o.payload = () => {
    const errs = [];
    for (const e of o.errs.values()) {
      const sent = o.sentErr.get(e.sig) || 0;
      if (e.n > sent) errs.push({ sig: e.sig, key: e.key, mod: e.mod, kind: e.kind, n: e.n - sent, msg: e.msg, fr: e.fr, st: sent ? '' : e.st });
      if (errs.length >= MAX_SEND_ERRS) break;
    }
    const f = o.frames;
    const hist = Array.from(f.hist);
    return {
      v: 1, build: o.build, dc: o.deviceClass.replace(/^tablet/, 'phone'), tier: o.tier, scale: o.scale,   // the Worker's classes (src/worker/obs.js DCS) have no tablet yet
      errs,
      fr: f.frames ? { h: hist, n: f.frames, hitch: f.hitches, low: f.lowFpsWindows, drop: Math.round(f.droppedTicks), sim: summary(f).simMs, ren: summary(f).renderMs } : null,
      rec: o.recoveries.filter((r) => !r.sent).slice(-8).map((r) => ({ kind: r.kind, ok: r.ok })),
      br: Object.values(o.breakers).filter((b) => b.state !== 'closed').map((b) => b.name).slice(0, 8),
    };
  };
  // Frames are cumulative per session: the server counts a session's histogram once (`first`),
  // so later beacons send only what's new.
  let sentFrames = null, sessionSent = false;
  o.flush = (reason = 'manual', { force = false } = {}) => {
    const now = Date.now();
    if (!force && (o.beacons >= MAX_BEACONS || now - o.lastFlush < MIN_FLUSH_MS) && reason !== 'pagehide' && reason !== 'hidden') return null;
    if (!force && o.beacons >= MAX_BEACONS + 2) return null;
    const p = o.payload();
    // The frame histogram since the last beacon.
    if (p.fr && sentFrames) {
      p.fr.h = p.fr.h.map((c, i) => c - sentFrames.h[i]);
      for (const k of ['n', 'hitch', 'low', 'drop']) p.fr[k] -= sentFrames[k];
    }
    if (p.fr && p.fr.n < 60) p.fr = null;
    p.first = !sessionSent;
    if (!p.errs.length && !p.fr && !p.rec.length && sessionSent) return null;
    const body = JSON.stringify(p);
    if (body.length > 8000) { p.errs = p.errs.slice(0, 4).map((e) => ({ ...e, st: '' })); }
    const out = JSON.stringify(p);
    let sent = false;
    if (o.sendEnabled && out.length <= 8000) {
      try {
        sent = globalThis.navigator?.sendBeacon?.(API, new Blob([out], { type: 'application/json' })) || false;
        if (!sent) { globalThis.fetch?.(API, { method: 'POST', body: out, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {}); sent = true; }
      } catch { sent = false; }
    }
    if (sent || !o.sendEnabled) {
      for (const e of p.errs) o.sentErr.set(e.sig, (o.sentErr.get(e.sig) || 0) + e.n);
      for (const r of o.recoveries) r.sent = true;
      if (o.frames.frames) { const fr = o.frames; sentFrames = { h: Array.from(fr.hist), n: fr.frames, hitch: fr.hitches, low: fr.lowFpsWindows, drop: Math.round(fr.droppedTicks) }; }
      sessionSent = true;
      o.beacons++; o.lastFlush = now;
    }
    o.lastPayload = p;
    return p;
  };

  // --- For the panel ----------------------------------------------------------------------------
  o.snapshot = () => ({
    build: o.build, deviceClass: o.deviceClass, tier: o.tier, tierReason: o.tierReason, tierFrom: o.tierFrom,
    scale: SCALES[o.scale], scaleLevel: o.scale, glLost: o.glLost,
    errCount: o.errCount, dropped: o.dropped,
    errors: [...o.errs.values()].sort((a, b) => b.n - a.n).map((e) => ({ sig: e.sig, mod: e.mod, kind: e.kind, n: e.n, msg: e.msg, fr: e.fr })),
    frames: summary(o.frames), hist: Array.from(o.frames.hist), nb: NB,
    breakers: Object.values(o.breakers).map((b) => ({ name: b.name, state: b.state, retryIn: b.retryIn(), trips: b.snapshot().trips, lastError: b.snapshot().lastError })),
    recoveries: o.recoveries.slice(), lastRecovery: o.recoveries[o.recoveries.length - 1] || null,
    pastSessions: (o.ledger?.sessions || []).slice(0, -1).slice(-5).map((x) => ({ tier: x.tier, p95: x.p95, frames: x.frames, ended: x.ended, scale: x.scale })),
    beacons: o.beacons, sending: o.sendEnabled,
  });

  // A tiny event hub (the self-heal layer and the panel listen).
  const subs = new Map();
  function emit(type, data) { const l = subs.get(type); if (l) for (const fn of l) { try { fn(data); } catch { /* a listener must not break capture */ } } }
  o.on = (type, fn) => { if (!subs.has(type)) subs.set(type, new Set()); subs.get(type).add(fn); return () => subs.get(type).delete(fn); };

  o.markCtxLost = () => { o.glLost = true; if (o.session) o.session.ctxLost = (o.session.ctxLost || 0) + 1; saveSession(); };
  return o;
}

export const obs = createObs();

// A function guarded by a breaker: while it's open the call is skipped (returns `fallback`), and a
// throw is recorded as a failure instead of escaping. No allocation per call (fixed arity).
export function guard(name, fn, fallback = undefined) {
  const b = obs.breaker(name);
  return function guarded(a, b2, c, d) {
    if (!b.allow()) return fallback;
    try {
      const r = fn(a, b2, c, d);
      if (b.state !== 'closed') b.success();   // a half-open trial that worked
      return r;
    } catch (err) { obs.fail(name, err, name === 'audio' ? 'audio' : 'error'); return fallback; }
  };
}
