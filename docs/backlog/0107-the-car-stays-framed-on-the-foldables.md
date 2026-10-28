---
id: 0107
title: The car stays framed under the HUD on the foldables' aspect ratios, live and in the replay
status: in-progress
priority: P1
size: S
lens: platform
created: 2026-10-27
pr:
by: operator
---

## Why
0063's probe (tests/e2e/release-frame.spec.js) holds the drop off the ledge in frame below the top HUD on
phones, iPads and desktops, and 0068's replay keeps the car out from under the peek. Neither has flown the
foldables' shapes: the open book fold (669×871, 951×589: near-square), the closed one sideways (594×368)
and a flip's 22:9 (360×748, 800×300).

## What
Add those viewports to the release-frame probe and the replay peek's car-in-region check; fix the director
(src/render/director.js) where they fail. Flicker probe (`--phone`) if the camera changes.

## Acceptance criteria
- [ ] release-frame passes at 669×871, 951×589, 594×368 and 360×748.
- [ ] The replay keeps the car beside or above the results at the same sizes.
- [ ] Flicker not raised (flicker-budget) if the camera changed.
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
tests/e2e/release-frame.spec.js and tests/e2e/replay-phone.spec.js, extended.

## Out of scope
New camera rigs.
