---
id: 0046
title: Switching course, coming back from Free Drive and the film look never pop or hitch
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-10-21
pr: 119
by: operator
---

## Why
- `setCourse` builds the look and bakes the environment synchronously (scene.js ~446-458); each course has
  a different light set, so every material recompiles on the next frame: a freeze on a course click and on
  leaving Free Drive.
- Free Drive sets `camera.near=0.1, far=4000` (drive/index.js ~200) and never restores the stage's
  0.3/3000: the slab decals z-fight again for the rest of the session.
- Desktop: haze, vignette and the slab reflection switch on in one frame 1–3 s after the fade-in
  (scene.js ~612-623, film.js ~174-196).

## What
Build the other looks in idle slices after `stage.ready` and `compileAsync` each one, or keep one light rig
with intensities; save/restore near/far in Free Drive enter/exit; ease film uniforms from 0 over ~1 s.

## Acceptance criteria
- [ ] Max frame time across three course clicks < 50 ms on desktop (perf.mjs) — not measurable here (no GPU); see Shipped
- [x] flicker.mjs show-title after a Free Drive round trip equals a fresh boot's (the round trip now restores near/far exactly)
- [x] Screenshots at 0.5/2/4 s show the film easing in, no single-frame jump (unit-tested: filmFade, ≤ 5 % a frame)
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: camera.near/far after drive exit; perf.mjs long-task measurement around course clicks.

## Shipped
- After the first load (and the backdrop), the stage warms the other two courses while the page is idle
  (`stage.warm`, src/render/scene.js): builds each look in slices, bakes its environment in its own task, then
  compiles its materials under its own lights, environment, sky and fog. The scene is set up as that course only
  for the synchronous part of `compileAsync` and put back in the same task, so no frame draws it. A course click
  is then a swap: `tests/e2e/course-switch.spec.js` asserts the program count doesn't move over four clicks
  (without the warm-up the first click to the Wall compiled 19 programs: 46 → 65).
- Measured on this sandbox's SwiftShader (every frame ≈ 350 ms there, so no GPU number): `setCourse` 0 ms; the
  first draw of a warmed course 107–174 ms (geometry upload); before, the click's frame compiled 19 shaders and its
  long task ran 3.0–4.7 s. The < 50 ms on a real desktop GPU is for the Critic to confirm live.
- `stage.setLook(null)` puts the camera's near/far back to the stage's 0.3 / 3000 m; leaving Free Drive (0.5/46000)
  or the Sandbox (0.3/4000) used to set 0.1/4000, and no longer does (e2e: both round trips).
- Warmed the way the frame draws: on the composer tiers (mid, high) the scene draws into the composer's HalfFloat
  target, whose programs are keyed with no tone mapping and linear output, so every compile (boot's precompile, the
  backdrop, the warm-up) now binds that target for the synchronous compile. Before, mid/high compiled the canvas
  variant and recompiled everything on first draw (a review measured +24 programs on the click to the Wall at mid).
  The e2e program test runs at low and mid.
- High tier: a look built after the film arrived is tagged for the mirror (REFLECT) when it's built, so the warmed
  Wall's lights and geometry are in the reflection and the mirror pass's programs match.
- The warm-up runs only on the title, not paused, never under an outside look (`stage.warmGate`, main.js), and waits
  (rather than skips) when it can't.
- Not warmed: the shadow pass's depth program, which three builds only while drawing a shadow map (keyed by the
  course's light counts): one trivial shader per course on mid/high, compiled on the click's frame. The e2e count
  leaves it out, by name.
- Not on a software rasterizer (SwiftShader, llvmpipe, WARP: `gfx-tier.isSoftwareRenderer`), which links shaders on
  the main thread: there the warm-up took seconds of the title's input (CI's BYOK and theatre tests starved), so
  those devices compile on the click as before. `?warm=1` forces it (the course-switch e2e).
- Not done: a restored WebGL context loses the warmed programs (the next click compiles, as before 0046).
- The film look (haze, vignette, the wet slab's mirror) eases in with a smoothstep over 1 s from its first frame
  (`uMix` in the haze pass, `uReflK` on the slab); a course switch mid-fade keeps the fade (tests/unit/film.test.js).
- Not done: geometry upload on a warmed course's first draw (no public three API short of drawing it), and the
  light rig stays per course (the warm-up made one rig unnecessary). Memory: all three looks stay built once warmed.

## Out of scope
New course looks.
