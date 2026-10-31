// The scorecard. Pure function of the run telemetry, so the client, the replay and the Worker
// always agree. The AI panel only *writes* the commentary (src/judges-ai.js, src/worker/); the
// numbers are decided here and nowhere else.
import { COURSES, LINEUP } from './courses.js';
import { CAR } from './vehicle.js';
import { dhypot } from './dmath.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Map x in [bad, good] → [0, 1] (works for either direction).
const band = (x, bad, good) => clamp01((x - bad) / (good - bad));
const r1 = (x) => Math.round(x * 10) / 10;

// The Wall: climb the curl, hang inverted, peel off the lip, roll upright, land on the mark.
export const WALL_CATEGORIES = [
  { id: 'climb', label: 'Climb', unit: '%' },
  { id: 'inversion', label: 'Inverted', unit: 's' },
  { id: 'rotation', label: 'Roll-out', unit: '°' },
  { id: 'landing', label: 'Landing', unit: '' },
  { id: 'precision', label: 'Precision', unit: 'm' },
  { id: 'efficiency', label: 'Gas left', unit: '%' },
  { id: 'damage', label: 'Integrity', unit: '%' },
];

export const CATEGORIES = [
  { id: 'height', label: 'Amplitude', unit: 'm' },
  { id: 'rotation', label: 'Rotation', unit: '°' },
  { id: 'clearance', label: 'Clearance', unit: 'm' },
  { id: 'landing', label: 'Landing', unit: '' },
  { id: 'precision', label: 'Precision', unit: 'm' },
  { id: 'efficiency', label: 'Air left', unit: '%' },
  { id: 'damage', label: 'Integrity', unit: '%' },
];

// Flight tiers and what the panel pays for each (src/sim/vehicle.js `tierOf`). Assist flies with
// the computer (rates held, LAND levels and governs, the crawl and the carry limited); Pro is rate
// control with no LAND governor; Advanced is ten valves by hand, no computer at all. Raw piloting
// is what the judges came to see, so the less the computer does, the more each point is worth.
export const TIERS = {
  assist: { id: 'assist', label: 'Assist', factor: 1 },
  pro: { id: 'pro', label: 'Pro', factor: 1.08 },
  advanced: { id: 'advanced', label: 'Advanced', factor: 1.15 },
};
// The tier a run was flown in: from its telemetry (what the inputs actually were) when it has one,
// else from the caller's `assist` flag (hand-built telemetry, old callers).
export function tierOfRun(t, opts = {}) {
  if (TIERS[t.tier] && t.endTick >= 0) return t.tier;
  return opts.assist === false ? 'pro' : 'assist';
}

// Three judges, three priorities. Weights sum to 1.
export const PANEL = [
  { id: 'engineer', name: 'The Engineer', title: 'Chief Vehicle Engineer',
    w: { height: 0.08, rotation: 0.17, clearance: 0.1, landing: 0.4, precision: 0.15, efficiency: 0.1 } },
  { id: 'coordinator', name: 'The Coordinator', title: 'Stunt Coordinator',
    w: { height: 0.28, rotation: 0.32, clearance: 0.12, landing: 0.18, precision: 0.05, efficiency: 0.05 } },
  { id: 'designer', name: 'The Designer', title: 'Head of Design',
    w: { height: 0.12, rotation: 0.22, clearance: 0.12, landing: 0.24, precision: 0.12, efficiency: 0.18 } },
];

// The Show: one flight, off the Wall and over the row.
export const SHOW_CATEGORIES = [
  { id: 'climb', label: 'Climb', unit: '%' },
  { id: 'inversion', label: 'Inverted', unit: 's' },
  { id: 'rotation', label: 'Roll-out', unit: '°' },
  { id: 'clearance', label: 'Clearance', unit: 'm' },
  { id: 'landing', label: 'Landing', unit: '' },
  { id: 'precision', label: 'Precision', unit: 'm' },
  { id: 'efficiency', label: 'Gas left', unit: '%' },
  { id: 'damage', label: 'Integrity', unit: '%' },
];

export const categoriesFor = (course) => (course === 'wall' ? WALL_CATEGORIES : course === 'show' ? SHOW_CATEGORIES : CATEGORIES);

