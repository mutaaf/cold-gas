// The daily jump (pure, no DOM, no network): one objective a day on the existing events, the same for
// everyone, picked from the UTC date; judged from the run's scorecard (src/sim/judge.js scoreRun: its
// facts, total and tier), never from anything the sim doesn't already measure; and a streak of
// consecutive UTC days completed, kept on this device only (localStorage `coldgas_daily`).
//
// The bars are set on the players who fly each course the way they fly it (0135: scripts/daily-reach.mjs prints the
// table, tests/unit/daily-reach.test.js holds a 30 % floor): the Show and the Wall on one thumb (a phone, Assist, careful),
// the Lineup on two thumbs (classic touch, Assist), Pro on the keys. Measured n 150, seed 12345:
//   mark-show    within 3.5 m of the mark   44 %  (3 m was 11 %: the careful thumb's touchdowns sit at 3.0–3.7 m)
//   gas-show     more than 25 % gas left    51 %  (see below)
//   soft-wall    0.8 m/s or softer          57 %  · stick-wall 84+ 100 % · ninety-show 90+ 69 %
//   pro-wall     85+ on Pro or Advanced     43 %  on the Wall; it was on the Show, where 9 % of Pro flights score
//                85+ and only 33 % clear the row and land clean at all (the row is Pro's hardest part), so no bar there
//                is both a stretch and in reach
//   skim-show    roofs by under 1.5 m       78 %  · scratch-show 100 %
//   roll-lineup  a clean 360°               37 %
//   mark-lineup  within 7 m (the pad)       31 %  (1.5 m was 10 %: 40 % of Lineup flights land at all)
// The gas bar (0134, then 0135): on one thumb the computer flies the push-off and the carry; what a thumb chooses is when
// to hold the pad. Kept down from the tap through the let-go it lands with 33–37 %; picked up after the fall has begun,
// at any height, 23–27 %. 0134 set the bar in that gap (> 30 %), which only 19–23 % of careful thumbs met. > 25 % is met
// by every thumb held from the tap and by about a third of those that let go: in the model the let-go thumbs all come
// back on the descent warning and land in two clusters, 24 % (64 of 109) and 26 % (40), split by nothing they choose, so
// for them the day is partly luck. Holding from the tap is the sure way. A 1–2 % change in the flight's gas swings this
// day's reach a lot: tests/unit/daily-reach.test.js will catch the downside.
// The Lineup sits on the floor: at other seeds (n 80) mark-lineup measures 26–31 % and roll-lineup 29–44 %; the next
// bar review should start there. The Pro day is measured on the keys; classic-touch Pro (a phone on Pro) is not modelled.
// What a miss can change (0139): the gas day's miss names the choice that meets it, in the device's words. Measured on the
// careful one-thumb population (human-phone.mjs 150 --scheme=thumb --skill=careful --daily, seed as committed):
//   held from the tap · slid 27/29 met · no slide 10/10    lifted, pressed again · no slide 31/31 (all at 26 %) · slid 5/80
// so the hold is the sure way, and a slide after a lift is what costs the day.
import { one } from './units.js';
import { coachWords } from './pointer.js';

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
  { id: 'mark-show', course: 'show', goal: () => `Land within ${len(3.5, 1)} of the mark`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.padMiss <= 3.5 ? done() : miss(`${len(f.padMiss, 1)} off the mark`)) },
  { id: 'gas-show', course: 'show', goal: () => 'Clear the row with more than 25 % gas left',
    check: (c, f) => (!cleanOver(f) ? miss('clear the row and land clean first') : f.airPct > 25 ? done() : miss(`${f.airPct} % gas left, need 26 %`, true)),
    hint: (ctx) => (thumbOn(ctx) ? 'hold the pad from the tap to the ground; letting go and then sliding costs gas'
      : `shorter ${coachWords(ctx).boost} bursts and one late ${ctx.tier === 'assist' ? coachWords(ctx).land : coachWords(ctx).lift}`),
    titleHint: (ctx) => (thumbOn(ctx) ? 'Hold the pad from the tap to the ground' : '') },
  { id: 'soft-wall', course: 'wall', goal: () => `Touch down at ${rate(0.8)} or softer`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.sink <= 0.8 ? done() : miss(`touched down at ${rate(f.sink)}`)) },
  { id: 'pro-wall', course: 'wall', tier: 'pro', goal: () => 'Score 85+ on Pro or Advanced',
    check: (c) => (c.tier === 'assist' ? miss('fly it on Pro or Advanced') : c.total >= 85 ? done() : miss(`${r1(c.total)}, need 85`)) },
  { id: 'skim-show', course: 'show', goal: () => `Clear the roofs by under ${len(1.5, 1)} and land clean`,
    check: (c, f) => (!cleanOver(f) ? miss('clear the row and land clean first') : f.clearance < 1.5 ? done() : miss(`cleared by ${len(f.clearance, 1)}`)) },
  { id: 'roll-lineup', course: 'lineup', goal: () => 'Roll a clean 360° over the row',
    check: (c, f) => (landed(f) && f.rotations >= 1 ? done() : !landed(f) ? miss('no clean landing yet') : miss(`rolled ${f.rollDeg}°, need 360°`)) },
  { id: 'stick-wall', course: 'wall', goal: () => 'Stick it: score 84+',
    check: (c, f) => (c.total >= 84 && landed(f) ? done() : miss(`${r1(c.total)}, need 84`)) },
  { id: 'ninety-show', course: 'show', goal: () => 'Score 90 or more',
    check: (c) => (c.total >= 90 ? done() : miss(`${r1(c.total)}, need 90`)) },
  { id: 'mark-lineup', course: 'lineup', goal: () => `Land within ${len(7)} of the mark`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.padMiss <= 7 ? done() : miss(`${len(f.padMiss, 1)} off the mark`)) },
  { id: 'scratch-show', course: 'show', goal: () => 'Clear the row without a scratch',
    check: (c, f) => (cleanOver(f) && (f.damagePct ?? 0) === 0 ? done() : !cleanOver(f) ? miss('clear the row and land clean first') : miss(`${f.damagePct} % damage`)) },
];
function done() { return { ok: true, miss: '' }; }
// `fix`: the miss is the objective's own number, so its hint (what to change) applies; not a "land clean first".
function miss(why, fix = false) { return fix ? { ok: false, miss: why, fix } : { ok: false, miss: why }; }
const thumbOn = (ctx) => ctx?.device === 'touch' && ctx.scheme === 'thumb';

// The results' line for a missed Daily (0139): the reason with its number, then what to change in this device's words
// (ctx as src/pointer.js: { device, scheme, tier, course }) when the objective has one, else "try again".
export function missLine(obj, r, ctx) {
  const hint = r?.fix && obj?.hint ? obj.hint(ctx || {}) : '';
  return hint ? `Daily: ${r.miss} · ${hint}` : `Daily: ${r.miss} — try again`;
}
// The title card's one-line hint for today's objective on this device ('' when there is none).
export const titleHint = (obj, ctx) => (obj?.titleHint ? obj.titleHint(ctx || {}) : '');

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
