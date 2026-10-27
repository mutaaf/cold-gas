---
id: 0088
title: Procedural texture canvases are read back on the CPU, not stalled on the GPU
status: proposed
priority: P2
size: S
lens: performance
created: 2026-10-24
pr:
by: scout
---

## Why
Loading the title on a 390x844 touch context in headless Chromium logs four "GPU stall due to
ReadPixels" warnings during boot. They come from the generated textures: `scene.js`
(concreteTextures) and `wall.js` (deckTextures, groundTexture) create 2D canvases, paint, then
call `getImageData` for per-pixel grain. On a GPU-accelerated canvas that readback stalls the
pipeline, a boot hitch on a phone where the lockdown wants a steady first second. Hint:
https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext (`willReadFrequently`).

## What
Pass `{ willReadFrequently: true }` to the `getContext('2d')` calls of every canvas that is
read back with `getImageData` in `src/render/scene.js` and `src/render/wall.js`. Pixel output
must stay byte-identical (same textures, same determinism).

## Acceptance criteria
- [ ] Every `getContext('2d')` on a canvas later passed to `getImageData` sets `willReadFrequently: true`
- [ ] Boot at 390x844 touch logs no "GPU stall due to ReadPixels" message
- [ ] Generated texture bytes are unchanged (hash of the pixel data matches before/after)
- [ ] hud-audit and title-audit stay clean; no flicker.mjs region rises

## Test plan
A unit or e2e check that loads the title and asserts the console has no ReadPixels stall
warning; a hash of each generated texture compared against the pre-change value.

## Out of scope
Moving texture generation to a worker or to shaders.

Scout 2026-10-27: still reproduces on `main` 90dc6b6 — a 390×844 touch title load logs "GPU stall due to ReadPixels" four times.
