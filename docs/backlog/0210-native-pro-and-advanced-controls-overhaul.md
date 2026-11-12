---
id: 0210
title: The iPhone app's Pro and Advanced controls are shaped for the screen they're on (phone, Duo, iPad)
status: shipped
priority: P1
size: L
lens: player-feel
created: 2026-11-11
pr: 333
by: operator
---

## Why
The owner (2026-11-11): "buttons in pro and advanced need an overhaul … think superior innovation here and over
exaggerating duo and regular modes across phone and tablet". On the iPhone app the classic controls (Pro, Advanced on
the ground, and Assist when classic is chosen) are one layout everywhere. It's a fixed stick and a 2×2 block of four
buttons in the bottom corners, all four always lit. The web stopped doing that long ago: `syncTouchPhase` (src/main.js)
shows only what the moment uses, on the right thumb's arc (slot A under the thumb, B and C either side). Advanced's
nozzle pad is the web's 300 × 380 picture dropped into the bottom of every screen. On a Duo in tabletop that leaves
half the controller panel empty, and on a phone held sideways or a Duo held open it sits in the middle, where neither
thumb is. The app was iPhone-only, so an iPad got nothing.

## What
Runs on: the operator's Mac (Xcode, the simulators). iPhone app only; the web, the Worker and the sim are untouched.
- **One deck geometry, pure and tested** (`ColdGasLayout/Deck.swift`). It's worked out from the fold layout's spread
  and the controls' rect, never the device model (NATIVE §2.8). The forms are phone (portrait), phone held
  sideways, Duo open (book or flat, edge to edge), Duo tabletop (the whole lower half is the controller) and tablet.
  - Each form puts the stick under the left thumb and a three-slot fan on an arc fitted to the right thumb's reach.
    Sizes grow with the form.
  - On the phone the clusters sit in the bottom corners. Held sideways and on the open Duo they climb the side edges.
    On the iPad they sit at the side grips, at mid height. On tabletop they're a console's two wells either side of
    a phase strip.
  - The Advanced valve deck is the car whole under both thumbs on a phone held upright. Everywhere else it's split
    down the spine, one half under each thumb.
- **The classic controls morph with the flight phase** (`Input/FlightDeck.swift`), using the web's own rule (main.js
  `syncTouchPhase` + styles.css slots A/B/C):
  - On the ground and the curl: GO, with BRAKE beside it. RELEASE (amber) comes up only on the ledge.
  - In the air: LIFT on Pro and Advanced, LAND on Assist, and BOOST until the row is behind you.
  - Landed: BRAKE. The stick hides once you've landed.
  - A held control stays held through a morph (the web's pointer capture). The stick is the web's fixed ring. A
    thumb that lands outside the ring, still in its corner, floats the ring to itself and starts from zero.
- **An on-glass ghost:** a slow hairline ring breathes around the control the cue line names (RELEASE, LIFT, LAND,
  BOOST, GO, the stick). It's static under Reduce Motion.
- **Advanced's valve deck** (`Input/NozzlePad.swift`):
  - The car's true plan outline, from `SPEC`.
  - A hairline from every pad to where its nozzle really sits on the car (`NOZZLE_SPEC`).
  - Each open valve drawn as its jet: a line out of the nozzle in its exhaust direction, or a ring for the down jets.
  - On an iPad, a Pencil's pressure scales the valve as the web's pen does (`step5(v · max(0.15, pressure))`).
- **Haptics per control:** GO soft, BRAKE rigid, LIFT and LAND heavier, RELEASE the heaviest, BOOST sharp.
  - The stick ticks as it leaves its dead zone and as it reaches the rim.
  - Each valve group has its own weight.
  - Settings' Haptics Off now silences these UI taps too, and Subtle halves them.
- **iPad:** `TARGETED_DEVICE_FAMILY` "1,2" (project.yml) and every orientation on iPad (Info.plist). It launches and
  lays out on an iPad simulator. The next App Store version needs iPad screenshots (13" `APP_IPAD_PRO_3GEN_129` at
  least) before it can be submitted. Nothing in App Store Connect is changed here, and the build in review is
  untouched.
- The camera's carry check reads the deck's real rects (`CameraFraming`, Director.swift), and the cue line sits above
  the deck.

## Acceptance criteria
- [x] The sim inputs are unchanged: `make test` green (the 52 run vectors, the live input vectors, the
      withKnownIssue 0186 rows as they were). The surfaces only call `TouchControls.press/release/stick` and set
      `nozzleValves`, as before.
- [x] `DeckTests`: in every form, every control sits inside the controls rect, is at least 44 pt (slot A at least
      84 pt), overlaps nothing, and stays off the Duo's fold band. The fan lies on one arc around its pivot. Tabletop
      uses the lower panel's full height.
- [x] Simulator screenshots for Pro on the ground and in the air, and Advanced in the air, on: an iPhone upright and
      sideways, the Duo closed, book and tabletop (`-window` + `-pose`), and an iPad upright and sideways. Each one
      looked at.
- [x] The app builds for iPhone and iPad (`TARGETED_DEVICE_FAMILY 1,2`) and launches on an iPad simulator.
- [x] `make rules` passes.

Shots (docs/shots/deck-0210/, from `ios/scripts/deck-shots.sh`): the phone upright (ground, climb with the ghost on GO, air,
Advanced) and sideways (ledge, Advanced), the Duo closed, book and tabletop (laid out with `-window`/`-pose`), and an iPad
upright and sideways. Not yet: a hardware pass on a Duo, a Pro Max and an iPad (feel, reach, haptics in the hand).

## Test plan
`ios/Packages/ColdGasCore/Tests/ColdGasLayoutTests/DeckTests.swift` holds the geometry to the criteria above for
the measured poses (the Duo's three) and the reference phone and iPad sizes. `make test` covers the rest. The shots
use a DEBUG `-freeze <tick>` that stops a scripted run at a moment with the controls up.

## Out of scope
- Assist's one-thumb pad (fine as it is).
- A hardware pass on a Duo, a Pro Max and an iPad (NATIVE §5: a gate before TestFlight).
- A left-handed mirror (the web has `data-hand`; the app has no setting yet).
- Store screenshots and the next version's release notes.
