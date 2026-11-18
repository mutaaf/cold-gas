---
id: 0280
title: On the iPhone the frame stays sharp and even, and the game has three looks (Real, Anime, 8-bit)
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-17
pr: 428
by: operator
---

## Why
The owner: "The graphics on this are still very choppy and blocky. It seems like we're not realistic enough and efficient
enough. Maybe we can put a couple of ways to skin this, like an anime skin and an 8-bit skin, and then the current version skin."

## What
Render-only, iOS (`ios/ColdGas/Render/`, `ios/ColdGas/UI/SettingsView.swift`); the sim, the scorer and the vectors are untouched.

**Choppy and blocky (cause).** The governor judged every frame against 120 Hz's 8.3 ms, always, on a display link that
allowed 60–120 Hz. A frame that didn't fit at 120 took pixels first, 5 % a step, down to the 0.5 floor, so the scene was
drawn at a quarter of the screen's pixels and MetalFX stretched it 2× (the blocks). A frame that still missed its 8.3 ms
deadline was shown for 16.7 ms between 8.3 ms ones (the judder). #365 measured the open Duo's main pass at ≈ 17 ms at half
resolution and the Pro Max holding 120 only just: on most phones 120 Hz at a sharp scale was never on the table.

**The fix: the cadence is the governor's too.** `Renderer.cadence` (120 or 60) and the stage view's link at that one rate
(min = max = preferred), so every frame is shown for the same time. At 120, pixels give way only to 0.8 (`sharpScale`); past
that the cadence halves to an even 60, which doubles the budget (16.7 ms) and holds the scale at 0.8 or above. It returns to
120 after 10 s under 40 % of 60's budget at a sharp scale (at most twice a session). `-fps 60|120` pins it. #365's hysteresis
and target cache (fewer, cheaper scale steps) stack on this without overlap: this PR doesn't touch the step logic or the targets'
reuse.

**Three looks** (`Look.swift`, Settings → Look, `cg.look` in UserDefaults, default Real; `-look real|anime|pixel` for shots):
- **Real**: the look as it was.
- **Anime**: `Shaders.metal` `brdf(toon:)`: light in three flat tones, a hard GGX highlight on polished panels only, no
  clear coat, a cel shadow edge, set lamps with a pool's edge; the sky in four flat, punchier bands with bigger stars; in the
  film pass ink from the depth's second difference (flat to any plane, so no floor lines) and long brightness jumps, a brighter,
  more saturated print and speed lines over 28 m/s or in the crash's slow motion. Cost: the main pass's depth resolved (sample
  0) and eight extra reads a pixel in the film pass.
- **8-bit**: the scene at a fixed ≈ 240 columns (5 px blocks on a 1206-wide phone), no mirror, no bloom, no MetalFX, a
  125-colour palette through a 4×4 Bayer dither, shown as exact whole blocks (nearest neighbour). The cheapest mode.
Every look runs the same passes for the car, the stage, the sky and the effects (sparks, puffs, plumes, mist, chips), so
they all take it; the HUD is SwiftUI over the scene and never changes.

The 1.2.0 notes and its What's new card (Settings) say so.

## Acceptance criteria
- [x] Settings → Look: Real, Anime, 8-bit, kept on the device, Real by default; switching applies on the next frame.
- [x] Each look in a run and in Roam on the simulator (shots in the PR).
- [x] The stage view's link runs at one fixed rate; the governor halves the cadence before the scale goes under 0.8.
- [x] `make test` (52 run vectors) passes: pixels only.

## Test plan
Simulator only ("ColdGas iPhone", always `-mute`): `-look real|anime|pixel -play -autopilot -freeze 1900` (a run) and
`-look … -roam show` (Roam), screenshots of each. `-bench -look …` on the title's loop for the CPU and GPU frame. `make test`
for the vectors, `node scripts/check-backlog.mjs`. On a phone (the owner's): Settings → Look, fly the Show and roam; the
debug line (For nerds) shows the render scale and the cadence.

## Out of scope
Free Drive's own world shaders (the post passes give them the look's ink, palette and blocks; their lighting stays physical),
the web game.
