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
// Lineup's row); a car LAND had stopped over the semi (ROOF_HOLD) fell off it with the jets out for
// up to 0.46 s (the critic's first bounce: every "lifted, pressed again" thumb). Measured per tick (a
// 0.25 s mean hid it), from the flight's peak sink to the wheels (LESSONS 2026-11-06: a boost off the
// ledge reads ≥ 1.5 g mid free fall): no span ≥ 0.08 s under 0.5 g while sinking > 1 m/s.
function burn(run, step, release) {
  const g = [], sink = [], h = [];
  while (run.phase !== 'done') {
    const c = run.car, vx = c.vel.x, vy = c.vel.y, vz = c.vel.z;
    step();
    g.push(Math.hypot((c.vel.x - vx) * 240, (c.vel.y - vy) * 240 + 9.81, (c.vel.z - vz) * 240) / 9.81);
    sink.push(-c.vel.y); h.push(c.pos.y - SPEC.comHeight);
  }
  const end = run.t.touchTick > 0 ? run.t.touchTick : run.tick, r0 = release();
  let peak = Math.max(0, r0);
  for (let i = peak; i < end; i++) if (sink[i] > sink[peak]) peak = i;
  // The longest jets-off span, how far the sink rises again above its lowest since the peak (above
  // 1.2 m: below it the computer levels the car before the wheels), and whether LAND slowed the car under
  // 4 m/s more than 4.5 m up: over the ground its profile wants more than that there, so only the semi's
  // 4.1 m roof does it (ROOF_HOLD), and the most it sinks from then on.
  let gap = 0, cur = 0, rise = 0, low = Infinity, held = false, after = 0;
  for (let i = peak; i < end; i++) {
    if (sink[i] < 4 && h[i] > 4.5) held = true;
    if (held) after = Math.max(after, sink[i]);
    cur = g[i] < 0.5 && sink[i] > 1 ? cur + 1 : 0;
    gap = Math.max(gap, cur);
    if (h[i] > 1.2) { low = Math.min(low, sink[i]); rise = Math.max(rise, sink[i] - low); }
  }
  return { peak, gap: gap / 240, rise, held, after, t: run.t, release: r0 };
}
// The one-thumb Show (thumb-mastery.test.js's thumb): on the ledge 0.5 s, tap. Held from the tap, or
// (`again` s) lifted within 0.1 s and pressed again that long after the tap; the pad slid `x` px sideways.
function thumbBurn(x, again = -1) {
  const run = createRun('show'), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1, release = -1;
  th.down();
  return burn(run, () => {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (again >= 0 && tapT >= 0) {
      if (run.tick === tapT + 20) th.up();
      if (run.tick === tapT + Math.round(again * 240)) th.down();
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
// Every flight: the jets never out mid-brake, not on the row, not crashed. A flight LAND never slowed
// over the semi: the sink only falls. One it did (it came over the 4.1 m roof too low and too slow to pass
// it: from 12 m at 15 m/s with 7 m/s along the run, the stop reaches ROOF_HOLD before the roof ends): it
// comes down off the roof on the jets (the same no-gap rule), the sink opening up to LAND_CAP_MIN (4 m/s)
// and no more, and lands soft enough. (A sink held under 0.5 m/s from 5.3 m would take ≈8 s on the jets,
// and the ≈75 kg left at the stop lasts ≈2 s of hover.)
function oneBurn(b, label) {
  expect(b.peak, label).toBeGreaterThan(b.release);
  expect(b.gap, label).toBeLessThan(0.08);
  if (!b.held) expect(b.rise, label).toBeLessThanOrEqual(0.5);
  else expect(b.after, label).toBeLessThanOrEqual(4.5);
  expect(b.t.contact, label).toBe(false);
  expect(b.t.sink, label).toBeLessThanOrEqual(2.2);
  expect(scoreRun(b.t).facts.crashed, label).toBe(false);
}

describe('one burn from the onset to the wheels (0169)', () => {
  const SLIDES = [-24, -12, 0];
  for (let x = 8; x <= 48; x += 4) SLIDES.push(x);

  it('the one-thumb Show held from the tap: the down-jets never go out mid-brake, at any held sideways slide', () => {
    for (const x of SLIDES) {
      const b = thumbBurn(x);
      oneBurn(b, `${x} px`);
      // Up to +24 px the car passes the semi in one burn; from +28 it comes over the semi's roof slow and low.
      if (x <= 24) expect(b.held, `${x} px`).toBe(false);
    }
  }, 180000);

  it('lifted after the tap and pressed again: the jets never go out, off the semi too', () => {
    for (const again of [1, 1.5, 2, 2.5]) for (const x of [-24, 0, 24]) oneBurn(thumbBurn(x, again), `again ${again} s, ${x} px`);
  }, 180000);

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
      oneBurn(b, course);
      expect(b.held, course).toBe(false);
      expect(b.t.sink, course).toBeLessThanOrEqual(1.5);
    }
  }, 60000);
});
