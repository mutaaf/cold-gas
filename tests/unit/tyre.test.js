// Tyre load sensitivity (ticket 0021): peak μ and cornering stiffness against load follow a
// published Magic Formula fit (Cabrera et al., Sensors 18(3) 2018, Table 2, 205/65 R15), carried
// over as relative shape (spec.js). The fit's numbers are written out here, not read from spec.js.
import { describe, it, expect } from 'vitest';
import { tyreFy, tyreBy, tyreMuLoad, TYRE } from '../../src/sim/vehicle.js';
import { SPEC } from '../../src/sim/spec.js';

const PDY1 = 0.932775, PDY2 = -0.128085, PKY2 = 2.293896;
const fitMu = (x) => (PDY1 + PDY2 * (x - 1)) / PDY1;                                  // μ(Fz)/μ(Fz0)
const fitKy = (x) => (Math.sin(2 * Math.atan(x / PKY2))) / Math.sin(2 * Math.atan(1 / PKY2)); // Kα(Fz)/Kα(Fz0)

// The game's tyre at load x·Fz0 (Fz0 = 1, so forces are per unit nominal load).
function tyreAt(x) {
  const D = SPEC.tyreMu0 * tyreMuLoad(x) * x, B = tyreBy(x);
  let peak = 0;
  for (let a = 0; a <= 0.6; a += 0.0005) peak = Math.max(peak, -tyreFy(D, a, B));
  const K = -tyreFy(D, 1e-5, B) / 1e-5;
  return { mu: peak / x, K };
}

describe('tyre load sensitivity (ticket 0021)', () => {
  const nom = tyreAt(1);
  it('spec.js carries the published fit', () => {
    expect(SPEC.tyreLoadSens).toBeCloseTo(PDY2 / PDY1, 6);
    expect(SPEC.tyreKyLoad).toBeCloseTo(PKY2, 6);
    expect(nom.mu).toBeCloseTo(SPEC.tyreMu0, 3);
    expect(nom.K / SPEC.tyreMu0).toBeCloseTo(TYRE.BY * TYRE.CY, 3);   // the track tyre's own stiffness at Fz0
  });
  for (const x of [1, 2, 3]) {
    it(`at ${x}·Fz0 peak μ and cornering stiffness match the fit within 5 %`, () => {
      const t = tyreAt(x);
      expect(t.mu / (SPEC.tyreMu0 * fitMu(x))).toBeGreaterThan(0.95);
      expect(t.mu / (SPEC.tyreMu0 * fitMu(x))).toBeLessThan(1.05);
      expect(t.K / nom.K / fitKy(x)).toBeGreaterThan(0.95);
      expect(t.K / nom.K / fitKy(x)).toBeLessThan(1.05);
    });
  }
  it('cornering stiffness per unit load saturates: lower at 3·Fz0 than at Fz0', () => {
    expect(tyreAt(3).K / 3).toBeLessThan(nom.K);
    expect(tyreAt(3).K / 3 / nom.K).toBeCloseTo(fitKy(3) / 3, 2);
  });
  it('a loaded tyre needs more slip angle for its (lower) peak', () => {
    const peakAlpha = (x) => Math.tan(Math.PI / (2 * TYRE.CY)) / tyreBy(x);
    expect(peakAlpha(3)).toBeGreaterThan(peakAlpha(1));
  });
  it('the peak force never falls with load (held past the fit, at bump-stop loads)', () => {
    let last = 0;
    for (let x = 0.1; x <= 12; x += 0.1) {
      const D = tyreMuLoad(x) * x;
      expect(D).toBeGreaterThanOrEqual(last - 1e-12);
      last = D;
    }
  });
});