const WALL_W = {
  engineer: { climb: 0.12, inversion: 0.12, rotation: 0.12, landing: 0.38, precision: 0.16, efficiency: 0.1 },
  coordinator: { climb: 0.24, inversion: 0.24, rotation: 0.22, landing: 0.18, precision: 0.06, efficiency: 0.06 },
  designer: { climb: 0.14, inversion: 0.16, rotation: 0.16, landing: 0.24, precision: 0.14, efficiency: 0.16 },
};
// The Show's weights (SIM_VERSION 27, ticket 0120). On Assist the computer flies the climb, the hang and the
// roll-out to 9.7–10 for everyone, so weight there paid every run the same; it now sits on what the pilot
// decides: the mark, the touchdown and the gas. Measured on 300-player populations (docs/backlog/0120):
// a one-thumb player who never aims 90.3 → 83.7 median, one who aims onto the mark 91 → 92.7 (p90 95.7),
// the reference 94 → 97.7, still above every thumb.
const SHOW_W = {
  engineer: { climb: 0.04, inversion: 0.03, rotation: 0.05, clearance: 0.08, landing: 0.34, precision: 0.36, efficiency: 0.10 },
  coordinator: { climb: 0.08, inversion: 0.10, rotation: 0.14, clearance: 0.16, landing: 0.16, precision: 0.28, efficiency: 0.08 },
  designer: { climb: 0.04, inversion: 0.06, rotation: 0.08, clearance: 0.10, landing: 0.24, precision: 0.34, efficiency: 0.14 },
};
// Through points [[x, v], …] (v 0..1): flat before the first, straight between, the last value after.
function curve(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + ((vb - va) * (x - a)) / (b - a); }
  }
  return pts[pts.length - 1][1];
}
// The Show's mark, read off the pad's painted rings (2 · 4 · 7 m, courses.js): full marks inside 3.5 m,
// 0.85 at 5 m, under half at the outer ring's 7 m, a sliver at 12 m and nothing from 20. (Was a straight
// line from 1 m to 20 m, which kept 74 % of the marks for a 6 m miss outside the 4 m ring.)
const SHOW_PRECISION = [[3.5, 1], [5, 0.85], [7, 0.45], [12, 0.15], [20, 0]];
// Gas left on the Show: full marks from 45 % (the reference keeps 48 %).
const SHOW_GAS_FULL = 45;

// Damage (src/sim/damage.js): every judge marks the car's integrity, each with their own weight
// (the Engineer cares most: they have to fix it). 60 % or worse is a wreck, whatever else happened.
const DAMAGE_W = { engineer: 0.15, coordinator: 0.08, designer: 0.12 };
export const WRECK_PCT = 60;
const damagePct = (t) => (t.damage ? t.damage.pct : 0);
const withDamage = (s, j, c) => s * (1 - DAMAGE_W[j.id]) + DAMAGE_W[j.id] * c.damage;
const damageFactsOf = (t) => ({ damagePct: damagePct(t), integrity: 100 - damagePct(t), damageZones: t.damage ? t.damage.zones : null });

// Landing quality, shared: sink rate, attitude, heading, wheel sync, suspension.
function landingScore(t) {
  const sinkS = band(t.sink, 6, 0.9);
  const tiltS = band(t.tiltDeg, 25, 1.5);
  const headS = band(Math.abs(t.headingDeg) > 90 ? 180 - Math.abs(t.headingDeg) : Math.abs(t.headingDeg), 30, 2);
  const syncS = band(t.wheelSpreadMs, 250, 20);
  const suspS = t.bottomOut ? 0.55 : 1;
  return 10 * (0.38 * sinkS + 0.26 * tiltS + 0.14 * headS + 0.22 * syncS) * suspS * (t.bodyStrike ? 0.6 : 1);
}

// Clearance over the parked row: contact is a zero; close-but-clean is the art (≈0.8 m is
// perfect, 3 m+ is safe).
// (SIM_VERSION 27: a margin up to 2 m is as good as a skim, and a high, safe crossing costs less: 0.85 at
// 6 m, 0.75 from 12 m. It was 0.72 from 4.8 m, which marked down the reference's 5 m for being safe.)
const CLEARANCE = [[0, 0.82], [0.8, 1], [2, 1], [6, 0.85], [12, 0.75]];
function clearanceScore(t) {
  const clearance = Number.isFinite(t.minClearance) ? t.minClearance : 0;
  return t.contact ? 0 : clearance <= 0 ? 0 : 10 * curve(clearance, CLEARANCE);
}

