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
];

export const CATEGORIES = [
  { id: 'height', label: 'Amplitude', unit: 'm' },
  { id: 'rotation', label: 'Rotation', unit: '°' },
  { id: 'clearance', label: 'Clearance', unit: 'm' },
  { id: 'landing', label: 'Landing', unit: '' },
  { id: 'precision', label: 'Precision', unit: 'm' },
  { id: 'efficiency', label: 'Air left', unit: '%' },
];

// Three judges, three priorities. Weights sum to 1.
export const PANEL = [
  { id: 'engineer', name: 'The Engineer', title: 'Chief Vehicle Engineer',
    w: { height: 0.08, rotation: 0.17, clearance: 0.1, landing: 0.4, precision: 0.15, efficiency: 0.1 } },
  { id: 'coordinator', name: 'The Coordinator', title: 'Stunt Coordinator',
    w: { height: 0.28, rotation: 0.32, clearance: 0.12, landing: 0.18, precision: 0.05, efficiency: 0.05 } },
  { id: 'designer', name: 'The Designer', title: 'Head of Design',
    w: { height: 0.12, rotation: 0.22, clearance: 0.12, landing: 0.24, precision: 0.12, efficiency: 0.18 } },
];

// The Show: both stunts, one card.
export const SHOW_CATEGORIES = [
  { id: 'climb', label: 'Climb', unit: '%' },
  { id: 'inversion', label: 'Inverted', unit: 's' },
  { id: 'rollout', label: 'Roll-out', unit: '°' },
  { id: 'kickflip', label: 'Kickflip', unit: '°' },
  { id: 'clearance', label: 'Clearance', unit: 'm' },
  { id: 'landing', label: 'Landings', unit: '' },
  { id: 'precision', label: 'Precision', unit: 'm' },
  { id: 'efficiency', label: 'Gas left', unit: '%' },
];

export const categoriesFor = (course) => (course === 'wall' ? WALL_CATEGORIES : course === 'show' ? SHOW_CATEGORIES : CATEGORIES);

// Landing quality, shared: sink rate, attitude, heading, wheel sync, suspension.
function landingScore(t) {
  const sinkS = band(t.sink, 6, 0.9);
  const tiltS = band(t.tiltDeg, 25, 1.5);
  const headS = band(Math.abs(t.headingDeg) > 90 ? 180 - Math.abs(t.headingDeg) : Math.abs(t.headingDeg), 30, 2);
  const syncS = band(t.wheelSpreadMs, 250, 20);
  const suspS = t.bottomOut ? 0.55 : 1;
  return 10 * (0.38 * sinkS + 0.26 * tiltS + 0.14 * headS + 0.22 * syncS) * suspS * (t.bodyStrike ? 0.6 : 1);
}

function scoreWall(t, opts) {
  const course = COURSES.wall;
  const crashed = t.flipped || !t.settledUpright || t.fellOff || t.landedOnRamp;
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
  c.precision = 10 * band(padMiss, 20, 1);
  c.efficiency = 10 * band(airPct, 0, 50) * clamp01(turned / 120);
  if (!jumped) { c.rotation = 0; c.landing = 0; c.precision = 0; c.efficiency = 0; }
  if (crashed) { c.landing = 0; c.precision *= 0.3; }
  const assistFactor = opts.assist === false ? 1.08 : 1;
  const W = {
    engineer: { climb: 0.12, inversion: 0.12, rotation: 0.12, landing: 0.38, precision: 0.16, efficiency: 0.1 },
    coordinator: { climb: 0.24, inversion: 0.24, rotation: 0.22, landing: 0.18, precision: 0.06, efficiency: 0.06 },
    designer: { climb: 0.14, inversion: 0.16, rotation: 0.16, landing: 0.24, precision: 0.14, efficiency: 0.16 },
  };
  const judges = PANEL.map((j) => {
    let s = 0;
    for (const k of Object.keys(W[j.id])) s += W[j.id][k] * c[k];
    if (crashed) s = Math.min(s, 3.5);
    else if (!jumped) s = Math.min(s, 3);
    return { id: j.id, name: j.name, title: j.title, score: r1(Math.min(10, s * assistFactor)) };
  });
  const total = r1(judges.reduce((a, j) => a + j.score, 0) * 10 / 3);
  let verdict;
  if (t.fellOff) verdict = 'Fell off the wall';
  else if (!launched) verdict = t.progress > 0.5 ? 'Stalled on the wall' : 'No climb';
  else if (t.landedOnRamp) verdict = 'Came down on the deck';
  else if (t.flipped || !t.settledUpright) verdict = 'Rolled over';
  else if (crashed) verdict = 'Crash';
  else if (total >= 92) verdict = 'Perfect 10';
  else if (total >= 84) verdict = 'Stuck it';
  else if (total >= 72) verdict = 'Clean';
  else if (total >= 55) verdict = 'Rough landing';
  else verdict = 'Survived';
  return {
    course: 'wall', total, judges,
    categories: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r1(v)])),
    facts: {
      course: 'wall', height: r1(t.maxRampHeight), progressPct: Math.round(t.progress * 100), invertedS: r1(t.invertedTime),
      launchHeight: r1(t.launchHeight), launchKmh: Math.round(t.launchSpeed * 3.6), entryKmh: Math.round(t.rampEntrySpeed * 3.6),
      apex: r1(t.apex), maxG: r1(t.maxG), rollDeg: Math.round(rollDeg), pitchDeg: Math.round(pitchDeg), rotations: Math.round(turned / 360),
      sink: r1(t.sink), tiltDeg: r1(t.tiltDeg), headingDeg: r1(t.headingDeg), wheelSpreadMs: Math.round(t.wheelSpreadMs),
      padMiss: r1(padMiss), airPct: Math.round(airPct), zeroToSixty: t.zeroToSixty,
      bottomOut: t.bottomOut, bodyStrike: t.bodyStrike, contact: false, clearance: null, apexOverRoof: null,
      flipped: t.flipped, fellOff: t.fellOff, landedOnRamp: t.landedOnRamp, crashed, jumped, endReason: t.endReason,
    },
    verdict,
  };
}

