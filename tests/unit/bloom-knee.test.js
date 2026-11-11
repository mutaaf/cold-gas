// 0187: the bloom's soft knee is opt-in per look, and three's own gate is kept for every other look.
import { describe, it, expect } from 'vitest';
import { kneeBloom, bloomLook, KNEE_FS } from '../../src/render/bloom-knee.js';

const fakePass = () => ({
  highPassUniforms: { luminosityThreshold: { value: 0.8 }, smoothWidth: { value: 0.01 } },
  materialHighPassFilter: { fragmentShader: 'three', needsUpdate: false },
  threshold: 0.8,
});

describe('kneeBloom', () => {
  it('swaps in the knee shader, off by default', () => {
    const p = kneeBloom(fakePass());
    expect(p.materialHighPassFilter.fragmentShader).toBe(KNEE_FS);
    expect(p.materialHighPassFilter.needsUpdate).toBe(true);
    expect(p.knee).toBe(0);
    expect(p.highPassUniforms.knee.value).toBe(0);
  });
  it('a look sets it like the threshold', () => {
    const p = kneeBloom(fakePass());
    Object.assign(p, bloomLook({ strength: 0.62, threshold: 4.5, knee: 1 }));
    expect(p.highPassUniforms.knee.value).toBe(1);
    // A look without it (the Lineup, a road) turns it back off.
    Object.assign(p, bloomLook({ strength: 0.3, threshold: 0.92 }));
    expect(p.highPassUniforms.knee.value).toBe(0);
  });
  it("off, the shader is three's luminance gate", () => {
    expect(KNEE_FS).toContain('smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v)');
    expect(KNEE_FS).toContain('mix(outputColor, texel, alpha)');
  });
});

// The knee's arithmetic, mirrored from KNEE_FS: only what is over the threshold, on the brightest channel.
const knee = ([r, g, b], t) => { const m = Math.max(r, g, b); const k = Math.max(m - t, 0) / Math.max(m, 1e-4); return [r * k, g * k, b * k]; };
describe('the knee (mirror of KNEE_FS)', () => {
  it('a red LED strip keeps a thin glow, lit white paint sends nothing', () => {
    const led = knee([5.5, 0.26, 0.36], 4.5);
    expect(led[0]).toBeCloseTo(1.0, 6);           // was 5.5 through the luminance gate
    expect(knee([3.2, 3.2, 3.1], 4.5)).toEqual([0, 0, 0]);   // the car under the washes: was all of it
    expect(knee([9, 0.9, 1.08], 4.5)[0]).toBeCloseTo(4.5, 6); // a brake lamp still blooms
  });
});
