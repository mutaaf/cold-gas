---
id: 0149
title: The native app makes the run felt in the hand (Core Haptics, driven by the sim)
status: in-progress
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
- [x] `HapticScore` unit tests against the JS sim's own flights (`Tests/Vectors/haptics/*.json`, written by
      `npm run vectors`):
      - the reference Show releases once and lands with four wheel transients within 0.3 s (54 ms measured);
      - the hiss softens as the tanks blow down, and the air is silent under the tyres;
      - a crash gets an impact transient for every hit ≥ 1 m/s, outside the 10 ms rate limit, and is never "stuck";
      - the Lineup has no release.
- [x] 0 allocations per tick in `HapticScore`, measured with malloc zone statistics over five crash replays.
      `HapticPlayer` makes its players once (3 looping continuous players + a bank of 24 transients). Its dynamic
      parameters are sent only when a channel moves.
- [x] Off / Subtle / Full, stored in UserDefaults; a tap on the controls panel cycles it, with selection feedback.
      [ ] A unit test with a mock engine.
- [ ] Every haptic moment is also on the screen or in the sound. There's no HUD or audio yet (phase 3); the rule is
      in §6.
- [ ] Recovery after an audio interruption and after backgrounding mid-run: `stoppedHandler`/`resetHandler`
      restart and the background stop are built, not yet exercised on hardware.
- [ ] The hardware pass. The track plays on the iPhone 15 Pro Max (`-haptics demo show`: engine on, the same events
      as the simulator's log). Still owed: the owner feels the release, the hiss blowing down, a clean vs a sloppy
      touchdown, and a crash (`-haptics demo crash`), and says yes. The Duo when hardware exists.
- [ ] The landing HUD's amber/red, the judges' numbers, medals and the one-thumb pad: they need the HUD and the
      results (phases 3–4).

## Test plan
swift-testing in `ColdGasCore` for `HapticScore`; an app test that drives `HapticPlayer` with a mock engine and
counts players and events; `make shots` with `-haptics log` for the reference Show; the hardware pass recorded in
the PR.

## Out of scope
Web haptics (iOS Safari has no Vibration API). Audio-to-haptics generation from the sound files.
