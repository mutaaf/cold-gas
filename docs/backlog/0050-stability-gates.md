---
id: 0050
title: Stability gates: flicker scenarios for every moment, and a WebKit device sweep in CI
status: shipped
priority: P0
size: M
lens: tech-health
created: 2026-10-21
pr: 86
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
- [x] `docs/flicker-budget.json` committed with this baseline and the new scenarios
- [x] `node scripts/flicker-budget.mjs` passes on main and fails when a NaN is planted in plumes
- [ ] (split to 0071) devices.spec passes on WebKit and Chromium locally and in CI within the time budget
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
As above. AGENTS.md § 5 lists the new commands; definition of done gains "flicker-budget passes for
rendering changes".

## Out of scope
Running the flicker probe in CI (it needs a GPU); agents run it locally.

## Progress (build/0050-flicker-budget, 2026-10-22)
Shipped the flicker gate: `show-live-jets`, `retry-countdown`, `drive-road`, `endless-cruise` in flicker.mjs
(plus `--gl=swiftshader`, so a GPU-free sandbox can measure), `scripts/flicker-budget.mjs`, and
`docs/flicker-budget.json` with this ticket's Metal baseline and main measured in full on software GL (desktop
and phone, 71 entries each). A NaN planted in the plumes (`uSeed = NaN`) blacks the whole frame and pops
nowhere (every region 0.00‰), so the gate also fails any scenario that is mostly pure black: planted, it
exits 1 (show-jets 1000‰ black); clean, it exits 0. The WebKit device sweep needs CI to install WebKit, and
the CI workflow is a frozen path: split to 0071 (proposed, for the operator).
