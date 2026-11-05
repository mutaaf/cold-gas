---
id: 0163
title: "The iPhone app's picture is the web's: the night sky, the launch complex, the lit wet slab, the row's light, bloom, the mist"
status: in-progress
priority: P1
size: L
lens: platform
created: 2026-11-04
pr: 257
by: operator
---

## Why
With the director ported (0158) the framing matches, and the native frame looks far cheaper beside the web's at the same moment: a
navy card for a sky, no rocket, a dark matte floor, a dim row, no glow, hardly any mist.

## What
Runs on: the operator's Mac (Xcode, Metal), and on the phone for the bench.

What was wrong under the hood (none of it a units mismatch: spots, points, the key, exposure and AgX already matched three's):
- The materials had no `scene.environment` at all, nor the course's hemisphere light: a made-up `skyFill` stood in. Most of the
  floor's light on the web is the night studio's softboxes at a grazing angle, and most of the paint's.
- three's `AdditiveBlending` is (src alpha, one), and the Wall's beams, glow decals and spill write (colour · a, a), so `a` counts twice
  on the web. Native counted it once: its searchlights were far too strong.
- The Wall's and Show's fog is `FogExp2`; the exporter dropped the density and native fell back to a linear fog. The Lineup's rim
  light was skipped. The spot's penumbra and the clear coat's visibility term weren't three's.
- 0159's mist held its width on an upright phone, 2.6× narrower than the web's points: about 7× less area.
- The film grain was added in linear light, which lifted and speckled a near-black sky.

What's new:
- `scripts/native-stage-page.js`: the course's PMREM read back through three's own `textureCubeUV` into a cube of half floats; the launch
  complex with its flood lighting baked into vertex colours (`bakeComplex`), its beams, lamps and beacons; the wet slab's puddles as a
  tile; film.js's look values. `src/render` only gained two `export`s.
- `Shaders.metal`: the environment and hemisphere with three's split-sum indirect, the sky and stars by ray, the height fog and the
  sun's scatter in each material (`hazed`), glints and lit-air billboards, the wet slab, bloom, film.js's vignette.
- `Renderer.swift`: the mirror, bloom's passes, and `shed`.

Seen at store-capture size: the smear's five taps ghosted thin bright edges into blocks on the open Duo; now nine, at quarter size.

On purpose unlike the web:
- The mirror draws only what stands on the stage, the row, the car and the complex, at quarter size with no MSAA, smeared once; the
  slab reads one texel. The web's is the whole scene at half size with five taps.
- The film's depth-based pass is split up: fog in each material, the lamps' in-scattering as billboards.
- Bloom is a quarter-size chain added in one pass, not UnrealBloomPass's ten blurs. Same threshold, strength and radius.

- The mist: one web point in five (300 at most), each denser by √5, the web's size, under a budget of 3 screens of overdraw. The web's 1800
  at its size were about 23 M fragments a frame at 660×1434. Shrinking them to fit drew strings of beads.
- Anisotropy 4, not 8. The row's red outline is drawn twice as wide: the web holds it at 1.5 px in a vertex shader not ported here.

Left out: the rocket's vapour vents, and a static fire's glow and steam.

## Acceptance criteria
- [ ] Show, Wall and Lineup at 440×956 beside the web's frames at the same moments: a person calls them the same game.
- [ ] On a cool iPhone 15 Pro Max at 120 Hz: presentation p95 ≤ 8.34 ms with GPU p95 under the frame at scale 0.5, shed 0. Nobody has run
  this outside the simulator. `-bench -scale 0.5`, then each of `-gpu-skip env,stars,haze,wet,mirror,complex,lattice,floodbeams,glints,glows,bloom,mist`.
- [ ] A hot phone or Low Power Mode drops the mirror (`LOOK shed` in the log), never the cadence.

## Test plan
`node scripts/native-stage.mjs show wall lineup`, `make rules` in `ios/`, `npm run -s vectors -- --check`. Fly each course with
`-timescale 1,0.03 -cam-log` and put the frames beside the web's. `-fx-log` prints the mist's fragments.
