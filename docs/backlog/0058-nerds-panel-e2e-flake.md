---
id: 0058
title: The nerds panel e2e passes every time, not most times
status: shipped
priority: P2
size: S
lens: tech-health
created: 2026-10-21
pr: 69
by: operator
---

## Why
`tests/e2e/nerds.spec.js` "opens the nerds panel, it counts the work live, and closing it restores the
engine" failed twice in a row (with its retry) on PR #66, a docs-only change (CI run 39709797225:
`expect(locator).toBeVisible() failed`), and passed on rerun. Flakes cost every PR 20 minutes and teach
everyone to rerun instead of read.

## What
Find what the visibility assertion races (the lazy nerds chunk, the panel's open transition, SwiftShader
frame time) and wait on the real condition; `test.slow()` only if it is slow but correct.

## Acceptance criteria
- [x] `npx playwright test tests/e2e/nerds.spec.js --repeat-each=20` passes 20/20 locally
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
The repeat run above, numbers in the PR.

## Out of scope
Changing the panel.

## Outcome
Two waits, not a race in the panel. On CI's software GL a live run's frames take 0.2–2 s: the lazy chunk's import waited behind them past the 5 s visibility timeout (it opens in < 0.5 s on a GPU), and under load the reference run could end before the panel's first one-second reading, leaving "—". The test now opens the panel first and waits for the toggle's `aria-pressed`, then starts the run; it is `test.slow()`. Local stress: 24/24 with `--repeat-each=24 --workers=4` (was 2 failures in 20).
