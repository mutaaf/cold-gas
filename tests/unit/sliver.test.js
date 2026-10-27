// Specular anti-aliasing on slivers (0051): a lit member under `rough` px on screen eases its
// roughness up to 1 and its normal toward the viewer, so a box a pixel or two across shades as the
// average of its faces instead of flipping between a bright face and a dark one as the camera moves.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sliver } from '../../src/render/sliver.js';

const compile = (mat) => {
  const lib = THREE.ShaderLib.standard;
  const sh = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  mat.onBeforeCompile(sh);
  return sh;
};

describe('sliver rough (specular AA)', () => {
  it('eases roughness and the normal by the on-screen width, after three sets them', () => {
    const sh = compile(sliver(new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.85 }), { minPx: 1, dim: false, rough: 8 }));
    expect(sh.vertexShader).toMatch(/vPx = px;/);
    expect(sh.fragmentShader).toMatch(/varying float vPx;/);
    const f = sh.fragmentShader;
    const r = f.indexOf('roughnessFactor = mix( 1.0, roughnessFactor, smoothstep( 1.0, 8.0, vPx ) );');
    const n = f.indexOf('normal = normalize( mix( sV, normal, smoothstep( 1.0, 8.0, vPx ) )');
    expect(r).toBeGreaterThan(f.indexOf('#include <roughnessmap_fragment>'));
    expect(n).toBeGreaterThan(f.indexOf('#include <normal_fragment_maps>'));
    // The roughness three lights with (lights_physical_fragment) is read after both.
    expect(f.indexOf('#include <lights_fragment_begin>')).toBeGreaterThan(Math.max(r, n));
  });

  it('leaves a sliver without it as it was, under its own program key', () => {
    const plain = sliver(new THREE.MeshStandardMaterial(), { minPx: 1, dim: false, maxK: 4 });
    const aa = sliver(new THREE.MeshStandardMaterial(), { minPx: 1, dim: false, maxK: 4, rough: 8 });
    expect(compile(plain).fragmentShader).toBe(THREE.ShaderLib.standard.fragmentShader);
    expect(plain.customProgramCacheKey()).not.toBe(aa.customProgramCacheKey());
  });

  it('the Show truss uses it', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/render/wall.js', import.meta.url), 'utf8');
    expect(src).toMatch(/color: 0x2b2e33, metalness: 0\.85[^\n]*rough: 8 \}\)/);
  });
});
