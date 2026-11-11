// 0187: the bloom's soft knee is opt-in per look, and three's own gate is kept for every other look.
import { describe, it, expect } from 'vitest';
import { kneeBloom, bloomLook, KNEE_FS } from '../../src/render/bloom-knee.js';
import { buildWall } from '../../src/render/wall.js';

// The Wall's (and the Show's, and the title's) look: the generator's first value (src/render/wall.js).
const WALL_BLOOM = buildWall('high').next().value.look.bloom;

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
  const T = WALL_BLOOM.threshold;
  it('the Wall asks for it, and the iPhone export keeps the old gate', () => {
    expect(WALL_BLOOM.knee).toBe(1);
    expect(T).toBe(5);
    expect(WALL_BLOOM.native).toEqual({ strength: 0.62, radius: 0.55, threshold: 0.82 });
    expect(bloomLook(WALL_BLOOM)).not.toHaveProperty('native');
  });
  it('a red LED strip keeps a thin glow, lit white paint sends nothing, a lamp still blooms', () => {
    expect(knee([5.5, 0.26, 0.36], T)[0]).toBeCloseTo(0.5, 6);        // through the luminance gate it was all 5.5
    expect(knee([3.2, 3.2, 3.1], T)).toEqual([0, 0, 0]);              // the car under the washes: was all of it
    expect(knee([9, 0.9, 1.08], T)[0]).toBeCloseTo(4, 6);             // the brake light (roadster.js, 9)
    expect(knee([5.7, 5.82, 6], T)[2]).toBeCloseTo(1, 6);              // a headlamp at 6
  });
  it('continuous at the threshold: a light crossing it fades in, never pops', () => {
    expect(knee([T, 0, 0], T)[0]).toBe(0);
    expect(knee([T + 1e-3, 0, 0], T)[0]).toBeCloseTo(1e-3, 6);
  });
});
