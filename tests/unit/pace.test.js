import { describe, it, expect } from 'vitest';
import { createPacer, TITLE_FPS } from '../../src/pace.js';

// Count the frames a pacer draws over `secs` of a display at `hz`, with rAF's timestamps jittered by up to ±j ms.
function drawn(hz, secs = 10, j = 0) {
  const p = createPacer();
  let n = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < hz * secs; i++) if (p.due((i * 1000) / hz + rnd() * j)) n++;
  return n / secs;
}

describe('the title pacer (0049)', () => {
  it('draws the idle title at no more than ~30 fps on any display', () => {
    for (const hz of [60, 75, 90, 120, 144, 165, 240]) {
      const fps = drawn(hz);
      expect(fps, `${hz} Hz`).toBeLessThanOrEqual(31);
      expect(fps, `${hz} Hz`).toBeGreaterThanOrEqual(24);
    }
    expect(TITLE_FPS).toBe(30);
  });
  it('keeps 30 fps through rAF jitter, and never skips on a 30 Hz display', () => {
    expect(drawn(60, 10, 1.5)).toBeCloseTo(30, 0);
    expect(drawn(120, 10, 1.5)).toBeCloseTo(30, 0);
    expect(drawn(30, 10, 1.5)).toBeCloseTo(30, 0);
    expect(drawn(24)).toBeCloseTo(24, 0);
  });
  it('draws the first frame, and the next one after a reset', () => {
    const p = createPacer();
    expect(p.due(1000)).toBe(true);
    expect(p.due(1008)).toBe(false);
    p.reset();
    expect(p.due(1016)).toBe(true);
  });
  it('a clock that goes backwards (a new timeline) draws at once', () => {
    const p = createPacer();
    p.due(5000);
    expect(p.due(10)).toBe(true);
  });
});
