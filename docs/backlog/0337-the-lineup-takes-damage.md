---
id: 0337
title: The Lineup's row takes damage too: glass, lamps, panels
status: proposed
priority: P2
size: M
lens: authenticity
created: 2026-11-19
pr: 
by: operator
---

## Why
The parked vehicles rock, dent and chip, but their glass and lamps never break.

## What
- A `CarDamage` per parked body, fed from the impacts on it; their glass and lamps drawn by state.

## Acceptance criteria
- [ ] A hard hit on a parked car's flank cracks its side glass
- [ ] Its lamp on the struck corner goes out

## Test plan
Roam the Lineup and hit the row; shots in three looks.

SCOUT 2026-11-20: held back to proposed to bring the ready queue to its cap of 10; not funnel-driven. Promote when room.
