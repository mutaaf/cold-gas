---
id: 0203
title: On the Wall, a phone's release frame shows a car falling in the dark, not a glowing white blob in a red haze
status: proposed
priority: P1
size: M
lens: authenticity
created: 2026-11-12
pr:
by: critic
---

## Why
The release is the reveal's signature frame. The car drops off a red-edged inverted lip into the night, inverted then
rolling, with its attitude jets visible (REVEAL_RESEARCH §2.1.4: "leaving the lip inverted, going wheels-sideways at
about 0.5 s"). On the Show it reads that way on both screens. On the Wall, on a phone, it doesn't.

`scripts/look-audit.mjs` against production `index-DxnlFBnX.js`, the moment `release` (air, car below 18 m):

| course · size | red share | car box P10 luma |
|---|---|---|
| Show · 390×844 | 0.5 % | 3 |
| Show · 1440×900 | 9.9 % | 8 |
| **Wall · 390×844** | **19.1 %** | **114** |

In `docs/critique/2026-11-12-0407/W-look-release.png` the car is a white body with a bloom halo: its sill, glass and
lower bodywork are washed out. The upper third of the frame is a red haze from the strips at the lip above the camera.
0187 and 0193 fixed the climb, the hang and the run-up (P10 ≤ 60, red ≤ 12 %). This is the next frame of the same
stunt, and it's still the old look.

## What
Find which term blows the car out at the Wall's phone release: the bloom with the car in the plume's backlight, the
nozzle lights, or the deck look (`src/render/deck-look.js`) switching off as the car leaves the deck while the
camera still looks up at the lip. Then hold the release to the same bar as the hang. Keep it position-driven, the same
live and in the replay (0187's rule).

## Acceptance criteria
- [ ] Wall, 390×844 and 430×932 touch, look-audit `release`: red ≤ 12 %, car box P10 ≤ 60 (today 19.1 % / 114).
- [ ] The Show's release stays ≤ 12 % / ≤ 60 on both screens. The climb, hang and run-up keep 0187's and 0193's numbers.
- [ ] The plume still reads cold and white (0.5 s after release the jets' core pixels stay blue-white, not red-pink).
- [ ] `flicker.mjs --only=show-replay,show-jets,show-live-jets` A/B main vs branch, same command (LESSONS 2026-11-11):
      no region past budget.
- [ ] `ref-hash` unchanged (renderer only). `npm run audit` clean.

## Test plan
`release` is already a look-audit moment. Add it to the bar (exit 1 on a miss for `--courses=wall`). Paste main and
branch tables in the PR.

## Out of scope
- The title (0086). The touchdown's plume.
