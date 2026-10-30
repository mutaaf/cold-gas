---
id: 0116
title: On an upright phone the carry shows the whole parked row, not three of its five
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-29
pr: 177
by: critic
---

## Why
The stunt is the car flying over a row of five parked vehicles (docs/REVEAL_RESEARCH.md:187: "five vehicles
parked side by side in one row", the Semi tallest in the centre). On an upright phone, the carry camera can't fit that row in the frame. At mid-row (car z −13.7), only
3 of the 5 bodies are half or more on screen. The Semi in the middle of the row is cut in half by the left
edge, and the two cars behind it are off the screen.

0113 measures the row *under the HUD*, and it records 390×844 as 0 % covered, which is true: on an upright
phone the HUD is at the top. Nothing measures the row going *off the edges*, so the upright phone (the
most common way the game is held) passes every probe while the obstacle it is clearing is cut off.

Measured on production `800890a` (docs/critique/2026-10-29-0940.md):
- **Method:** the Show reference, stepped at 30 fps with the director (0063's `fly()` stepping).
- **Sampling:** each body's own box (footprint × 0…h), sampled on a 7×7×7 grid, projected through
  `__coldgas.camera`.
- **Crossing:** car z from −10 to −22.6, which is the row's own extent (front −10.0, back −22.6 from
  `S.run.car.world.bodies`). That's 52 air frames, including the locked-off hold.

| Viewport | Row on screen, mean | Frames < 50 % on screen | Frames with < 3 bodies in | At z −13.7 |
|---|---|---|---|---|
| 390×844 touch | **61 %** | **15 / 52** | **12 / 52** | 65 %, 3 of 5 bodies |
| 360×800 touch | **60 %** | **17 / 52** | **14 / 52** | 66 %, 3 of 5 bodies |
| 412×915 touch | **60 %** | **17 / 52** | **14 / 52** | 64 %, 3 of 5 bodies |
| 844×390 touch | 92 % | 4 / 52 | 3 / 52 | 100 %, 5 of 5 |
| 1440×900 | 92 % | 4 / 52 | 3 / 52 | 100 %, 5 of 5 |

The 4 bad frames at 844×390 and 1440×900 come from the locked-off hold, where the row is off screen by
design (0063). The upright phones lose 11–13 more frames than that, and they come from the tracking carry.

The real frame shows it: `docs/critique/2026-10-29-0940/p390-A-4-over-row.jpg` (T+12.5) shows half the
Semi, the Pickup and the Roadster. The car is over a row the player sees three-fifths of. The bottom 30 % of
the frame is empty concrete.

The geometry is the cause. The carry (`src/render/director.js:229-232`) stands the camera ≈ 21 m to the
side with a fixed 54° *vertical* FOV. At aspect 0.46 that is a ≈ 26° horizontal FOV, which shows ≈ 9.9 m of
ground at the row against the row's 12.6 m. The camera also looks at the car's z − 2, so the row is
off-centre as well as too wide.

## What
- In `src/render/director.js`, the Show's tracking carry (`st.shot === CARRY`): on an upright view
  (`camera.aspect < 1`), widen the shot to fit the row's length horizontally, not the car's height
  vertically. Two ways to do it:
  - Pull the camera back: distance from the row's 12.6 m plus a margin at the actual horizontal FOV.
  - Or hold the 54° horizontal FOV, which means a taller vertical FOV on a tall screen.
- Bias the look point toward the row's centre (z ≈ −16.3) while the car is over it.
- Whichever you choose, the car must stay inside 0063's and 0112's bars (centre below the top HUD + 24 px,
  ≥ 90 % in frame), and the landscape and desktop framing must not change (0113 owns those).

## Acceptance criteria
- [ ] The on-screen probe in the critique, made an e2e helper and run on the Show reference stepped at
      30 fps. At 390×844, 360×800 and 412×915 touch, it measures:
      - the row's mean on-screen share ≥ 90 % over the tracking carry's frames, with the locked-off hold
        excluded (`director` shot = hold);
      - no tracking-carry frame with < 4 of 5 bodies half on screen;
      - 5 of 5 bodies at z −13.7.
- [ ] The same probe at 820×1180 touch (iPad portrait, aspect 0.69) meets the same three bars.
- [ ] 0063's release-frame and 0112's cover probes stay green at every view they run.
- [ ] 844×390 and 1440×900: the carry's camera pose at z −13.7 is unchanged (within 1 cm and 0.1°),
      unless 0113 lands first and owns it.
- [ ] A before/after real-frame screenshot at 390×844, T+12.3 ± 0.3, in the PR, with all five bodies and the
      car in one frame.
- [ ] hud-audit, title-audit and flicker.mjs unchanged or better. The reference run's score, sink and
      clearance are bit-identical (camera only).

## Test plan
Extend `tests/e2e/frame-probe.js` with a row-on-screen measure that samples each body's own box, not the
union. Report off-screen apart from HUD-covered (LESSONS 2026-10-28). Add the three upright views to
`phone-frame.spec.js` with the bars above.

## Out of scope
The row under the HUD on landscape and desktop (0113). The touchdown's framing on an upright phone (0108).
The locked-off hold (0063).

## Critic sharpen (2026-10-29 15:52)
The defect is upright *aspect*, not phone size. On production `be5d69a` at iPad portrait 820×1180 touch, the
Show reference at T+12.3 (`05 CARRY`, `docs/critique/2026-10-29-1552/ipad-A-carry.jpg`):
- the leftmost parked body is cut by the left edge;
- the row sits low and left of the car;
- the bottom ≈ 25 % of the frame is bare concrete.

It is the same fixed 54° vertical FOV, which gives ≈ 39° horizontal at aspect 0.69. The operator's lockdown
names iPad explicitly, so the fix should key on `camera.aspect < 1`, not on a phone width, and the probe adds
820×1180 to its views (acceptance above).

## Shipped (#177)
Measured on this branch with 0063's stepped probe (frame-probe.js, Show reference at 30 fps, every carry frame,
the hold excluded); main `e10b4ee` (after 0113's locked-off carry) → branch:

| Viewport | Row on screen, mean | Carry frames with < 4 bodies half on | At z −13.7 |
|---|---|---|---|
| 390×844 touch | 71 % → **100 %** | 27 → **0** | 5 → 5 |
| 360×800 touch | 69 % → **100 %** | 28 → **0** | 4 → **5** |
| 412×915 touch | 70 % → **100 %** | 27 → **0** | 4 → **5** |
| 820×1180 touch | 94 % → **100 %** | 7 → **0** | 5 → 5 |

Two causes, both upright-only:
- The carry framed the car, not the row: on `camera.aspect < 1` it now stands abeam of the row's middle, back as far as
  the stretch from the car's tail at the cut to its nose at the row's back needs across the frame inside carryOut's
  edge (≈ 47 m at 390×844), so no re-placement fires (`fitRowAcross`).
- keepClear's rail yaw (upright touch, compact HUD) holds the car at or right of the frame's centre on every frame,
  even when it is low, so the "locked-off" carry panned with the car until it passed mid-screen and pushed the row's
  far end off the right edge. In the carry the yaw is off; instead the carry's fit holds the car's centre under the
  foot of the HUD standing at the top of the left edge + 24 px (`bandL`, measured with 0113's band), so it still never
  sits under the rail (`covered` stays empty at every upright view).

Every upright view in release-frame.spec.js and phone-frame.spec.js (390×844, 360×800, 412×915, 820×1180,
1024×1366, 669×871, 360×748, 360×380) now asserts mean ≥ 90 %, no carry frame under 4 of 5, 5 of 5 at mid-row, along
with 0063's and 0112's bars. Landscape and desktop: every change is gated on `aspect < 1` (bandL is read but unused
there), so their poses and the flicker probe's two screens (1280×720, 844×390) are bit-identical to main.
Shots: `docs/shots/row-across-0116/` (390×844 at z −13.7 before and after, and at the cut, z −10).
