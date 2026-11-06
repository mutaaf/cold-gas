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
import { createOneThumb, thumbStage } from '../../src/onethumb.js';

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

// 0169: one burn from the onset to the wheels. The reveal's down-jets never go out between the
// onset and the touchdown (1.7 → 3.3 G at ≈6.5 m → 1.0 G → a 1.4 G flare). Past the row's last roof
// LAND's altimeter used to drop 3–4 m in a tick, the ground's profile wanted twice the sink the car
// had, and the jets went out for 0.2–0.3 s at ≈6 m on the one-thumb Show (and at the end of the
// Lineup's row). Measured per tick (a 0.25 s mean hid it): from the brake's onset to touchdown,
// where the onset is ≥ 1.5 g held 0.1 s while sinking > 5 m/s (the ticket's "first tick at 1.5 g"
// would start at the roll-out's or a slide's kick, mid free fall), no span ≥ 0.08 s under 0.5 g while sinking > 2 m/s.
function burn(run, step, release) {
  const g = [], sink = [], h = [];
  while (run.phase !== 'done') {
    const c = run.car, vx = c.vel.x, vy = c.vel.y, vz = c.vel.z;
    step();
    g.push(Math.hypot((c.vel.x - vx) * 240, (c.vel.y - vy) * 240 + 9.81, (c.vel.z - vz) * 240) / 9.81);
    sink.push(-c.vel.y); h.push(c.pos.y - SPEC.comHeight);
  }
  const end = run.t.touchTick > 0 ? run.t.touchTick : run.tick, r0 = release();
  let onset = -1;
  for (let i = r0; i < end && onset < 0; i++) if (sink[i] > 5 && g.slice(i, i + 24).every((x) => x >= 1.5)) onset = i;
  // The longest jets-off span while sinking > 2 m/s, and how far the sink rises again once the brake
  // has slowed it below 9 m/s (above 1.2 m: below it the computer levels the car before the wheels).
  let gap = 0, cur = 0, rise = 0, low = Infinity, slowed = false, held = false;
  for (let i = Math.max(0, onset); onset >= 0 && i < end; i++) {
    if (sink[i] < 1 && h[i] > 3) held = true;   // stopped over a roof (LAND's ROOF_HOLD)
    cur = g[i] < 0.5 && sink[i] > 2 ? cur + 1 : 0;
    gap = Math.max(gap, cur);
    if (sink[i] < 9) slowed = true;
    if (slowed && h[i] > 1.2) { low = Math.min(low, sink[i]); rise = Math.max(rise, sink[i] - low); }
  }
  return { onset, gap: gap / 240, rise, held, t: run.t, release: r0 };
}
// The one-thumb Show held from the tap (thumb-mastery.test.js's thumb), the pad slid `x` px sideways.
function thumbBurn(x) {
  const run = createRun('show'), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1, release = -1;
  th.down();
  return burn(run, () => {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (x && released && run.phase === 'air' && th.held) th.move(x, 0);
    th.sample(run, released, inp);
    if (!released && ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air')) { released = true; release = run.tick; }
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }, () => release);
}
function refBurn(course) {
  const run = createRun(course), ap = createAutopilot(course);
  let release = -1;
  return burn(run, () => {
    const inp = ap(run);
    if (release < 0 && run.phase !== 'drive' && inp.fan === 0) release = run.tick;
    stepRun(run, inp);
  }, () => release);
}

describe('one burn from the onset to the wheels (0169)', () => {
  const SLIDES = [-24, -12, 0];
  for (let x = 8; x <= 28; x += 4) SLIDES.push(x);

  it('the one-thumb Show: the down-jets never go out mid-brake, and the sink only falls, at any held sideways slide', () => {
    for (const x of SLIDES) {
      const b = thumbBurn(x);
      expect(b.onset, `${x} px`).toBeGreaterThan(b.release);
      expect(b.gap, `${x} px`).toBeLessThan(0.08);
      expect(b.rise, `${x} px`).toBeLessThanOrEqual(0.5);
      expect(b.held, `${x} px`).toBe(false);
      expect(b.t.contact, `${x} px`).toBe(false);
      expect(scoreRun(b.t).facts.crashed, `${x} px`).toBe(false);
    }
  }, 120000);

  it('a slide that carries the car over the semi too low to pass it: LAND stops it above the roof, then lands it clear', () => {
    // From +32 px the car comes over the semi's 4.1 m roof lower than any brake to the ground could pass:
    // LAND holds it ROOF_HOLD above the roof (as before 0169) and goes down again from there. Not on
    // the row, never crashed.
    for (let x = 32; x <= 48; x += 4) {
      const b = thumbBurn(x);
      expect(b.held, `${x} px`).toBe(true);
      expect(b.t.contact, `${x} px`).toBe(false);
      expect(b.t.sink, `${x} px`).toBeLessThanOrEqual(1.5);
      expect(scoreRun(b.t).facts.crashed, `${x} px`).toBe(false);
    }
  }, 120000);

  it('held from the tap, no slide: soft, on time, the gas as before', () => {
    const b = thumbBurn(0), s = scoreRun(b.t);
    expect(b.t.sink).toBeLessThanOrEqual(1.3);
    const secs = (b.t.touchTick - b.release) / 240;
    expect(secs).toBeGreaterThanOrEqual(4.0);
    expect(secs).toBeLessThanOrEqual(5.5);
    // 33.6 % of the tanks at the wheels before 0169; within 3 points of it.
    expect(Math.abs((100 * b.t.airAtTouch) / SPEC.gasMass - 33.6)).toBeLessThanOrEqual(3);
    expect(s.facts.crashed).toBe(false);
  }, 60000);

  it('the Show, Wall and Lineup references brake in one pulse, off no roof', () => {
    for (const course of ['show', 'wall', 'lineup']) {
      const b = refBurn(course);
      expect(b.onset, course).toBeGreaterThan(0);
      expect(b.gap, course).toBeLessThan(0.08);
      expect(b.rise, course).toBeLessThanOrEqual(0.5);
      expect(b.t.contact, course).toBe(false);
      expect(b.t.sink, course).toBeLessThanOrEqual(1.5);
    }
  }, 60000);
});
