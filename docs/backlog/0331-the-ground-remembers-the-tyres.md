---
id: 0331
title: The ground remembers the tyres: ruts, berms and laid grass kept per tile on the GPU
status: shipped
priority: P1
size: L
lens: authenticity
created: 2026-11-19
pr: 461
by: operator
---

## Why
A wheel across mud, sand, snow or grass left nothing behind but a puff of dust; the owner wants persistent tracks, cached,
with no per-frame work when nothing happens.

## What
- `TraceAtlas` (ColdGasWorld Trace.swift, pure): 16 m tiles, 48 slots given out on a tile's first stroke and taken back least
  recently pressed first; strokes cut per tile with their texel boxes; the shader's 32 × 32 table relative to the drawing origin.
- `TraceField` + Trace.metal: a 2D array texture (256² RGBA8 a layer, 12 MB once), one small quad per stroke (a render pass per layer touched, the texel read in place; the simulator max-blends) over
  its box (rut depth by the ground, load and spin; berm; pressed; the matter's tag), a layer cleared once when it's given out.
- Trace.h, read by the terrain: rut walls lit by their slope, a darker floor, the berm, laid grass paler, packed snow grey-blue,
  mud's sheen; Real soft, Anime two bands and an ink lip, 8-bit nearest and stepped. Nothing encoded on a frame without a stroke.

## Acceptance criteria
- [x] A stroke inside a tile is one stroke in its texels; across a corner it's four, each clipped (TraceTests)
- [x] A trace lasts until its tile is evicted, least recently pressed first, and its slot is cleared before reuse (TraceTests)
- [x] The table finds each slot relative to the drawing origin 5 km out (TraceTests)
- [x] Non-numbers and jumps write nothing (TraceTests)
- [x] Ruts drawn in Real, Anime and 8-bit on the simulator (PR shots)

## Test plan
`make test` (TraceTests); on the simulator `-freedrive -fd-at 1620,40,90 -fd-hold 0.45,0.7 -fd-wet 0.85 -look real|anime|pixel` and look at the circle of ruts; `-matter-off` is the before.
