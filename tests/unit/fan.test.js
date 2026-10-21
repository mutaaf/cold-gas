// The fan, scheduled like the livestream's DOWNFORCE channel (SIM_VERSION 13, ticket 0012): the
// controller asks for the suction the deck's tilt needs, spools to it in ≈1.5 s, holds the car
// hanging inverted, and idles on the level. Telemetry: docs/REVEAL_RESEARCH.md §2.1.2.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, wallProgress } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { createVehicle, step, newInput, up, G, DT } from '../../src/sim/vehicle.js';
import { DRILLS, buildDrill } from '../../src/practice.js';
import { scoreRun } from '../../src/sim/judge.js';

const TELEMETRY = [[25, 434], [50, 825], [75, 1544], [90, 3300], [127, 4510], [170, 4700]];   // pitch°, kgf
const pitchOf = (c, u) => Math.acos(Math.max(-1, Math.min(1, up(c, u).y))) * 180 / Math.PI;

describe('fan suction follows the attitude (SIM_VERSION 13)', () => {
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
    for (let i = 0; i < 240 * 1.2; i++) step(s, inp);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThan(22);   // below 50 mph: the void
    expect(s.fanForce / G).toBeGreaterThan(3000);
  });
  it('floored up the curl, the fan gives the climb its grip: the car reaches the ledge', () => {
    // The telemetry is the reveal's crawl; a player who holds full throttle asks for every newton
    // of grip, and the attitude law alone would let the rears spin it to a stall.
    const run = createRun('wall'), ap = createAutopilot('wall'), u = {};
    let at50 = 0;
    while (run.phase === 'drive' || run.phase === 'ramp') {
      const inp = ap(run);
      if (run.car.pos.z > -40 && run.phase !== 'air' && wallProgress(run.car.pos) < 0.97) inp.throttle = 1;
      stepRun(run, inp);
      if (!at50 && run.phase === 'ramp' && pitchOf(run.car, u) >= 50) at50 = run.car.fanForce / G;
      if (wallProgress(run.car.pos) >= 0.97) break;
    }
    expect(wallProgress(run.car.pos)).toBeGreaterThanOrEqual(0.97);
    expect(at50).toBeGreaterThan(3000);
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

// Run 1 starts parked at the foot of the curl, fans idle (SIM_VERSION 19, ticket 0019): the fans
// spool at rest (t 8: 79 kgf), the car rolls (t 9: 186 kgf) and is on the curl by t 10–11 (434 kgf
// at 25.5°): ≈ 3 s from rest to 25° of pitch (docs/REVEAL_RESEARCH.md §2.1.2, TELEMETRY 1 Hz).
describe('the Wall starts at the foot of the curl, like run 1', () => {
  it('spools at rest, rolls onto the curl and reaches 25° of pitch 2.5–5 s after the first tick', () => {
    const run = createRun('wall'), ap = createAutopilot('wall'), u = {};
    let arm = -1, f1 = -1, t25 = -1, f25 = 0;
    while (run.phase !== 'done' && t25 < 0) {
      const inp = ap(run);
      if (arm < 0 && inp.fan) arm = run.tick;
      stepRun(run, inp);
      if (arm >= 0 && f1 < 0 && run.tick - arm >= 240) f1 = run.car.fanForce / G;
      if (run.phase === 'ramp' && pitchOf(run.car, u) >= 25) { t25 = run.tick / 240; f25 = run.car.fanForce / G; }
    }
    expect(arm).toBe(0);                                      // armed at rest, on the first tick
    expect(f1, `+1 s: ${f1.toFixed(0)} kgf`).toBeGreaterThanOrEqual(50);    // telemetry 186 kgf at t 9
    expect(f1, `+1 s: ${f1.toFixed(0)} kgf`).toBeLessThanOrEqual(250);
    expect(t25).toBeGreaterThanOrEqual(2.5);
    expect(t25).toBeLessThanOrEqual(5);
    expect(f25, `25°: ${f25.toFixed(0)} kgf`).toBeGreaterThanOrEqual(300);  // telemetry 434 kgf
    expect(f25, `25°: ${f25.toFixed(0)} kgf`).toBeLessThanOrEqual(600);
  });
  it('the whole reference run, start to settled, takes ≤ 22 s and still scores 96 ± 3', () => {
    const run = createRun('wall'), ap = createAutopilot('wall');
    while (run.phase !== 'done') stepRun(run, ap(run));
    expect(run.t.endReason).toBe('settled');
    expect(run.tick / 240).toBeLessThanOrEqual(22);
    const s = scoreRun(run.t);
    expect(s.total).toBeGreaterThanOrEqual(93);
    expect(s.total).toBeLessThanOrEqual(99);
  });
});
