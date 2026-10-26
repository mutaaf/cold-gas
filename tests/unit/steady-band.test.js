// A steady landing band (0047): the HUD's colour, word, ring and buzz follow `steadyStatus`, which
// enters a worse band at predict's thresholds, leaves it only once clear of them, and holds every
// change for BAND_HOLD s. Not scored: predict.js never changes a run.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { predict, newPrediction, newBand, steadyStatus, BAND_HOLD } from '../../src/sim/predict.js';
import { surface, COURSES } from '../../src/sim/courses.js';
import { SPEC } from '../../src/sim/spec.js';

// The reference flights, read as the HUD reads them: once a 60 Hz frame, height over the surface.
const sn = { x: 0, y: 0, z: 0 };
function bands(course) {
  const run = createRun(course), ap = createAutopilot(course), pr = newPrediction(), band = newBand();
  const raw = [], steady = [];
  while (run.phase !== 'done') {
    stepRun(run, ap(run));
    if (run.phase !== 'air' || run.tick % 4) continue;
    const c = run.car, d = surface(COURSES[course], c.pos.x, c.pos.y, c.pos.z, sn);
    predict(c, Math.max(0, (sn.y > 0.9 ? d : c.pos.y) - SPEC.comHeight), pr);
    raw.push(pr.status);
    steady.push(steadyStatus(band, pr, run.tick / 240));
  }
  return { raw, steady };
}
const changes = (list) => list.reduce((n, s, i) => n + (i > 0 && s !== list[i - 1] ? 1 : 0), 0);

describe('the landing band holds still (0047)', () => {
  for (const course of ['show', 'lineup', 'wall']) {
    it(`${course}: the reference landing changes band at most 6 times (it flapped before)`, () => {
      const { raw, steady } = bands(course);
      // (On SIM_VERSION 26's references the raw band changed 8 / 14 / 16 times: Show / Lineup / Wall.)
      expect(changes(steady)).toBeLessThanOrEqual(changes(raw));
      expect(changes(steady)).toBeLessThanOrEqual(6);
      // Every band the HUD shows lasts at least the hold (the first included).
      let run = 1;
      for (let i = 1; i < steady.length; i++) {
        if (steady[i] === steady[i - 1]) { run++; continue; }
        expect(run * 4 / 240).toBeGreaterThanOrEqual(BAND_HOLD - 1e-9);
        run = 1;
      }
    });
  }

  it('a one-frame excursion never shows, a held one does after BAND_HOLD, and stepping down needs clear numbers', () => {
    const band = newBand();
    const pr = { status: 'green', marginAhead: 2, touchSink: 0, sink: 2, profileSink: 8 };
    expect(steadyStatus(band, pr, 0)).toBe('green');
    pr.status = 'amber'; pr.marginAhead = -0.1;
    expect(steadyStatus(band, pr, 1 / 60)).toBe('green');
    pr.status = 'green'; pr.marginAhead = 0.1;
    expect(steadyStatus(band, pr, 2 / 60)).toBe('green');
    // Amber for longer than the hold: amber.
    pr.status = 'amber'; pr.marginAhead = -0.2;
    for (let f = 3; f <= 13; f++) steadyStatus(band, pr, f / 60);
    expect(band.status).toBe('amber');
    // Back to green, but only just over the edge: it stays amber however long that lasts.
    pr.status = 'green'; pr.marginAhead = 0.3;
    for (let f = 14; f <= 60; f++) steadyStatus(band, pr, f / 60);
    expect(band.status).toBe('amber');
    // Clear of it: green after the hold.
    pr.marginAhead = 1;
    expect(steadyStatus(band, pr, 61 / 60)).toBe('amber');
    for (let f = 62; f <= 72; f++) steadyStatus(band, pr, f / 60);
    expect(band.status).toBe('green');
    // A flap between two worse bands still warns: the hold isn't restarted, and the worst seen shows.
    const flap = newBand(), p2 = { status: 'green', marginAhead: 2, touchSink: 0, sink: 2, profileSink: 8 };
    steadyStatus(flap, p2, 0);
    let f = 1;
    for (; f <= 60 && flap.status === 'green'; f++) {
      p2.status = f % 2 ? 'amber' : 'red'; p2.touchSink = f % 2 ? 2 : 4; p2.marginAhead = -1;
      steadyStatus(flap, p2, f / 60);
    }
    expect(flap.status).toBe('red');
    expect(f / 60).toBeLessThanOrEqual(BAND_HOLD + 2 / 60 + 1e-9);
    // …and so does green ⇄ red (a tilt hovering where the roll-out starts to count).
    const gr = newBand(), p3 = { status: 'green', marginAhead: 2, touchSink: 0, sink: 2, profileSink: 8 };
    steadyStatus(gr, p3, 0);
    for (f = 1; f <= 60 && gr.status === 'green'; f++) {
      const red = f % 2 === 1;
      Object.assign(p3, red ? { status: 'red', touchSink: 4, marginAhead: -1 } : { status: 'green', touchSink: 0, marginAhead: 2 });
      steadyStatus(gr, p3, f / 60);
    }
    expect(gr.status).toBe('red');
    // A new flight (time runs backwards) takes the status at once.
    pr.status = 'red'; pr.touchSink = 5;
    expect(steadyStatus(band, pr, 0)).toBe('red');
  });
});
