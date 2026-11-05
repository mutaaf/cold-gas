---
id: 0156
title: "The iPhone app is a game: three courses flown live, the HUD, results, the board, the Duo's poses"
status: shipped
priority: P1
size: L
lens: platform
created: 2026-11-04
pr: 253
by: operator
---

## Why
The owner asked for an App Store build. The app played recorded runs and nothing else, which Apple refuses as a demo
(guideline 4.2), and it couldn't be played.

## What
Runs on: the operator's Mac (Xcode, Metal).
- `ios/ColdGas/Game`: a run flown live on LiveRun (0155), cut into 240 Hz ticks from the display link, through to the aftermath.
- `ios/ColdGas/UI`: the title over the reference run, the countdown, the HUD with the cue line, the one-thumb pad with its
  sight, the classic stick and buttons, pause, results, the board, settings, how to play.
- `Spread.full`: the Duo edge to edge when open. Tabletop keeps the screen over the controller.
- The Wall's and the Lineup's stages exported; one renderer per course.
- Moderation for guideline 1.2: a filter on initials, and hide and report on each row.
- Auto-pause on losing the screen; no GPU work in the background.

## Acceptance criteria
- [x] The reference flights flown through the live path score what the sim's vectors say: Show 97.7, Wall 96.0, Lineup 92.0.
- [x] A scripted thumb lands the Show on one-thumb (85.7, settled) through the same controls a touch uses.
- [x] Production's dry post accepts Swift-flown runs at the local score.
- [x] Shots in every pose: Pro Max, book, tabletop, closed, landscape; Fly stays on screen in each.
- [ ] The owner's flight on real hardware, with real touches (no scripted run presses the glass).

## Test plan
`make test`, `make rules`, `make bench`, and the shots above; on the phone, one flight of each course by hand.

## Not in 1.0
The full replay theatre, Free Drive, the health
beacon, a BYOK key. Rendering details still open are in 0153.
