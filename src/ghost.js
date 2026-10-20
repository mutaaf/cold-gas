// Ghost of your best jump: the best finished run's replay frames, kept on this device
// (IndexedDB, keyed by SIM_VERSION) and played back in lockstep with the live sim tick.
// Lookups are allocation-free; storage never throws (private modes, blocked storage).
import { FRAME_EVERY, SIM_VERSION } from './sim/run.js';

export const newGhostPose = () => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });

// Flatten run.frames (one Float32Array per frame) into one array: cheap to store and to read.
// `ref` marks the reference jump: a stand-in until you finish a run of your own.
export function packFrames(frames, total, ref = false) {
  const n = frames.length, stride = n ? frames[0].length : 0;
  const data = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) data.set(frames[i], i * stride);
  return { v: SIM_VERSION, n, stride, total, ref, data };
}

// Your own run always replaces the reference; otherwise the higher total wins.
export function isBetter(best, g) {
  if (!best) return true;
  if (g.ref !== best.ref) return !g.ref;
  return g.total > best.total;
}

// Pose of the ghost at a live sim tick. Frame i was recorded after tick FRAME_EVERY·(i+1).
// Position is lerped, attitude nlerped; past either end the ghost holds its first/last frame.
export function ghostAt(g, tick, out) {
  if (!g || !g.n) return false;
  const { data, stride, n } = g;
  const f = Math.min(n - 1, Math.max(0, tick / FRAME_EVERY - 1));
  const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), k = f - i0;
  const a = i0 * stride, b = i1 * stride;
  out.x = data[a] + (data[b] - data[a]) * k;
  out.y = data[a + 1] + (data[b + 1] - data[a + 1]) * k;
  out.z = data[a + 2] + (data[b + 2] - data[a + 2]) * k;
  const s = data[a + 3] * data[b + 3] + data[a + 4] * data[b + 4] + data[a + 5] * data[b + 5] + data[a + 6] * data[b + 6] < 0 ? -1 : 1;
  let qx = data[a + 3] + (s * data[b + 3] - data[a + 3]) * k;
  let qy = data[a + 4] + (s * data[b + 4] - data[a + 4]) * k;
  let qz = data[a + 5] + (s * data[b + 5] - data[a + 5]) * k;
  let qw = data[a + 6] + (s * data[b + 6] - data[a + 6]) * k;
  const l = Math.hypot(qx, qy, qz, qw) || 1;
  out.qx = qx / l; out.qy = qy / l; out.qz = qz / l; out.qw = qw / l;
  return true;
}

// --- Storage (this device only) ------------------------------------------------------------
// One fixed key; the record carries its SIM_VERSION, so a sim change retires the old ghost.
const DB = 'coldgas', STORE = 'ghost', KEY = 'best';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    const timer = setTimeout(() => reject(new Error('idb timeout')), 3000);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { clearTimeout(timer); const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('idb blocked')); };
  });
}
const valid = (g) => !!g && g.v === SIM_VERSION && g.n > 0 && g.data instanceof Float32Array;

export async function loadBest() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => { db.close(); resolve(valid(req.result) ? req.result : null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch { return null; }
}

// Compare and write in one transaction, so a worse run (another tab, a slow load) never
// overwrites a better stored one.
export async function saveBest(g) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const t = db.transaction(STORE, 'readwrite');
      const s = t.objectStore(STORE);
      const req = s.get(KEY);
      req.onsuccess = () => { const old = req.result; if (!valid(old) || isBetter(old, g)) s.put(g, KEY); };
      t.oncomplete = t.onerror = t.onabort = () => { db.close(); resolve(); };
    });
  } catch { /* storage blocked */ }
}

export function ghostEnabled() {
  try { return localStorage.getItem('coldgas_ghost') !== '0'; } catch { return true; }
}
export function setGhostEnabled(on) {
  try { localStorage.setItem('coldgas_ghost', on ? '1' : '0'); } catch { /* storage blocked */ }
}
