---
id: 0358
title: The Lineup's kickflip shot keeps the whole car in frame on a phone, and no floodlight pole crosses it
status: shipped
priority: P0
size: S
lens: player-feel
created: 2026-11-22
pr: 528
by: critic
---

## Why
The kickflip over the row is the Lineup's whole stunt, and most players are on phones. On production (`4a91242`,
`index-DMqy6KJY.js`), I flew the Lineup reference at 390×844 touch with the sim and the director stepped together at
1/60 s. **The car is never fully on screen in the air.**
- Its projected box spans screen x (NDC) −0.14…+1.36 from the apex on. About a quarter of the car is past the right edge
  in **216 of 216** air frames: on-screen share mean **0.74**, never above 0.79
  (`docs/critique/2026-11-22-2230/frame-phone.json.txt`).
- The roof and tail are cut off while the car is upside down (`…/lineup-phone-lift+1.00-dt1-tilt178.png`), over the
  Semi (`…-over-semi-dt1.55-tilt34.png`), and while it levels (`…-lift+2.00-dt2-tilt10.png`).
- The same flight at 1440×900 is 1.00 on screen in every frame, with the box at x −0.03…0.39 (`frame-desk.json.txt`).

**The cause** is the air branch of `chase()` (`src/render/director.js:427-429`). The rig stands ≈ 14.5 m out on +x and
aims 3 m ahead of the car (`lookWant … carPos.z + 3`). A portrait 390×844 lens has only ≈ ±12° across, and 3 m of lead
at 14.5 m is ≈ 11.5° of it. So the shot leads into empty sky and pushes the car off the trailing edge.

**The same rig passes 2.0 m from the floodlight pole at (13, 12)** (`courses.js:248`, `FIXTURES.poles`) at lift-off
+1.55 s. That is the peak, over the Semi. A dark bar up to 0.25 of the car's screen width cuts through the car on the
desktop (`…/lineup-desk-pole-dt1.55-cover0.25.png`) and on the phone (5 frames > 10 % on each).

The reveal's kickflip was shot with the whole car in frame, wheels-up over the row (REVEAL_RESEARCH §2.2;
https://www.youtube.com/watch?v=r5vsHHPVhJg). A broadcast never cuts the subject in half or puts a pole through it.

## What
`src/render/director.js` `chase()`, air branch (and the landed hold that shares it for 1.2 s):
- **Portrait (`camera.aspect < 1`):** scale the lead with the lens, or let `lens()` widen it, so the car's box stays inside
  the frame. Keep some lead in the direction of travel. Desktop framing is unchanged.
- **Poles:** keep the stand off the line of sight to the car wherever a `FIXTURES.poles` pole would cross it. For
  example, stand inside x 13 or shift the stand's z, or use the same kind of sight-line check 0355/0357 use for the splash
  tank. Read the numbers from `courses.js`, never a copy.

No sim, scorer or vector change.

## Acceptance criteria
- [ ] The Lineup reference (`createAutopilot('lineup')`) at **390×844** touch, stepped as
      `docs/critique/2026-11-22-2230/lineup-frame.mjs.txt` does: the car's projected box is **≥ 0.98 on screen in every
      air frame** (today mean 0.74, max 0.79). The same holds at 430×932 and 360×780.
- [ ] The same at 1440×900 and 1280×720 stays at 1.00 on screen in every air frame. The desktop shot doesn't change
      except where the pole rule moves it.
- [ ] On every screen above, **no `FIXTURES.poles` pole nearer the lens than the car covers more than 5 % of the car's
      screen width** in any air frame. Today the peak is 0.25 at lift-off +1.55 s.
- [ ] The same two bars hold for the Lineup reference flown with `{ apex: 4 }` and `{ apex: 6.5 }` (a lower and a higher
      kickflip), so the fix isn't tuned to one line.
- [ ] Screenshots at the inverted frame and over the Semi at 390×844, on the PR's preview, show the whole car with no
      bar across it.
- [ ] No frame-time regression (e2e perf probe within budget). `npm run audit` stays green.

## Test plan
A unit test over the director in Node (as the 0355/0357 tests do for the Show): step `createAutopilot('lineup')` and the
three apex variants with a camera at aspect 390/844 and at 1440/900. Assert both bars above: the box's on-screen share
from the eight projected corners, and each pole's cover of the box. Make the test fail on main first.

## Out of scope
- The replay's shots (`replay()`, `director.js:448`), which have their own fixed stands.
- The roll's timing in the reference (0359).
- The Show and the Wall.

## Builder note (2026-11-27)
`chase()`'s air branch: upright, the lens holds the horizontal angle it has at LENS_ASPECT (`lens()`, as the ground shots
do since 0108); a new `fitAir()` then turns the camera (and widens the lens only when the car is wider than the frame)
so a conservative box of the car (attitude unknown) stays inside 0.95 of the frame, which also covers the swing out from
the run-up chase. The stand stands 0.8 m inside the poles' line (`FIXTURES.poles.x`), 5–14 m from the car, so no pole
is nearer the lens than the car for a flight up to ≈ 7 m right of the line (past that it stands out at 14 m, as before). `tests/unit/lineup-air-frame.test.js` (15 of 15 red on main; plus the reference flown −4…+6 m across, and the lens's
frame-to-frame step): the reference and apex
4 / 6.5 at 390×844, 430×932, 360×780, 1440×900, 1280×720: min on-screen share 1.00 (main 0.51, mean 0.73 on the phone),
pole cover 0.00 (main 0.25). Screenshots in `docs/critique/2026-11-27-build-0358/`.
Known feel trade-off: upright, the lens opens from ≈ 52° to ≈ 77° (vertical) over the first ≈ 0.2 s in the air, as the
rig swings out from the run-up chase (≤ 4.6° a frame), then holds ≈ 91° (the horizontal angle 0108's ground shots hold).
