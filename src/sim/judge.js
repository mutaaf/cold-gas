// The scorecard. Pure function of the run telemetry, so the client, the replay and the Worker
// always agree. The AI panel only *writes* the commentary (src/judges-ai.js, src/worker/); the
// numbers are decided here and nowhere else.
import { PAD, TALLEST } from './course.js';
import { CAR } from './vehicle.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Map x in [bad, good] → [0, 1] (works for either direction).
const band = (x, bad, good) => clamp01((x - bad) / (good - bad));
const r1 = (x) => Math.round(x * 10) / 10;

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

export function scoreRun(t, opts = {}) {
  const crashed = t.contact || t.flipped || !t.settledUpright;
  const jumped = t.airStartTick >= 0 && t.touchTick >= 0;
  const rollDeg = Math.abs(t.rollAccum) * 180 / Math.PI;
  const rotations = Math.round(rollDeg / 360);
  const rollError = rotations > 0 ? Math.abs(rollDeg - rotations * 360) : 360;
  const clearance = Number.isFinite(t.minClearance) ? t.minClearance : 0;
  const airPct = (t.airEnd / CAR.airMass) * 100;
  const padMiss = Math.hypot(t.lateral, t.landZ - PAD.z);
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
