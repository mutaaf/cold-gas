---
id: 0003
title: Hero roadster detail pass — door cut lines, mirrors-free aero, real wheel arches
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-10-19
pr:
---

## Why
The roadster is the star of every frame. The loft body reads well at distance, but up close on
the title turntable it lacks panel lines, a defined shoulder and crisp arches.

## What
In src/render/cars.js: add a shoulder crease (a second n-exponent band in the loft), shut lines
as thin dark inset tubes along the door and the targa, a proper arch lip (a torus segment
following the arch), carbon sills, and a tinted glass gradient. Keep it entirely our own
design, with no badges.

## Acceptance criteria
- [ ] Title turntable screenshots at 1440x900 show shut lines, a shoulder and clean arches
- [ ] Triangle count for the hero stays under 60k
- [ ] Mid tier holds frame time on a phone

## Test plan
`node scripts/shots.mjs` before and after (attach both to the PR), plus the e2e smoke.

## Out of scope
Lineup vehicles (separate ticket).
