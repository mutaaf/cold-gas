// The reveal's G-FORCE trace (SIM_VERSION 14, ticket 0013). Run 2 off the Wall, TELEMETRY at 2 Hz
// (docs/REVEAL_RESEARCH.md §2.1.4): 0.2 G at release and 0.3–0.4 G for the first second (the car
// falls almost free while the side jets roll it), then 1.7 → 3.3 G peak at ≈6.5 m, and wheels down
// 4.5 s after release. Specific force is |Δv/Δt − g|/g, averaged like the livestream reads it
// (LESSONS: compare G like the livestream reads it).
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { newInput, LIFT_MAX, massOf, G } from '../../src/sim/vehicle.js';
import { DRILLS, buildDrill } from '../../src/practice.js';
import { SPEC, NOZZLE_SPEC } from '../../src/sim/spec.js';

// Fly a reference and record the specific force (g) every tick, and the release: the tick the
// pilot disarms the fan off the deck.
function trace(course) {
  const run = createRun(course), ap = createAutopilot(course);
  const g = [];
  let release = -1;
  while (run.phase !== 'done') {
    const inp = ap(run);
    if (release < 0 && run.phase !== 'drive' && inp.fan === 0) release = run.tick;
    const c = run.car, vx = c.vel.x, vy = c.vel.y, vz = c.vel.z;
    stepRun(run, inp);
    g.push(Math.hypot((c.vel.x - vx) * 240, (c.vel.y - vy) * 240 + 9.81, (c.vel.z - vz) * 240) / 9.81);
  }
  const mean = (a, b) => g.slice(a, b).reduce((s, x) => s + x, 0) / (b - a);
  return { run, g, release, mean };
}

describe('the reveal G trace', () => {
  const wall = trace('wall'), show = trace('show');

  it('falls nearly free off the lip: ≤ 0.6 G over the first second (telemetry 0.2–0.4 G)', () => {
    for (const { release, mean } of [wall, show]) {
      expect(release).toBeGreaterThan(0);
      expect(mean(release, release + 240)).toBeLessThanOrEqual(0.6);
    }
  });

  it('brakes late and hard: a 2.8–3.6 G peak (0.5 s average) below 10 m (telemetry 3.3 G at 6.5 m)', () => {
    const t = wall.run.t;
    expect(t.brakePeakG).toBeGreaterThanOrEqual(2.8);
    expect(t.brakePeakG).toBeLessThanOrEqual(3.6);
    expect(t.brakePeakH).toBeLessThan(10);
    // The same number from the raw trace: the strongest 0.5 s after the roll-out.
    let peak = 0;
    for (let i = wall.release + 240; i + 120 <= t.touchTick; i++) peak = Math.max(peak, wall.mean(i, i + 120));
    expect(peak).toBeCloseTo(t.brakePeakG, 1);
  });

  it('lands 4.0–5.0 s after release (telemetry 4.5 s), soft', () => {
    const s = (wall.run.t.touchTick - wall.release) / 240;
    expect(s).toBeGreaterThanOrEqual(4.0);
    expect(s).toBeLessThanOrEqual(5.0);
    expect(wall.run.t.sink).toBeLessThanOrEqual(1.5);
    // The Show brakes over the row against the roofs (LAND's altimeter), so it hangs a little longer.
    expect((show.run.t.touchTick - show.release) / 240).toBeLessThan(6);
    expect(show.run.t.sink).toBeLessThanOrEqual(1.5);
    expect(show.run.t.contact).toBe(false);
  });

  it('the down-jets can make the reveal\'s peak: 76.5 kN pitch-free, 3.2 G full (research §11.5)', () => {
    const lift = NOZZLE_SPEC.filter((n) => n.group === 'lift');
    // Pitch-free: the front pair's moment matches the rear pair's at the trim.
    expect(LIFT_MAX).toBeGreaterThan(76000);
    expect(LIFT_MAX / ((SPEC.dryMass + SPEC.gasMass) * G)).toBeGreaterThan(3.1);
    expect(lift.reduce((a, n) => a + n.max, 0)).toBeLessThanOrEqual(80000);   // the rear row's class
    expect(massOf(wall.run.car)).toBeLessThan(SPEC.dryMass + SPEC.gasMass);
  });
});

describe('brakePeakG on the results chip', () => {
  it('is the braking peak, not the release kick', () => {
    const { run } = trace('wall');
    const card = scoreRun(run.t);
    expect(card.facts.brakeG).toBe(Math.round(run.t.brakePeakG * 10) / 10);
    expect(card.facts.brakeH).toBeLessThan(10);
  });
  it('a carry burn at the release is a maxG spike, never the braking peak', () => {
    // Pro off the ledge: the rear jets at full the moment it lets go (3.3 G along the run), then
    // LAND. maxG catches the kick at 27 m; brakePeakG only counts the roof-up stop.
    const { run } = buildDrill(DRILLS.find((d) => d.id === 'release'), 'show');
    const t0 = run.tick;
    while (run.phase !== 'done') {
      const t = (run.tick - t0) / 240, inp = newInput();
      if (t < 0.25) { inp.assist = 0; inp.thrust = 1; } else inp.level = 1;
      stepRun(run, inp);
    }
    expect(run.t.maxG).toBeGreaterThan(3);
    expect(run.t.brakePeakG).toBeGreaterThan(1.5);
    expect(run.t.brakePeakH).toBeLessThan(15);
    expect(run.t.brakePeakG).toBeLessThan(run.t.maxG);
  });
});
