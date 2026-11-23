// The judges' words, checked against the card (0282). A model writes the remarks; `scoreRun` made the numbers. Any
// number a remark states, in digits ("3.7", "48%", "4 ms") or spelled out up to ninety-nine ("thirty-six"), must be
// one the player can be told. A number with a unit after it ("thirty-six seconds", "26.8 meters", "48%") is held to the
// facts of that quantity only (the hang's seconds, the heights and distances and their feet, …): pooling every value
// would let a 2.7 s hang said as "twenty-seven seconds" pass on a 26.9 m climb. A bare number may be any value on the
// card (facts, judges, categories, total), its src/units.js conversion, or a number in the facts the model was given
// (src/worker/ai/prompt.js userPrompt: "28 m", "five parked EVs"). A remark that states anything else is unfaithful, and
// the sheet shows the same judge's own line from `localWords` instead; the model's text stays under Inspect the call
// (invariant 5½). Pure: no DOM.
import { M_TO_FT, KG_TO_LB, MPS_TO_MPH, MPS_TO_KMH } from './units.js';

export const WORD_KEYS = ['headline', 'engineer', 'coordinator', 'designer'];

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const WORD = new Map([...ONES.map((w, i) => [w, i]), ...TENS.map((w, i) => [w, i * 10]).filter(([w]) => w), ['hundred', 100]]);
const TEN_RE = TENS.filter(Boolean).join('|'), ONE_RE = ONES.slice(1, 10).join('|');
// Digits (a thousands comma and a decimal point allowed), or a spelled number: "thirty-six", "thirty six", "forty", "five".
const NUM_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)|\\b(?:(${TEN_RE})(?:[-\\s](${ONE_RE}))?|(${[...ONES, 'hundred'].join('|')}))\\b`, 'gi');
// The unit right after a number, as the quantity it names (longest first: "m/s" before "m", "ms" before "m").
const UNITS = [
  [/^\s*(?:km\/h|kph|mph|m\/s|ft\/s|feet per second|metres? per second|meters? per second|miles per hour)/i, 'speed'],
  [/^\s*-?\s*(?:ms|milliseconds?)\b/i, 'ms'],
  [/^\s*-?\s*(?:s|secs?|seconds?)\b/i, 'time'],
  [/^\s*-?\s*(?:m|metres?|meters?|ft|feet|foot)\b/i, 'len'],
  [/^\s*(?:%|-?\s*per\s*cents?\b|-?\s*percent\b)/i, 'pct'],
  [/^\s*(?:°|-?\s*degrees?\b|-?\s*deg\b)/i, 'angle'],
  [/^\s*-?\s*g\b/i, 'g'],
];
const unitAt = (rest) => { for (const [re, q] of UNITS) if (re.test(rest)) return q; return null; };

// Every number stated in a piece of text: { n, q (the quantity its unit names, or null), at (its index) }.
export function statedNumbers(text) {
  const s = String(text || ''), out = [];
  for (const m of s.matchAll(NUM_RE)) {
    let n;
    if (m[1]) n = Number(m[1].replace(/,(?=\d{3}\b)/g, '').replace(/,$/, ''));
    else if (m[2]) n = WORD.get(m[2].toLowerCase()) + (m[3] ? WORD.get(m[3].toLowerCase()) : 0);
    else n = WORD.get(m[4].toLowerCase());
    if (Number.isFinite(n)) out.push({ n, q: unitAt(s.slice(m.index + m[0].length, m.index + m[0].length + 24)), at: m.index });
  }
  return out;
}
export const numbersIn = (text) => statedNumbers(text).map((x) => x.n);

// Which quantity each fact is, so a number with a unit is held to its own quantity, and converted only as src/units.js
// would convert it (never every factor on every value: a judge's 9.7 × 3.6 would excuse "thirty-six").
const LEN = ['height', 'launchHeight', 'apex', 'apexOverRoof', 'brakeH', 'padMiss', 'clearance'];
const KMH = ['launchKmh', 'entryKmh', 'splashKmh'];
const MPS = ['sink'];
const TIME = ['invertedS', 'mudS', 'zeroToSixty', 'tAir', 'airS'];
const MS = ['wheelSpreadMs'];
const PCT = ['airPct', 'progressPct', 'damagePct', 'integrity'];
const ANGLE = ['rollDeg', 'pitchDeg', 'tiltDeg', 'headingDeg'];
const G = ['maxG', 'brakeG'];
const KG = ['massKg', 'gasKg'];
// Always fine to say: none, one, two, ten (Perfect 10), a hundred (per cent, out of 100), a roll's degrees.
const ALWAYS = [0, 1, 2, 10, 100, 180, 360, 720];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
// The values a remark may state for this card, by quantity (`any` for a bare number), and the facts the model read.
export function allowedNumbers(card, brief = '') {
  const pools = { any: new Set(ALWAYS), time: new Set(), ms: new Set(), len: new Set(), speed: new Set(), pct: new Set([100]), angle: new Set([90, 180, 360, 720]), g: new Set() };
  const add = (q, v) => { if (num(v)) { pools[q].add(Math.abs(v)); pools.any.add(Math.abs(v)); } };
  const f = card?.facts || {};
  const walk = (o) => { for (const v of Object.values(o || {})) { if (v && typeof v === 'object') walk(v); else add('any', v); } };
  walk(f);
  for (const k of LEN) if (num(f[k])) { add('len', f[k]); add('len', f[k] * M_TO_FT); }
  for (const k of MPS) if (num(f[k])) { add('speed', f[k]); add('speed', f[k] * M_TO_FT); add('speed', f[k] * MPS_TO_MPH); add('speed', f[k] * MPS_TO_KMH); }
  for (const k of KMH) if (num(f[k])) { add('speed', f[k]); add('speed', f[k] / MPS_TO_KMH * MPS_TO_MPH); add('speed', f[k] / MPS_TO_KMH); }
  for (const k of TIME) add('time', f[k]);
  for (const k of MS) add('ms', f[k]);
  for (const k of PCT) add('pct', f[k]);
  for (const v of Object.values(f.damageZones || {})) add('pct', v);
  for (const k of ANGLE) add('angle', f[k]);
  for (const k of G) add('g', f[k]);
  for (const k of KG) if (num(f[k])) add('any', f[k] * KG_TO_LB);
  add('any', card?.total);
  for (const j of card?.judges || []) add('any', j.score);
  walk(card?.categories);
  if (card?.multiplier) add('any', card.multiplier);
  // The facts as the model read them: "28 m" is a length, "3.7 s" a time, "five parked EVs" a bare five.
  for (const { n, q } of statedNumbers(brief)) add(q || 'any', n);
  return Object.fromEntries(Object.entries(pools).map(([k, v]) => [k, [...v]]));
}

// A stated number is the card's when it is within ±10 % or ±0.5 (whichever is larger) of an allowed value of its quantity.
const near = (n, v) => Math.abs(Math.abs(n) - v) <= Math.max(0.1 * v, 0.5);
const ok = (x, allowed) => (allowed[x.q] || allowed.any).some((v) => near(x.n, v));
// The first number in `text` the card doesn't back, or null.
const firstBad = (text, allowed) => statedNumbers(text).find((x) => !ok(x, allowed)) || null;
export const faithful = (text, allowed) => !firstBad(text, allowed);

// Which of the four remarks state a number the run didn't make.
export function checkWords(words, card, brief = '') {
  const allowed = allowedNumbers(card, brief);
  return WORD_KEYS.filter((k) => words?.[k] && !faithful(words[k], allowed));
}

// The words to show: each unfaithful remark swapped for the same judge's own line. `replaced` names the swapped keys.
export function faithfulWords(words, card, local, brief = '') {
  if (!words) return { words, replaced: [] };
  const replaced = checkWords(words, card, brief);
  if (!replaced.length) return { words, replaced };
  const own = local(card), out = { ...words };
  for (const k of replaced) out[k] = own[k];
  return { words: out, replaced };
}

// The words as they stream (the docked strip types them onto the sheet). Until the call is `done`, the last word is
// still growing ("thirty" may become "thirty-six", "3." become "3.7"), so it is never shown: each remark shows only
// what is already closed. A remark that has stated a wrong number stops just before it, and stays there until the
// final words land (the judge's own line).
let liveMemo = { card: null, brief: null, allowed: null };
export function liveFaithful(words, card, brief = '', done = false) {
  if (!words) return words;
  if (liveMemo.card !== card || liveMemo.brief !== brief) liveMemo = { card, brief, allowed: allowedNumbers(card, brief) };
  const out = { ...words };
  for (const k of WORD_KEYS) {
    if (!out[k]) continue;
    const closed = done ? out[k] : out[k].replace(/\S*$/, '');
    const bad = firstBad(closed, liveMemo.allowed);
    out[k] = (bad ? closed.slice(0, bad.at) : closed).trimEnd();
  }
  return out;
}

// The receipt's line when a remark was swapped.
export const replacedLine = (n) => (n === 1
  ? '1 remark replaced with the game’s own line: it stated a number the run didn’t make'
  : `${n} remarks replaced with the game’s own lines: they stated numbers the run didn’t make`);
