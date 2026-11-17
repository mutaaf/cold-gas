---
id: 0239
title: On the iPhone the Wreck score and its combos are shown and felt, and Roam's backlot offers Wreck beside Fly
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club (operator's call 2026-11-13). The playtester praised the crashes and the haptics; the iPhone is where a combo can
be felt step by step. Roam is the backlot: you drive to the row and pick Fly or Wreck from where you stand.

## What
Runs on: the operator's Mac (Xcode).
Depends on: 0237 (the scorer, through the vectors); 0238 (the web's design to match).
- ColdGasPhysics/ColdGasClient: port 0237's `wreckRun` and the combo detector, held bit-exact by the vectors.
- The HUD's combo readout and the sheet's Style and Wreck cards, matching 0238. Medals.swift gets Wreck medals.
- Core Haptics: a pattern per combo step (scrape, topple, tumble, part off) rising with the multiplier, driven by the
  combo's ticks (ColdGasCore HapticScore.swift / ios/ColdGas/Haptics/).
- Roam (0220): **Wreck <course>** beside **Fly <course>** on the roam HUD, starting a scored run from the mark.

## Acceptance criteria
- [ ] `cd ios && make test` green with the vectors bit-exact, including the Wreck card.
- [ ] A recorded wreck shows its combo steps at the right ticks and plays one haptic pattern per step (HapticScore tests).
- [ ] Wreck from Roam starts a scored run from the course's mark.
- [ ] The app builds for the simulator; shots in docs/shots/0239/.

## Test plan
Swift tests for the port and the haptic score; vectors; a simulator run from Roam's Wreck button.

## Out of scope
Building before the in-flight UI (`ios/ColdGas/UI/`), rendering and collision work has landed. Ranks and wreck days on the
iPhone (follow-ups once 0241 and 0242 ship). Free Drive's combo reports on the iPhone (follow-up to 0243).

## Notes
2026-11-17 (builder): the iPhone scores Wreck natively ahead of the web's 0237: ColdGasClient `Wreck.swift` (the pure scorer,
combos, the combo haptic patterns) and ColdGasPhysics `WreckTracker.swift` (reads impacts, parked cars, the car going over
and flights off the run tick by tick, live and in the aftermath; never writes the sim). Nine steps: slam, roof, side swipe,
grind, crush, airborne, rollover, shove, topple; a chain holds while each lands within 1.25 s, its multiplier is the number of
different steps. The HUD calls each combo (×N and the step) and the phone plays the step's pattern then N rising ticks; the
sheet shows WRECK beside the score, never added to it. Recorded runs: clean references score under 3, pro-fuzz-0 78.4 (×7),
crash-lineup-rolls2 36.0 (×6); naive players 0. Not done: Wreck from Roam, Wreck medals; the vectors don't carry the card
until 0237 lands on the web. Shots: docs/shots/0239/.
