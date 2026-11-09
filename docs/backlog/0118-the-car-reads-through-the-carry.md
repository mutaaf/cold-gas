---
id: 0118
title: The car reads through the carry again, with the row still in sight (0113 halved it)
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-30
pr: 186
by: critic
---

## Why
0113 (#175) put the parked row in sight over the carry. To fit the car (20–25 m up at the row's front) and the
row's foot into the band the HUD leaves, the shot stands back up to 2.5× and stays there through the carry. The
cost is the hero. Across the carry the roadster is now half the size it was on every screen, and on a landscape
phone it is a ≈ 35 CSS px speck. `l844-5-over-row.jpg` shows the 4.3 m car smaller than the parked coupe below it,
with the top 55 % of the frame empty sky and the launch pad. 0113's own What said "1440×900's and the portrait phone's
car framing don't get worse". At 1440×900 it did, by half.

The measure is the car's projected box (every hero mesh's bounding box through `__coldgas.camera`), divided by the
screen width, over the tracking-carry frames (`director.state.shot === 'carry'`, car z from the row's front to its
back, 56 frames). It comes from 0063's stepped flight (`tests/e2e/frame-probe.js`, the Show reference at 30 fps).
Production `e053bc2` (landscape and desktop unchanged on `9fdbcc4`, re-measured) against a local build of `907ea64` (the commit before #175):

| View | Car width / screen, mean (min–max), before 0113 | after 0113 (production) | Row under HUD before → after |
|---|---|---|---|
| 844×390 touch | 0.096 (0.080–0.110) | **0.041** (0.040–0.043) | 95 % → 0 % |
| 667×375 touch | 0.116 | **0.044–0.079** (two runs) | 94 % → 0 % |
| 1180×820 touch | 0.144 | **0.080** | 62 % → 0 % |
| 1280×720 | 0.116 | **0.049** | 66 % → 0 % |
| 1440×900 | 0.129 (0.108–0.149) | **0.061** (0.059–0.063) | 62 % → 0 % |

The width barely changes through the carry (0.040–0.043 at 844×390). That means the shot frames the worst moment,
the car at its highest over the row's front, and holds it while the car comes down to 6–8 m over the pad. The
span between the car and the row shrinks by more than half in that time, and the frame never uses it.

## What
- `src/render/director.js`'s carry shot (`fitCarry`): keep the car and the row's near foot inside the band, but let the
  framing follow the span as it closes. Two ways to do it:
  - a slow, monotonic dolly or push-in that tracks the car-to-row-foot height, eased and with no sudden jumps, or
  - a second locked-off cut once the car is below about 12 m.
  Either way, the car grows as it comes down. 0113's notes say a fast re-place swept the frame and raised
  `show-live-jets` car flicker to 295‰. Move slowly or cut. Never pan the lit Wall across the frame
  (LESSONS 2026-10-27, 0063).
- No sim change. The landed rig and the replay are untouched.

## Acceptance criteria
- [ ] The probe above, over the carry frames: the car's mean width / screen is ≥ **0.060** at 844×390 and 667×375,
      ≥ **0.075** at 1280×720 and 1180×820, and ≥ **0.085** at 1440×900. That is ≥ 1.45× the 0113
      level at 844×390 and 1440×900, and still under the pre-0113 framing that hid the row.
- [ ] In the carry's last third (car z past the row's middle) the car's width is ≥ 1.4× its width at the cut, at every
      view above.
- [ ] 0113's bars still hold: the row ≤ 25 % under a HUD rect in every carry frame, and `rowShown` ≥ 0.9 on screens
      wider than tall. Every assertion in `release-frame.spec.js` and its foldable sibling stays green.
- [ ] `flicker.mjs --only=show-live-jets` (desktop and `--phone`) not raised past `docs/flicker-budget.json`.
- [ ] Before/after real frames at car z ≈ −12 and −20, 844×390 touch and 1440×900, in the PR.
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
Add the car-width series to `frame-probe.js`'s `fly()` (`carBox()` / `innerWidth` per carry frame). Assert the mean
and the last-third growth in `release-frame.spec.js` at the views above.

## Out of scope
Upright screens (0116 owns their carry: there the stand-back is across the row, and this probe's upright readings didn't match the real frames, so no bar is set for them). The hold before the cut. The touchdown
rig (0108).

## Critic note 2026-10-31
Still open on production `0856de8`. A spot check with the critic's real-frame probe, the 8-corner box of the hero at
the frame where car z first passes −16 (not the 56-frame probe above), gave car width / screen = **0.060** at
1440×900 (`2026-10-31-0400/d-ref-4-over-row.jpg`: ≈ 90 px of 1440). The bars stand as written.
