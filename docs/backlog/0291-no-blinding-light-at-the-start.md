---
id: 0291
title: On the iPhone no light blinds at a run's start: the lamps' lit air stops at the surface and never veils the car
status: shipped
priority: P0
size: S
lens: player-feel
created: 2026-11-18
pr: 435
by: operator
---

## Why
The owner, on the TestFlight build after 0270 (#406) shipped: "still at the beginning of our stunts we have a bright shining
light that reflects off the car that makes it impossible and blinding to the user." The 2026-11-13 playtest had said the same
("the starting light is too bright on the car"). 0270 capped the set lamps on the paint, and nothing clips any more, so its
`-luma` numbers came out clean while the opening still blinded.

## What
Render-only, iOS (`ios/ColdGas/Render/`):
- `Shaders.metal` `cg_glow_*`: each lamp's lit air is film.js's closed form integrated along the pixel's ray up to the
  surface it hits (the resolved depth), as on the web. The air in front of the car's own box is kept to 15 % (`HERO_AIR`).
- `Renderer.swift`: the glows draw in their own small pass over the resolved HDR frame (before the bloom), and the depth is
  resolved whenever they draw (it already was for Anime). The roadster's box is computed once.
- Debug: `-luma` adds `white97` (the share of the frame at luma ≥ 0.97) and `carFloor` (the car's 10th-percentile luma: the
  veil). `scripts/glare.sh` (`make glare`) is the gate.

## Cause (measured, simulator, muted)
- Not the key or spot lights (0270's cap holds), not the paint's clear coat, not the bloom, not the exposure, not EDR.
- The lamps' lit air. On the web, film.js integrates each lamp's in-scattering along the ray **up to the surface**: "the
  glow stops where geometry stands in front of it". The native port drew it as a camera-facing billboard with its depth
  pulled 4.5 m toward the lens. Every pixel near a lamp got the lamp's whole halo (both tails of the ray, π/h), including
  the car's. The Show's and the Wall's base uplights stand at x = ±2.4 m beside the mark (z −5.3), and the car starts
  between them at z −6. At every run's opening the run-up camera looked through one of those halos at the car. The tyres,
  the glass and the shadow side came up to the paint's grey: a luminous grey-white cloud where the car should be.
- Attribution, Show at t = 3 s: `-gpu-skip glows` takes the haze away entirely, and `-gpu-skip bloom` leaves it as it was.
- EDR: the drawable is `bgra8Unorm` with no extended range, and the film pass clamps to 1. Nothing exceeds SDR white on an
  HDR or EDR iPhone. The simulator's frame is the phone's frame, apart from MetalFX's upscale.

## Result
`scripts/glare.sh`, t ≤ 3 s of each run. Before is main at cbda30cf with the new probe, after is this branch, on the same
simulator. Luma is sRGB 0–255. The car's pixels are the convex hull of its projected box.

| | white97 max (frame ≥ 0.97) | car near-white max | car floor (p10) avg / max | car mean | car peak | frame peak / mean |
|---|---|---|---|---|---|---|
| Show | 0.000 → 0.000 % | 0.00 → 0.00 % | **77 / 100 → 24 / 44** | 148 → 92 | 224 → 213 | 224 / 31.4 → 214 / 29.9 |
| Wall | 0.000 → 0.000 % | 0.00 → 0.00 % | **70 / 70 → 15 / 15** | 145 → 86 | 224 → 224 | 224 / 30.7 → 224 / 29.3 |
| Lineup | 0.000 → 0.000 % | 0.00 → 0.00 % | 3 / 4 → 2 / 4 | 53 → 53 | 253 → 249 | 255 / 60.7 → 255 / 60.7 |

Nothing reaches white, before or after (0270's cap holds), so the haze passed every clipping measure. The car's floor shows it.
Before, the darkest tenth of the car (tyres, glass, the shadow side) sat at 70–100, a grey veil. After, it sits at 15–44: the
car reads as a white car with dark tyres and glass inside the lamp's halo. With the glows off entirely (`-gpu-skip glows`,
Show) the car's mean is 36, so the lit air had been most of the car's brightness. The Lineup has no lamp at its start and is
unchanged. Shots: docs/shots/0291/ (before-/after-, Show and Wall at 1.5 s and 3 s, the Lineup at 1.5 s).

## Acceptance criteria
- [x] The first 3 s of the Show, Wall and Lineup runs pass `scripts/glare.sh`: in every measured frame, ≤ 0.5 % of the frame
  at luma ≥ 0.97, ≤ 0.5 % of the car's pixels near white (all channels ≥ 235), and the car's floor (10th-percentile luma) ≤ 60.
- [x] The lamps keep their halo in the air round them and over the set. The car reads crisp inside it: tyres dark,
  glass dark, white paint lit.
- [x] `make test` (52 run vectors) passes: pixels only.
- [ ] The owner, on the iPhone: a Show and a Wall run open on a clear car.

## Test plan
- Simulator only (`ColdGas iPhone`, muted, under `/tmp/coldgas-sim.lock`), the same build with and without the fix:
  `OUT=… scripts/glare.sh <app>`. It runs `-play -course show|wall|lineup -autopilot -timescale 0.25 -luma <course>
  -luma-every 4 -luma-snap 0.3,1.5,3.0` and gates t ≤ 3 s.
- Attribution: the same runs with `-gpu-skip glows` and `-gpu-skip bloom`.
- `cd ios && make test` for the vectors.

## Out of scope
The web (film.js already stops the glow at the surface). The glows' strength in the open air is unchanged.
