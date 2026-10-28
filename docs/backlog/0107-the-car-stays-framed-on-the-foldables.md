---
id: 0107
title: The car stays framed under the HUD on the foldables' aspect ratios, live and in the replay
status: shipped
priority: P1
size: S
lens: platform
created: 2026-10-27
pr: 149
by: operator
---

## Why
0063's probe (tests/e2e/release-frame.spec.js) holds the drop off the ledge in frame below the top HUD on
phones, iPads and desktops, and 0068's replay keeps the car out from under the peek. Neither has flown the
foldables' shapes: the open book fold (669×871, 951×589: near-square), the closed one sideways (594×368)
and a flip's 22:9 (360×748, 800×300).

## What
- Measured first (0063's probe, now `tests/e2e/frame-probe.js`, shared): the book fold open (669×871,
  951×589, installed 669×930), closed and turned (594×368), a flip's tall screen upright (360×748) and its
  cover sideways (424×360) already held the bar. The two shortest failed: on the cover screen upright
  (360×380) the car's centre rose to 95 px under a 105 px rail head; on the tall screen sideways with the
  bars (800×300), to 75 px under a 56 px top bar.
- `src/render/director.js` keepClear: the highest the car's centre may go is also held a number of CSS px
  down (the top HUD's foot + 24 px: 131 upright, 84 sideways), read from the canvas's height at each
  reframe. It binds only under 524 px upright and 336 px sideways, so every size the flicker probe and the
  other audits fly frames as before (min(0.5, …) is 0.5 there: bit-identical).
- `src/styles.css`: upright under 440 px tall the compact rail's head (clock, phase) rides in the top bar's
  left corner, where the brand would be (hidden at that width): holding the car under a 109 px head lost the
  parked row's roofs in a 380 px frame; under the top bar it keeps both.
- 0068's replay on the fold: open and closed-sideways the results cover the screen, so Replay folds them to
  the peek; the car stays in what they leave (`tests/e2e/replay-probe.js`, shared).

## Acceptance criteria
- [x] The release-frame bar at 669×871, 951×589, 594×368, 360×748, 360×380 and 800×300 (e2e); 669×930 and 424×360 by probe.
- [x] The replay keeps the car above the peek in ≥ 90 % of frames at 669×871, 951×589 and 594×368 (e2e).
- [x] Flicker not raised: `flicker.mjs --phone` against the budget (the change can't bind at 844×390).
- [x] Works at 390×844 touch and 1280×720 keyboard (release-frame's own views unchanged, all pass).

## Test plan
`tests/e2e/phone-frame.spec.js` (new; its own file so it runs in CI's lighter shard): the release-frame
probe at the six sizes and the replay peek at three. `tests/e2e/release-frame.spec.js` and
`tests/e2e/replay-phone.spec.js` now import the shared probes, unchanged otherwise. The HUD audit at
360×380 (the rail's head moved).

## Out of scope
New camera rigs.
