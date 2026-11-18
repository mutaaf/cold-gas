---
id: 0290
title: On the iPhone, Anime reads as cel animation and 8-bit as pixel art, not filters over Real
status: in-progress
priority: P1
size: M
lens: player-feel
created: 2026-11-18
pr: 434
by: operator
---

## Why
The owner, on #428's three looks: "the anime and 8 bit modes are not properly done." Looking at #428's shots:
- **8-bit** read as a grainy dither filter over the Real render. Its blocks were about 5 px (≈ 240 columns), a 4×4 Bayer
  dither over a 125-colour cube made static over everything, and the stage's trusses turned to mush.
- **Anime** read as Real with thin lines. A lamp washed the car white, the ink drew seam lines across the curl (the depth's
  second difference caught every facet of the tessellated curve, and the brightness-jump ink caught every band of light),
  and nothing about it looked like cel animation.

## What
Render-only, iOS (`ios/ColdGas/Render/Look.swift`, `Shaders.metal`, `Renderer.swift`, `Crash.swift`, `ios/ColdGas/World/World.metal`).
The sim, the scorer and the vectors are untouched.

**Both drawn looks: light through a ramp, not a BRDF** (`celRamp`, `drawnLight`; `world_cel` for Free Drive's land, roads and
props). The key (its shadow's edge made hard), every set lamp (the car's HERO_LUX cap kept), the hemisphere and the
environment's diffuse are summed as irradiance; its brightness picks a band (deep, shadow, mid, lit), each a fixed level of the
material's own colour. A lamp that would blow white paint out lights it to the lit band and no further, so neither look can
wash the car out on its own. Shadows take a violet-blue tint, never grey; the lit band takes the light's hue (a red lamp's pool
reads red). No reflections, clear coat or wet mirror; a metal reads as its tint. The set's beams, pools and spill are three
flat steps of their own falloff at 60 % (a faint beam a flat shaft). The lamps' soft halos (film.js's lit air) are Real's
only: quantised, they drew grey discs over the car. Smoke, dust and the jets' mist are cel puffs: two flat tones with a clean
edge (8-bit: one), the faint skirt dropped. The haze comes in four flat layers of depth, as a painted background's.

**Anime**
- The ramp with an eased (about a pixel) edge, a hard highlight shape where the GGX lobe passes a level on polished panels,
  a hard rim on the car (faint on what stands) so its outline reads against the stage.
- A painted sky: a deep indigo gradient to a violet horizon at night (the course's own dusk, saturated, in Free Drive), soft
  clouds in the lower sky lit on the side toward a big flat moon (shaded side, two pale craters, a glow and a halo ring) 17°
  up, fixed in the world a little left of where the lens first looks when a run (or a drive) starts; sparse stars.
- Ink at the render size from the depth: silhouettes where a neighbour is farther than the plane through the pixel predicts
  (in 1/distance, affine across any plane, so a floor seen edge-on reads nothing; inked on the near side only; a car a few %
  nearer than the curl behind it is caught), thick out to 120 m (3 px at the render size), thinner to 320 m, a hair beyond; creases where the normals rebuilt from the depth on the four quarters round a pixel differ
  by more than ≈ 40° (a panel's edge, a rail), thin, faded by 110 m. A tessellated curve (the curl, 5–10° a facet) and a
  texture's seams never cross it: **no seam lines on the curl**. The brightness-jump ink is gone.
- A print with no path to white: linear to 0.8 then a soft shoulder per channel (a lit red stays red), saturated 12 %; bloom
  only over 1.6 (the lamps themselves, never a lit panel), at 60 %.
- Speed lines over 28 m/s or in the crash's slow motion (tapered rays from the edge); an impact frame on a landing (≥ 12 % of
  the hardest sink) or a hit big enough for the slow-motion beat: 50–100 ms of two tones (light parts in ink on paper, a red
  middle, dark rays), at most one each 0.6 s, none with Reduce Motion or Dim Flashing Lights.

**8-bit**
- ≈ 160 columns across the short side (8 px blocks on a 1206-wide phone, 151×328), shown as whole nearest-neighbour blocks.
- The same ramp, hard-edged; textures read a mip coarser (their broad tone, not their grain).
- 32 fixed colours chosen for this game at night: seven night blues, six neutrals for concrete and the white car, six reds
  for the loop, the LEDs and the lamps, five warms for sparks, dust and the dusk, four greens for Free Drive's land, three dusk
  violets and the jets' ice blue. Each pixel takes the nearest in Oklab: **no dither** on the scene.
- A 1 px outline in the palette's darkest colour on every silhouette (the same depth test at 160 columns), a real corner
  (≈ 50°) darkened by half, and a pixel of rim light round the car.
- A sky of flat palette bands with a one-pixel checker only where two bands meet, single-pixel stars fixed to the sky (each
  star is the one pixel its direction projects into, so it steps with the lens and never smears), and a pixel moon (or sun).
- Effects take the grid and the palette (they're drawn at 160 columns and quantised); a spark is at least a pixel wide.
- The lens snapped each frame so the car lands on a pixel's centre: the car never swims, the set steps in whole pixels.
- No bloom, mirror or MetalFX: still the cheapest look. Both looks draw no mirror (Anime's cost over Real is the ink's nine
  depth reads a pixel and the resolved depth, against the mirror's pass it no longer draws).

The car, the stage, the sky, the effects, Roam and Free Drive all take each look (the same passes). The HUD is SwiftUI and
keeps its type in every look.

## Acceptance criteria
- [x] 8-bit is ≈ 160 columns, 32 colours, no dither on the scene, a 1 px outline; it reads as pixel art on the pad, the curl,
  in the air, in a crash and in Roam (shots in the PR).
- [x] Anime has hard bands with tinted shadows, a painted sky with clouds and a moon, clean ink (thick silhouettes, thin
  creases, none on the curl's facets), speed lines and impact frames; the car is never washed white (shots in the PR).
- [x] Neither drawn look blows the car out on its own, and Real is unchanged.
- [x] `make test` (52 run vectors) passes: pixels only.

## Test plan
Simulator only ("ColdGas iPhone", always `-mute`, the shared lock held round each session): for each of `-look real|anime|pixel`,
`-play -autopilot -freeze <tick>` on the pad (200), the curl (1900) and in the air, `-play -script crash-show-carry5 -freeze
<tick>` for a crash, and `-roam show` for Roam; inspect each shot. `cd ios && make test` for the vectors,
`node scripts/check-backlog.mjs`. On a phone (the owner's): Settings → Look, fly the Show, crash it, roam and Free Drive in
each look; turn on Reduce Motion and check there are no impact frames.

## Out of scope
A pixel font for the HUD in 8-bit (the HUD keeps its own type); the web game; the glare at the start of stunts in Real
(0291, another branch).
