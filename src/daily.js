// The daily jump (pure, no DOM, no network): one objective a day on the existing events, the same for
// everyone, picked from the UTC date; judged from the run's scorecard (src/sim/judge.js scoreRun: its
// facts, total and tier), never from anything the sim doesn't already measure; and a streak of
// consecutive UTC days completed, kept on this device only (localStorage `coldgas_daily`).
//
// The thresholds were set against scripts/human-show.mjs's populations (Assist and Pro, cues new) and
// the reference flights, so most days are a stretch for a player who lands, none a lottery:
//   within 3 m of the Show's mark  ≈ 10 % of clean Assist landings · gas > 40 %  ≈ 18 %
//   roofs by under 1.5 m           ≈ 23 %                          · 90+ on the Show ≈ 30 %
import { one } from './units.js';

export const DAY_MS = 86_400_000;
const COURSE = { show: 'The Show', wall: 'The Wall', lineup: 'The Lineup' };
const len = (m, d = 0) => one('len', m, d);
const rate = (mps) => one('rate', mps, 1);
const landed = (f) => !!f.jumped && !f.crashed;
const cleanOver = (f) => landed(f) && !!f.crossedRow && !f.contact;
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

// Each objective: the course it's flown on, the line the title shows, and `check(card)` → { ok, miss }
// (`miss` is the results line's reason when it isn't done: specific, with the number).
export const OBJECTIVES = [
  { id: 'mark-show', course: 'show', goal: () => `Land within ${len(3)} of the mark`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.padMiss <= 3 ? done() : miss(`${len(f.padMiss, 1)} off the mark`)) },
  { id: 'gas-show', course: 'show', goal: () => 'Clear the row with more than 40 % gas left',
    check: (c, f) => (!cleanOver(f) ? miss('clear the row and land clean first') : f.airPct > 40 ? done() : miss(`${f.airPct} % gas left, need 41 %`)) },
  { id: 'soft-wall', course: 'wall', goal: () => `Touch down at ${rate(0.8)} or softer`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.sink <= 0.8 ? done() : miss(`touched down at ${rate(f.sink)}`)) },
  { id: 'pro-show', course: 'show', tier: 'pro', goal: () => 'Score 85+ on Pro or Advanced',
    check: (c) => (c.tier === 'assist' ? miss('fly it on Pro or Advanced') : c.total >= 85 ? done() : miss(`${r1(c.total)}, need 85`)) },
  { id: 'skim-show', course: 'show', goal: () => `Clear the roofs by under ${len(1.5, 1)} and land clean`,
    check: (c, f) => (!cleanOver(f) ? miss('clear the row and land clean first') : f.clearance < 1.5 ? done() : miss(`cleared by ${len(f.clearance, 1)}`)) },
  { id: 'roll-lineup', course: 'lineup', goal: () => 'Roll a clean 360° over the row',
    check: (c, f) => (landed(f) && f.rotations >= 1 ? done() : !landed(f) ? miss('no clean landing yet') : miss(`rolled ${f.rollDeg}°, need 360°`)) },
  { id: 'stick-wall', course: 'wall', goal: () => 'Stick it: score 84+',
    check: (c, f) => (c.total >= 84 && landed(f) ? done() : miss(`${r1(c.total)}, need 84`)) },
  { id: 'ninety-show', course: 'show', goal: () => 'Score 90 or more',
    check: (c) => (c.total >= 90 ? done() : miss(`${r1(c.total)}, need 90`)) },
  { id: 'mark-lineup', course: 'lineup', goal: () => `Land within ${len(1.5, 1)} of the mark`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.padMiss <= 1.5 ? done() : miss(`${len(f.padMiss, 1)} off the mark`)) },
  { id: 'scratch-show', course: 'show', goal: () => 'Clear the row without a scratch',
    check: (c, f) => (cleanOver(f) && (f.damagePct ?? 0) === 0 ? done() : !cleanOver(f) ? miss('clear the row and land clean first') : miss(`${f.damagePct} % damage`)) },
];
function done() { return { ok: true, miss: '' }; }
function miss(why) { return { ok: false, miss: why }; }

export const courseName = (id) => COURSE[id] || id;

// --- dates (UTC) ------------------------------------------------------------------------------------
export const dayNumber = (ms) => Math.floor(ms / DAY_MS);
export const dayKey = (ms) => new Date(dayNumber(ms) * DAY_MS).toISOString().slice(0, 10);
export const keyToDay = (key) => (/^\d{4}-\d{2}-\d{2}$/.test(key || '') ? dayNumber(Date.parse(`${key}T00:00:00Z`)) : NaN);

// A 32-bit integer mix (deterministic in every engine: integer ops only).
function mix(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
// The objective for a UTC day: a seeded walk from EPOCH that never gives the same objective two days
// running (each day steps to one of the other N − 1). Days before EPOCH take the plain hash.
export const EPOCH = 20454;   // 2026-01-01
let memo = { day: EPOCH, i: mix(EPOCH) % OBJECTIVES.length };
export function objectiveIndex(day) {
  const N = OBJECTIVES.length;
  if (!Number.isFinite(day)) return 0;
  if (day <= EPOCH) return mix(day) % N;
  let { day: d, i } = day >= memo.day ? memo : { day: EPOCH, i: mix(EPOCH) % N };
  while (d < day) { d++; i = (i + 1 + (mix(d) % (N - 1))) % N; }
  if (day >= memo.day) memo = { day, i };
  return i;
}
export const objectiveFor = (ms) => OBJECTIVES[objectiveIndex(dayNumber(ms))];

// Judge a run against an objective. Only a run on the objective's course counts; `card` is scoreRun's.
export function evaluate(obj, card, course) {
  if (!obj || !card || course !== obj.course) return null;
  return obj.check(card, card.facts || {});
}

// --- the streak ---------------------------------------------------------------------------------------
// Stored: { last: 'YYYY-MM-DD' (the last UTC day completed), streak, best }. The streak shown is alive
// while the last completed day is today or yesterday (UTC), else it has lapsed to 0.
export function readStreak(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || !Number.isFinite(keyToDay(o.last))) return { last: '', streak: 0, best: 0 };
    const n = (x) => (Number.isInteger(x) && x >= 0 && x < 100000 ? x : 0);
    return { last: o.last, streak: n(o.streak), best: Math.max(n(o.best), n(o.streak)) };
  } catch { return { last: '', streak: 0, best: 0 }; }
}
export function streakNow(s, ms) {
  const today = dayNumber(ms), last = keyToDay(s.last);
  const doneToday = last === today;
  return { streak: doneToday || last === today - 1 ? s.streak : 0, doneToday, best: s.best };
}
// Today completed: counted once a day; yesterday's streak carries on, a gap starts again at 1.
export function complete(s, ms) {
  const today = dayNumber(ms), last = keyToDay(s.last);
  if (last === today) return s;
  const streak = last === today - 1 ? s.streak + 1 : 1;
  return { last: dayKey(ms), streak, best: Math.max(s.best || 0, streak) };
}

const KEY = 'coldgas_daily';
export function loadStreak(storage = globalThis.localStorage) {
  try { return readStreak(storage?.getItem(KEY)); } catch { return readStreak(null); }
}
export function saveStreak(s, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}
