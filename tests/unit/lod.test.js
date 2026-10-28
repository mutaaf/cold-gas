// 0052: the endless world's detailed spruces swap in and out with hysteresis, so a camera that
// lingers at the ring's edge (a car stopped, a slow corner) doesn't swap a tile's trees back and forth.
import { describe, it, expect } from 'vitest';
import { wantHi, HI_BAND } from '../../src/world/lod.js';

describe('spruce detail LOD (wantHi)', () => {
  const R = 300;   // the high tier's hiR; the ring is hiR + 64 (half a tile) from a tile's centre
  it('a tile comes in inside the ring and leaves only past the ring plus the band', () => {
    expect(wantHi(R + 63, R, false)).toBe(true);
    expect(wantHi(R + 65, R, false)).toBe(false);
    expect(wantHi(R + 65, R, true)).toBe(true);
    expect(wantHi(R + 64 + HI_BAND - 1, R, true)).toBe(true);
    expect(wantHi(R + 64 + HI_BAND + 1, R, true)).toBe(false);
  });
  it('a camera jittering across the ring swaps a tile once, not every frame', () => {
    let hi = false, swaps = 0;
    for (let k = 0; k < 200; k++) {
      const d = R + 64 + (k % 2 ? -4 : 4) + Math.sin(k * 0.3) * 10;
      const next = wantHi(d, R, hi);
      if (next !== hi) { swaps++; hi = next; }
    }
    expect(swaps).toBe(1);
  });
  it('the low tier (hiR 0) never draws the detailed trees', () => {
    expect(wantHi(0, 0, false)).toBe(false);
    expect(wantHi(0, 0, true)).toBe(false);
  });
  it('the band is under a tile (128 m), so a far tile still goes back to the simple trees', () => {
    expect(HI_BAND).toBeGreaterThan(0);
    expect(HI_BAND).toBeLessThan(128);
  });
});
