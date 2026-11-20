---
id: 0350
title: Water reads as water: the river's facets, the grass on the water and the black splash tank (Real, Anime, 8-bit)
status: in-progress
priority: P1
size: M
lens: player-feel
created: 2026-11-19
by: operator
---

## Why
The coordinator's review of the world train's simulator shots (#465: land 0310, water 0320, matter 0330, splash and sink
0340) found three visible defects. A river beside the car showed pale, stretched, flat-shaded triangles; grass tufts stood on
and over the river and its banks below the waterline; and at a scored splash-down the tank read as a black box with sparks,
no water in it. All three looks.

## What
The umbrella for 0351 (grass off the water), 0352 (rivers that flow), 0353 (the scored tank's water and crown) and 0354 (the
drawn looks' lakes and rivers checked). Pixels only: no sim, scorer, vector or physics change.

## Acceptance criteria
- [x] Rivers read as flowing water: a smooth surface, ripples drawn out along `WaterSample.flow` and carried downstream, no
      facets (0352).
- [x] No grass on or over a lake, a river or the sea, nor on a bank below the waterline (0351).
- [x] A scored splash tank's surface, the splash's crown, its ring and its spray read as water in Real, Anime and 8-bit (0353).
- [x] `cd ios && make test` (58 run vectors bit-exact), `make build`, `node scripts/check-backlog.mjs`.
- [x] Before and after shots of all three in all three looks: docs/shots/0350/.

## Test plan
`cd ios && make test` (58 run vectors bit-exact), `make build`, `make rules`; simulator shots before/after in Real, Anime and 8-bit: a river at `-freedrive -fd-tod golden -fd-at -845,-3906,-69`, a lake at `-fd-at 3397,-1165,-135 -fd-cam cinema`, the Show's splash `-replay splash-show-wide -fx-cam top -holds 14.25,14.5,14.9,15.8` (docs/shots/0350/).
