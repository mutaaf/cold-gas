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
//   soft-wall    0.8 m/s or softer          57 %  · stick-wall 84+ 69 % (100 % before 0182) · ninety-show 90+ 69 %
//   pro-wall     72+ on Pro or Advanced     43 %  on the Wall (85+ before 0182 counted the Wall's mark); it was on the Show, where 9 % of Pro flights score
//                85+ and only 33 % clear the row and land clean at all (the row is Pro's hardest part), so no bar there
//                is both a stretch and in reach
//   skim-show    roofs by under 1.5 m       78 %  · scratch-show 100 %
//   roll-lineup  two turns, clean           51 %  (0198; a clean 360 was 150/150 on one thumb)
//   mark-lineup  two turns within 4 m       35 %  (0198; within 7 m was 150/150; within 1.2 m of any landing, 5 %)
// The gas bar (0134, then 0135): on one thumb the computer flies the push-off and the carry; what a thumb chooses is when
// to hold the pad. Kept down from the tap through the let-go it lands with 33–37 %; picked up after the fall has begun,
// at any height, 23–27 %. 0134 set the bar in that gap (> 30 %), which only 19–23 % of careful thumbs met. > 25 % is met
// by every thumb held from the tap and by about a third of those that let go: in the model the let-go thumbs all come
// back on the descent warning and land in two clusters, 24 % (64 of 109) and 26 % (40), split by nothing they choose, so
// for them the day is partly luck. Holding from the tap is the sure way. A 1–2 % change in the flight's gas swings this
// day's reach a lot: tests/unit/daily-reach.test.js will catch the downside.
// The Lineup sat on the floor on two thumbs (at other seeds, n 80, mark-lineup 26–31 %, roll-lineup 29–44 %). Since 0181
// a phone flies it on one thumb, and the careful one-thumb population meets both (150/150 each, the bars unchanged): the
// computer flies the kickflip, so these two days were a phone's easy days, and Pro (keys) is where the Lineup is hard. The Pro day is measured on the keys; classic-touch Pro (a phone on Pro) is not modelled.
// 0198: the Lineup's days now ask for the one thumb's choice (0191): the second turn, slid up for on the run-up. The careful
// population takes the call half the time (flyThumbLineup P.twice; daily-reach.mjs prints it: 76/150). Called, 76/76 land
// two clean turns; onto the mark, 53 of them are within 4 m (the never-aimed 720 is at 4.3 m, the held-from-Go 360 meets
// neither day). Phone-first: on keys or two thumbs the roll is flown by hand, and no modelled player of theirs lands a 720
// (flyTouch: 0/150 land two turns; with the roll held through a second turn, 0/60; a keys Assist/Pro sweep of run-up speed, LIFT
// hold and roll: 4 of 48 rolled two turns, none landed). So a Lineup day on keys is one to fly on a phone,
// and its miss line says "try again" there rather than name a way that isn't modelled.
// What a miss can change (0139, 0150): the gas, skim, mark and ninety days' misses name the choice that meets it, in the device's words. Measured on the
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
// The Pro Wall's bar (0182, SIM_VERSION 31): the Wall's mark now counts, and Pro on the keys lands a median 9.3 m off it,
// so 85+ fell from 43 % to 15 % of Pro flights (23/150). 72+ is met by the same 43 % (65/150) on the new scale.
const PRO_WALL = 72;
// The Lineup's mark day (0198): two turns within this of the mark (m).
const LINEUP_MARK = 4;
// The Lineup's facts carry no crossedRow: clean there is landed, no contact with the row, and not on its roof.
const cleanLineup = (f) => landed(f) && !f.contact && !f.flipped;

