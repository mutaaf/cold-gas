---
id: 0270
title: On the iPhone the car is never blinding at a run's opening (the Show, the Wall, the title)
status: shipped
priority: P0
size: S
lens: player-feel
created: 2026-11-16
pr: 406
by: operator
---

## Why
The owner, playing the TestFlight build (main): "At the beginning of the ramp or the beginning of the wall or beginning of
the show, we can't have the lights flashing on the car so brightly that it reflects and you can't see anything. It's
blinding and you can't see the car." A playtester had said the starting light is too bright on the car. #365 (open) raises
the bloom threshold and dims the headlamps, and notes that a bright haze remains at the Show's opening.

## What
Render-only, iOS (`ios/ColdGas/Render/`), kept small so #365 merges on top:
- `Shaders.metal`: a set lamp lights the car's own materials (flags.w & 4) to at most `HERO_LUX`; the bloom's high pass
  gets a soft knee (only the light over the threshold blooms) and caps its input at 16.
- `Renderer.swift`: the car's materials (`roadster-*`, and #365's `drive-*`) carry that flag.
- `CarState.swift`, `Crash.swift`: with Reduce Motion or Dim Flashing Lights, no headlamp wake-up flare and no crash flash.
- Debug tooling: `-luma <tag>` (the glare probe: the car's clipped and near-white pixels and the frame's peak, per frame,
  with `-luma-snap` PNGs). Every capture ran muted (main's `-mute`).

## Acceptance criteria
- [ ] The first seconds of the Show, Wall and Lineup runs and of the title loop: no car pixels clipped to white beyond
  specular glints, no frame-wide bloom wash (before/after frames and numbers in docs/shots/0270/).
- [ ] The set lamps still light the curl and the set as before; the car under them reads as a lit white car.
- [ ] Reduce Motion or Dim Flashing Lights: no flare, no flash. No full-frame flash above 3 a second (WCAG 2.3.1).
- [ ] `make test` (52 run vectors) passes: pixels only.

## Test plan
Simulator only (muted, `-mute`), one at a time: `-play -course show|wall|lineup -autopilot -timescale 0.25 -luma <course>
-luma-snap …` and the title's loop, before and after, the same moments. `make test` for the vectors.

## Cause (measured, simulator, muted)
- The set's lamps are physical (candela, inverse-square). The Wall's and the Show's base uplights (2160 cd each) stand at
  x = ±2.4 m beside the mark (z −5.3); the car starts at z −6 and climbs the curl through their cones 1–5 m away, where
  inverse-square puts 100–2000 lux on white paint against a 1.7 lux key. The title's loop shows the car on the curl right there.
- The bloom's high pass was a hard step: any pixel over 0.82 sent its whole colour into the chain, so the lit white car became
  a frame-wide glow round it (the "bright haze" #365 notes).
- No auto-exposure (the exposure is fixed per course), no strobes aimed at the camera; the headlamps' wake-up blip (×1.7 for
  half a second) is the one flash, small.

## Result (`-luma`, t ≤ 7 s of each run, the title's loop t ≤ 9 s; before → after)
| | car near-white (≥ 235) avg / max | car clipped max | car contrast (sd) | frame peak | frame mean |
|---|---|---|---|---|---|
| Title | 8.09 / 21.38 % → 0.65 / 5.04 % | 0.20 → 0.00 % | 37.2 → 45.9 | 255 → 252 | 49.8 → 41.7 |
| Show | 0.29 / 7.04 % → 0.00 / 0.12 % | 0.20 → 0.00 % | 40.3 → 44.0 | 255 → 253 | 41.3 → 36.4 |
| Wall | 0.03 / 0.84 % → 0.00 / 0.02 % | 0.20 → 0.00 % | 40.6 → 41.9 | 255 → 254 | 37.4 → 34.0 |
| Lineup | 0 / 0 % → 0 / 0 % | 0 → 0 % | 51.6 → 51.6 | 255 → 255 | 59.9 → 59.9 |

No frame's mean rose by more than 25/255 between samples, before or after (no full-frame flash). Shots: docs/shots/0270/.

## Out of scope
The web game (the same lamps there are a separate ticket if it shows), Free Drive's sky (#365).
