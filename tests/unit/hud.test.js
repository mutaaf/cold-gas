// The HUD's telemetry, read like the livestream's channels (ticket 0018, docs/REVEAL_RESEARCH.md
// §2.1.2, §2.1.4): PITCH along the deck (170° at the hang), G as the same 0.5 s window of specific
// force the results chip uses (`brakePeakG`), and the N₂ gauge in kg and tank bar with the
// regulator's state.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { CAR, feedPressure } from '../../src/sim/vehicle.js';
import { hudPitch, createGWindow, tankBar, gasState } from '../../src/hud-telemetry.js';

// Fly the Wall reference and record what the HUD would show every tick.
function fly(course) {
  const run = createRun(course), ap = createAutopilot(course);
  const ticks = [], gw = createGWindow();
  let peakAt = -1, peak = 0;
  while (run.phase !== 'done') {
    stepRun(run, ap(run));
    const c = run.car;
    gw.push(c.vel);
    if (run.t.brakePeakG > peak) { peak = run.t.brakePeakG; peakAt = ticks.length; }
    ticks.push({
      phase: run.phase, progress: run.t.progress ?? 0, speed: Math.hypot(c.vel.x, c.vel.y, c.vel.z), fy: c.vel.y,
      pitch: hudPitch(c.quat, run.phase === 'ramp'), g: gw.read(), air: c.air, state: gasState(c.air), feed: feedPressure(c),
    });
  }
  return { run, ticks, peakAt };
}

describe('HUD telemetry (0018)', () => {
  const wall = fly('wall');
  const ramp = wall.ticks.filter((k) => k.phase === 'ramp');

  it('PITCH reads the deck: 165–175° at the hang (telemetry 170°), 88–92° on the vertical', () => {
    // The hang: the car slowed to a crawl at the top of the curl, before it lets go.
    const hang = ramp.filter((k) => k.progress > 0.88 && k.speed < 3);
    expect(hang.length).toBeGreaterThan(240);
    for (const k of hang) { expect(k.pitch).toBeGreaterThanOrEqual(165); expect(k.pitch).toBeLessThanOrEqual(175); }
    // The vertical: where the deck reading crosses 90°, its neighbours a tick either side stay in band.
    const i = ramp.findIndex((k) => k.pitch >= 90);
    expect(i).toBeGreaterThan(0);
    for (const k of ramp.slice(i - 1, i + 2)) { expect(k.pitch).toBeGreaterThanOrEqual(88); expect(k.pitch).toBeLessThanOrEqual(92); }
    // Up the curl the reading only climbs (no wrap past 180 into negatives on the way up).
    const climb = ramp.filter((k) => k.progress < 0.85);
    for (let j = 1; j < climb.length; j++) expect(climb[j].pitch).toBeGreaterThan(climb[j - 1].pitch - 0.5);
  });

  it('in the air PITCH is the signed nose angle from level: level (±15°) at touchdown', () => {
    const air = wall.ticks.filter((k) => k.phase === 'air');
    expect(air.length).toBeGreaterThan(0);
    expect(Math.abs(air[air.length - 1].pitch)).toBeLessThanOrEqual(15);
    for (const k of air) { expect(k.pitch).toBeGreaterThanOrEqual(-90); expect(k.pitch).toBeLessThanOrEqual(90); }
  });

  it('G is specific force over the 0.5 s window: within ±0.15 of brakePeakG at its peak, 1 G cruising', () => {
    expect(wall.run.t.brakePeakG).toBeGreaterThan(2);
    expect(Math.abs(wall.ticks[wall.peakAt].g - wall.run.t.brakePeakG)).toBeLessThanOrEqual(0.15);
    // Rolling steadily along the approach (10 s in) it reads 1 G.
    expect(wall.ticks[2400].phase).toBe('drive');
    expect(wall.ticks[2400].g).toBeCloseTo(1, 1);
  });

  it('the N₂ gauge: 297 kg at 690 bar full, and bar = 690·(m/297)^1.375 within ±2 bar', () => {
    expect(CAR.airMass).toBe(297);
    expect(tankBar(297)).toBeCloseTo(690, 6);
    for (const m of [297, 250, 200, 150, 100, 50, 10]) expect(Math.abs(tankBar(m) - 690 * (m / 297) ** 1.375)).toBeLessThanOrEqual(2);
    expect(tankBar(0)).toBe(0);
    expect(tankBar(-1)).toBe(0);
  });

  it('REG while the feed holds line pressure, BLOWDOWN after: Wall set-down crosses at ≈160–195 kg', () => {
    for (const k of wall.ticks) expect(k.state).toBe(k.feed >= 1 ? 'reg' : 'blowdown');
    const first = wall.ticks.findIndex((k) => k.state === 'blowdown');
    expect(first).toBeGreaterThan(0);
    expect(wall.ticks[first].phase).toBe('air');
    expect(wall.ticks[first].air).toBeGreaterThanOrEqual(160);
    expect(wall.ticks[first].air).toBeLessThanOrEqual(195);
    expect(wall.ticks[0].state).toBe('reg');
  });
});
