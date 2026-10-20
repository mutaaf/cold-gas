// The fan, scheduled like the livestream's DOWNFORCE channel (SIM_VERSION 12, ticket 0012): the
// controller asks for the suction the deck's tilt needs, spools to it in ≈1.5 s, holds the car
// hanging inverted, and idles on the level. Telemetry: docs/REVEAL_RESEARCH.md §2.1.2.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { createVehicle, step, newInput, up, G, DT } from '../../src/sim/vehicle.js';
import { DRILLS, buildDrill } from '../../src/practice.js';

const TELEMETRY = [[25, 434], [50, 825], [75, 1544], [90, 3300], [127, 4510], [170, 4700]];   // pitch°, kgf
const pitchOf = (c, u) => Math.acos(Math.max(-1, Math.min(1, up(c, u).y))) * 180 / Math.PI;

describe('fan suction follows the attitude (SIM_VERSION 12)', () => {
  it('the reference Wall climb reads within ±30 % of the telemetry at each pitch', () => {
    const run = createRun('wall'), ap = createAutopilot('wall'), u = {}, got = [];
    while (run.phase !== 'done' && got.length < TELEMETRY.length) {
      stepRun(run, ap(run));
      if (run.phase === 'ramp' && pitchOf(run.car, u) >= TELEMETRY[got.length][0]) got.push(run.car.fanForce / G);
    }
    expect(got.length).toBe(TELEMETRY.length);
    TELEMETRY.forEach(([pitch, kgf], i) => {
      expect(got[i], `${pitch}°: ${got[i].toFixed(0)} kgf vs ${kgf}`).toBeGreaterThan(kgf * 0.7);
      expect(got[i], `${pitch}°: ${got[i].toFixed(0)} kgf vs ${kgf}`).toBeLessThan(kgf * 1.3);
    });
  });
  it('idles on the level: armed and stopped, ≤ 250 kgf (telemetry 79–186 kgf on the pad)', () => {
    const s = createVehicle('lineup'); s.pos.x = 30;
    const inp = { ...newInput(), fan: 1, brake: 1 };
    for (let i = 0; i < 240 * 5; i++) step(s, inp);
    expect(s.fanForce / G).toBeGreaterThan(50);
    expect(s.fanForce / G).toBeLessThanOrEqual(250);
  });
  it('spools to 90 % of its demand in 1–3 s (telemetry 1.5 s)', () => {
    const s = createVehicle('lineup'); s.pos.x = 30;
    for (let i = 0; i < 480; i++) step(s, newInput());
    const inp = { ...newInput(), fan: 1, brake: 1 };
    step(s, inp);
    let t = DT;
    for (; t < 5 && s.fan < 0.9 * s.fanDemand; t += DT) step(s, inp);
    expect(t).toBeGreaterThan(1.0); expect(t).toBeLessThan(3.0);
  });
  it('fills the grip void at a launch: full throttle from rest asks for the cap', () => {
    const s = createVehicle('lineup'); s.pos.x = 30;
    for (let i = 0; i < 480; i++) step(s, newInput());
    const inp = { ...newInput(), fan: 1, throttle: 1 };
    for (let i = 0; i < 240 * 2.5; i++) step(s, inp);
    expect(s.fanForce / G).toBeGreaterThan(3000);
  });
  it('holds the car stopped, hanging inverted on the ledge, for 10 s (run 1 hung ≈10 s)', () => {
    for (const course of ['wall', 'show']) {
      const { run } = buildDrill(DRILLS.find((d) => d.id === 'ledge'), course);
      const u = {}, p0 = { ...run.car.pos };
      const inp = { ...newInput(), fan: 1, brake: 1, assist: 1 };
      // The car itself, not the run (a run calls a 6 s stop a stall and ends).
      const c = run.car;
      for (let i = 0; i < 240 * 10; i++) step(c, inp);
      expect(c.grounded).toBe(4);
      expect(up(c, u).y).toBeLessThan(-0.9);
      expect(Math.hypot(c.pos.x - p0.x, c.pos.y - p0.y, c.pos.z - p0.z)).toBeLessThan(0.5);
      expect(c.fanForce / G).toBeGreaterThan(4500);   // telemetry: 4,697–4,700 kgf hanging
    }
  });
});
