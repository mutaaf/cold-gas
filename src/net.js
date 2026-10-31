// Shared by the judges' stream (src/ai/stream.js), the board (src/panel.js), Free Drive's roads
// (src/drive/load.js), the physics WASM (src/sim/engine-web.js) and the self-heal's build probe.
//
//   fetchWithDeadline(url, { ms, signal, ...init })   every network call has a deadline and a cancel
//   withDeadline(promise, ms, label)                   the same for anything else (a lazy import)
//   postRetry(url, init)                               POST, retried on a 503
//   lazyOnce(load)                                     a lazy chunk asked for once, asked again after a failure
//   reimport(failed, again)                            that retry, past Chromium's memory of the failed import
//   judgesOverran(error, providerMs)                   a judges' deadline that counts against their breaker
//
// [obs] A deadline aborts with a TimeoutError, which obs's fetch wrapper records (by route only);
// a caller's own cancel is an AbortError, which it doesn't (nothing went wrong).
import { obs } from './obs/index.js';

const timeoutError = (what, ms) => {
  const err = new Error(`${what} took longer than ${Math.round(ms / 100) / 10} s`);
  err.name = 'TimeoutError';
  return err;
};
const short = (url) => String(url).replace(/^.*\/coldgas\//, '/').replace(/\?.*$/, '');
export const isTimeout = (err) => err?.name === 'TimeoutError';
export const isAbort = (err) => err?.name === 'AbortError';

// fetch(), but it gives up after `ms` (the headers must have arrived by then: read a body that can
// stall under your own `signal`), and `signal` cancels it at any point, body included.
export function fetchWithDeadline(url, { ms = 15_000, signal = null, ...init } = {}) {
  const ctl = new AbortController();
  let timedOut = false;
  const cancel = () => ctl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; ctl.abort(timeoutError(`fetch ${short(url)}`, ms)); }, ms);
  let p;
  try { p = globalThis.fetch(url, { ...init, signal: ctl.signal }); } catch (err) { p = Promise.reject(err); }
  return p.then(
    (res) => { clearTimeout(timer); return res; },
    (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      throw timedOut ? timeoutError(`fetch ${short(url)}`, ms) : err;
    },
  );
}

// Settles with `promise`, or rejects with a TimeoutError after `ms`. The timer never outlives it.
export function withDeadline(promise, ms, label = 'task') {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(label, ms)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// POST, and try twice more on a 503: the platform's answer when an isolate has run over its CPU
// budget (Cloudflare 1102). The replay is heavy; the next try usually lands on a fresh isolate.
// [obs] Each retry is a self-heal: recorded as a recovery, ok if a later try landed. (The failures
// themselves are recorded by obs's fetch wrapper, by route only: never a header or a key.)
export async function postRetry(url, init, waits = [1200, 3000]) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (i > 0) obs.recovery('net-retry', res.status !== 503, `${String(url).replace(/^.*\/api\//, '/api/')} after ${i} retr${i > 1 ? 'ies' : 'y'}: ${res.status}`);
    if (res.status !== 503 || i >= waits.length || init.signal?.aborted) return res;
    await new Promise((r) => setTimeout(r, waits[i]));
  }
}

// A lazy chunk, asked for once: the promise is kept while it's pending or loaded and forgotten when it
// fails, so the next press asks again (0057: one dropped fetch broke Free Drive until a reload). `load`
// gets the last failure (null the first time) to pass to `reimport`.
export function lazyOnce(load) {
  let p = null, failed = null;
  return () => (p ??= Promise.resolve().then(() => load(failed)).then(
    (mod) => { failed = null; return mod; },
    (err) => { p = null; failed = err; throw err; },
  ));
}

// Chromium keeps a failed dynamic import in its module map: the same URL fails again at once, with no
// request. So a retry asks for the URL the error names (Chromium, Firefox) with a query, a fresh fetch and
// a fresh module record; an error that names none (WebKit) just asks again. A stylesheet Vite couldn't
// preload stays in the page as a failed <link>, and Vite skips any href already there: it's taken out first,
// so the retry's preload asks for it again. (A shared chunk the root imports can't be re-asked this way:
// Chromium names the root, and the copy's imports hit the remembered failure. Only a reload cures that.)
export function reimport(failed, again) {
  const msg = String(failed?.message || '');
  const css = /Unable to preload CSS for (\S+)/.exec(msg)?.[1];
  if (css) for (const l of globalThis.document?.querySelectorAll('link[rel="stylesheet"]') ?? []) if (l.href === css) l.remove();
  const url = css ? null : /https?:\/\/[^\s'"]+\.js/.exec(msg)?.[0];
  if (!url || new URL(url).origin !== globalThis.location?.origin) return again();
  return import(/* @vite-ignore */ `${url}?retry=${Date.now()}`);
}

// The judges' 35 s deadline counts against their breaker (which turns the AI panel off, across sessions)
// only when the provider had most of it (0057): a chunk that took the first 30 s left the provider 5, and a
// late answer then is the network's doing, not the judges'.
export const JUDGES_FAIR_MS = 30_000;
export const judgesOverran = (error, providerMs) => /too long/.test(error || '') && providerMs >= JUDGES_FAIR_MS;
