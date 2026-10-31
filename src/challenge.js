// Challenge links (pure, no DOM): a finished run carried in the URL's fragment, so a shared run is a
// rematch. `…/coldgas/?play=jump&course=show#vs=<payload>`. The payload is the run's input log (the
// whole run: it replays bit-exactly, src/sim/run.js simulate) plus the course, SIM_VERSION, the score
// it scored and the sender's initials when they have some, packed small and base64url-encoded:
//
//   byte 0      format (FORMAT)
//   varint      SIM_VERSION
//   byte        course (COURSE_IDS index)
//   varint      score × 10 (0..1000)
//   byte        tier (TIER_IDS index)
//   3 bytes     initials (A–Z), or three zeros
//   varint      entries
//   per entry   varint tick delta (the first: its tick), then one byte per changed channel
//               (channel index | 0x80 on the entry's last; 0xFF alone = an entry that changed nothing)
//               followed by its change from the channel's last value (zigzag varint; values stay
//               within ±100, the quantised input's range)
//
// That's ≈ 4 bytes for a typical entry (one channel changes at a time). The bytes are then compressed
// with deflate-raw where the platform has CompressionStream ('z' prefix), else sent as they are ('r').
// Everything decoded is bounded and checked: a fragment longer than VS_MAX_CHARS, a decompressed size
// past MAX_RAW, an unknown course, a tick out of order or past MAX_TICKS, a value outside ±100 or a
// trailing byte all reject the whole payload (null), never throw. The fragment never reaches a
// server (a browser never sends it), so the link carries nothing personal but three letters.
import { SIM_VERSION, MAX_TICKS, INPUT_KEYS, createRun, stepRun } from './sim/run.js';
import { newInput } from './sim/vehicle.js';
import { scoreRun } from './sim/judge.js';

export const FORMAT = 1;
export const COURSE_IDS = ['show', 'wall', 'lineup'];
export const TIER_IDS = ['assist', 'pro', 'advanced'];
export const CHANNELS = INPUT_KEYS.length;        // 23
export const VS_MAX_CHARS = 12000;                // a fragment longer than this is never decoded
export const VS_TARGET_CHARS = 1900;              // what a Share aims for (the whole URL stays under ~2,000)
const MAX_RAW = 256 * 1024;                       // decompressed bytes, at most (a 90 s run with every channel moving every tick is far less)
const NONE = 0xff, LAST = 0x80;

// --- varints -----------------------------------------------------------------------------------
function putVar(out, n) {
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
}
function getVar(r) {
  let n = 0, mul = 1;
  for (let i = 0; i < 5; i++) {
    if (r.i >= r.b.length) throw new Error('eof');
    const x = r.b[r.i++];
    n += (x & 0x7f) * mul;
    if (!(x & 0x80)) return n;
    mul *= 128;
  }
  throw new Error('varint');
}
const getByte = (r) => { if (r.i >= r.b.length) throw new Error('eof'); return r.b[r.i++]; };

// --- the log, as bytes ---------------------------------------------------------------------------
// A log from an older client (12 channels) is padded to today's 23 (the missing channels are zero,
// exactly as simulate() reads it).
export function packBytes({ log, course, score, tier = 'assist', initials = '', simVersion = SIM_VERSION }) {
  const ci = COURSE_IDS.indexOf(course);
  if (ci < 0) throw new Error('course');
  const out = [FORMAT];
  putVar(out, simVersion);
  out.push(ci);
  putVar(out, Math.max(0, Math.min(1000, Math.round((Number(score) || 0) * 10))));
  out.push(Math.max(0, TIER_IDS.indexOf(tier)));
  const ini = /^[A-Z]{3}$/.test(initials || '') ? initials : '';
  for (let i = 0; i < 3; i++) out.push(ini ? ini.charCodeAt(i) : 0);
  putVar(out, log.length);
  const prev = new Int16Array(CHANNELS);
  let lastTick = 0;
  log.forEach((e, k) => {
    putVar(out, k === 0 ? e[0] : e[0] - lastTick);
    lastTick = e[0];
    const changed = [];
    for (let c = 0; c < CHANNELS; c++) {
      const v = e[c + 1] | 0;
      if (v !== prev[c]) changed.push(c);
    }
    if (!changed.length) out.push(NONE);
    changed.forEach((c, j) => {
      const v = Math.max(-100, Math.min(100, e[c + 1] | 0)), d = v - prev[c];
      out.push(c | (j === changed.length - 1 ? LAST : 0));
      putVar(out, d >= 0 ? 2 * d : -2 * d - 1);   // zigzag: a ramp's +1, +1, +1 is one byte each, and deflate folds it
      prev[c] = v;
    });
  });
  return Uint8Array.from(out);
}

