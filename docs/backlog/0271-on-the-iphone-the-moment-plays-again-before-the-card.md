---
id: 0271
title: On the iPhone the run's moment plays again, slowed and felt, before the card
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-17
pr: 417
by: operator
---

## Why
The owner: "the game, the stunt and the roam need to be 100x better". A playtester loved the crashing and the haptics.
Today a run ends and the card cuts straight in: the landing or the wreck the player just made is over before they've
seen it, and the card covers it. Pillar 1 asks for "a landing you can feel in the camera and the sound … and a replay you
want to watch twice". Broadcast sport answers this with the instant replay: the moment again, slower, from a better seat.

## What
iPhone only, presentation only (the sim is done when any of it runs; nothing scored or recorded changes):
- **The encore** (`ios/ColdGas/Game/Encore.swift`, `Game.swift`): once the run is at rest, its moment plays once more
  from the track it recorded: the first hit over 6.5 m/s (the one the crash cut picks), else the hardest hit, else the
  first scrape over 5 m/s, else the touchdown. 0.75 s before it to 1.05 s after, the clock easing to a quarter through
  the moment and back (≈3.5 s). A tap skips it. Reduce Motion and drills skip it.
- **Its camera** (`Director.encore`): a locked-off long lens, low beside the moment with a clear sight line (the crash
  cut's test), its aim panning with the car. Upright, front three-quarters so the car comes at the lens and fills the tall
  frame; wider screens broadside. The Lineup's lens stays off the lamp poles' line.
- **Felt and heard in step**: each impact the replay reaches plays its haptic again (hit, crush, wheel) and the grind
  follows the scrape; the touchdown thuds; the bed's wind drops with the slow clock. The sparks, chips, dust, dents and
  torn-off parts are the crash's own replay (seeded per event, as before), on the slowed clock (`Crash.directed`), and the
  camera's shake rattles on it too.
- **Tyre smoke** (`Render/TyreSmoke.swift`): from the track's own wheels, a tyre turning slower than the ground smokes in
  proportion to the slip, and a touchdown after real air throws a burst from each tyre. Into the crash's puff pool: no
  new pipeline, pass or draw call.
- **The card rises** out of the scene on a short spring (a fade with Reduce Motion); behind it the camera holds a low
  three-quarter on the car where it came to rest (on a wide screen, a slow orbit).
- The chrome: a small "REPLAY" tag and a hairline that runs out with it. Nothing else is said.

## Acceptance criteria
- [x] `make test` (the 52 run vectors) passes unchanged: no sim, scorer or haptic-score change.
- [x] A landing and a wreck each replay their moment before the card (frames in docs/shots/0271/).
- [x] A tap skips to the card; Reduce Motion and drills go straight to the card as before.
- [x] No full-screen flash: the hit's flash is the existing one, gated by Dim Flashing Lights, and slowed it comes less often.
- [ ] Felt on a phone: the replayed hits buzz in step with the sparks (the simulator has no haptics; `-haptics-log`).

## Test plan
Simulator, muted (`-mute`): `-play -course show -script ref-show -encore-rate 0.12 -cam-log` (a landing),
`-play -course lineup -tier pro -script crash-lineup-rolls2 -encore-rate 0.12` (a wreck); `-encore-rate` (DEBUG) stretches
the encore alone for screenshots. `make test` for the vectors.

## Out of scope
The Wreck score and combos on the card (0239), the sets' look and Roam (separate work), the web.
