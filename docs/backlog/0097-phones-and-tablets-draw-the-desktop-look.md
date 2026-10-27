---
id: 0097
title: Phones and tablets draw the desktop's look; only the pixels (and, if measured, the AA filter) differ
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-10-27
pr: 136
by: operator
---

## Why
Operator: "the quality of renderings should match web desktop on mobile and tablet." Today every touch device
(iPhone, iPad, Android) boots `mid` (src/gfx-tier.js `pickDeviceTier`) and the ledger treats that as a ceiling
(src/obs/ledger.js `chooseBoot`), so a phone can never reach `high`. Against a desktop, `mid` loses: the
pixel-ratio cap (1.5 vs 2), the shadow map (1024 vs 2048), SMAA (FXAA instead), the depth texture and with it the
whole film look (atmosphere, height fog, lamp halos, vignette) and the wet slab's planar reflection
(`wetSlab(…, false)`), and half the plume mist (900 vs 1800). A phone shows a flat black floor under a hard
horizon where a desktop shows haze, halos and a reflection.

## What
- Touch devices boot `high` like a desktop: the same effects, materials, shadows, film look, reflection, mist
  and geometry detail, and the same pixel-ratio cap (2). A ≤ 2 GB Android phone still starts `low` (the floor).
- The ledger's ceiling for touch is `high`; a phone whose ledger holds only `mid` sessions (booted before this)
  and never ran `high` goes there at once.
- Pixels before the look: a slow session boots the next one a resolution step lower at the same tier
  (100 → 85 → 70 → 55 %); only a session still slow at the resolution floor drops a tier. In-session the
  governor already steps only the resolution. Effect steps on the ladder (0091) are left for later.
- The AA filter is picked by the flicker probe on the phone profile (SMAA vs FXAA on the high look), not by
  the device class (0037's measurement predates the sliver, specular-AA and NaN fixes).
- 0049's battery rules (30 fps title, no grain or blur while flying) apply unchanged on every device.
- Render only: no sim change.

## Acceptance criteria
- [ ] Unit: `pickDeviceTier` boots iPhone, iPad (both UAs) and Android ≥ 3 GB (or unreported) at `high`; ≤ 2 GB at `low`
- [ ] Unit: `chooseBoot` steps a slow device high@100 → 85 → 70 → 55 % → mid; a never-tried `high` is tried
- [ ] Unit + e2e: the governor steps the resolution down on a run of slow frames at the phone profile and keeps the tier
- [ ] Screenshots: title, Show release, landing, results, a Free Drive road at 1440×900, 390×844 and 820×1180, before vs after
- [ ] `flicker-budget` passes for `chromium-swiftshader phone` (no region above docs/flicker-budget.json)
- [ ] `perf.mjs` and `perf-drive.mjs phone` before/after in the PR
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
tests/unit/gfx-tier.test.js, tests/unit/obs.test.js (ledger order, governor floor), tests/e2e/gfx-tier.spec.js
(iPhone/iPad boot high with the film look), tests/e2e/governor.spec.js (slow frames at the phone profile step the
resolution, the tier stays). `node scripts/shots-look.mjs docs/shots/0097 <after> <before>`. flicker.mjs --phone
--gl=swiftshader for SMAA and FXAA builds; perf.mjs, perf-drive.mjs phone before/after.

## Out of scope
Effect steps on the governor's ladder (0091). A user-facing quality menu. Real-device GPU timing.

## Progress (2026-10-27, draft PR: held on the flicker gate)
Built and tested, not shipped: the phone flicker budget fails in four regions and the remaining cause is the
desktop's own content, so this waits for an operator decision.

- Done: touch boots `high` (DPR cap 2, shadows 2048, film look, wet-slab reflection, mist 1800, Free Drive's far
  rings); ≤ 2 GB Android stays `low`. The ledger tries a never-run `high` at once, and a slow session costs a
  resolution step (100 → 85 → 70 → 55 %) before a tier. The governor steps resolution on slow frames at the
  phone profile (unit + e2e). Screenshots: docs/shots/0097/ (title, release, landing, results, road; desktop,
  phone, iPad; main vs this branch).
- AA, by measurement (flicker.mjs --phone --gl=swiftshader, this machine, main vs each filter on the high look):
  SMAA put 14 regions over main (show-wide wall 28.9 → 50.2 ‰, drive-road other 4.2 → 25.1), FXAA 4 and lowered
  most (show-wide car 95.9 → 37.3, retry-countdown car 58.9 → 18.6, show-replay car 70.9 → 47.8). Touch keeps FXAA.
- The stored swiftshader phone budget doesn't match this machine (main itself reads 25 regions over, e.g.
  lineup-title/row 89.0, as #131 found); the gate here is main's own run on this machine (25 % or 0.5 ‰).
- Still over with FXAA:
  | region | main | this branch | limit | cause (one layer off) |
  |---|---|---|---|---|
  | show-title/ground | 1.32 | 2.44 | 1.82 | the wet slab's half-res mirror (mirror frozen: 1.85; the slivers sized to the mirror took it 2.95 → 2.44) |
  | drive-road/other | 4.16 | 9.59 | 5.20 | Free Drive's far-tree ring (`high` only; hidden: 5.19) |
  | drive-road/sky | 0.85 | 1.96 | 1.35 | the same (hidden: 0.80) |
  | endless-cruise/ground | 4.71 | 6.01 | 5.89 | the same (hidden: 4.77) |
  Shadow 1024 changed nothing; DPR 1.5 made the title worse; the haze lowers flicker. The far trees are 4+ px
  wide there: coverage alpha, widening and a larger hide radius changed nothing or moved pops between regions.
  A puddle reflection one mip softer reached 1.83 against 1.82 but visibly smears the car's reflection on desktop
  too; a temporal blend of the mirror gave 2.44 → 2.32. All of those were left out.
- Kept: the slivers drawn into the mirror are sized to its half-resolution target (film.js), which lowers the
  mirror's crawl (measured on the phone; the desktop label has not been re-run with it yet, and must be before
  this ships).
- Options: (a) accept these four (each below the stored desktop swiftshader budget for the same look, measured
  on another machine: title ground 8.7, drive-road other 35.6, sky 2.07, endless ground 6.86) and rebaseline the
  phone label deliberately;
  (b) let touch keep mid's far-tree ring and a softer puddle reflection (no longer "only pixels/AA");
  (c) temporal AA for the composer (a bigger change; would also help desktop).
