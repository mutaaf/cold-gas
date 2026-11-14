---
id: 0239
title: On the iPhone the Wreck score and its combos are shown and felt, and Roam's backlot offers Wreck beside Fly
status: proposed
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
