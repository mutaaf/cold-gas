---
id: 0179
title: A failed WebGL context is asked for again, lighter, before the page says it needs WebGL
status: proposed
priority: P1
size: S
lens: performance
created: 2026-11-10
pr:
by: scout
---

## Why
The obs digest (2026-11-10, `top`) lists `THREE.WebGLRenderer: Error creating WebGL context.` on two sessions across two
builds. For those players the title never appears: `src/main.js` catches the throw from `createStage`, prints
"COLD GAS needs WebGL. Try a current browser." and stops, so the visit is lost before a run. `createStage`
(src/render/scene.js:380) asks once, with `powerPreference: 'high-performance'` and, on the low tier, MSAA. Context creation
fails more often with those asks (a hybrid-GPU laptop that refuses the discrete GPU, a phone that is out of contexts after a
background tab) than with the plain request, and the second attempt is cheap.
Reference: MDN `HTMLCanvasElement.getContext` attributes (https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext):
`powerPreference` and `antialias` are hints a browser may refuse.
Funnel number to move: `visit-new` → `run` on the devices that fail today (the `webgl` signature's session count).

## What
- `src/render/scene.js` `createStage`: wrap `new THREE.WebGLRenderer` in a helper that tries once as now, and on a throw
  tries once more with `{ antialias: false }` and no `powerPreference`, on a fresh canvas context (the failed canvas may hold
  a lost context: `canvas.replaceWith` a clone only if the first attempt left it unusable). The retry flags the tier
  down one step (`high` → `mid`, `mid` → `low`) so the frame budget fits the lighter context. Nothing else about a good
  device's start changes.
- `src/main.js`: unchanged unless both attempts fail; then keep the message and the `obs.error('webgl', …)` beacon, and
  add `retried: true` to the beacon's detail so the digest tells a second failure from a first.

## Acceptance criteria
- [ ] With the first `getContext('webgl2')` call forced to return null, the title appears and a run starts, on the next tier down.
- [ ] With every call forced to return null, the page shows the existing message once and the beacon carries `retried: true`.
- [ ] A device whose first attempt succeeds takes the same path as today (no extra `getContext`, same tier, same pixels).
- [ ] 390×844 touch and 1280×720: no layout change.

## Test plan
e2e in `tests/e2e/gfx-tier.spec.js`: an init script that wraps `HTMLCanvasElement.prototype.getContext` to return null
for the first webgl2 request (and, in a second test, for all). Assert the title shows / the message shows and the beacon
body. A unit test for the helper if it is pure enough to import.

## Out of scope
A 2D-canvas fallback game, a context-lost recovery mid-run (0042 covers backgrounding), new hosts or analytics.
