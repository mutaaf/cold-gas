// The judges' words, checked against the card (0282). A model writes the remarks; `scoreRun` made the numbers. Any
// number a remark states, in digits ("3.7", "48%", "4 ms") or spelled out up to ninety-nine ("thirty-six"), must be
// one the player can be told: a value on the card (facts, judges, categories, total), that value as src/units.js shows
// it in the other system, or a number in the brief the model was given (src/worker/ai/prompt.js: "28 m", "five parked
// EVs"). A remark that states anything else is unfaithful, and the sheet shows the same judge's own line from
// `localWords` instead; the model's text stays under Inspect the call (invariant 5½). Pure: no DOM.
import { M_TO_FT, KG_TO_LB, MPS_TO_MPH, MPS_TO_KMH } from './units.js';

export const WORD_KEYS = ['headline', 'engineer', 'coordinator', 'designer'];

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const WORD = new Map([...ONES.map((w, i) => [w, i]), ...TENS.map((w, i) => [w, i * 10]).filter(([w]) => w), ['hundred', 100]]);
const TEN_RE = TENS.filter(Boolean).join('|'), ONE_RE = ONES.slice(1, 10).join('|');
// Digits (a thousands comma and a decimal point allowed), or a spelled number: "thirty-six", "thirty six", "forty", "five".
const NUM_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)|\\b(?:(${TEN_RE})(?:[-\\s](${ONE_RE}))?|(${[...ONES, 'hundred'].join('|')}))\\b`, 'gi');

// Every number stated in a piece of text, as numbers.
export function numbersIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(NUM_RE)) {
    if (m[1]) { const n = Number(m[1].replace(/,(?=\d{3}\b)/g, '').replace(/,$/, '')); if (Number.isFinite(n)) out.push(n); }
    else if (m[2]) out.push(WORD.get(m[2].toLowerCase()) + (m[3] ? WORD.get(m[3].toLowerCase()) : 0));
    else if (m[4]) out.push(WORD.get(m[4].toLowerCase()));
  }
  return out;
}

// Which unit each fact is in, so it is accepted only as src/units.js would convert it (never every factor on every value:
// a judge's 9.7 × 3.6 would excuse "thirty-six").
const LEN = ['height', 'launchHeight', 'apex', 'apexOverRoof', 'brakeH', 'padMiss', 'clearance'];
const KMH = ['launchKmh', 'entryKmh', 'splashKmh'];
const MPS = ['sink'];
const KG = ['massKg', 'gasKg'];
// Always fine to say: a roll's degrees, none, one, two, ten (Perfect 10), a hundred (per cent, out of 100).
const ALWAYS = [0, 1, 2, 10, 100, 180, 360, 720];

// The values a remark may state for this card (and the brief the model read, when the call carried it).
export function allowedNumbers(card, brief = '') {
  const vals = new Set(ALWAYS);
  const add = (v) => { if (typeof v === 'number' && Number.isFinite(v)) vals.add(Math.abs(v)); };
  const f = card?.facts || {};
  const walk = (o) => { for (const v of Object.values(o || {})) { if (v && typeof v === 'object') walk(v); else add(v); } };
  walk(f);
  for (const k of LEN) if (typeof f[k] === 'number') add(f[k] * M_TO_FT);
  for (const k of MPS) if (typeof f[k] === 'number') { add(f[k] * M_TO_FT); add(f[k] * MPS_TO_MPH); add(f[k] * MPS_TO_KMH); }
  for (const k of KMH) if (typeof f[k] === 'number') { add(f[k] / MPS_TO_KMH * MPS_TO_MPH); add(f[k] / MPS_TO_KMH); }
  for (const k of KG) if (typeof f[k] === 'number') add(f[k] * KG_TO_LB);
  add(card?.total);
  for (const j of card?.judges || []) add(j.score);
  walk(card?.categories);
  if (card?.multiplier) add(card.multiplier);
  for (const n of numbersIn(brief)) add(n);
  return [...vals];
}

// A stated number is the card's when it is within ±10 % or ±0.5 (whichever is larger) of an allowed value.
const near = (n, v) => Math.abs(Math.abs(n) - v) <= Math.max(0.1 * v, 0.5);
export const faithful = (text, allowed) => numbersIn(text).every((n) => allowed.some((v) => near(n, v)));

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

// The words as they stream (the docked strip types them onto the sheet): only numbers already closed are checked (the
// last, still-growing word is left out), and a remark that has stated a wrong one is held where it was, not shown.
export function liveFaithful(words, card, brief = '') {
  if (!words) return words;
  const allowed = allowedNumbers(card, brief), out = { ...words };
  for (const k of WORD_KEYS) if (out[k] && !faithful(out[k].replace(/\S*$/, ''), allowed)) out[k] = '';
  return out;
}

// The receipt's line when a remark was swapped.
export const replacedLine = (n) => (n === 1
  ? '1 remark replaced with the game’s own line: it stated a number the run didn’t make'
  : `${n} remarks replaced with the game’s own lines: they stated numbers the run didn’t make`);
