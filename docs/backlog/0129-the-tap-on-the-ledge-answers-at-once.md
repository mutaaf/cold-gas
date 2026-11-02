---
id: 0129
title: On one thumb, the tap on the ledge answers at once, not 0.9 s later at the lip
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-01
pr: 207
by: critic
---

## Why
On one thumb the release is the one decision the player makes on the Wall. The pad says **"Tap · Let go"**, the player
taps, and for the next **0.92 s** nothing on the pad changes. It still reads "Tap · Let go" while the car drives
itself out along the ledge (`src/onethumb.js:117-121`: the tap sets `st.drive`; the push-off only starts at
`THUMB.lip` 0.98). The label only flips to "Hold · Land" when `noteRelease` fires on the push-off
(`src/main.js:765`, `thumbStage` keys off `S.released`, `src/onethumb.js:87`).

Measured on production `index-V_Xnttkm.js` at 390×844 touch with real CDP touches, polled every 50 ms of wall time.
After the tap, `[data-thumb-act]` read "Let go" at sim +0.1, +0.2, +0.3 and +0.4 s, and "Land" only once
`S.released` (+0.92 s stepped; `docs/critique/2026-11-01-2200.md`). The haptic `buzz('tap')` (`src/input.js:189`)
is the only answer, and iOS Safari has no vibration API, so on an iPhone there is none.

The bar: about 0.1 s is the limit for a response to feel immediate (Miller 1968; Card, Moran & Newell 1983). A second
of "Tap · Let go" after the tap reads as a missed tap, and the player taps again. It also reads as lag at the moment
the real car was at its most decisive: on the launch run it spent "under 1 s at the lip" (REVEAL_RESEARCH §2.1.4,
line 178), and the drive-off itself fits inside that. The drive-off can stay. The silence can't.

This is also a third of the newcomer's long hang (critique 16:00, defect 4). Split in the sim: the reference spends
3.65 s inverted; a one-thumb player who taps 0.25 s after the cue spends 5.07 s. The extra is 0.27 s of slower crawl
from 0.85, plus the reaction, plus **0.99 s inverted in the drive-off**. Only the reaction is the player's.

## What
- `src/onethumb.js`: expose whether the drive-off is under way (e.g. a `driving` getter over `st.drive`).
- `src/main.js` `syncThumb`: a ledge stage that is driving gets its own words and state, e.g. `['', 'Letting go']`
  with the ring filling to the lip, `data-stage="going"`, and no "Tap" verb. The pad shows the tap was taken on the
  frame of the tap.
- `src/styles.css`: the going state is visibly different from the waiting one, not only in text: a fill or ring
  sweep, with a static version under reduced motion.
- No sim change. The drive-off, the push-off, `THUMB.carry` and `THUMB.lip` stay as they are (ref-hash and the input
  log are unchanged).

## Acceptance criteria
- [ ] e2e at 390×844 touch, one-thumb, Show: real CDP touches (hold to the cue, let go, tap). Within **≤ 100 ms** of
      wall time after the tap's `touchend`, `[data-thumb-act]` no longer reads "Let go", and the pad's `data-stage` (or
      an attribute the test reads) marks the drive-off. Polled at ≤ 16 ms.
- [ ] Stepped in the page (`liveStep(1/60)`): from the tap until `S.released`, every frame's label is the drive-off's,
      never "Let go". After `S.released` it is "Hold · Land" as today.
- [ ] A second tap during the drive-off changes nothing: same `S.releaseTick` and same input log as a single tap
      (unit test on `createOneThumb`).
- [ ] Tap → release is unchanged (0.92 s ± 1 tick, stepped), and `invertedS` for a 0.25 s tap is unchanged at 5.07 s
      (sim probe, as in the critique), since this ticket is the feedback, not the physics.
- [ ] Before/after screenshots at 390×844 one frame after the tap, `prefers-reduced-motion` included.
- [ ] ref-hash, determinism, 32/32 naive landings, and `human-phone.mjs 300 --scheme=thumb --skill=careful` median 93
      unchanged. hud-audit clean at 390×844, 360×780 and 844×390. Desktop 1440×900 keyboard unchanged.

## Test plan
- `tests/e2e/thumb-mastery.spec.js` (or a new `thumb-tap.spec.js`): the real-touch timing above.
- `tests/unit/thumb-mastery.test.js` (or `tests/unit/touch.test.js`): `driving` flips on the tap in the ledge stage, a second tap is
  a no-op, and a hold without a tap never sets it.

## Out of scope
- Shortening the drive-off or the crawl from 0.85 (that's a sim change, judged by the hang split, not here).
- The classic button scheme's RELEASE, which lets go on its own press.
