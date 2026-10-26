import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFilm, filmFade, FILM_FADE_MS } from '../../src/render/film.js';

// 0046: the film look (haze, vignette, the wet slab's mirror) eases in over about a second from its
// first frame, rather than switching on in one.
describe('film look fade-in', () => {
  it('rises smoothly from 0 to 1 over FILM_FADE_MS, no step bigger than a few percent a frame', () => {
    expect(FILM_FADE_MS).toBeGreaterThanOrEqual(800);
    expect(filmFade(0)).toBe(0);
    expect(filmFade(-5)).toBe(0);
    expect(filmFade(FILM_FADE_MS)).toBe(1);
    expect(filmFade(FILM_FADE_MS * 3)).toBe(1);
    expect(filmFade(FILM_FADE_MS / 2)).toBeCloseTo(0.5, 6);
    let prev = 0, maxStep = 0;
    for (let t = 0; t <= FILM_FADE_MS + 20; t += 1000 / 60) {
      const f = filmFade(t);
      expect(f).toBeGreaterThanOrEqual(prev);
      maxStep = Math.max(maxStep, f - prev);
      prev = f;
    }
    expect(maxStep).toBeLessThan(0.05);
  });

  it('holds the haze and the slab reflection at 0 on the first frame and full after the fade', () => {
    const renderer = { getDrawingBufferSize: (v) => v.set(2, 2), shadowMap: {}, getRenderTarget: () => null, setRenderTarget() {}, clear() {}, render() {} };
    const composer = { renderTarget1: { depthTexture: {} }, insertPass() {} };
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);   // under the slab: the mirror pass skips its draw
    camera.updateMatrixWorld();
    const film = createFilm({ renderer, scene: new THREE.Scene(), camera, composer, tier: 'high' });
    const slab = { tReflect: { value: null }, uReflK: { value: 0 }, uReflMat: { value: new THREE.Matrix4() } };
    film.setLook('show', [], [slab]);
    const mix = film.haze.uniforms.uMix;
    film.render(true, 5000);
    expect(mix.value).toBe(0);
    expect(slab.uReflK.value).toBe(0);
    film.render(true, 5000 + FILM_FADE_MS / 2);
    expect(mix.value).toBeCloseTo(0.5, 6);
    expect(slab.uReflK.value).toBeCloseTo(0.5, 6);
    film.render(true, 5000 + FILM_FADE_MS);
    expect(mix.value).toBe(1);
    expect(slab.uReflK.value).toBe(1);
    // A course switch (setLook again) after the fade keeps the look at full, no second fade or pop to 0.
    film.setLook('wall', [], [slab]);
    film.render(true, 5000 + FILM_FADE_MS + 16);
    expect(slab.uReflK.value).toBe(1);
  });
});
