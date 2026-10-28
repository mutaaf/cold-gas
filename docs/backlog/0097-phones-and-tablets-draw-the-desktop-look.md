---
id: 0097
title: Phones and tablets draw the desktop's look; only the pixels (and, if measured, the AA filter) differ
status: shipped
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

## Shipped (#136, 2026-10-27; operator decision: parity first, the flicker after in 0100)
- Touch boots `high` (DPR cap 2, shadows 2048, film look, wet-slab reflection, mist 1800, Free Drive's far rings);
  ≤ 2 GB Android stays `low`. The ledger tries a never-run `high` at once, and a slow session costs a resolution
  step (100 → 85 → 70 → 55 %) before a tier. The governor steps resolution on slow frames at the phone profile
  (unit + e2e). Screenshots: docs/shots/0097/ (title, release, landing, results, road; desktop, phone, iPad;
  main vs this change).
- AA, by measurement (flicker.mjs --phone --gl=swiftshader, same machine, main vs each filter on the high look):
  SMAA put 14 regions over main (show-wide wall 28.9 → 50.2 ‰, drive-road other 4.2 → 25.1), FXAA 4 and lowered
  most (show-wide car 95.9 → 37.3, retry-countdown car 58.9 → 18.6, show-replay car 70.9 → 47.8). Touch keeps FXAA.
- The stored swiftshader phone budget doesn't match this machine (main itself reads 25 regions over, e.g.
  lineup-title/row 89.0, as #131 found); the gate here was main's own run on this machine (25 % or 0.5 ‰).
- Four phone regions stay over main, re-baselined by operator decision in docs/flicker-budget.json, each at or
  under the desktop label's value for that region; 0100 calms them and restores the old values:
  | region | main | now | old limit | cause (one layer off) | desktop budget |
  |---|---|---|---|---|---|
  | show-title/ground | 1.32 | 2.44 | 1.82 | the wet slab's half-res mirror (frozen: 1.85) | 8.72 |
  | drive-road/other | 4.10 | 9.63 | 5.13 | Free Drive's far-tree ring (hidden: 5.19 before #140) | 35.62 |
  | drive-road/sky | 0.85 | 1.96 | 1.35 | the same (hidden: 0.80) | 2.07 |
  | endless-cruise/ground | 3.64 | 5.02 | 4.55 | the same (hidden: 4.77 before #140) | 5.71 |
  The Free Drive rows are re-measured after 0052 (#140, road paint) landed, against main deb8e84 on the same
  machine; on the desktop label this branch and main read the same in Free Drive.
- film.js: the slivers drawn into the half-resolution mirror are sized to its target (the title's slab 2.95 → 2.44 ‰
  on the phone). Desktop label, main vs this change on the same machine: 71 ok, 0 over; show-title/ground
  21.46 → 10.79 ‰, nothing else moved (its budget is left as it was; 0100 can lower it). The final phone run:
  67 ok, over only in the four re-baselined regions.
- After 0063 (#138, a still camera at the release) the phone re-check (show-live-jets, show-wide, show-replay,
  retry-countdown; same-machine main 1f68989 vs this) put one more region over: show-live-jets/wall 76.99 → 102.28
  (limit 96.24). One layer off: haze and halos off 88.32, DPR 1.5 97.72, mist 900 / mirror frozen / shadow 1024 no
  change; AA is FXAA on both. Desktop content (same pass, no phone-specific code), under the desktop budget
  (128.66): approved as a fifth region under the parity decision; its stored phone value (115.0089) already holds it,
  so only the budget's notes changed. In 0100. Everything else in those scenarios went down (show-wide car
  124.5 → 36.2, show-replay wall 6.3 → 0.4, retry-countdown car 55.6 → 15.0).
- Perf, phone profile (4× CPU, the Mac's GPU), main → this: first load usable 13.29 → 13.20 s; Free Drive stelvio
  59.1 → 58.6 fps (draws 332 → 448); the Show run render CPU p50 6.6 → 10.3 ms at 59–60 fps. Real-device GPU
  cost unverified: the governor and the ledger are the net, and they take pixels first.

