// Circuit breakers for the flaky subsystems (the AI judge, audio, the world's worker, the rocket
// backdrop). Pure: the clock is injected and the state is a plain object the health ledger
// persists, so a subsystem that broke in the last session stays off at the next boot until its
// cooldown has passed, then gets one trial.
//
//   closed     calls go through; `threshold` failures inside `windowMs` open it
//   open       calls are refused (the caller falls back) until `openUntil`
//   half-open  one trial call: success closes it, failure re-opens it for twice as long
//
// Hot paths call `allow()`: in the closed state that is one property read, no clock, no allocation.

export const BREAKER_DEFAULTS = { threshold: 2, windowMs: 60_000, baseCooldownMs: 30_000, maxCooldownMs: 30 * 60_000 };

export function newBreakerState() {
  return { state: 'closed', fails: 0, firstFail: 0, openUntil: 0, trips: 0, lastError: '', lastChange: 0 };
}

export function createBreaker(name, { now = Date.now, state = null, onChange = null, ...opts } = {}) {
  const o = { ...BREAKER_DEFAULTS, ...opts };
  const s = state && typeof state === 'object' ? { ...newBreakerState(), ...state } : newBreakerState();
  const change = (to) => { if (s.state !== to) { s.state = to; s.lastChange = now(); onChange?.(name, s); } };
  const b = {
    name,
    get state() { return s.state; },
    snapshot: () => ({ name, ...s }),
    // May the subsystem be used now? (Open past its cooldown → half-open: one trial.)
    allow() {
      if (s.state === 'closed') return true;
      if (s.state === 'open' && now() >= s.openUntil) change('half-open');
      return s.state === 'half-open';
    },
    success() {
      if (s.state === 'closed' && s.fails === 0) return;
      s.fails = 0; s.firstFail = 0;
      if (s.state !== 'closed') { s.trips = Math.max(0, s.trips - 1); change('closed'); }
    },
    failure(err) {
      const t = now();
      s.lastError = String(err?.message ?? err ?? '').slice(0, 120);
      if (s.state === 'half-open') return open(t);
      if (s.state === 'open') return;
      if (!s.fails || t - s.firstFail > o.windowMs) { s.fails = 0; s.firstFail = t; }
      if (++s.fails >= o.threshold) open(t);
      else onChange?.(name, s);
    },
    // Ms until a trial is allowed (0 when closed or due).
    retryIn() { return s.state === 'open' ? Math.max(0, s.openUntil - now()) : 0; },
    reset() { Object.assign(s, newBreakerState()); onChange?.(name, s); },
  };
  function open(t) {
    s.openUntil = t + Math.min(o.maxCooldownMs, o.baseCooldownMs * 2 ** s.trips);
    s.trips++; s.fails = 0; s.firstFail = 0;
    change('open');
  }
  return b;
}
