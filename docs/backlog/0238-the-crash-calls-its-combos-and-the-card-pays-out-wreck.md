---
id: 0238
title: On the web the crash calls its combos as they happen, and the card pays out Style and Wreck side by side
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club (operator's call 2026-11-13). The Wreck score (0237) only matters if a player sees the combo build while the car
comes apart and gets paid for it on the card.

## What
Depends on: 0237.
- A combo readout on the HUD during the crash, keyed to 0237's combo ticks (live and in the replay), in the HUD's
  instrument style (src/ui.js); reduced motion honoured; no per-frame allocation.
- The landing beat (src/beat.js) and the results sheet show both scores: Style (today's card) and Wreck (total, the chain).
  A wreck no longer ends on "write-off" alone.
- A Fly | Wreck choice for the scored courses (the same sim and courses, the parked row as targets): it decides which score
  the medals, the beat's headline and the copy lead with. Both scores are always computed.
- Medals (src/medals.js) per event, tier and score kind; bests kept on the device. (2026-11-13, Phase 2: licenses, 0254,
  read only the Style card; the Wreck side of progress is 0242's ranks. Both in 0254's store once it lands; if this ships
  first, 0254 migrates its Wreck bests.)
- Box Office `game_over` and the funnel get the Wreck total as a number only (§3.3 rules), if no `src/worker/` change is
  needed.

## Acceptance criteria
- [ ] A recorded wreck shows its combo steps on the HUD at the ticks 0237 gives, live and in the replay.
- [ ] The sheet shows Style and Wreck separately; a clean landing shows Wreck as nothing to report, not a zero that reads as
      failure.
- [ ] Wreck medals and bests persist per course and tier on the device.
- [ ] 390×844 touch and 1280×720 keyboard; `npm run audit` passes; no frame-time regression.

## Test plan
e2e: a wreck log played to the sheet, asserting the combo readout and both cards; unit tests for the medals' new keys.

## Out of scope
The iPhone (0239). Crew lines (0240). Daily wreck days (0241). Ranks (0242). A server board (0244).
