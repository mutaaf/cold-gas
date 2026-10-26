---
id: 0047
title: A steady HUD: nothing shifts, flaps or flashes as numbers change
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-10-21
pr: 121
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
- [x] `[data-ch=spd]` rect x constant every frame of a Show run (e2e: tests/e2e/steady-hud.spec.js; 5.7 px range on main → 0)
- [x] Band status changes ≤ 6 times in a reference landing (was flapping): Show 8 → 2, Lineup 14 → 2, Wall 16 → 4
  (tests/unit/steady-band.test.js)
- [x] Every input computes ≥ 16 px on a coarse pointer (shipped in #71; now guarded by e2e)
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e for rect stability and input font sizes; unit test for the band hysteresis in predict.js
(not scored, so no SIM_VERSION change).

## Out of scope
HUD redesign.

## Shipped
- Already in #71 (re-measured on main, not redone): `rise` animates opacity/transform only, Geist Mono 400 is
  preloaded, buttons have no tap highlight, fields are ≥ 16 px on coarse pointers.
- The band (src/sim/predict.js `steadyStatus`, used by src/hud-landing.js): a worse band is entered at `predict`'s
  own thresholds, a better one only once clear of them (margin ahead ≥ 0.5 m, touchdown sink 0.2–0.3 m/s under the
  limit, sink ≤ profile + 0.2) for 150 ms without a break; a worse one once worse readings have run 150 ms of sim
  time, a flap in between not restarting it (amber ⇄ red or green ⇄ red still warns, at the worst seen). A pause
  doesn't count. Colour, word, touchdown ring, the warn buzz, the one-thumb pad's amber pulse and the coach's
  "Land now" pointer follow it. `predict.status` itself is unchanged (coach, human-show, drills).
- Red (and its buzz) now shows ≥ 150 ms after the raw prediction first reads red; learn.spec's red wait still
  passes on its `results` fallback when a drill lands inside that.
- LET GO stays while the car keeps rolling the right way (> 0.5 rad/s), down to 6°, instead of flapping with ROLL.
- A hop: the HUD's air layout, the landing HUD and the touch layout switch only after 0.25 s off the ground
  (main.js `flying`); the sim returns a hop to 'drive' within 0.15 s, so a hop swaps neither. Off the Wall the air
  controls still come up at release. Still on the raw phase (not this ticket): the camera's air shake and FOV, the
  roll cue, and the timeline latching LIFT-OFF on a hop.
- The desktop strip (fine pointer, > 1100 px, full HUD): SINK and FAN are one width (118 px), the fan figure has a
  5ch slot, N₂'s second line has slots for kg, pressure and bar: the strip measured 751.8 px in every state probed
  (both layouts, 5-digit fan, signed pitch, an empty tank). Phone layouts were left alone (rails and bands, audited).
- Free Drive's speed glides like the stunt HUD's (≈ 90 ms).
- No sim change: `predict` is read-only and the run is untouched.

