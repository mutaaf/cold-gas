---
id: 0227
title: Out in Free Drive's world the roadside breaks (fences and signs knocked down, rails that give)
status: in-progress
priority: P1
size: M
lens: player-feel
created: 2026-11-13
pr:
by: operator
---

## Why
The owner, 2026-11-13: "enhance the physics and impact to environment". 0223 made the sets' cones, barriers and signs
move; out in the open world nothing beside the road gives way (0223's out of scope).

## What
Runs on: the operator's Mac (Xcode).
- Fences, signposts and guard rails beside the world's roads, streamed with the land, that a car knocks down, bends or
  breaks with real masses and strengths, and that come back when the car has gone.

## Acceptance criteria
- [ ] `make test` green, the run vectors bit-exact; tests that a post breaks over its strength and holds under it.
- [ ] Shots in docs/shots/0227/.

## Test plan
`cd ios && make test` (new tests for the posts and rails); `-freedrive -fd-hold` into a fence on the simulator.

## Out of scope
Destructible trees and buildings.
