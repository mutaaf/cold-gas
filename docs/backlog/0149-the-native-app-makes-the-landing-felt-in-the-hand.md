---
id: 0149
title: The native app makes the run felt in the hand (Core Haptics, driven by the sim)
status: proposed
priority: P1
size: L
lens: player-feel
created: 2026-11-04
pr:
by: operator
---

## Why
On the web, `buzz()` (src/touch-settings.js) uses `navigator.vibrate`, which iOS Safari doesn't have, so an iPhone
player feels nothing at all: not the release, not the landing, not a crash. The native app can do far better than
the web's six buzzes. The landing should be felt: one clean thump on a synced touchdown, four ragged ones on a
sloppy one, the hiss of the jets softening as the nitrogen blows down. Pillar 1: "a landing you can feel in the
camera and the sound", and now in the hand.

## What
Runs on: `HapticScore` in `ColdGasCore` (Linux-testable); `HapticPlayer` on the operator's Mac. Design in
docs/NATIVE.md §6. Phase 3, after the core (phase 1) lands.
- `HapticScore` (pure): reads the sim each tick and writes events into a fixed ring (no allocation): rolling rumble
  (speed, surface), climb load, release, jets' hiss (total valve flow × tank pressure), apex drop-out, landing HUD
  amber/red, retro-burn, **a touchdown transient per wheel at that wheel's contact tick scaled by its sink rate**,
  impacts from `run.impacts` (scrape, hit, crush, grind), the settle, the judges' numbers, medals.
- `HapticPlayer`: one `CHHapticEngine` sharing the audio session; three continuous players (rumble, hiss, grind)
  made once and modulated with `CHHapticDynamicParameter`; transients rate-limited (≤ 1 per 10 ms per channel);
  restart on `stoppedHandler` / `resetHandler`; stop on background.
- The same track on a game controller with haptics (`GCController.haptics`).
- UI: `UISelectionFeedbackGenerator` / impact feedback on taps, toggles and the one-thumb pad; a light tick at the
  Duo's hinge detents (effect only).
- Settings: Off / Subtle / Full (default Full); the system haptics switch respected; replays play the same track,
  scrubbing silences it.
- `-haptics log` prints the track (the simulator can't play haptics).

## Acceptance criteria
- [ ] `HapticScore` unit tests against 0146's vectors: the reference Show emits release, warn and touchdown events on
      the expected ticks; a synced landing emits its four wheel transients within 0.3 s of each other; a crash vector
      emits an impact per `run.impacts` hit above 1 m/s.
- [ ] 0 B allocated per tick by `HapticScore` and per event by `HapticPlayer` (the allocation bench).
- [ ] Off produces no `CHHapticEngine` activity; Subtle has no continuous rumble and halves intensity.
- [ ] Every haptic moment is also on the screen or in the sound (no information by haptics alone).
- [ ] The engine recovers after an audio interruption (a call, Siri) and after backgrounding mid-run.
- [ ] Hardware pass on a Pro Max and a Duo: the owner feels the release, the hiss blowing down, a clean vs a sloppy
      touchdown, and a crash, and says yes in the PR.

## Test plan
swift-testing in `ColdGasCore` for `HapticScore`; an app test that drives `HapticPlayer` with a mock engine and
counts players and events; `make shots` with `-haptics log` for the reference Show; the hardware pass recorded in
the PR.

## Out of scope
Web haptics (iOS Safari has no Vibration API). Audio-to-haptics generation from the sound files.
