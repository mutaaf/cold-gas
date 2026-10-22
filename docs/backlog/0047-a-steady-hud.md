---
id: 0047
title: A steady HUD: nothing shifts, flaps or flashes as numbers change
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
- The desktop strip is `width:max-content` centred with translateX(-50%) (styles.css ~556); pitch gains
  and loses "+", fan hits 5 digits: the whole strip slides sideways.
- Landing cue LET GO ↔ ROLL (hud-landing.js ~139-150) and the green/amber/red bands (sim/predict.js
  ~75-76) have no hysteresis: colour, word, blink and buzz flap at band edges.
- A hop on the Lineup toggles drive ↔ air and swaps the HUD and touch layout (ui.js ~137).
- `rise` keyframes animate `filter` on containers (styles.css ~69,73,499), switching off backdrop blur
  until they end: the glass pops in.
- Geist Mono isn't preloaded: title numbers swap fonts.
- Free Drive speed is raw and centred (drive/hud.js ~240): it dithers.
- No `-webkit-tap-highlight-color`: buttons flash grey on tap. Inputs under 16 px zoom iOS on focus
  (AI key 15 px, selects 13 px, seed 13 px, save name 14 px, wish 15 px) and pinch-out is blocked.

## What
Fixed-width value slots in `ch`, a figure-space sign slot, fixed strip width; enter/exit thresholds plus
150 ms hold on landing bands; 0.25 s airborne hold; animate only opacity/transform; preload Geist Mono
400; reuse ui.js's 90 ms glide in Drive; `button{-webkit-tap-highlight-color:transparent}`;
`font-size:max(16px,…)` on inputs for coarse pointers.

## Acceptance criteria
- [ ] `[data-ch=spd]` rect x constant every frame of a Show run (e2e)
- [ ] Band status changes ≤ 6 times in a reference landing (was flapping)
- [ ] Every input computes ≥ 16 px on a coarse pointer
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e for rect stability and input font sizes; unit test for the band hysteresis in predict.js
(not scored, so no SIM_VERSION change).

## Out of scope
HUD redesign.