// Bytes → { simVersion, course, score, tier, initials, log } or throws (unpack() turns that into null).
export function unpackBytes(b) {
  const r = { b, i: 0 };
  if (getByte(r) !== FORMAT) throw new Error('format');
  const simVersion = getVar(r);
  const course = COURSE_IDS[getByte(r)];
  if (!course) throw new Error('course');
  const score10 = getVar(r);
  if (score10 > 1000) throw new Error('score');
  const tier = TIER_IDS[getByte(r)];
  if (!tier) throw new Error('tier');
  const ic = [getByte(r), getByte(r), getByte(r)];
  let initials = '';
  if (ic.every((c) => c >= 65 && c <= 90)) initials = String.fromCharCode(...ic);
  else if (!ic.every((c) => c === 0)) throw new Error('initials');
  const n = getVar(r);
  if (n < 1 || n > MAX_TICKS) throw new Error('entries');
  const cur = new Array(CHANNELS).fill(0);
  const log = new Array(n);
  let tick = 0;
  for (let k = 0; k < n; k++) {
    const d = getVar(r);
    tick = k === 0 ? d : tick + d;
    if ((k > 0 && d === 0) || tick >= MAX_TICKS) throw new Error('tick');
    let x = getByte(r);
    if (x !== NONE) {
      let seen = 0;
      for (;;) {
        const c = x & 0x7f;
        if (c >= CHANNELS || (seen & (1 << c))) throw new Error('channel');
        seen |= 1 << c;
        const z = getVar(r);
        if (z > 400) throw new Error('value');
        const v = cur[c] + (z & 1 ? -(z + 1) / 2 : z / 2);
        if (v < -100 || v > 100 || v === cur[c]) throw new Error('value');
        cur[c] = v;
        if (x & LAST) break;
        x = getByte(r);
      }
    }
    log[k] = [tick, ...cur];
  }
  if (r.i !== b.length) throw new Error('trailing');
  return { simVersion, course, score: score10 / 10, tier, initials, log };
}

