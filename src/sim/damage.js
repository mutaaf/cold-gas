// Damage: what the impacts did to the car, per zone, as a percentage. Pure and deterministic (it
// reads only the sim's impact events and permanent crush, src/sim/impacts.js and vehicle.js), so
// the HUD, the judges and the Worker's re-simulation all see the same numbers.
//
// Zones: nose, tail, left, right, roof, floor (underbody and skirts), susp (wheels and suspension).
// The model, all ESTIMATES with the reasoning:
//   HIT     damage ∝ impact energy ∝ speed²: 100 % at 14 m/s (≈50 km/h, a full-frontal barrier
//           test's speed, which writes a car off); a 5 m/s knock costs ≈13 %.
//   SCRAPE  bodywork grinding along a surface: 0.6 % per 10 m/s of sliding per 30 Hz sample
//           (≈18 % a second at 36 km/h), the sills and paint going.
//   WHEEL   a tyre slamming down faster than a hard landing (3 m/s) bends suspension: 100 % at
//           10 m/s (a 5 m drop with no braking).
//   CRUSH   a zone is at least as damaged as its deepest permanent crush (0.35 m = 100 %).
// Integrity = 100 − total, total = 0.6·worst zone + 0.4·mean: one wrecked corner is a wreck.
import { HIT, SCRAPE, WHEEL, CRUSH, PART } from './impacts.js';

export const ZONES = ['nose', 'tail', 'left', 'right', 'roof', 'floor', 'susp'];
const Z = Object.fromEntries(ZONES.map((z, i) => [z, i]));
const HIT_FULL = 14, WHEEL_SAFE = 3, WHEEL_FULL = 10, SCRAPE_PER = 0.6, CRUSH_FULL = 0.35;

export function createDamage() {
  return { zones: new Float64Array(ZONES.length), total: 0, seen: 0, lastTick: -1, last: -1 };
}

// Which zone a hull probe belongs to. Side probes split by the car's own x (+x is the car's left).
function zoneOf(part, probe, hull) {
  if (part === PART.nose) return Z.nose;
  if (part === PART.tail) return Z.tail;
  if (part === PART.roof) return Z.roof;
  if (part === PART.floor) return Z.floor;
  if (part === PART.wheel) return Z.susp;
  return hull[probe] && hull[probe].x > 0 ? Z.left : Z.right;
}

// Fold any new impact events into the damage. Call once per tick after vehicle.step.
export function updateDamage(d, car, hull) {
  const m = car.impacts;
  const zones = d.zones;
  for (let i = d.seen; i < m.count; i++) {
    const kind = m.kind[i], z = zoneOf(m.part[i], m.probe[i], hull), v = m.speed[i];
    let add = 0;
    if (kind === HIT) add = 100 * (v / HIT_FULL) * (v / HIT_FULL);
    else if (kind === SCRAPE) add = SCRAPE_PER * (v / 10);
    else if (kind === WHEEL) { const e = Math.max(0, v - WHEEL_SAFE) / (WHEEL_FULL - WHEEL_SAFE); add = 100 * e * e; }
    else if (kind === CRUSH) { zones[z] = Math.max(zones[z], (100 * m.crush[i]) / CRUSH_FULL); }
    if (add > 0) { zones[z] = Math.min(100, zones[z] + add); d.lastTick = m.tick[i]; d.last = z; }
  }
  d.seen = m.count;
  let worst = 0, sum = 0;
  for (let k = 0; k < zones.length; k++) { if (zones[k] > 100) zones[k] = 100; worst = Math.max(worst, zones[k]); sum += zones[k]; }
  d.total = Math.min(100, 0.6 * worst + (0.4 * sum) / zones.length);
  return d;
}

// Rounded, JSON-friendly copy for the scorecard and the AI panel.
export function damageFacts(d) {
  const zones = {};
  for (let k = 0; k < ZONES.length; k++) zones[ZONES[k]] = Math.round(d.zones[k]);
  return { pct: Math.round(d.total), integrity: Math.round(100 - d.total), zones };
}