// Each objective: the course it's flown on, the line the title shows, and `check(card)` → { ok, miss }
// (`miss` is the results line's reason when it isn't done: specific, with the number).
export const OBJECTIVES = [
  { id: 'mark-show', course: 'show', goal: () => `Land within ${len(3.5, 1)} of the mark`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.padMiss <= 3.5 ? done() : miss(`${len(f.padMiss, 1)} off the mark`, true)),
    hint: aimHint },
  { id: 'gas-show', course: 'show', goal: () => 'Clear the row with more than 25 % gas left',
    check: (c, f) => (!cleanOver(f) ? miss('clear the row and land clean first') : f.airPct > 25 ? done() : miss(`${f.airPct} % gas left, need 26 %`, true)),
    hint: (ctx) => (thumbOn(ctx) ? 'hold the pad from the tap to the ground; letting go and then sliding costs gas'
      : `shorter ${coachWords(ctx).boost} bursts and one late ${ctx.tier === 'assist' ? coachWords(ctx).land : coachWords(ctx).lift}`),
    // The card's line is short enough to share the streak's row with its pips at 320 px; the countdown's tip says it whole.
    titleHint: (ctx, whole) => (!thumbOn(ctx) ? '' : whole ? 'Hold the pad from the tap to the ground' : 'Hold the pad from the tap') },
  { id: 'soft-wall', course: 'wall', goal: () => `Touch down at ${rate(0.8)} or softer`,
    check: (c, f) => (!landed(f) ? miss('no clean landing yet') : f.sink <= 0.8 ? done() : miss(`touched down at ${rate(f.sink)}`)) },
  { id: 'pro-wall', course: 'wall', tier: 'pro', goal: () => `Score ${PRO_WALL}+ on Pro or Advanced`,
    check: (c) => (c.tier === 'assist' ? miss('fly it on Pro or Advanced') : c.total >= PRO_WALL ? done() : miss(`${r1(c.total)}, need ${PRO_WALL}`)) },
  { id: 'skim-show', course: 'show', goal: () => `Clear the roofs by under ${len(1.5, 1)} and land clean`,
    check: (c, f) => (!cleanOver(f) ? miss('clear the row and land clean first') : f.clearance < 1.5 ? done() : miss(`cleared by ${len(f.clearance, 1)}`, true)),
    // 0150: the opposite thumb to the gas day's. Held from the tap, the computer carries the car 4.5 m over the roofs; let go
    // within 0.6 s of the tap and kept off, 1.3 m (a cliff between 0.6 and 0.7 s: lifted later, 4.5 m again; pressed again
    // 0.25 s later, 3.2–4.5 m). "Right after the tap" is the window. On keys and classic touch (human-show.mjs 150 assist
    // --cues=new --daily, seed as committed): BOOST held to its cue never meets it (0/60); a short burst with LAND from
    // 4 m meets it 11/14, everyone else 12/136.
    hint: (ctx) => (thumbOn(ctx) ? 'let go of the pad right after the tap and stay off it; held, it carries you high'
      : `one short ${coachWords(ctx).boost} burst, not to the cue, and ${ctx.tier === 'assist' ? coachWords(ctx).land : coachWords(ctx).lift} late, once you’re low over the pad`),
    titleHint: (ctx, whole) => (!thumbOn(ctx) ? '' : whole ? 'Let go right after the tap and stay off the pad' : 'Let go right after the tap'),
    // The sheet's NEXT RUN line would teach the hold (the 'mark' and 'clean' lines); on a missed skim it says this instead.
    coach: (ctx) => (thumbOn(ctx) ? 'For the Daily: let go of the pad right after the tap and stay off it' : ''),
    // Its fix contradicts holding the pad, so the sheet's "hold the pad" items say the Daily's line instead (dailyItems).
    swapHold: true },
  // 0198: the Lineup's two days ask for the choice the one thumb has there (0191): the second turn, called on the run-up.
  // Held from Go and never moved, the computer flies a clean 360 1.3 m off the mark, and that met both old bars (a clean
  // 360; within 7 m) 150/150: the streak counted a run nobody flew. Measured below (n 150, seed 12345).
  { id: 'roll-lineup', course: 'lineup', goal: () => 'Roll two turns over the row and land clean',
    check: (c, f) => (!cleanLineup(f) ? miss('no clean landing yet') : f.rotations >= 2 ? done() : turnsMiss(f)),
    hint: twiceHint, titleHint: twiceTitle, coach: twiceCoach },
  { id: 'stick-wall', course: 'wall', goal: () => 'Stick it: score 84+',
    check: (c, f) => (c.total >= 84 && landed(f) ? done() : miss(`${r1(c.total)}, need 84`)) },
  { id: 'ninety-show', course: 'show', goal: () => 'Score 90 or more',
    // 0150: a clean flight off the mark is what holds a careful flight under 90 (one thumb with no slide: 85.7–86.0 at
    // 6 m; with the slide, 95.7 at 2.4 m), so that miss names the aim. A crash, a scrape on the row, a hard or tilted
    // touchdown, or a landing on the mark keeps "try again": the aim isn't what cost it.
    check: (c, f) => (c.total >= 90 ? done() : miss(`${r1(c.total)}, need 90`, cleanOver(f) && f.padMiss > 3.5 && !(f.sink > 1.5) && !(f.tiltDeg > 15))),
    hint: aimHint },
  // 0198: two turns onto the mark. A 360 can't carry the mark day: the held-from-Go thumb's is already 1.3 m off, and an
  // aimed one beats 1.2 m 8 times in 150. Called and never aimed, the 720 sets down 4.3 m off (wherever it was called);
  // aimed, it comes in (1.5 m onto the dot, Gold: tests/unit/thumb-lineup.test.js), so the bar sits just inside that.
  { id: 'mark-lineup', course: 'lineup', goal: () => `Roll two turns and land within ${len(LINEUP_MARK)} of the mark`,
    check: (c, f) => (!cleanLineup(f) ? miss('no clean landing yet') : !(f.rotations >= 2) ? turnsMiss(f)
      : f.padMiss <= LINEUP_MARK ? done() : miss(`${len(f.padMiss, 1)} off the mark`, true)),
    hint: (ctx, r) => (r?.turns ? twiceHint(ctx) : aimHint(ctx)),
    titleHint: (ctx, whole) => (!thumbOn(ctx) ? '' : whole ? 'Slide up on the run-up, then onto the amber dot' : 'Slide up on the run-up'),
    coach: twiceCoach },
  { id: 'scratch-show', course: 'show', goal: () => 'Clear the row without a scratch',
    check: (c, f) => (cleanOver(f) && (f.damagePct ?? 0) === 0 ? done() : !cleanOver(f) ? miss('clear the row and land clean first') : miss(`${f.damagePct} % damage`)) },
];
function done() { return { ok: true, miss: '' }; }
// `fix`: the miss is the objective's own number, so its hint (what to change) applies; not a "land clean first".
function miss(why, fix = false) { return fix ? { ok: false, miss: why, fix } : { ok: false, miss: why }; }
const thumbOn = (ctx) => ctx?.device === 'touch' && ctx.scheme === 'thumb';
// Onto the mark, in the device's words (0150: mark-show and ninety-show): one thumb slides onto the amber dot, the rest lean.
function aimHint(ctx) { return thumbOn(ctx) ? 'hold the pad in the air and slide onto the amber dot, following it down' : coachWords(ctx).aim; }
// 0198: one turn where the day asks two. `turns`: the hint names the call, not the aim. On one thumb the call is a slide up
// on the run-up; keys and two thumbs fly the roll by hand, and no modelled player of theirs lands a 720 (see the header),
// so there the miss says "try again" rather than promise a way.
const turnsMiss = (f) => ({ ok: false, miss: `rolled ${f.rollDeg}°, need 720°`, fix: true, turns: true });
function twiceHint(ctx) { return thumbOn(ctx) ? 'slide up on the run-up for two turns' : ''; }
function twiceTitle(ctx, whole) { return !thumbOn(ctx) ? '' : whole ? 'Slide up on the run-up for two turns' : 'Slide up on the run-up'; }
// The sheet's NEXT RUN line on a one-turn Lineup day: the coach would teach the mark, the day wants the call.
function twiceCoach(ctx, r) { return thumbOn(ctx) && r?.turns ? 'For the Daily: slide up on the run-up for two turns' : ''; }

