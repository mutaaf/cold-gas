---
id: 0000
title: Short imperative title
status: ready        # proposed | ready | in-progress | shipped | dropped
priority: P1         # P0 (broken/urgent) | P1 (next) | P2 (later)
size: M              # S (<1h) | M (one sitting) | L (split it if it touches >3 systems)
lens: player-feel    # player-feel | content | authenticity | performance | accessibility | tech-health
created: YYYY-MM-DD
pr:                  # filled in by the Builder when shipped
---

## Why
What a player feels or gets that they don't today. One paragraph. Cite sources if a
real-world reference or design article inspired it.

## What
The change, concretely. Which modules in `src/` it touches.

## Acceptance criteria
- [ ] Checkable statement a test or screenshot can prove
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse
- [ ] No frame-time regression (e2e perf probe within budget)

## Test plan
Which unit/e2e test is added or changed, and what it asserts.

## Out of scope
What this ticket deliberately does not do.