export function scoreRun(t, opts = {}) {
  if (t.course === 'wall') return scoreWall(t, opts);
  if (t.course === 'show') return scoreShow(t, opts);
  return scoreLineup(t, opts);
}

// The Show scores each stunt on its own card, then each judge's mark is the mean of their two.
// Never reaching the lineup leaves that half at zero: the whole show is the point.
function scoreShow(t, opts) {
  const reached = t.leg === 1;
  const wall = scoreWall(reached ? t.wall : t, opts);
  const kick = reached ? scoreLineup(t, opts) : null;
  const judges = wall.judges.map((j, i) => ({ ...j, score: r1((j.score + (kick ? kick.judges[i].score : 0)) / 2) }));
  const total = r1(judges.reduce((a, j) => a + j.score, 0) * 10 / 3);
  const wc = wall.categories, kc = kick?.categories;
  const categories = {
    climb: wc.climb, inversion: wc.inversion, rollout: wc.rotation,
    kickflip: kc ? kc.rotation : 0, clearance: kc ? kc.clearance : 0,
    landing: r1(kc ? (wc.landing + kc.landing) / 2 : wc.landing / 2),
    precision: r1(kc ? (wc.precision + kc.precision) / 2 : wc.precision / 2),
    efficiency: kc ? kc.efficiency : 0,
  };
  let verdict;
  if (!reached) verdict = wall.facts.jumped && !wall.facts.crashed ? 'Never reached the lineup' : wall.verdict;
  else if (kick.verdict === 'No jump' || kick.facts.crashed || kick.verdict === 'No trick') verdict = kick.verdict;
  else if (total >= 92) verdict = 'Perfect 10';
  else if (total >= 84) verdict = 'Stuck it';
  else if (total >= 72) verdict = 'Clean';
  else if (total >= 55) verdict = 'Rough landing';
  else verdict = 'Survived';
  const wf = wall.facts, kf = kick?.facts;
  const last = kf || wf;
  return {
    course: 'show', total, judges, categories, verdict,
    facts: {
      course: 'show', reachedLineup: reached, wall: wf, lineup: kf || null,
      // The headline numbers (share text, theatre), from the last stunt flown.
      rollDeg: kf ? kf.rollDeg : wf.rollDeg, apex: kf ? kf.apex : wf.apex, sink: last.sink,
      height: wf.height, invertedS: wf.invertedS, maxG: wf.maxG, zeroToSixty: wf.zeroToSixty,
      crashed: wf.crashed || !!kf?.crashed, jumped: wf.jumped, endReason: t.endReason,
    },
  };
}

function scoreLineup(t, opts = {}) {
  const PAD = LINEUP.pad, TALLEST = LINEUP.tallest;
  const crashed = t.contact || t.flipped || !t.settledUpright;
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

  const assistFactor = opts.assist === false ? 1.08 : 1;   // Pro (no flight computer) bonus
  const judges = PANEL.map((j) => {
    let s = 0;
    for (const k of Object.keys(j.w)) s += j.w[k] * c[k];
    if (crashed) s = Math.min(s, 3.5);
    else if (rotations === 0) s = Math.min(s, 4.5);
    return { id: j.id, name: j.name, title: j.title, score: r1(Math.min(10, s * assistFactor)) };
  });
  const total = r1(judges.reduce((a, j) => a + j.score, 0) * 10 / 3);

  return {
    total,                              // 0..100
    judges,
    categories: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r1(v)])),
    facts: {
      apex: r1(t.apex), apexOverRoof: r1(apexOverRoof), rollDeg: Math.round(rollDeg), rotations,
      clearance: r1(clearance), sink: r1(t.sink), tiltDeg: r1(t.tiltDeg), headingDeg: r1(t.headingDeg),
      wheelSpreadMs: Math.round(t.wheelSpreadMs), padMiss: r1(padMiss), airPct: Math.round(airPct),
      launchKmh: Math.round(t.launchSpeed * 3.6), bottomOut: t.bottomOut, bodyStrike: t.bodyStrike,
      contact: t.contact, flipped: t.flipped, crashed, jumped, endReason: t.endReason,
    },
    verdict: verdictOf(total, crashed, jumped, t),
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
