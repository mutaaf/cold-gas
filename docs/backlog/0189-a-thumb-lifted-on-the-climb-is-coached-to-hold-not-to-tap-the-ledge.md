---
id: 0189
title: A thumb lifted on the climb is told to keep holding to the ledge, not "you hung 0 s inverted, tap to let go"
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-10
pr: 307
by: critic
---

## Why
The focus's item 1 is the first run on a phone and the screen right after it. The commonest first-run mistake on one
thumb is lifting the thumb partway up the curl (`daily-reach`'s thumb population models it: "20 % lift the thumb once
mid-climb"). Critique `docs/critique/2026-11-10-2130.md` §2 played it on production at 390×844 touch, the Show, first
visit: hold the pad from Go, lift it once the car is 7 m up the curl. The car stops on the curl (HUD "Stopping"), and
the results (`docs/critique/2026-11-10-2130/C-results.png`) say:

- **"No climb · 13.0"**, and the Engineer (the AI model) gets it right: "Vertical velocity ceased at twelve meters".
- **NEXT RUN:** "Let go on the ledge: tap the pad when you're upside down".
- **WHAT HAPPENED:** "Never let go · You hung 0 s inverted but never released. → On the ledge, tap the pad to let go."

All three of our own lines describe a run that didn't happen. The player let go *too early*. The game tells them they
never let go and points at the step after the one they failed. The source is `src/sim/coach.js:159-161`: with
`t.airStartTick < 0` and no `fellOff`, every run is `no-release`, whether it hung on the ledge for 20 s or stopped
halfway up. The NEXT RUN line (`src/pointer.js`) follows it.

## What
`src/sim/coach.js` (and the pointer line it feeds, `src/pointer.js`): split the no-jump case by how far up the curl the
car got (`wallProgress` / `t.maxRampHeight`, and `t.invertedTime`):
- **Stopped short of the ledge** (never inverted on the ledge): "Stopped on the climb · You stopped N m up the curl.
  → Keep holding the pad until you're upside down on the ledge." In the scheme's words (`say`), so keys and two
  thumbs read their own control.
- **Reached the ledge and hung:** today's `no-release` line, unchanged.

## Acceptance criteria
- [x] Unit (`tests/unit/coach*.test.js`): one thumb on the Show and on the Wall, held from Go and lifted at 7 m up the
      curl, never pressed again: the top fix's title isn't "Never let go", its detail names the height it stopped at
      (± 1 m), and its fix says to keep holding to the ledge. The pointer's NEXT RUN line says the same.
- [x] The same unit: a thumb that hangs on the ledge and never taps still reads "Never let go … hung N s inverted".
- [x] e2e or screenshot at 390×844 touch on production's flow: the C-results case above reads the new line.
      (Critic 2026-11-11 09:37: `docs/critique/2026-11-11-0937/C-results.png`.)
- [x] Classic touch and keys get their own control's words (`say`).
- [x] No sim or scorer change: `ref-hash` identical, `naive-players` 32/32.
- [ ] Funnel number to move: `retry` / `run-wrecked` among touch runs (digest `players`). The 2026-11-10 player wrecked
      twice and never retried.

## Test plan
Fly `tests/unit/thumb-mastery.test.js`'s `flyThumb` pattern with the thumb lifted at 7 m on the climb, feed
`coach()` and `pickPointer`, and assert the titles and words above.

## Out of scope
- Whether lifting the thumb on the climb should stop the car (it should: the real car crawls on suction and stops
  when told to).
- The judges' AI remarks.

## Shipped (#307)
`stopped-climb` in src/sim/coach.js (and Coach.swift): a Wall or Show run that never reached the ledge (`progress < HANG_AT`,
where the pad's tap lets go) reads "Stopped on the climb · You stopped N m up the curl, short of the ledge. → Keep holding
<drive> until you're upside down on the ledge."; NEXT RUN "Climb to the ledge: keep holding the pad until you’re upside down
on it". A hang on the ledge with no tap keeps "Never let go". Its own funnel event, `wreck-climb`. tests/unit/coach-climb.test.js
(Show and Wall lifted at 7 m: detail 7.5 m; classic, keys, pad words). Real page at 390×844 touch on a local build:
docs/shots/coach-climb-0189/ (production is the Critic's re-check). ref-hash identical, naive-players 32/32.
Open boxes: the production screenshot follows the deploy (the builder's live check, then the Critic's); the funnel box is
an outcome, read from the digest's `wreck-climb` and `retry` once touch players reach it.

## Critic re-review (2026-11-11 09:37): pass
On production `ea322c9` at 390×844 touch, first visit: the Show, the thumb held from Go and lifted 7 m up the curl.
- The card reads "No climb · 13.0".
- NEXT RUN reads "Climb to the ledge: keep holding the pad until you're upside down on it".
- WHAT HAPPENED reads "Stopped on the climb · You stopped 28 ft 8.6 m up the curl, short of the ledge. → Keep holding the pad
  until you're upside down on the ledge."

Evidence: `docs/critique/2026-11-11-0937/C-results.png` and `C-lifted.png`. The funnel box stays open: it's an outcome,
and no touch player has reached it yet.
