---
id: 0100
title: The wet slab's reflection, Free Drive's far-tree ring and the burn's haze over the Wall hold still on every screen
status: ready
priority: P1
size: M
lens: performance
created: 2026-10-27
pr:
by: operator
---

## Why
0097 (#136) put phones and tablets on the desktop's look. By operator decision (2026-10-27) it shipped parity first
and re-baselined four `chromium-swiftshader phone` regions in docs/flicker-budget.json to the high look's numbers.
Each of them is still at or under the desktop label's value for that region, so this is flicker the desktop already
has, and phones have it now too. One-layer-off attribution (`flicker.mjs --phone --gl=swiftshader --only=…` with
`FLK_PRE`, main vs branch on the same machine; LESSONS 0051 method):

| region | main (mid) | high, FXAA | old limit | with the layer off |
|---|---|---|---|---|
| show-title/ground | 1.32 ‰ | 2.44 ‰ | 1.82 | mirror frozen: 1.85 |
| drive-road/other | 4.16 | 9.59 | 5.20 | far trees hidden: 5.19 |
| drive-road/sky | 0.85 | 1.96 | 1.35 | far trees hidden: 0.80 |
| endless-cruise/ground | 4.71 | 6.01 | 5.89 | far trees hidden: 4.77 |
| show-live-jets/wall (after #138) | 76.99 | 102.28 | 96.24 | haze and halos off: 88.32; DPR 1.5: 97.72 |

- **The wet slab's mirror** (src/render/film.js createMirror): a half-resolution planar reflection. The heat map
  puts the pops on the reflection of the Wall's truss and the floodlight. 0097 already sized the slivers to the
  mirror's target (2.95 → 2.44). What was tried and left out: one mip softer in standing water (`lod` floor 0.8 →
  1.9 in wall.js wetSlab) reached 1.83 against 1.82 but visibly smears the car's reflection on desktop. A
  temporal blend of the mirror with the last frame (keep 0.5–0.6, dropped above a few px/frame of camera motion)
  reached only 2.32. DPR 1.5 made it worse (4.29), so the mirror's resolution matters.
- **The far-tree ring** (`tree-far`: road.js `tree1`/`treeR1`, endless-world.js conifer1/broad1, `high` only).
  The trees there are 4+ px wide, so this is ordinary edge aliasing. Coverage alpha (opaque list or transparent),
  widening to a 2 px footprint and a larger hide radius all changed nothing or moved pops between regions. Note
  that the probe's ID pass draws `tree-far` instances without their hide-radius collapse, so region accounting
  shifts when they change; judge by the frame-wide total as well as by region.
- **The film look's haze and lamp halos over the Wall during the burn** (src/render/film.js HazePass; the fifth
  region, approved after 0063's still release camera, #138, cut main's number to 77). Mist count (1800 vs 900),
  the mirror and the shadow size had no effect there. Its stored phone budget (115.0089) was left as is: it
  already holds the high look, under the desktop label's 128.6584. Calm it until it's back under main's 76.99 on the
  same machine.
- Shadow map size: no effect anywhere. The haze lowers the title's flicker but raises the live burn's wall.

## What
Calm all three on every screen without dropping content. The candidate is temporal AA for the composer (a jittered
projection plus history with reprojection from the depth texture the high tier already keeps). That would also help
the parked row, the truss and the desktop's SMAA shimmer. Smaller alternatives: the mirror at a higher fraction of
the drawing buffer, measured for cost on the phone profile; reprojected history for the mirror only.

## Acceptance criteria
- [ ] The four phone regions back at or under their pre-0097 limits: show-title/ground 0.6966, drive-road/other 4.1619, drive-road/sky 0.8477, endless-cruise/ground 4.7021 (or, on a machine where main reads differently, under main's same-machine numbers by the gate's rule), and those values restored in docs/flicker-budget.json
- [ ] No region rises on either swiftshader label (desktop and phone)
- [ ] The reflection and the far forest look as they do now in screenshots (no visible smear or thinning)
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
flicker.mjs both screens, main vs branch on the same machine; `--heat` for the title's ground and drive-road;
`perf-show.mjs` / `perf-drive.mjs phone` for the cost; scripts/shots-look.mjs for the look.

## Out of scope
Changing the tier contents (what 0097 made the same on every device).
