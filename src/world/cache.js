// Tile caches for the endless world: an in-memory LRU of built tiles (typed arrays, under a byte
// budget), and an optional IndexedDB store on this device keyed by world version + seed + tile, so a
// seed you've driven before streams in from disk instead of being rebuilt. Both are invisible to
// the physics (it never reads them) and safe to lose: a miss just builds the tile again.

// Bytes a built tile holds (its arrays).
export function tileBytes(t) {
  let b = t.pos.byteLength + t.nor.byteLength + t.col.byteLength + t.dep.byteLength;
  if (t.veg) for (const v of Object.values(t.veg)) b += v.m.byteLength + v.c.byteLength;
  return b;
}

export function createLru(maxBytes) {
  const map = new Map();          // key → { value, bytes }, oldest first
  let bytes = 0, hits = 0, misses = 0;
  return {
    get(key) {
      const e = map.get(key);
      if (!e) { misses++; return null; }
      map.delete(key); map.set(key, e);
      hits++;
      return e.value;
    },
    has: (key) => map.has(key),
    set(key, value, size) {
      const old = map.get(key);
      if (old) { bytes -= old.bytes; map.delete(key); }
      map.set(key, { value, bytes: size });
      bytes += size;
      while (bytes > maxBytes && map.size > 1) {
        const [k, e] = map.entries().next().value;
        map.delete(k); bytes -= e.bytes;
      }
    },
    clear() { map.clear(); bytes = 0; },
    stats: () => ({ entries: map.size, bytes, hits, misses }),
  };
}

// IndexedDB: one object store, values are the tile objects (structured clone keeps typed arrays).
// Capped at `maxEntries`; the oldest written are dropped first. Every call is best-effort.
// Opening it can hang (WebKit, a blocked upgrade in another tab): after `openMs` the cache is off
// for this world and every tile is built instead (a late open is closed, not used).
export const IDB_OPEN_MS = 1500;
export function createIdbCache(name = 'coldgas-endless', maxEntries = 600, { openMs = IDB_OPEN_MS, idb } = {}) {
  let dbp = null, writes = 0, hits = 0, misses = 0;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let settled = false;
      const done = (db) => { if (settled) { try { db?.close(); } catch { /* closing */ } return; } settled = true; clearTimeout(timer); resolve(db); };
      const timer = setTimeout(() => done(null), openMs);
      try {
        const factory = idb === undefined ? globalThis.indexedDB : idb;
        if (!factory) return done(null);
        const req = factory.open(name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles').createIndex('t', 't');
        };
        req.onsuccess = () => done(req.result);
        req.onerror = () => done(null);
        req.onblocked = () => done(null);
      } catch { done(null); }
    });
    return dbp;
  };
  return {
    async get(key) {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const r = db.transaction('tiles', 'readonly').objectStore('tiles').get(key);
          r.onsuccess = () => { const v = r.result ? r.result.v : null; if (v) hits++; else misses++; resolve(v); };
          r.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    },
    async put(key, value) {
      const db = await open();
      if (!db) return;
      try {
        const tx = db.transaction('tiles', 'readwrite'), st = tx.objectStore('tiles');
        st.put({ v: value, t: Date.now() }, key);
        if (++writes % 50 === 0) {
          // Trim to the newest maxEntries.
          const c = st.count();
          c.onsuccess = () => {
            let extra = c.result - maxEntries;
            if (extra <= 0) return;
            st.index('t').openCursor().onsuccess = (e) => {
              const cur = e.target.result;
              if (!cur || extra-- <= 0) return;
              cur.delete(); cur.continue();
            };
          };
        }
      } catch { /* quota or private mode: fine, it's a cache */ }
    },
    stats: () => ({ writes, hits, misses }),
  };
}
