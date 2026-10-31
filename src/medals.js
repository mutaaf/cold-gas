// Medals (0120): bronze, silver and gold per event and flight tier, the best on this device.
//
// Thresholds are score totals (src/sim/judge.js scoreRun, the same number the Worker verifies) and
// are calibrated from measured populations, not from 100: gold is what a skilled player reaches on
// that tier, silver what a careful one does, bronze a clean landing. The numbers and where they come
// from are in docs/backlog/0120-thumb-mastery.md. A medal is a reading of the score, never a score:
// nothing here feeds back into a run.
//
// Storage: one localStorage key on this device (coldgas_medals), { "<course>:<tier>": best total }.
// Every read and write is guarded (private mode, storage off, quota): no storage, no medals kept,
// the run goes on. getMedals(course, tier) is the read other modules use (the title, the daily).
import './medals.css';

export const MEDAL_KEY = 'coldgas_medals';
export const MEDAL_ORDER = ['bronze', 'silver', 'gold'];
export const MEDAL_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

// [bronze, silver, gold] per course and tier.
//  - The Show, Assist (the phone's default, one-thumb), SIM_VERSION 27 judging, scripts/human-phone.mjs 300
//    each: a thumb that never aims lands 81.7–86 (median 83.7: bronze); one that slides onto the sight's dot,
//    median 92.7 (silver) and p90 95.7 (gold); sloppy aiming median 90.3; the classic two-thumb scheme and
//    the keyboard population median 73; the reference 97.7.
//  - The Wall, Assist: scripts/naive-players.mjs (32 naive strategies: 84–88) and the reference (96).
//  - The Lineup, Assist: the reference kickflip is 92; a clean 360 by hand is the bronze.
//  - Pro and Advanced: the panel pays ×1.08 and ×1.15 (judge.js TIERS) for flying with less computer;
//    the bars rise by less than that (ESTIMATE: the same flight is harder to fly, so not the full factor).
export const MEDALS = {
  show: { assist: [80, 90, 95], pro: [82, 92, 96.5], advanced: [83, 93, 97.5] },
  wall: { assist: [84, 90, 94], pro: [86, 92, 96], advanced: [87, 93, 97.5] },
  lineup: { assist: [72, 84, 90], pro: [75, 87, 93], advanced: [77, 89, 95] },
};

export function thresholds(course, tier) {
  const t = (MEDALS[course] || MEDALS.show)[tier] || (MEDALS[course] || MEDALS.show).assist;
  return { bronze: t[0], silver: t[1], gold: t[2] };
}

// The medal a total earns (null under bronze, or not a number).
export function medalFor(course, tier, total) {
  if (!Number.isFinite(total)) return null;
  const th = thresholds(course, tier);
  let m = null;
  for (const k of MEDAL_ORDER) if (total >= th[k] - 1e-9) m = k;
  return m;
}

const r1 = (x) => Math.round(x * 10) / 10;

// The next medal above `best` and how far `from` is short of it (null when gold is held).
export function nextMedal(course, tier, best, from = best) {
  const th = thresholds(course, tier);
  for (const k of MEDAL_ORDER) {
    if (!(best >= th[k])) {
      const ref = Number.isFinite(from) ? from : 0;
      return { medal: k, at: th[k], toGo: r1(Math.max(0.1, th[k] - ref)) };
    }
  }
  return null;
}

// "Silver at 90 · 3.2 to go" (or the gold line when it's held).
export function nextTargetText(course, tier, best, from = best) {
  const n = nextMedal(course, tier, best, from);
  if (!n) return 'Gold held · beat your best';
  return `${MEDAL_LABEL[n.medal]} at ${n.at} · ${n.toGo.toFixed(1)} to go`;
}

// --- storage ----------------------------------------------------------------------------------
let mem = null;   // the parsed store (a copy survives storage that throws)
function load() {
  if (mem) return mem;
  mem = {};
  try {
    const raw = globalThis.localStorage?.getItem(MEDAL_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (/^[a-z]+:[a-z]+$/.test(k) && Number.isFinite(v) && v >= 0 && v <= 100) mem[k] = v;
  } catch { /* storage off or junk: start empty */ }
  return mem;
}
function save() {
  try { globalThis.localStorage?.setItem(MEDAL_KEY, JSON.stringify(mem)); } catch { /* quota / private mode */ }
}
// For tests: forget the in-memory copy so the next read goes back to storage.
export function _resetMedalCache() { mem = null; }

// The medals held on this device for an event and tier: the best total, its medal, the bars and the
// next one to go for. Safe to call anywhere (no DOM).
export function getMedals(course, tier) {
  const best = load()[`${course}:${tier}`];
  const b = Number.isFinite(best) ? best : null;
  return { course, tier, best: b, medal: b == null ? null : medalFor(course, tier, b), thresholds: thresholds(course, tier), next: nextMedal(course, tier, b ?? -1) };
}

// Count a finished run. Returns the medal it earned, the one held before, and whether it's new.
export function recordRun(course, tier, total) {
  const before = getMedals(course, tier);
  if (!Number.isFinite(total) || !MEDALS[course]) return { before, after: before, earned: null, isNew: false };
  const s = load(), k = `${course}:${tier}`;
  if (!(s[k] >= total)) { s[k] = r1(total); save(); }
  const after = getMedals(course, tier);
  const earned = medalFor(course, tier, total);
  const isNew = !!after.medal && after.medal !== before.medal;
  return { before, after, earned, isNew };
}

// --- the results row --------------------------------------------------------------------------
// One compact row under the score: three pips (bronze · silver · gold, filled when held), the medal
// this run earned (or "New" when it's a first), and the next target. Hairlines, Geist, ink and amber.
export function renderMedals(el, course, tier, total, rec = null) {
  if (!el) return;
  const m = rec?.after || getMedals(course, tier);
  const th = m.thresholds;
  el.textContent = '';
  el.hidden = false;
  el.dataset.medal = m.medal || 'none';
  const row = document.createElement('div');
  row.className = 'md-row';
  for (const k of MEDAL_ORDER) {
    const pip = document.createElement('span');
    pip.className = 'md-pip';
    pip.dataset.k = k;
    if (m.best != null && m.best >= th[k]) pip.dataset.held = '';
    if (rec?.isNew && rec.after.medal === k) pip.dataset.new = '';
    const dot = document.createElement('i');
    const lab = document.createElement('span');
    lab.className = 'md-lab';
    lab.textContent = `${MEDAL_LABEL[k]} ${th[k]}`;
    pip.append(dot, lab);
    row.append(pip);
  }
  const note = document.createElement('span');
  note.className = 'md-next';
  note.dataset.medalsNext = '';
  const earned = rec?.earned;
  note.textContent = (rec?.isNew ? `New ${MEDAL_LABEL[rec.after.medal]} · ` : earned ? `${MEDAL_LABEL[earned]} run · ` : '') + nextTargetText(course, tier, m.best ?? -1, total);
  row.append(note);
  el.append(row);
  el.setAttribute('aria-label', `Medals: ${m.medal ? `${MEDAL_LABEL[m.medal]} held` : 'none yet'}. ${note.textContent}`);
}

// Results-sheet hook (src/main.js): count the run, then draw the row into [data-medals].
export function showMedals(course, tier, total, root = document) {
  const el = root.querySelector('[data-medals]');
  const rec = recordRun(course, tier, total);
  renderMedals(el, course, tier, total, rec);
  return rec;
}
export function hideMedals(root = document) {
  const el = root.querySelector('[data-medals]');
  if (el) el.hidden = true;
}