// The Wall, and the Show (the Wall with the row under the ledge: clearance counts, contact
// crashes, and the pad is beyond the row).
function scoreWall(t, opts) {
  const show = t.course === 'show';
  const course = COURSES[show ? 'show' : 'wall'];
  const wrecked = damagePct(t) >= WRECK_PCT;
  const crashed = t.flipped || !t.settledUpright || t.fellOff || t.landedOnRamp || (show && t.contact) || wrecked;
  const launched = t.airStartTick >= 0;
  const jumped = launched && t.touchTick >= 0;
  const rollDeg = Math.abs(t.rollAccum) * 180 / Math.PI;
  const pitchDeg = Math.abs(t.pitchAccum) * 180 / Math.PI;
  const turned = Math.max(rollDeg, pitchDeg);
  const rollShare = rollDeg / Math.max(1, rollDeg + pitchDeg);
  const airPct = (t.airEnd / CAR.airMass) * 100;
  const padMiss = dhypot(t.lateral, t.landZ - course.pad.z);
  const c = {};
  c.climb = 10 * clamp01(t.progress) * Math.sqrt(clamp01(t.progress));
  c.inversion = t.progress > 0.8 ? 10 * band(t.invertedTime, 0, 1.0) : 0;
  // Coming off the ledge upside down, the car must turn ~180° to land. The reveal did it as a
  // roll; a roll-dominant turn scores higher than a flip.
  c.rotation = 10 * clamp01(turned / 160) * (0.7 + 0.3 * rollShare);
  c.landing = landingScore(t);
  c.precision = show ? 10 * curve(padMiss, SHOW_PRECISION) : 10 * band(padMiss, 20, 1);
  c.efficiency = 10 * band(airPct, 0, show ? SHOW_GAS_FULL : 50) * clamp01(turned / 120);
  if (show) c.clearance = t.crossedRow ? clearanceScore(t) : 0;
  c.damage = 10 * (1 - damagePct(t) / 100);
  if (!jumped) { c.rotation = 0; c.landing = 0; c.precision = 0; c.efficiency = 0; c.clearance = 0; }
  if (crashed) { c.landing = 0; c.precision *= 0.3; }
  const tier = TIERS[tierOfRun(t, opts)];
  const W = show ? SHOW_W : WALL_W;
  const judges = PANEL.map((j) => {
    let s = 0;
    for (const k of Object.keys(W[j.id])) s += W[j.id][k] * c[k];
    s = withDamage(s, j, c);
    if (crashed) s = Math.min(s, 3.5);
    else if (!jumped) s = Math.min(s, 3);
    else if (show && !t.crossedRow) s = Math.min(s, 5);
    return { id: j.id, name: j.name, title: j.title, score: r1(Math.min(10, s * tier.factor)) };
  });
  const total = r1(judges.reduce((a, j) => a + j.score, 0) * 10 / 3);
  let verdict;
  if (t.fellOff) verdict = 'Fell off the wall';
  else if (wrecked) verdict = 'Wrecked';
  else if (show && t.contact) verdict = 'Contact';
  else if (!launched) verdict = t.progress > 0.5 ? 'Stalled on the wall' : 'No climb';
  else if (t.landedOnRamp) verdict = 'Came down on the deck';
  else if (t.flipped || !t.settledUpright) verdict = 'Rolled over';
  else if (crashed) verdict = 'Crash';
  else if (show && !t.crossedRow) verdict = 'Short of the row';
  else if (total >= 92) verdict = 'Perfect 10';
  else if (total >= 84) verdict = 'Stuck it';
  else if (total >= 72) verdict = 'Clean';
  else if (total >= 55) verdict = 'Rough landing';
  else verdict = 'Survived';
  return {
    course: course.id, total, judges, tier: tier.id, multiplier: tier.factor,
    categories: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r1(v)])),
    facts: {
      course: course.id, height: r1(t.maxRampHeight), progressPct: Math.round(t.progress * 100), invertedS: r1(t.invertedTime),
      launchHeight: r1(t.launchHeight), launchKmh: Math.round(t.launchSpeed * 3.6), entryKmh: Math.round(t.rampEntrySpeed * 3.6),
      apex: r1(t.apex), maxG: r1(t.maxG), brakeG: r1(t.brakePeakG || 0), brakeH: r1(t.brakePeakH || 0), rollDeg: Math.round(rollDeg), pitchDeg: Math.round(pitchDeg), rotations: Math.round(turned / 360),
      sink: r1(t.sink), tiltDeg: r1(t.tiltDeg), headingDeg: r1(t.headingDeg), wheelSpreadMs: Math.round(t.wheelSpreadMs),
      padMiss: r1(padMiss), airPct: Math.round(airPct), zeroToSixty: t.zeroToSixty,
      bottomOut: t.bottomOut, bodyStrike: t.bodyStrike, contact: show && t.contact,
      clearance: show && Number.isFinite(t.minClearance) ? r1(t.minClearance) : null, crossedRow: show ? t.crossedRow : null, apexOverRoof: null,
      flipped: t.flipped, fellOff: t.fellOff, landedOnRamp: t.landedOnRamp, crashed, jumped, endReason: t.endReason, ...damageFactsOf(t),
    },
    verdict,
  };
}

export function scoreRun(t, opts = {}) {
  if (t.course === 'wall') return scoreWall(t, opts);
  if (t.course === 'show') return scoreWall(t, opts);
  return scoreLineup(t, opts);
}

