// 0052: road paint is anti-aliased by its pixel footprint. A hard step() on a 10–15 cm line went
// under a pixel past ~100 m and sparkled as the car moved; the dusk glow keyed on a step fed the
// bloom the same pops.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { roadMaterial, createUniforms } from '../../src/render/roadlook.js';

const compiled = (marking) => {
  const mat = roadMaterial(createUniforms(), marking);
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  mat.onBeforeCompile(sh, null);
  return sh.fragmentShader;
};

describe('road paint', () => {
  for (const marking of ['eu', 'us', 'no']) {
    it(`${marking}: every line and dash is a footprint-filtered coverage, never a hard step`, () => {
      const fs = compiled(marking);
      const body = fs.slice(fs.indexOf('float cgRough'));
      expect(body).toContain('cgLine(u');
      expect(body).not.toMatch(/\bstep\s*\(/);
      if (marking !== 'us') expect(body).toContain('cgDash(v');
      // The glow follows the paint's coverage, not a threshold on the colour.
      expect(body).toContain('cgPaintGlow * 0.6 * vec3(1.0, 0.97, 0.9) * cgPaint');
      // …and none of it lands on the gravel shoulder (the old threshold never lit gravel).
      expect(body).toMatch(/cgPaint = [^;]*\(1\.0 - sh \* \(1\.0 - vRoad\.w\)\)/);
      expect(body.lastIndexOf('cgPaint =')).toBeGreaterThan(body.indexOf('float sh ='));
    });
  }
  it('the helpers are defined once and filter by fwidth', () => {
    const fs = compiled('eu');
    expect(fs.match(/float cgLine\(/g)).toHaveLength(1);
    expect(fs.match(/float cgDash\(/g)).toHaveLength(1);
    expect(fs).toMatch(/cgLine[\s\S]*fwidth\(x\)/);
  });
});
