---
id: 0335
title: The crash's sparks, chips, dust and torn parts land on the world's ground, not at y = 0
status: shipped
priority: P2
size: S
lens: authenticity
created: 2026-11-19
pr: 999
by: operator
---

## Why
Out in Free Drive's hills a crash's chips, sparks, dust and torn-off parts fell to the stage's height (y = 0): through a
hillside, or hanging in the air over a valley.

## What
- Each particle keeps the ground's height where it was thrown (Crash.ground, Debris.ground); a scored run's stays 0.

## Acceptance criteria
- [x] Torn parts and chips settle on the ground in the hills (simulator)
- [x] A scored run's crash is drawn as before (the replay shots)

## Test plan
The simulator's `-fd-wreck` out on the land: the torn wing lies on the slope.
