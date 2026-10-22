---
id: 0037
title: Phones and iPads get anti-aliasing, and iOS devices get the tier they can run
status: ready
priority: P0
size: M
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
Every edge crawls on touch devices. `mid` (the touch default) renders into a HalfFloat composer target
with no MSAA and SMAA loads only on `high` (src/render/scene.js ~371, 416-428); `low` draws straight to
the canvas but has `antialias: false`. Canvas MSAA is spent on the composer tiers where it only smooths
the final quad. Separately, src/main.js ~53 sends a device to `low` when `hardwareConcurrency <= 4`
(Safari has no `deviceMemory` and caps cores), so iPhones and iPads likely boot `low`: DPR 1 on a 3×
screen, no AA, no bloom. Lockdown sweep: phone flicker show-wide car 76‰, row 85‰; lineup-title row 142‰.

## What
- `low`: canvas `antialias: true`. `mid`: SMAA low preset or FXAA after the OutputPass. Composer tiers:
  canvas `antialias: false`.
- Tier choice for coarse pointers: drop the core-count test, start `mid`, let the governor (0044) step down.
  Record the boot reason in obs so the digest shows tiers per device class; label tablets as `tablet`.

## Acceptance criteria
- [ ] `scripts/flicker.mjs --phone`: every region's pops fall vs the baseline in this ticket, none rises
- [ ] An iPad/iPhone UA with `hardwareConcurrency` 4 boots `mid`
- [ ] `scripts/perf-show.mjs phone` p95 frame time within 10 % of before
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Unit test for the tier picker (pure: inputs → tier). flicker.mjs and perf-show.mjs numbers in the PR.

## Out of scope
New quality settings UI.
