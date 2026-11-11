// The roadster's shut lines (0187): a 4.2 mm tube under 3 px on screen is drawn 3 px wide and faded by the share
// it really covers, so a black line on the white paint stops popping as it crosses the frame (show-replay's closer
// shot: car pops 29.7 → 9.9 ‰, the same as with no shut lines at all). Close up it draws exactly as modelled.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { tubeCover, sliverTube } from '../../src/render/sliver.js';

const compile = (mat) => {
  const lib = THREE.ShaderLib.standard;
  const sh = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  mat.onBeforeCompile(sh);
  return sh;
};

describe('tubeCover', () => {
  // A 52° camera: projection [1][1] = 1 / tan(26°); 720 px tall drawing buffer.
  const p11 = 1 / Math.tan((26 * Math.PI) / 180), halfH = 360;
  it('keeps the darkness a sub-pixel line puts on screen: width × alpha is its true width', () => {
    for (const depth of [12, 20, 31]) {
      const c = tubeCover(0.0042, p11, halfH, depth, 3, 16);
      expect(c.px).toBeLessThan(1);
      expect(c.k).toBeGreaterThan(1);
      expect(c.px * c.k * c.cov).toBeCloseTo(c.px, 9);   // drawn wider, faded by the same factor
      expect(c.px * c.k).toBeCloseTo(3, 6);              // drawn 3 px wide
    }
  });
  it('draws a line already wider than minPx as modelled (k = 1, opaque)', () => {
    const c = tubeCover(0.0042, p11, halfH, 0.5, 3, 16);
    expect(c.px).toBeGreaterThan(3);
    expect(c.k).toBe(1);
    expect(c.cov).toBe(1);
  });
  it('caps the widening far away (maxK)', () => {
    const c = tubeCover(0.0042, p11, halfH, 2000, 3, 16);
    expect(c.k).toBe(16);
  });
  it('fades the alpha low enough that a 3 px line on white paint never steps a pixel by more than the probe\'s pop (24 of 255) at replay distance', () => {
    // show-replay's closer rig: about 30 px a metre on a 720 px buffer; the paint reads ≈ 200.
    const depth = (p11 * halfH) / 30;
    const c = tubeCover(0.0042, p11, halfH, depth, 3, 16);
    expect(200 * c.cov).toBeLessThan(24);
  });
});

describe('sliverTube', () => {
  it('widens along the tube\'s own normal and fades by coverage', () => {
    const m = sliverTube(new THREE.MeshStandardMaterial(), { radius: 0.0042, minPx: 3, maxK: 16 });
    const sh = compile(m);
    expect(m.transparent).toBe(true);
    expect(sh.uniforms.uTubeR.value).toBe(0.0042);
    expect(sh.uniforms.uMinPx.value).toBe(3);
    expect(sh.vertexShader).toMatch(/vec3 tSpread = normal \* uTubeR;/);
    expect(sh.vertexShader).toMatch(/transformed = position \+ tSpread \* \( tK - 1\.0 \);/);
    expect(sh.fragmentShader.indexOf('diffuseColor.a *= vCover;')).toBeGreaterThan(sh.fragmentShader.indexOf('#include <color_fragment>'));
  });
  it('the roadster\'s shut lines use it', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/render/roadster.js', import.meta.url), 'utf8');
    expect(src).toMatch(/seam: sliverTube\(new THREE\.MeshStandardMaterial\(\{ color: 0x050506, roughness: 0\.6 \}\), \{ radius: SEAM_R, minPx: 3, maxK: 16 \}\)/);
    expect(src).toMatch(/function seam\(points, radius = SEAM_R, mat = M\.seam\)/);
  });
});
