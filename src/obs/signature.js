// Error signatures: the same fault gets the same id on every device, so a thousand players hitting
// one bug is one row with n = 1000, not a thousand rows. Pure (no DOM), shared by the client, the
// Worker's validation and the unit tests.
//
//   sig = hash(message | top frame with line:col | build)   one fault in one build
//   key = hash(message | top frame without line:col)         the same fault across builds
//
// The message is normalised first (numbers, hex ids, quoted values, URLs and anything that looks
// like a key are replaced), and the frame keeps only the function and the file's own name (the
// bundler's content hash and any query string are dropped). Nothing personal survives: no host, no
// path, no user data.

// FNV-1a over UTF-16 code units, twice with different offsets → 12 hex digits (48 bits).
function fnv(s, h) {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function hash12(s) {
  const a = fnv(s, 0x811c9dc5), b = fnv(s, 0x050c5d1f);
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12);
}

// Anything that could be a secret: provider key shapes and long opaque tokens.
const SECRET_RE = /\b(?:sk|pk|xai|gsk|AIza|key|ant)[-_A-Za-z0-9]{12,}|\b[A-Za-z0-9+/=_-]{32,}\b/g;
export const redact = (s) => String(s).replace(SECRET_RE, '[redacted]');

// One line, ≤ 160 chars, variable parts folded so that occurrences group.
export function normMessage(msg) {
  return redact(String(msg ?? '').split('\n')[0])
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'")]+/gi, '<url>')
    .replace(/(["'`])(?:(?!\1).){41,}\1/g, '$1…$1')          // long quoted values (short ones name the property)
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/-?\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b/gi, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// A file's own name: no scheme, host, path, query or bundler hash (`index-B4x_9kQa.js` → `index.js`).
export function normFile(f) {
  let s = String(f || '').replace(/[?#].*$/, '');
  s = s.slice(s.lastIndexOf('/') + 1) || s;
  s = s.replace(/-[A-Za-z0-9_]{8}(\.(?:m?js|wasm))$/, '$1');
  return s.replace(/[^\w.-]/g, '').slice(0, 48) || '?';
}

// Chrome/V8:   "    at fn (https://x/coldgas/assets/index-AB12cd34.js:12:345)" / "    at https://x/a.js:1:2"
// Firefox/Safari: "fn@https://x/coldgas/assets/index-AB12cd34.js:12:345"
// WASM:        "    at wasm://wasm/0012abcd:wasm-function[421]:0x1f2e"
const V8 = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;
const WASM = /wasm-function\[(\d+)\]/;
export function parseFrames(stack, max = 6) {
  const out = [];
  if (!stack) return out;
  for (const line of String(stack).split('\n')) {
    if (out.length >= max) break;
    const w = WASM.exec(line);
    if (w) { out.push({ fn: `wasm-function[${w[1]}]`, file: 'rapier.wasm', line: 0, col: 0 }); continue; }
    const m = V8.exec(line) || GECKO.exec(line);
    if (!m) continue;
    const fn = (m[1] || '').replace(/^async /, '').replace(/^Object\./, '').replace(/[^\w$.<>[\]-]/g, '').slice(0, 40) || '<anon>';
    out.push({ fn, file: normFile(m[2]), line: +m[3] || 0, col: +m[4] || 0 });
  }
  return out;
}
const fmt = (f, lc) => (f ? `${f.fn}@${f.file}${lc ? `:${f.line}:${f.col}` : ''}` : '');

// → { sig, key, msg, fr, st } for an error-like value. `build` is the client's build id.
export function signature(err, build = 'dev', kind = 'error') {
  const raw = err && typeof err === 'object' ? (err.message ?? String(err)) : String(err);
  const name = err && typeof err === 'object' && err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  const msg = normMessage(name + raw) || kind;
  const frames = parseFrames(err && err.stack);
  const top = frames[0];
  const fr = fmt(top, true).slice(0, 120);
  return {
    sig: hash12(`${msg}|${fr}|${build}`),
    key: hash12(`${msg}|${fmt(top, false)}`),
    msg,
    fr,
    st: frames.map((f) => fmt(f, true)).join(' < ').slice(0, 400),
  };
}

// Which subsystem a stack belongs to, from its files (the lazy chunks keep their names).
const MODULES = [
  [/rapier|wasm-function|engine(-web)?\.js|\.wasm/, 'physics'],
  [/rocket/, 'rocket'],
  [/theatre|aurora|stream\.js/, 'judge'],
  [/terrain\.worker|endless-world|tilegen|roadchunk/, 'world'],
  [/audio/, 'audio'],
  [/nerds/, 'nerds'],
  [/SMAAPass|film|EffectComposer|three\.module|WebGLRenderer/, 'render'],
];
export function moduleOf(stack) {
  const s = String(stack || '').split('\n').slice(0, 4).join('\n');
  for (const [re, m] of MODULES) if (re.test(s)) return m;
  return 'app';
}

export const MODULE_IDS = ['app', 'render', 'webgl', 'shader', 'physics', 'audio', 'judge', 'world', 'rocket', 'net', 'lazy', 'nerds', 'drive', 'frame', 'page'];
// What players do, as counts (obs.play; src/worker/obs.js stores them as `play:<name>` per day). The
// funnel: a visit (new, or back on a later UTC day) → a run → landed or wrecked → posted / shared.
// howto-skip: Skip on the how-to card before a Jump. run-quit: a Jump run left before its card (Pause → Home or
// Restart, a drill or Free Drive opened mid-run, the page closed with it live); once per run (0130).
// 0138: a Jump run's decided card also counts how it was flown (ctl-*: the one-thumb pad, the classic touch stick
// and buttons, a keyboard or a gamepad; fly-*: the flight tier) and, for a wreck, what wrecked it (wreck-*: the
// coach's first finding, folded by wreckCause). Counts only, once per run.
// 0136: the Daily, tapped → finished → met: daily-start (a tap on Play today's or Play again), then daily-done or daily-miss
// on every finished run on the Daily's course, however it was started (a plain Jump or a Retry there counts toward the
// Daily too, as the streak does), so read done / (done + miss) as the met rate, and start as the taps. daily-run is the old name for a miss, still counted beside daily-miss for one release (src/comeback.js).
export const CTL_EVENTS = ['ctl-thumb', 'ctl-classic', 'ctl-keys', 'ctl-pad'];
export const FLY_EVENTS = ['fly-assist', 'fly-pro', 'fly-advanced'];
export const WRECK_EVENTS = ['wreck-short', 'wreck-brake', 'wreck-ran-out', 'wreck-roll', 'wreck-flipped', 'wreck-fell-off', 'wreck-release', 'wreck-other'];
export const PLAY_EVENTS = ['visit-new', 'visit-return', 'howto', 'howto-skip', 'run', 'run-quit', 'run-landed', 'run-wrecked', 'retry',
  'post', 'post-fail', 'share', 'board-open', 'challenge-open', 'challenge-run', 'daily-start', 'daily-miss', 'daily-run', 'daily-done', 'drive', 'sandbox',
  ...CTL_EVENTS, ...FLY_EVENTS, ...WRECK_EVENTS];
// The coach's finding ids (src/sim/coach.js) → the wreck's cause. Into the row; a hard touchdown (never braked,
// braked or landed late); braked but ran out at the bottom; the roll-out or the attitude; on its roof; off the
// curl's side; the release. Anything else (the mark, the gas, clean, no coach) is `other`.
const WRECK_OF = {
  short: 'short', 'no-brake': 'brake', 'late-brake': 'brake', 'late-land': 'brake', 'ran-out': 'ran-out',
  'late-roll': 'roll', 'no-roll': 'roll', 'over-roll': 'roll', tilt: 'roll', flipped: 'flipped', 'fell-off': 'fell-off',
  'no-release': 'release', 'early-release': 'release', 'stopped-climb': 'release',
};
export const wreckCause = (items) => `wreck-${WRECK_OF[items?.[0]?.id] || 'other'}`;
// How a run was flown: the device in use (src/input.js lastDevice) and, on touch, the scheme on screen.
export function ctlOf(device, scheme) {
  if (device === 'touch') return scheme === 'thumb' ? 'ctl-thumb' : 'ctl-classic';
  return device === 'pad' ? 'ctl-pad' : 'ctl-keys';
}
export const flyOf = (tier) => (FLY_EVENTS.includes(`fly-${tier}`) ? `fly-${tier}` : 'fly-assist');
export const KIND_IDS = ['error', 'rejection', 'trap', 'ctxlost', 'shader', 'fetch', 'lazy', 'audio', 'worker', 'frame', 'unclean'];
