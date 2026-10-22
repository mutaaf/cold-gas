---
id: 0058
title: The nerds panel e2e passes every time, not most times
status: ready
priority: P2
size: S
lens: tech-health
created: 2026-10-21
pr:
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
- [ ] `npx playwright test tests/e2e/nerds.spec.js --repeat-each=20` passes 20/20 locally
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
The repeat run above, numbers in the PR.

## Out of scope
Changing the panel.
