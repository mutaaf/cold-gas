// 0363: on the Lineup, Assist's run-up is the kickflip's speed. A held ↑ (keys, RT, the touch GO) eases off at
// LINEUP.runUp (REVEAL.lineup.speed, 7.5 m/s; docs/REVEAL_RESEARCH.md §2.2: ≈ 7–9 m/s, row 48), so "Hold ↑ to go" then
// "Space at the line", followed to the letter, lifts off at the reveal's speed instead of running into the row at 32 m/s.
// Pro keeps the full throttle. A run from before the limit (v33, v32) replays on the course as it was.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate, simVersionOf, replayable, courseAt, RUNUP_VERSION, SURFACE_VERSION, SIM_VERSION, MARK_VERSION } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { COURSES } from '../../src/sim/courses.js';
import { REVEAL } from '../../src/sim/autopilot.js';
import { coach } from '../../src/sim/coach.js';

const hyp = (c) => Math.hypot(c.vel.x, c.vel.z);

// ↑ held from the start; the speed as the car's centre crosses z (the line's lift-off marker is z 0).
function speedAt(z, { assist = 1, v } = {}) {
  const run = createRun('lineup', v);
  while (run.car.pos.z < z && run.tick < 240 * 30) {
    const inp = newInput(); inp.assist = assist; inp.throttle = 1;
    inp.steer = Math.max(-1, Math.min(1, run.car.pos.x * 0.25));
    stepRun(run, inp);
  }
  return hyp(run.car);
}

// The critic's sweep (docs/critique/2026-11-23-2136/lineup-floored.mjs.txt): ↑ held to the press at z `press`, Space
// `lift` s (↑ released), ← 0.8 s from the first air tick, then Shift to the ground.
function floored(press, lift, assist = 1) {
  const run = createRun('lineup'); let tL = null, tR = null;
  while (run.phase !== 'done' && run.tick < 240 * 40) {
    const c = run.car, inp = newInput(); inp.assist = assist; const now = run.tick / 240;
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    if (tL === null && c.pos.z >= press) tL = now;
    if (tL === null) inp.throttle = 1;
    else if (now - tL < lift) inp.lift = 1;
    else if (run.phase === 'air') { if (tR === null) tR = now; if (now - tR < 0.8) inp.roll = -1; else inp.level = 1; }
    else inp.brake = 1;
    stepRun(run, inp);
  }
  const card = scoreRun(run.t, { assist: !!assist });
  return { run, card, landed: run.t.settledUpright && run.t.touchTick > 0 && card.verdict !== 'Wrecked' };
}

describe('0363: Assist runs up to the Lineup at the kickflip\'s speed', () => {
  it('the limit is the reference\'s run-up speed, as course data', () => {
    expect(COURSES.lineup.runUp).toBe(REVEAL.lineup.speed);
    expect(COURSES.show.runUp).toBeUndefined();
    expect(COURSES.wall.runUp).toBeUndefined();
  });

  it('↑ held from the start reaches the line at 7–9 m/s (§2.2)', () => {
    for (const z of [-14, -4, 0]) {
      const v = speedAt(z);
      expect(v).toBeGreaterThanOrEqual(7);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('Pro keeps the full throttle: > 25 m/s at the line', () => {
    expect(speedAt(0, { assist: 0 })).toBeGreaterThan(25);
  });

  it('a run flown before the limit replays as it was: ↑ held is fast again at v33', () => {
    expect(speedAt(0, { v: SURFACE_VERSION })).toBeGreaterThan(25);
    expect(speedAt(0, { v: SIM_VERSION })).toBeGreaterThan(25);
  });

  it('every press at z −6…+1 held 0.4 s, then ← and Shift, clears the row and lands upright, unwrecked', () => {
    const misses = [];
    for (const press of [-6, -5, -4, -3, -2, -1, 0, 1]) {
      const { run, card, landed } = floored(press, 0.4);
      if (!landed || run.t.contact) misses.push({ press, verdict: card.verdict, end: run.t.endReason });
    }
    expect(misses).toEqual([]);
  });

  it('Pro floored at the line still meets the row, and the coach still says to ease off, with the band', () => {
    const { run, card } = floored(0, 0.4, 0);
    expect(run.t.contact).toBe(true);
    card.tier = 'pro';
    const c = coach(run.inputLog, 'lineup', card), kmh = Math.round(c.flight.lineSpeed * 3.6);
    expect(kmh).toBeGreaterThan(90);
    expect(c.items[0].fix).toContain(`Ease off ↑ before the line: between 25 km/h and 30 km/h, not ${kmh} km/h.`);
  });

  it('the Lineup is RUNUP_VERSION; the Show and the Wall are untouched', () => {
    expect(RUNUP_VERSION).toBeGreaterThan(MARK_VERSION);
    expect(simVersionOf('lineup')).toBe(RUNUP_VERSION);
    expect(simVersionOf('show')).toBe(MARK_VERSION);
    expect(simVersionOf('wall')).toBe(MARK_VERSION);
    expect(replayable('lineup', RUNUP_VERSION) && replayable('lineup', SURFACE_VERSION) && replayable('lineup', SIM_VERSION)).toBe(true);
    expect(replayable('lineup', MARK_VERSION)).toBe(false);   // no v34 Lineup run ever shipped
    expect(courseAt('lineup', SURFACE_VERSION).runUp).toBeUndefined();
    expect(courseAt('lineup', SURFACE_VERSION).surfaces).toBe(COURSES.lineup.surfaces);
    expect(courseAt('lineup', SIM_VERSION).surfaces).toBeFalsy();
    expect(courseAt('lineup').runUp).toBe(REVEAL.lineup.speed);
  });

  it('a v33 log replays to the same bits on the v33 course (simulate with the version)', () => {
    const a = createRun('lineup', SURFACE_VERSION);
    while (a.phase !== 'done' && a.tick < 240 * 8) { const i = newInput(); i.assist = 1; i.throttle = a.tick < 240 * 3 ? 1 : 0; i.brake = a.tick >= 240 * 3 ? 1 : 0; stepRun(a, i); }
    const b = simulate(a.inputLog, 'lineup', a.tick, null, SURFACE_VERSION);
    expect(b.car.pos.z).toBe(a.car.pos.z);
    expect(b.t.maxSpeed).toBe(a.t.maxSpeed);
  });
});
