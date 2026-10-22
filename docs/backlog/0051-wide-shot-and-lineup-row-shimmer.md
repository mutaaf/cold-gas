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
