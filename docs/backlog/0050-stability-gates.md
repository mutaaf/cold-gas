---
id: 0050
title: Stability gates: flicker scenarios for every moment, and a WebKit device sweep in CI
status: ready
priority: P0
size: M
lens: tech-health
created: 2026-10-21
pr:
by: operator
---

## Why
The lockdown must stay locked. Today flicker.mjs has no scenario for a live run with jets, a retry
countdown, Free Drive or the endless world, nothing checks its numbers against a budget, and no test
boots the game on WebKit (every iOS browser) or at an iPad viewport. Lockdown sweep baseline (bbcb526,
chromium, desktop / phone): show-wide wall 64/57‰, car 82/76‰, row 51/85‰; lineup-title row 104/142‰;
show-replay car 32/51‰; show-replay-rigs car 46/70‰.

## What
- flicker.mjs: `show-live-jets`, `retry-countdown`, `drive-road`, `endless-cruise` scenarios; write
  `--json`; `scripts/flicker-budget.mjs` compares a run with `docs/flicker-budget.json` (fails on any
  region's pops rising > 25 % over budget).
- `tests/e2e/devices.spec.js` (WebKit project, tagged so CI runs it once): iPhone SE, iPhone 15,
  iPhone landscape, iPad mini, iPad Pro 12.9 (Mac UA + touch), desktop: boot with zero console errors,
  no horizontal overflow, start a Show, rotate, return; canvas tracks the viewport.

## Acceptance criteria
- [ ] `docs/flicker-budget.json` committed with this baseline and the new scenarios
- [ ] `node scripts/flicker-budget.mjs` passes on main and fails when a NaN is planted in plumes
- [ ] devices.spec passes on WebKit and Chromium locally and in CI within the time budget
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
As above. AGENTS.md § 5 lists the new commands; definition of done gains "flicker-budget passes for
rendering changes".

## Out of scope
Running the flicker probe in CI (it needs a GPU); agents run it locally.
