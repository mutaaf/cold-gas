// Adapt to me (0079): a small, pure performance model of this session's runs, and what it suggests
// between runs. It generalises Rookie mode (src/rookie.js, 0074), whose streak and offer it keeps
// exactly. No DOM: src/main.js records each finished run, draws the banner or the offer on the results
// and applies a step only between runs (a run's tier is latched at its start, never changed mid-run).
//
// The rules (the ticket's "harder or easier based on performance"):
//   - Easier, automatic (only while Adapt to me is on): STEP_DOWN_AFTER crashes in a row on Pro or
//     Advanced steps the flight tier down one level (Advanced → Pro → Assist), with an Undo.
//   - Easier, offered: Rookie mode (Easy driving + Assist) from the third crash in a row, as 0074. Not on
//     the sheet that already stepped the tier down (one change at a time).
//   - Harder, offered (never forced): every STEP_UP_AFTER good runs in a row, one step: Easy driving →
//     Standard first, then Assist → Pro (×1.08), then Pro → Advanced (×1.15).
// A good run: a clean one (no crash, it flew and landed: the Show also crossed the row) that touched
// down in the green (sink ≤ SINK_SOFT, tilt ≤ 15°) or beat the player's best on this device.
import { isCrash, nextStreak, offerRookie, ROOKIE_AFTER } from './rookie.js';
import { SINK_SOFT } from './sim/predict.js';
import { TIERS } from './sim/judge.js';

export const STEP_DOWN_AFTER = 3;
export const STEP_UP_AFTER = 3;
export const NEW_PLAYER_RUNS = 5;   // live pointers on the cue line for a player's first five runs
export { ROOKIE_AFTER };

const DOWN = { advanced: 'pro', pro: 'assist' };
const UP = { assist: 'pro', pro: 'advanced' };
export const stepDownOf = (tier) => DOWN[tier] || null;
export const stepUpOf = (tier) => UP[tier] || null;

export function newPerf() {
  return { crashes: 0, tierCrashes: 0, good: 0, runs: 0, last: null };
}

// What one finished run says. `best`: the player's best total on this event before this run (null: none).
export function outcomeOf(card, { best = null } = {}) {
  const f = card?.facts || {};
  const crashed = isCrash(card);
  const clean = !crashed && !!f.jumped && (f.course !== 'show' || !!f.crossedRow);
  const soft = clean && Number(f.sink) <= SINK_SOFT && !(Number(f.tiltDeg) > 15);
  const beat = clean && best != null && Number(card.total) > best;
  return { crashed, clean, good: soft || beat, total: Number(card?.total) || 0, sink: Number(f.sink) || 0, tier: card?.tier || 'assist' };
}

export function record(p, o) {
  return {
    crashes: nextStreak(p.crashes, o.crashed),
    tierCrashes: o.crashed ? (p.tierCrashes | 0) + 1 : 0,
    good: o.good ? (p.good | 0) + 1 : 0,
    runs: (p.runs | 0) + 1,
    last: o,
  };
}

// The player (or Undo) changed the tier or the driving level: the tier's crash count and the good
// streak start over. Rookie's streak is reset by its own rules in src/main.js (a choice resets it).
export const afterChange = (p) => ({ ...p, tierCrashes: 0, good: 0 });

// What the sheet shows after this run. `adapt`: the Adapt to me setting.
export function decide(p, { tier = 'assist', level = 'standard', adapt = true } = {}) {
  const out = { stepDown: null, rookie: false, offerLevel: null, offerTier: null };
  if (adapt && p.last?.crashed && p.tierCrashes >= STEP_DOWN_AFTER) out.stepDown = stepDownOf(tier);
  out.rookie = !out.stepDown && offerRookie(p.crashes, level, tier);
  if (p.last?.good && p.good >= STEP_UP_AFTER && p.good % STEP_UP_AFTER === 0) {
    if (level === 'easy') out.offerLevel = 'standard';
    else out.offerTier = stepUpOf(tier);
  }
  return out;
}

// Struggling: two crashes in a row. Live pointers come on for a new player, or while struggling with
// Adapt to me on.
export const struggling = (p) => (p.crashes | 0) >= 2;
export const coachLive = (p, flownEver, adapt = true) => flownEver < NEW_PLAYER_RUNS || (adapt && struggling(p));

// The words the sheet uses (one source for the banner, the offer and the tier picker).
export const TIER_WORDS = {
  assist: { name: 'Assist', state: 'On', sub: 'rolls you out, levels and brakes', long: 'The computer holds the rates; LAND rolls you out, carries you over the row, levels and brakes. Late? It lands for you.' },
  pro: { name: 'Pro', state: 'Off', sub: 'you fly it; brake at the line', long: 'Rate control, no LAND: roll out by the dial and brake at the BRAKE line yourself.' },
  advanced: { name: 'Advanced', state: 'Off', sub: 'ten valves by hand', long: 'No computer: ten valves by hand, a key or a pad per nozzle.' },
};
export const factorText = (tier) => `×${(TIERS[tier] || TIERS.assist).factor.toFixed(2)}`;

export function stepDownBanner(from, to, n = STEP_DOWN_AFTER) {
  const what = to === 'assist' ? 'Assist turned on' : `${TIER_WORDS[to].name} turned on`;
  return `${what}: ${n} crashes in a row on ${TIER_WORDS[from].name}.`;
}
export function offerWords(o) {
  if (o.offerLevel) return { label: 'Ready for Standard driving?', sub: 'your own steering and pedals', why: `${STEP_UP_AFTER} clean landings in a row on Easy.` };
  if (o.offerTier) return { label: `Ready for ${TIER_WORDS[o.offerTier].name}? ${factorText(o.offerTier)}`, sub: TIER_WORDS[o.offerTier].sub, why: `${STEP_UP_AFTER} clean landings in a row. The panel pays ${factorText(o.offerTier)} for it; switch back any time.` };
  return null;
}

// Session storage, as Rookie's streak (a reload keeps it, a new visit starts clean); the runs flown
// ever and the setting live in localStorage. Blocked or junk storage is a fresh start, never a throw.
const PERF = 'coldgas_perf', FLOWN = 'coldgas_flown', ADAPT = 'coldgas_adapt';
const sess = () => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };
const local = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
const int = (v, max) => { const n = parseInt(v || '0', 10); return n > 0 && n < max ? n : 0; };
export function loadPerf(store = sess()) {
  try {
    const o = JSON.parse(store?.getItem(PERF) || 'null');
    if (!o || typeof o !== 'object') return newPerf();
    return { crashes: int(o.crashes, 1000), tierCrashes: int(o.tierCrashes, 1000), good: int(o.good, 1000), runs: int(o.runs, 1e6), last: null };
  } catch { return newPerf(); }
}
export function savePerf(p, store = sess()) {
  try { store?.setItem(PERF, JSON.stringify({ crashes: p.crashes, tierCrashes: p.tierCrashes, good: p.good, runs: p.runs })); } catch { /* memory only */ }
}
export function loadFlown(store = local()) { try { return int(store?.getItem(FLOWN), 1e7); } catch { return 0; } }
export function saveFlown(n, store = local()) { try { store?.setItem(FLOWN, String(n | 0)); } catch { /* memory only */ } }
// Default on (new players and everyone who never touched it); only an explicit '0' is off.
export function loadAdapt(store = local()) { try { return store?.getItem(ADAPT) !== '0'; } catch { return true; } }
export function saveAdapt(on, store = local()) { try { store?.setItem(ADAPT, on ? '1' : '0'); } catch { /* memory only */ } }
