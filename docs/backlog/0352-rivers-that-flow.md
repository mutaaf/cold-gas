---
id: 0352
title: Rivers that flow: a smooth surface, ripples along the current, no pale facets
status: in-progress
priority: P1
size: M
lens: player-feel
created: 2026-11-19
by: operator
---

## Why
A river beside the car drew pale, stretched, flat-shaded triangles, as if its geometry or normals were broken (#465's
real-river shot; the Anime one drew them as solid white shapes).

## Root cause
Two things on a channel narrower than the land's mesh:
- The land is drawn from vertices 4 m apart near the eye (coarser past it). A river 5–12 m wide falls between them, so the
  drawn ground sags under the water's level in triangles the exact ground doesn't have. The water's fragment kept anything
  within 0.8 m above its level ("the beach stands in front anyway", true of the sea), and painted the edge's foam line over
  every pixel at depth 0, which on land is every one of them. So each sag in the bank became a pale triangle of foam at the
  river's level: the facets, outlined by the land's own triangles.
- The 32 m chop heaved a 6 m channel (displaced vertices on a still body), and nothing in the shading knew the current.

## What
- **The edge where the map puts it** (Water.metal): a lake's or a river's surface stops where the map's ground rises past its
  level (3 cm; the sea keeps its 0.8 m swash up the beach), and the edge's line is drawn only where there's water. A river's
  edge is a thin wet line, not surf.
- **Flowing water**: the near (1 km) map's `WaterMap.fx/fz` (0310's `WaterSample.flow`) go to the GPU as an rg16 texture
  (texture 18). A river's vertices aren't displaced (it runs flat); its normals are the chop's slopes read in the current's
  frame, drawn out along it (×0.45 along, ×1.7 across) and advected at `WaterSpec.riverSpeed` in two phases crossfaded (a flow
  map), with sparse flecks of foam riding downstream. Anime's glints and 8-bit's sparkle tiles drift with the current.
- **The wake stays on the water**: its segments spread metres wide and laid a pale sheet across a river's bank; its fragment
  now stops at the same edge.
- Lakes and the sea unchanged but for the edge line.

## Acceptance criteria
- [x] A river reads as flowing water in Real, Anime and 8-bit, no facets (docs/shots/0350/).

## Test plan
Simulator, each look: `-freedrive -fd-tod golden -fd-at -845,-3906,-69`, before and after (docs/shots/0350/); `make test` (WaterTests unchanged).
