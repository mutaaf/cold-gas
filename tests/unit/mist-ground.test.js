// The touchdown cloud lies on the ground instead of being sliced flat by it (0217). A mist point is a camera-facing
// square at its centre's depth, so the ground's depth test cuts it exactly where the square passes below the ground
// plane. Each fragment's alpha must fade to 0 by that plane, not end on it.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPlumes, mistGroundFade, MIST_FS, MIST_VS, SPRITE_K, MIST_FADE } from '../../src/render/plumes.js';

const W = 390, H = 844;
function cam({ pos = [6, 2.2, 9], look = [0, 0.4, 0], roll = 0 } = {}) {
  const c = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
  c.position.set(...pos); c.lookAt(...look); c.rotateZ(roll);
  c.updateMatrixWorld(true);
  return c;
}

// Independently of the shader's arithmetic: where the fragment at point coord (px, py) of a mist point really is in the
// world. gl_PointSize = aSize · scale / depth (scale = SPRITE_K · H), and the fragment lies on the ray through its pixel,
// at the centre's depth (a point writes one depth).
function fragmentWorld(c, p, aSize, px, py) {
  const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(c.matrixWorldInverse);
  const sizePx = aSize * SPRITE_K * H / -v.z;
  const ndc = new THREE.Vector3(p.x, p.y, p.z).project(c);
  ndc.x += (px - 0.5) * sizePx * 2 / W;
  ndc.y += (0.5 - py) * sizePx * 2 / H;   // gl_PointCoord's y runs down the screen
  return ndc.unproject(c);
}

describe('mist ground fade (0217)', () => {
  it('rebuilds each fragment\'s world height the way the GPU places it', () => {
    for (const c of [cam(), cam({ roll: 0.2 }), cam({ pos: [-3, 6, 4] })]) {
      const p = { x: 0.5, y: 0.15, z: -0.3 };
      for (const [px, py] of [[0.5, 1], [0, 1], [1, 0.8], [0.2, 0.1], [0.5, 0.5]]) {
        const y = fragmentWorld(c, p, 3, px, py).y;
        const band = Math.min(MIST_FADE.max, Math.max(MIST_FADE.min, MIST_FADE.k * 3 * SPRITE_K / c.projectionMatrix.elements[5]));
        const t = Math.min(1, Math.max(0, y / band));
        expect(mistGroundFade(p, 3, c, px, py)).toBeCloseTo(t * t * (3 - 2 * t), 4);
      }
    }
  });

  it('a grown puff at groundY + 0.15 m, its sprite crossing the ground, is transparent by the ground plane, not cut at it', () => {
    const c = cam(), p = { x: 0, y: 0.15, z: 0 }, aSize = 0.35 + 4.2 * 0.5;
    expect(fragmentWorld(c, p, aSize, 0.5, 1).y).toBeLessThan(-0.3);   // the square does cross the ground
    // Walk down the sprite's centre column: alpha falls smoothly and reaches 0 where the fragment meets the ground.
    let prev = Infinity, atGround = null;
    for (let i = 0; i <= 200; i++) {
      const py = 0.5 + i / 400, y = fragmentWorld(c, p, aSize, 0.5, py).y, f = mistGroundFade(p, aSize, c, 0.5, py);
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      prev = f;
      if (y <= 0) { atGround ??= f; expect(f).toBe(0); }
    }
    expect(atGround).toBe(0);
    // Not a cliff just above it either: halfway up the band the alpha is still in between.
    expect(mistGroundFade(p, aSize, c, 0.5, 0.5)).toBeGreaterThan(0.2);
  });

  it('leaves the cloud above the ground as it was', () => {
    const c = cam();
    expect(mistGroundFade({ x: 0, y: 2.5, z: 0 }, 2, c, 0.5, 1)).toBe(1);
    // A young, small puff on the ground barely changes at its centre.
    expect(mistGroundFade({ x: 0, y: 0.15, z: 0 }, 0.35, c, 0.5, 0.5)).toBeGreaterThan(0.95);
  });

  it('the shaders carry the fade, and the material tracks the ground height', () => {
    expect(MIST_VS).toMatch(/viewMatrix\[1\]\[0\]/);
    expect(MIST_VS).toMatch(/viewMatrix\[1\]\[1\]/);
    expect(MIST_VS).not.toMatch(/\bhalf\b/);   // reserved in GLSL ES
    expect(MIST_FS).toMatch(/smoothstep\(uGround, uGround \+ vBand, y\)/);
    expect(MIST_FS).toMatch(/t\.a \* vA \* lie/);
    const scene = new THREE.Scene(), hero = new THREE.Group();
    scene.add(hero);
    const pl = createPlumes(scene, hero, { maxMist: 16 });
    pl.update(1 / 60, 0, new Float64Array(10), new THREE.Vector3(), 3.25);
    expect(pl.points.material.uniforms.uGround.value).toBe(3.25);
  });
});
