// The fan car corners like the stage claim (ticket 0020): "corner at greater than 2 G's … beyond
// the tires, which is typically 1.26 G's" (OFFICIAL, Moravy; docs/REVEAL_RESEARCH.md §3.7). A
// held stick asks the armed fans for the suction the corner needs, and the rack opens to the grip
// they add. Steady state on open concrete, full stick, speed held, 2 s settle then a 1 s mean.
import { describe, it, expect } from 'vitest';
import { createVehicle, step, newInput, massOf, G, DT, tyreMuLoad } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

// Left-hand circles from x = 30: a right-hander there sweeps a 2.4 g circle (≈ 80 m across at
// 30 m/s) into the parked row at x ≈ 0.
function corner(v, fan) {
  const s = createVehicle('lineup'); s.pos.x = 30;
  const inp = newInput();
  for (let i = 0; i < 480; i++) step(s, inp);
  inp.fan = fan;
  while (Math.hypot(s.vel.x, s.vel.z) < v) { inp.throttle = 1; step(s, inp); }
  inp.steer = -1;
  let g = 0, kgf = 0, limit = 0, n = 0;
  for (let i = 0; i < 240 * 3; i++) {
    const sp = Math.hypot(s.vel.x, s.vel.z);
    inp.throttle = Math.max(0, Math.min(0.85, 0.3 + (v - sp) * 0.5));   // hold speed (under the launch's full-throttle law)
    step(s, inp);
    if (i >= 480) {
      g += Math.abs(sp * s.angVel.y) / G; kgf += s.fanForce / G;
      // No free g: the tyres' peak μ at the mean load the suction puts on them (0021).
      const x = 1 + s.fanForce / (massOf(s) * G);
      limit += SPEC.tyreMu0 * tyreMuLoad(x) * x; n++;
    }
  }
  return { s, inp, g: g / n, kgf: kgf / n, limit: limit / n, speed: Math.hypot(s.vel.x, s.vel.z) };
}

describe('cornering with the fans armed (ticket 0020)', () => {
  for (const v of [30, 40]) {
    it(`pulls more than 2 g steady at ${v} m/s, and no more than the tyres carry at that load`, () => {
      const r = corner(v, 1);
      expect(Math.abs(r.speed - v)).toBeLessThan(1.5);
      expect(r.g, `${r.g.toFixed(2)} g with ${r.kgf.toFixed(0)} kgf`).toBeGreaterThanOrEqual(2.0);
      expect(r.g).toBeLessThanOrEqual(r.limit);
      expect(r.kgf * G).toBeGreaterThanOrEqual(SPEC.fanIdleForce * 0.9);
      expect(r.kgf * G).toBeLessThanOrEqual(SPEC.fanMaxForce);
    });
  }
  it('gentle steering stays on the tyres: the fan idles below μ·g', () => {
    const s = createVehicle('lineup'); s.pos.x = 30;
    const inp = newInput();
    for (let i = 0; i < 480; i++) step(s, inp);
    inp.fan = 1;
    while (Math.hypot(s.vel.x, s.vel.z) < 30) { inp.throttle = 1; step(s, inp); }
    inp.throttle = 0.4; inp.steer = 0.2;
    for (let i = 0; i < 240 * 3; i++) step(s, inp);
    expect(s.fanForce / G).toBeLessThanOrEqual(250);
  });
  it('falls back to idle within fanHold of the stick centring', () => {
    const r = corner(30, 1), { s, inp } = r;
    expect(s.fanForce / G).toBeGreaterThan(3000);
    inp.steer = 0; inp.throttle = 0.3;
    for (let t = 0; t < SPEC.fanHold; t += DT) step(s, inp);
    expect(s.fanForce / G).toBeLessThanOrEqual(250);
  });
  it('disarmed, the corner is the tyres alone', () => {
    const r = corner(30, 0);
    expect(r.kgf).toBe(0);
    expect(r.g).toBeGreaterThan(1.0);
    expect(r.g).toBeLessThanOrEqual(SPEC.tyreMu0);
  });
});

// Ticket 0021: "typically 1.26 G's" on the tyres (OFFICIAL, a car-level number) through the
// tyre's load sensitivity and the car's own load transfer.
describe('cornering on the tyres alone (ticket 0021)', () => {
  for (const v of [20, 30, 40]) {
    it(`holds at least 1.20 g steady at ${v} m/s with the fans off`, () => {
      const r = corner(v, 0);
      expect(Math.abs(r.speed - v)).toBeLessThan(1.5);
      expect(r.g, `${r.g.toFixed(3)} g`).toBeGreaterThanOrEqual(1.20);
      expect(r.g).toBeLessThanOrEqual(SPEC.tyreMu0);
    });
  }
});
