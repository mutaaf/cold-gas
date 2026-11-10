// 0187: the look audit's two measures on synthetic frames.
import { describe, it, expect } from 'vitest';
import { redShare, lumaPercentile } from '../../scripts/lib/look-measure.mjs';

function frame(w, h, fill) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = (y * w + x) * 4; const [r, g, b] = fill(x, y); px[j] = r; px[j + 1] = g; px[j + 2] = b; px[j + 3] = 255; }
  return px;
}

describe('redShare', () => {
  it('counts saturated, bright reds only', () => {
    // Four columns: signal red, a dim red (value ≤ 40), a pale pink (saturation ≤ 0.5), blue-hour blue.
    const cols = [[220, 30, 40], [40, 2, 3], [230, 170, 175], [20, 30, 60]];
    const px = frame(4, 10, (x) => cols[x]);
    expect(redShare(px, 4, 10)).toBeCloseTo(0.25, 6);
  });
  it('a red that only ties another channel is not red', () => {
    expect(redShare(frame(2, 2, () => [200, 200, 20]), 2, 2)).toBe(0);
    expect(redShare(frame(2, 2, () => [200, 20, 200]), 2, 2)).toBe(0);
  });
  it('saturation just over and under 0.5', () => {
    expect(redShare(frame(1, 1, () => [200, 99, 99]), 1, 1)).toBe(1);    // (200-99)/200 = 0.505
    expect(redShare(frame(1, 1, () => [200, 100, 100]), 1, 1)).toBe(0);  // exactly 0.5
  });
  it('a whole red frame is 1, an empty one 0', () => {
    expect(redShare(frame(8, 8, () => [255, 0, 0]), 8, 8)).toBe(1);
    expect(redShare(new Uint8ClampedArray(0), 0, 0)).toBe(0);
  });
});

describe('lumaPercentile', () => {
  // A 10×10 frame whose luma rises 0..99 across it (grey, so luma = the value).
  const px = frame(10, 10, (x, y) => { const v = y * 10 + x; return [v, v, v]; });
  it('reads the percentile of the rect', () => {
    expect(lumaPercentile(px, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, 10)).toBe(9);
    expect(lumaPercentile(px, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, 50)).toBe(49);
    expect(lumaPercentile(px, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, 100)).toBe(99);
  });
  it('only the rect counts, clipped to the frame', () => {
    expect(lumaPercentile(px, 10, 10, { x: 5, y: 5, w: 20, h: 20 }, 10)).toBe(57);   // rows 5–9, cols 5–9: 25 values from 55; the 3rd is 57
    expect(lumaPercentile(px, 10, 10, { x: 20, y: 0, w: 5, h: 5 }, 10)).toBe(null);
  });
  it('uses Rec. 709 weights', () => {
    expect(lumaPercentile(frame(1, 1, () => [255, 0, 0]), 1, 1, { x: 0, y: 0, w: 1, h: 1 }, 50)).toBe(54);
    expect(lumaPercentile(frame(1, 1, () => [0, 255, 0]), 1, 1, { x: 0, y: 0, w: 1, h: 1 }, 50)).toBe(182);
  });
});
