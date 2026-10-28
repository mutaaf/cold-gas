---
id: 0051
title: The wide shot and the Lineup row hold still: find and fix the 50–140‰ shimmer
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
The worst measured flicker in the game (lockdown sweep, bbcb526): show-wide wall 5.1 jitter / 64‰ pops,
car 6.2 / 82‰, row 4.2 / 51‰; lineup-title row 8.3 / 104‰ desktop, 9.6 / 142‰ phone; show-title
backdrop 32‰ on phones. These are camera views every player sees on the title and the broadcast cam.
Some is geometric aliasing that 0037 may fix; the rest needs heatmaps.

## What
After 0037 lands, re-run `scripts/flicker.mjs --heat=<dir>` for these scenarios, attribute the hot pixels
(sub-pixel lamp strips without `sliver()`, specular aliasing on clear-coat, thin truss, shadow edges),
fix each source per LESSONS (sliver, DECAL, roughness clamp / specular AA, mip bias).

## Acceptance criteria
- [ ] show-wide and lineup-title: every region ≤ 15‰ pops on desktop and phone
- [ ] Heatmaps before/after in the PR
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
flicker.mjs numbers and heatmaps; update `docs/flicker-budget.json` (0050) to the new numbers.

## Out of scope
Changing the vehicle designs.

## Progress (PR #131, the Show's truss; still `ready`)
Attribution on CI's software GL (`--gl=swiftshader`, same build A/B against main, heatmaps per region with
`FLK_PRE="window.__flk.heatReg=<n>"`), by switching one layer off at a time before the capture:
- **show-wide wall** was the truss's shading, not its edges: flat-shading only the truss took it 111 → 31‰ (phone);
  bloom off, shadows off, the deck flat: no change. Fixed: `sliver(…, { rough })` (src/render/sliver.js) eases a
  member's roughness to 1 and its normal toward the viewer under 8 px on screen (the average of its faces); the
  width is measured from the member's size and distance, not a corner's projected spread, which collapses to ~0 px
  where a box's diagonal points along the view ray (review of #131: the first cut flattened close faces too).
  Branch vs main, same machine, phone: show-wide/wall 113.2 → 27.7, retry-countdown/wall 39.3 → 29.8, show-title/wall
  5.6 → 3.2; desktop: show-wide/wall 131.0 → 46.1, retry-countdown/wall 31.0 → 26.0, show-title/wall 7.2 → 4.8.
  No region rose on either screen (full probes of the first cut, all others within 3.5 %; the three scenarios that
  show the truss re-run after the fix).
- **show-wide car, lineup-title row and the Lineup's poles (lineup-title wall)** are geometric edge aliasing of a
  moving silhouette: roughness 1 and clearcoat 0 on the hero or the row, lamps hidden, bloom off, shadows off all
  left them within a few ‰ (hiding the poles took lineup-title wall 50 → 0.7, and the same `rough` on them did
  nothing). The phone tier's FXAA trims some (AA off: row 88 → 123). What remains needs coverage AA in the composer
  target (MSAA there is LESSONS' black-frame risk on some GPUs) or a temporal resolve; that is the open part.
- show-wide backdrop (the launch complex, 46–65‰) not attributed yet.
- **show-wide backdrop attributed (2026-10-27, builder, swiftshader desktop `--only=show-wide`, this sandbox's main: 56.5‰).**
  All of it is the rocket complex's one merged structure mesh (`struct` in src/render/rocket.js): hiding the lattice,
  lamps, beacons, beams or vapour leaves it within 1‰. Its shading is a small part: no specular 56.4, plain albedo
  (no soot noise, rings or seams) 54.8, every normal toward the viewer 51.0, a constant colour 37.9. Thin steel
  (masts, arms, legs) is not it: dimming spread members by their true width, padding them, or a 1 px / 3 px minimum
  all stay at 56–57 (LESSONS: guard `vSliver` on `vPx > 0`). What remains is the silhouettes of the big lit parts
  (vehicle, buildings, tank, spheres) moving a fraction of a pixel a frame: coverage aliasing, the same open part as
  the car and the row. No per-material fix keeps the look; it needs composer AA (#136 option c).