function scoreLineup(t, opts = {}) {
  const PAD = LINEUP.pad, TALLEST = LINEUP.tallest;
  const wrecked = damagePct(t) >= WRECK_PCT;
  const crashed = t.contact || t.flipped || !t.settledUpright || wrecked;
  const jumped = t.airStartTick >= 0 && t.touchTick >= 0;
  const rollDeg = Math.abs(t.rollAccum) * 180 / Math.PI;
  const rotations = Math.round(rollDeg / 360);
  const rollError = rotations > 0 ? Math.abs(rollDeg - rotations * 360) : 360;
  const clearance = Number.isFinite(t.minClearance) ? t.minClearance : 0;
  const airPct = (t.airEnd / CAR.airMass) * 100;
  const padMiss = dhypot(t.lateral, t.landZ - PAD.z);
  const apexOverRoof = t.apex - TALLEST;

  // Raw category scores, 0..10.
  const c = {};
  c.height = 10 * band(t.apex, 3.5, 9.5);
  // Rotation: a full 360 is worth 8.2 base, 720 is worth 10. Purity (no pitch/yaw wobble)
  // and finishing exactly on the rotation lift it; partial rolls score low.
  const purity = clamp01(1 - t.offAxis / 1.4);
  const finish = clamp01(1 - rollError / 60);
  if (rotations === 0) c.rotation = 3 * clamp01(rollDeg / 300);
  else c.rotation = Math.min(10, (rotations === 1 ? 7.2 : 8.8) + 1.2 * purity * finish) * lerp(0.55, 1, finish);
  // Clearance: contact is a zero. Close-but-clean is the art: ~0.8 m is perfect, 3 m+ is safe.
  c.clearance = t.contact ? 0 : clearance <= 0 ? 0 : 10 * (clearance < 0.8 ? lerp(0.82, 1, clearance / 0.8) : lerp(1, 0.72, clamp01((clearance - 0.8) / 4)));
  // Landing: sink rate, attitude, heading, wheel sync, suspension.
  const sinkS = band(t.sink, 6, 0.9);
  const tiltS = band(t.tiltDeg, 25, 1.5);
  const headS = band(Math.abs(t.headingDeg), 30, 2);
  const syncS = band(t.wheelSpreadMs, 250, 20);
  const suspS = t.bottomOut ? 0.55 : 1;
  c.landing = 10 * (0.38 * sinkS + 0.26 * tiltS + 0.14 * headS + 0.22 * syncS) * suspS * (t.bodyStrike ? 0.6 : 1);
  c.precision = 10 * band(padMiss, 16, 0.8);
  // Saving air only counts if you spent some on a trick.
  c.efficiency = 10 * band(airPct, 0, 65) * clamp01(rollDeg / 330);

  if (!jumped) for (const k of Object.keys(c)) c[k] = 0;
  if (crashed) { c.landing = 0; c.precision *= 0.3; }
  c.damage = 10 * (1 - damagePct(t) / 100);

  const tier = TIERS[tierOfRun(t, opts)];
  const judges = PANEL.map((j) => {
    let s = 0;
    for (const k of Object.keys(j.w)) s += j.w[k] * c[k];
    s = withDamage(s, j, c);
    if (crashed) s = Math.min(s, 3.5);
    else if (rotations === 0) s = Math.min(s, 4.5);
    return { id: j.id, name: j.name, title: j.title, score: r1(Math.min(10, s * tier.factor)) };
  });
  const total = r1(judges.reduce((a, j) => a + j.score, 0) * 10 / 3);

  return {
    total,                              // 0..100
    judges, tier: tier.id, multiplier: tier.factor,
    categories: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r1(v)])),
    facts: {
      apex: r1(t.apex), apexOverRoof: r1(apexOverRoof), rollDeg: Math.round(rollDeg), rotations,
      clearance: r1(clearance), sink: r1(t.sink), tiltDeg: r1(t.tiltDeg), headingDeg: r1(t.headingDeg),
      wheelSpreadMs: Math.round(t.wheelSpreadMs), padMiss: r1(padMiss), airPct: Math.round(airPct),
      launchKmh: Math.round(t.launchSpeed * 3.6), bottomOut: t.bottomOut, bodyStrike: t.bodyStrike,
      contact: t.contact, flipped: t.flipped, crashed, jumped, endReason: t.endReason, ...damageFactsOf(t),
    },
    verdict: wrecked && jumped ? 'Wrecked' : verdictOf(total, crashed, jumped, t),
  };
}

function verdictOf(total, crashed, jumped, t) {
  if (!jumped) return 'No jump';
  if (t.contact) return 'Contact';
  if (t.flipped) return 'Rolled over';
  if (crashed) return 'Crash';
  if (Math.abs(t.rollAccum) < Math.PI) return 'No trick';
  if (total >= 92) return 'Perfect 10';
  if (total >= 84) return 'Stuck it';
  if (total >= 72) return 'Clean';
  if (total >= 55) return 'Rough landing';
  return 'Survived';
}
