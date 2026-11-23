---
id: 0357
title: The Show's last second of brake is never shot across the splash tank, so the player sees the floor the car lands on
status: shipped
priority: P0
size: S
lens: player-feel
created: 2026-11-22
pr:
by: critic
---

## Why
The retro-burn down onto the mark is the climax of the stunt. In the real reveal, the down-jets fire and the car
touches down about t0 + 3 s (docs/REVEAL_RESEARCH.md §2 Timeline), in plain view on the pad. On the Show the game now
hides that ground from the player. The tracking rig that follows the carry down to the pad (FOLLOW, `src/render/director.js:544`:
`want = car + (21, clamp(0.5·y + 1.5, 2.2, 14), 2)`) stands about 25 m out on +x and 2.3–3.5 m up. Since #464 (0340), the splash tank (x 9.6–18.4 incl. walls, z −40.4…−23.6, coping 1.1 m,
`src/sim/courses.js:213`) stands between that rig and the car's line. 0355 (#474) moved the **landed** stand out of the
tank and that holds, but the FOLLOW rig before it still looks straight across the tank.

The critic measured this on production (`7b75946` / `2cd66d3`, same `director.js`). The reference was flown at a true
60 fps: the sim and the director stepped together at 1/60 s from Go, with the page's own live step held
(`docs/critique/2026-11-22-1536/brake-prod.mjs.txt` → `brake-phone.json.txt`, `brake-desk.json.txt`,
`brake-floor.txt`).
- **390×844 touch and 1440×900 alike:** from **12.78 s** (car 2.7 m up) until the cut to the landed stand at **13.667 s**
  (car 0.99 m up), the floor under at least one wheel is behind the tank's walls in **18 of 18** sampled frames (every
  3rd). Under all four wheels from 13.33 s (car 1.37 m) to the cut. That's ≈ 0.9 s of the final brake where the player
  can't see the ground the car lands on.
- The tank's projected box grows to **0.27** of the phone's screen (0.21 desktop) just before the cut.
- **The frame (`brake-phone-dx0-04-t13.583.png`, car 1.08 m up, 06 BRAKE):** the coping, the salmon LED rim and the
  water fill the lower third of an upright phone, full width. The car hovers just above the coping line, so it reads as
  a car setting down **into the pool**. The next frame is a 12.5 m hard cut to the landed stand (`…-05-t13.667.png`),
  0.57 s before touchdown, and only then does the floor appear.
- **Before 0340 there was no tank on this line**, so this is a regression of the core stunt's last second, not a design
  choice. A film crew would not shoot the money landing from behind a water tank.

Players: operator focus (1), the core loop on a phone. This is the moment the score is decided. No funnel number moves
directly. It's the frame every share clip and store shot of a Show landing contains.

## What
In `src/render/director.js`, the Show's FOLLOW rig (`:544`, and the `!landed` fall rig at `:550` if it gets the same view) keeps its
sight lines to the car's four wheel footprints on the floor (x, 0, z under each wheel) clear of every tank's box. Use
`src/render/tank-sight.js` (`sightBlocked`, already used by the landed stand). On a block, either:
- raise the rig until the floor under the car clears the 1.1 m coping (the rig is at 2.3–3.5 m in the blocked frames;
  the geometry needs ≈ +1.5 m at 13.6 s), easing in so it never jumps; or
- swing it round the car toward +z, as `groundStand` does, so it looks past the tank's near corner; or
- cut to the landed stand earlier, once the car is low enough that the stand frames it (e.g. when the floor under the
  car would be blocked), keeping 0063's one-cut-per-moment rule: no two hard cuts < 0.3 s apart (`CARRY_MIN`).

Render only: no sim, scorer, vector or ref-hash change. The Wall and the Lineup are unchanged unless they have the same fault.

## Acceptance criteria
- [ ] On the Show at 390×844 touch, 393×659 and 1440×900, along the reference flight as flown and ±4 m: in every frame
      from the apex to the touchdown, at a true 60 fps, the floor under all four wheels (car x/z ± (0.82, 1.42), y 0.02)
      is in sight, with no sight line crossing a tank's box (walls and coping). Measured the way
      `docs/critique/2026-11-22-1536/brake-prod.mjs.txt` + `brake-floor.txt` measure it. Today: 18/18 sampled frames
      fail from 12.78 s.
- [ ] In those frames the tank's projected box is ≤ 0.10 of the screen while the car is below 3 m (today 0.27 on a phone).
- [ ] A phone frame at the reference's 13.58 s (car ≈ 1.1 m up) shows the car over lit floor and its rings or the mark,
      not over the tank. Screenshot it beside `docs/critique/2026-11-22-1536/brake-phone-dx0-04-t13.583.png`.
- [ ] The camera never jumps more than 1 m in a frame except at a deliberate cut, and no two cuts fall < 0.3 s apart
      from the release to the results.
- [ ] 0355's criteria still hold (`tests/unit/landed-stand.test.js` green), and so do 0108/0119.
- [ ] No sim, scorer or ref-hash change (show 3501 · 97.3 · `6b2cb98b`). `npm test` green.

## Test plan
Extend `tests/unit/landed-stand.test.js`, which already drives the director at 60 Hz along both references at all three
sizes and three shifts. Add a check from the apex to the touchdown: floor-under-wheels sight lines vs the raw tank boxes,
plus the tank's screen share below 3 m. **Caveat:** in Node there is no HUD band (`#stage` is absent, so `viewH =
innerHeight`), and the carry's placement there differs from production's (the Node run shows a 0.10 s shot at 12.58 s that
production doesn't). The bar is production's frames: confirm with a browser probe that steps the sim and
`director.update` together at 1/60 s (see the critique's probe).

## Out of scope
- Moving or resizing the tank (0340, the owner's call).
- The landed stand (0355, shipped and passing).
- The carry over the row.
