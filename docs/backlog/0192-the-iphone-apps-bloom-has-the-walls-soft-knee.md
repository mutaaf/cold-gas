---
id: 0192
title: The iPhone app's bloom has the Wall's soft knee, as the web does since 0187
status: proposed
priority: P2
size: S
lens: platform
created: 2026-11-11
pr:
by: builder
---

## Why
0187 gave the web's Wall/Show look (and the title) a soft-knee bright pass (`src/render/bloom-knee.js`): only light
past 5 in its brightest channel goes into the bloom, so the lit white car and the LED strips' red halo stop washing a
phone's climb and hang (red share 33–63 % → 4–12 %, the car box's P10 140 → ≤ 53). The iPhone app's Metal bloom
(`ios/ColdGas/Render/Shaders.metal` `highPass`) is three's luminance gate. So `scripts/native-stage-page.js` exports
the Wall's old gate (`look.bloom.native`: 0.62 / 0.55 / 0.82) for it, and the app keeps the red room until it ports
the knee.

## What
Runs on: the operator's Mac (Xcode). iPhone app only.
- `Shaders.metal` `highPass`: when the stage's bloom has `knee`, pass `c * max(m - threshold, 0) / m` with
  `m = max(c.r, c.g, c.b)` (KNEE_FS), else the luminance gate as today. `Stage.swift` reads `knee` from `stage.json`.
- `native-stage-page.js`: export `look.bloom` itself (threshold 5, knee 1) once the app reads it, and drop `native`
  from `src/render/wall.js`.

## Acceptance criteria
- [ ] The app's Show at the climb and the hang, on the iPhone Duo and the Pro Max, reads as the web does at 390×844:
      saturated red ≤ 12 % of the frame, the car box's P10 ≤ 60 (`scripts/look-audit.mjs`'s measures on a capture).
- [ ] The Lineup's bloom is unchanged (no knee there).

## Out of scope
The web (0187 shipped it).
