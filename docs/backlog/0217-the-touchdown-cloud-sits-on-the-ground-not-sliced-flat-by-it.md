---
id: 0217
title: The touchdown cloud sits on the ground instead of being sliced flat by it
status: ready
priority: P0
size: M
lens: authenticity
created: 2026-11-12
pr:
by: critic
---

## Why
The reveal's landing is the shot everyone remembers: the car set down "in a large white condensation cloud" and
"drives away out of the cloud" (REVEAL_RESEARCH §2.1.4, l.175 and l.181; Moravy's "whitish cloud", OFFICIAL, l.182).
Ours has a straight edge across the bottom. On production, 390×844 touch (`index-WwfMlofP.js`), at touchdown on the
Show, the cloud ends in a **straight horizontal line 187 px long at y 545**. Nothing in the frame lines up with it: not
the pad, the lines or the car. Below that line the bare asphalt starts at once
(`docs/critique/2026-11-12-1000/show-r2-land.png`; also `show-r1-land.png`). The Lineup's touchdown has the same
straight base, with a step in it (`lineup-r1-land.png`). It reads as a grey card stood on the pad, not vapour lying on
it, and it's at the moment the player is looking hardest.

The cause is in `src/render/plumes.js`:
- The mist is `THREE.Points` drawn at `gl_PointSize`, so each one is a screen-aligned square. Its depth is tested
  against the ground, and nothing softens it near the ground (l.77–87).
- A particle that reaches the ground is clamped at `groundY + 0.15` m (l.150–151). Its sprite is metres across, so the
  ground's depth cuts off everything below its centre on a straight line.
- Hundreds of them stacked at the same height make one long straight edge. Where they sit at slightly different
  depths, the edge has steps.

## What
In `src/render/plumes.js`, make the mist's lower edge fade into the ground rather than end on it. Any of these would
do, measured against the bar below:
- Fade each sprite's alpha by its height above `groundY` in the fragment shader, using view depth or world y.
- Soft particles against the depth texture, where the tier has one (`scene.js:472`, high only), with a height-fade
  fallback on low and mid.
- Lift and flatten the ground-hugging particles so that no sprite crosses the ground plane.

Keep the cloud's look as it is above the ground: its density, its spread outward along the ground (l.149) and its
fade-out time. Don't change the sim, the camera or the director.

## Acceptance criteria
- [ ] At touchdown (`S.run.phase === 'landed'`, the first frame) on the Show, the Wall and the Lineup, at 390×844 touch
      and 1440×900, measure the straight edge in the mist only. Take the frame with the mist on and with
      `points.visible = false`, diff them (luma), and threshold the diff at 8 levels. The mask's lower boundary has
      **no horizontal run longer than 40 px** where the diff falls from ≥ 20 to < 5 within 2 px. Today that run is
      about 187 px on the Show phone frame. Add the probe as a script or a mode of `scripts/look-audit.mjs`, and put
      before → after numbers in the PR.
- [ ] Side-by-side screenshots of each touchdown (before → after) in the PR: the cloud lies on the pad, with no straight
      base line.
- [ ] Phone frame time is no worse (`scripts/perf.mjs` or the e2e perf probe), and on `low` the mist still draws.
- [ ] Flicker: `flicker.mjs --only=show-replay` within budget, with the same `--only` list on main and the branch
      (LESSONS 2026-11-11).
- [ ] `ref-hash` unchanged (render only).

## Test plan
- A unit test on the mist's shader or material: a particle at `groundY + 0.15` with its sprite crossing the ground has
  alpha that falls to 0 by the ground plane, not at it. Or the e2e/look probe above, held to its 40 px bar.

## Out of scope
- The jets' cones and shock diamonds.
- The cloud's colour under the red set lights.
- The mist pool size per tier (0045).

## Critic re-measure (2026-11-14)
Still unbuilt; render unchanged since filing. On production `index-BtiHHqbj.js`, 390×844 touch DPR 2, Show reference run,
I diffed the touchdown frame (`S.run.phase === 'landed'`) against the same view 450 ms later, after the mist had
cleared (luma, threshold 12). From x 60 to x 760 (device px, 90 % of the width), the mist's lowest row sits at
**y 1251–1259**: a level line about **350 CSS px long, flat within 4 CSS px**. That's longer than the 187 px measured
at filing. Frame: `docs/critique/2026-11-14-0423/phone-show-touchdown.png`. The 40 px acceptance bar stands.
