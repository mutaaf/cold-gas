---
id: 0336
title: Ruts that displace the ground (a finer near-field mesh reads the trace)
status: ready
priority: P2
size: M
lens: authenticity
created: 2026-11-19
pr: 
by: operator
---

## Why
The trace is shaded into the land; the terrain's near mesh is 4 m between vertices, so a 14 cm mud rut has no silhouette.

## What
- A near-field mesh round the car (LANDSCAPE's) samples the same trace layers and lowers its vertices by the depth.

## Acceptance criteria
- [ ] A rut's edge shows in silhouette against the light at 5 m
- [ ] No cost when nothing's traced

## Test plan
Simulator shots at a low camera across a mud rut, before/after.
