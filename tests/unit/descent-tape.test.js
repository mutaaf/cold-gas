// Ticket 0055: the descent tape's BRAKE label never draws over the scale's labels ("0 ft", "100"); its tick
// stays where the stop has to start.
import { describe, it, expect } from 'vitest';
import { brakeLabelY } from '../../src/hud-landing.js';

// The tape's boxes at the full HUD's 11 px and the compact phone's 22 px (index.html: "100" at y 4, "0 ft"
// at y 144; a text box is ≈ 0.93 em above its baseline and 0.23 em below).
const geoAt = (em) => ({ asc: 0.93 * em, desc: 0.23 * em, topBottom: 4 + 0.23 * em, zeroTop: 144 - 0.93 * em });
const box = (y, g) => [y - g.asc, y + g.desc];

describe('brakeLabelY', () => {
  for (const em of [11, 16, 18, 22]) {
    const g = geoAt(em);
    it(`at ${em} units: over its tick in the tape's middle, clear of both scale labels everywhere`, () => {
      expect(brakeLabelY(70, g)).toBe(64);
      expect(brakeLabelY(100, g)).toBe(94);
      for (let tick = 0; tick <= 140; tick += 0.5) {
        const [t, b] = box(brakeLabelY(tick, g), g);
        expect(b).toBeLessThanOrEqual(g.zeroTop - 2 + 1e-9);
        expect(t).toBeGreaterThanOrEqual(g.topBottom + 2 - 1e-9);
      }
    });
    it(`at ${em} units: never across its own tick (over it, or under it near the top)`, () => {
      for (let tick = 0; tick <= 140; tick += 0.5) {
        const [t, b] = box(brakeLabelY(tick, g), g);
        expect(b < tick || t > tick, `tick ${tick}: label ${t.toFixed(1)}..${b.toFixed(1)}`).toBe(true);
      }
    });
    it(`at ${em} units: over its tick wherever that clears "100", under it only above that`, () => {
      for (let tick = 0; tick <= 140; tick += 0.5) {
        const [t] = box(tick - 6, g), y = brakeLabelY(tick, g);
        if (t >= g.topBottom + 2) expect(y).toBeLessThan(tick); else expect(y).toBeGreaterThan(tick);
      }
    });
  }
  it('near the ground it stands just above "0 ft" (the reference descent: tick 133.1 at 16 units)', () => {
    const g = geoAt(16), y = brakeLabelY(133.1, g);
    expect(y).toBeCloseTo(g.zeroTop - 2 - g.desc, 6);
    expect(y).toBeLessThan(133.1 - 6);
  });
  it('a tape too short for three labels leaves the label where it was', () => {
    expect(brakeLabelY(50, { asc: 40, desc: 10, topBottom: 20, zeroTop: 70 })).toBe(44);
  });
});
