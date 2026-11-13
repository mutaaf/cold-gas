// Saves on CrazyGames go through its data module (docs.crazygames.com/sdk/data: "fully rely on the Data Module"; for
// a guest it keeps them in localStorage, for a signed-in player it syncs them across devices). The game itself reads
// and writes localStorage (the coldgas_* keys), so a portal build keeps one copy of those keys in the data module:
// - before the game loads (src/portal/boot.js), the data module's copy is written into localStorage (it wins);
// - after, every few seconds and when the page hides, localStorage's coldgas_* keys are written back if they changed.
// localStorage stays the fallback: no data module (GameDistribution, or the SDK blocked) and the game saves as it does.
export const SAVE_KEY = 'coldgas_save';
export const PREFIX = 'coldgas';
export const MAX_BYTES = 900_000;   // the data module's limit is 1 MiB of JSON (the docs); keep room

/** The game's keys in a Storage, as { key: value }. */
export function snapshot(ls) {
  const out = {};
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX) && k !== SAVE_KEY) out[k] = ls.getItem(k);
    }
  } catch { /* storage blocked */ }
  return out;
}

/** The snapshot as JSON within `max` bytes: the largest values (a best run's ghost) stay local first. */
export function fit(obj, max = MAX_BYTES) {
  const o = { ...obj };
  let s = JSON.stringify(o);
  const bySize = Object.keys(o).sort((a, b) => String(o[b]).length - String(o[a]).length);
  while (s.length > max && bySize.length) { delete o[bySize.shift()]; s = JSON.stringify(o); }
  return s;
}

/** The data module's copy into localStorage. Returns how many keys it wrote. */
export function hydrate(ls, data) {
  let raw = null;
  try { raw = data.getItem(SAVE_KEY); } catch { return 0; }
  if (!raw) return 0;
  let obj;
  try { obj = JSON.parse(raw); } catch { return 0; }
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') continue;
    try { ls.setItem(k, v); n++; } catch { /* full or blocked */ }
  }
  return n;
}

/** Writes localStorage's keys back to the data module when they change. Returns flush() (also run on hide). */
export function mirror({ ls, data, win = globalThis.window, doc = globalThis.document, every = 4000 }) {
  let last = '';
  try { last = data.getItem(SAVE_KEY) || ''; } catch { /* nothing yet */ }
  const flush = () => {
    const s = fit(snapshot(ls));
    if (s === last) return false;
    try { data.setItem(SAVE_KEY, s); last = s; return true; } catch { return false; }
  };
  if (every > 0) setInterval(flush, every);
  win?.addEventListener?.('pagehide', flush);
  doc?.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(); });
  return flush;
}