// --- base64url -----------------------------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
export function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) s += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) s += B64[c & 63];
  }
  return s;
}
export function fromB64url(s) {
  if (typeof s !== 'string' || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0, acc = 0, o = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? B64I[code] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

// --- compression (where the platform has it) ------------------------------------------------------
export const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
async function pipe(bytes, stream, cap = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) { reader.cancel().catch(() => {}); throw new Error('too big'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// The payload for a run: 'z' + base64url(deflate-raw(bytes)) where CompressionStream exists, else
// 'r' + base64url(bytes). `compress: false` forces the plain form (tests, old browsers).
export async function encodeChallenge(run, { compress = canCompress() } = {}) {
  const bytes = packBytes(run);
  if (compress) {
    try { return `z${toB64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`; } catch { /* plain below */ }
  }
  return `r${toB64url(bytes)}`;
}

// A payload → its run, or null for anything that isn't one (too long, bad base64, can't inflate, a
// bound broken). A run from another SIM_VERSION decodes (so the page can say it's from an older
// version) with `stale: true`.
export async function decodeChallenge(payload) {
  try {
    if (typeof payload !== 'string' || payload.length < 2 || payload.length > VS_MAX_CHARS) return null;
    const kind = payload[0];
    let bytes = fromB64url(payload.slice(1));
    if (!bytes || !bytes.length) return null;
    if (kind === 'z') {
      if (!canCompress()) return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_RAW);
    } else if (kind !== 'r') return null;
    if (bytes.length > MAX_RAW) return null;
    const run = unpackBytes(bytes);
    return { ...run, stale: run.simVersion !== SIM_VERSION };
  } catch {
    return null;
  }
}

// The fragment's payload, if the hash is a challenge (`#vs=…`, maybe among other `&`-separated keys).
export function vsFromHash(hash) {
  if (typeof hash !== 'string' || hash.length > VS_MAX_CHARS + 16) return null;
  const m = /(?:^#|&)vs=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? m[1] : null;
}

// The challenge URL for a payload: the deep link (`?play=jump`, so a launcher or an old build still
// lands in a jump) with the course, and the run in the fragment.
export function challengeUrl(base, course, payload) {
  return `${base}?play=jump&course=${encodeURIComponent(course)}#vs=${payload}`;
}

// How a finished run stands against the challenger's (scores to one decimal, as the panel gives them).
export function compare(mine, theirs, initials = '') {
  const who = initials || 'Your challenger';
  const d = Math.round((mine - theirs) * 10) / 10;
  if (d > 0) return { won: true, tie: false, diff: d, text: `You beat ${initials || 'your challenger'} by ${d.toFixed(1)}` };
  if (d === 0) return { won: false, tie: true, diff: 0, text: `Dead level with ${initials || 'your challenger'}` };
  return { won: false, tie: false, diff: -d, text: `${who} still leads by ${(-d).toFixed(1)}` };
}

// --- replaying a log in slices --------------------------------------------------------------------
// The challenger's run, re-flown here from its log: frames for the ghost, and the score it really
// scores on this build (a payload's claimed score is only believed when the replay agrees). The same
// ticks as simulate() (each log entry's values were quantised once already, so stepRun's quantise
// gives them back exactly; tests/unit/challenge.test.js checks it against simulate), but stepped a
// slice at a time so a phone's title never stalls for the ≈0.7 s a whole flight costs there.
export function createReplay(log, course) {
  const run = createRun(course), inp = newInput();
  let li = 0;
  const step = (ticks = Infinity) => {
    for (let n = 0; n < ticks && run.phase !== 'done'; n++) {
      while (li < log.length && log[li][0] <= run.tick) {
        const e = log[li++];
        for (let c = 0; c < CHANNELS; c++) inp[INPUT_KEYS[c]] = (e[c + 1] || 0) / 100;
      }
      stepRun(run, inp);
    }
    return run.phase === 'done';
  };
  return { run, step, card: () => (run.phase === 'done' ? scoreRun(run.t) : null) };
}
// Step a replay to the end in ≤ budgetMs slices, yielding between them.
export async function replayAsync(log, course, { budgetMs = 6, now = () => performance.now(), yieldFn = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
  const rp = createReplay(log, course);
  for (;;) {
    const t0 = now();
    while (!rp.step(16)) if (now() - t0 >= budgetMs) break;
    if (rp.run.phase === 'done') return rp;
    await yieldFn();
  }
}

// --- a shorter link, when a run's log is long --------------------------------------------------------
// A pad's stick or a jittery thumb can log a change on most ticks; such a run may not fit the target
// length losslessly. coarsen() rounds every channel to a step (5, 10, 25 hundredths: each divides 100,
// so on/off channels keep their 0 and ±100) and drops the entries that then change nothing. A coarsened
// log is a different run: the sender re-flies it and sends it only if it lands the same verdict within
// a point, with the score it really scores (src/comeback.js prepare()).
export function coarsen(log, step) {
  const out = [];
  let prev = null;
  for (const e of log) {
    const q = [e[0]];
    for (let c = 1; c < e.length; c++) q.push(Math.round(e[c] / step) * step || 0);   // (never -0)
    if (prev && q.length === prev.length && q.every((v, i) => i === 0 || v === prev[i])) continue;
    out.push(q); prev = q;
  }
  return out;
}
export const COARSE_STEPS = [5, 10, 25];
