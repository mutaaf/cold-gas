---
id: 0189
title: A thumb lifted on the climb is told to keep holding to the ledge, not "you hung 0 s inverted, tap to let go"
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-10
pr:
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
- [ ] Unit (`tests/unit/coach*.test.js`): one thumb on the Show and on the Wall, held from Go and lifted at 7 m up the
      curl, never pressed again: the top fix's title isn't "Never let go", its detail names the height it stopped at
      (± 1 m), and its fix says to keep holding to the ledge. The pointer's NEXT RUN line says the same.
- [ ] The same unit: a thumb that hangs on the ledge and never taps still reads "Never let go … hung N s inverted".
- [ ] e2e or screenshot at 390×844 touch on production's flow: the C-results case above reads the new line.
- [ ] Classic touch and keys get their own control's words (`say`).
- [ ] No sim or scorer change: `ref-hash` identical, `naive-players` 32/32.
- [ ] Funnel number to move: `retry` / `run-wrecked` among touch runs (digest `players`). The 2026-11-10 player wrecked
      twice and never retried.

## Test plan
Fly `tests/unit/thumb-mastery.test.js`'s `flyThumb` pattern with the thumb lifted at 7 m on the climb, feed
`coach()` and `pickPointer`, and assert the titles and words above.

## Out of scope
- Whether lifting the thumb on the climb should stop the car (it should: the real car crawls on suction and stops
  when told to).
- The judges' AI remarks.