// The results' line for a missed Daily (0139): the reason with its number, then what to change in this device's words
// (ctx as src/pointer.js: { device, scheme, tier, course }) when the objective has one, else "try again".
export function missLine(obj, r, ctx) {
  const hint = r?.fix && obj?.hint ? obj.hint(ctx || {}, r) : '';
  return hint ? `Daily: ${r.miss} · ${hint}` : `Daily: ${r.miss} — try again`;
}
// The sheet's NEXT RUN line on a missed Daily whose fix the coach would contradict (0150: skim on one thumb), else ''.
// ctx: the words of the run to come (src/main.js pointerCtx).
export const dailyCoach = (obj, r, ctx) => (r && !r.ok && r.fix && obj?.coach ? obj.coach(ctx || {}, r) : '');
// Whether that line also replaces the sheet's "hold the pad" items: only where the day's fix contradicts holding (skim).
// On the Lineup (0198) the call and the aim are both held, so the coach's aim stays.
export const dailySwapsHold = (obj) => !!obj?.swapHold;
// The sheet's "What happened" items under such a line: a fix that says to hold the pad says the Daily's line instead.
export const dailyItems = (items, line) => (!line ? items : (items || []).map((it) => (/\bhold(ing)? (on to )?the pad\b/i.test(it.fix || '') ? { ...it, fix: `${line}.` } : it)));
// The title card's hint for today's objective on this device ('' when there is none); `whole`: the countdown tip's wording.
export const titleHint = (obj, ctx, whole = false) => (obj?.titleHint ? obj.titleHint(ctx || {}, whole) : '');

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
