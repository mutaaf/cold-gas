---
id: 0068
title: On a phone the replay can be seen; Replay is not a button that does nothing visible
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr: 128
by: critic
---

## Why
Pillar 1 promises "a replay you want to watch twice", and 0036 shipped it as "what players watch while
the judges talk". On a portrait phone nobody can watch it. Measured on production (2ad8d46) on
2026-10-22 at 390×844 touch (docs/critique/2026-10-22-1015.md):

- Under `@media (max-width: 720px)` the results `.sheet` is `width: 100vw` on `rgba(5, 7, 12, 0.9)`
  with the base sheet's `backdrop-filter: blur(4px)` (`src/styles.css:192`, `:103`). It covers the whole canvas, so the replay
  plays behind a 90 % black, blurred sheet.
- Pressing the sheet's **Replay** (`[data-replay]`, `src/main.js:867`) restarts the replay clock and
  nothing else. `phone-8b-results-later.jpg` (before) and `phone-9-replay-a.jpg` (4 s after the tap)
  show the same sheet; only the typed words have moved on. The 04:00 critique's `phone-9-replay.jpg`
  is the same.
- At 1440×900 the same tap shows the car climbing the Wall in the left 62 % of the screen
  (`desk-9-replay-a.jpg`). At 844×390, 820×1180 and wider, the 520 px sheet leaves 300–920 px of the
  replay in view. Only portrait phones, the device most players hold, get nothing.

On top of that, the theatre covers the results full-screen on a phone for the length of the call (Skip
ends it), so on a phone the flight is never seen again after touchdown.

## What
- `src/styles.css` (the ≤ 720 px results rules) and the `[data-replay]` handler in `src/main.js`.
  One way: on a phone, Replay slides the sheet down to a peek (the verdict and total on one line, plus
  Retry · Home · Back to the scores) over the bottom ≤ 22 % of the screen while the replay plays
  full-frame above it. A tap on the peek or the end of the replay brings the sheet back.
- Keep it one tap each way, keyboard reachable (Esc / the same button), `prefers-reduced-motion`
  honoured (no slide, a cut), and the judges' typing keeps running underneath.
- No sim change. The replay rigs are not in scope.

## Acceptance criteria
- [x] At 390×844, 430×932 and 320×568 portrait, after Replay, the canvas region not covered by any
      results/sheet element is ≥ 75 % of the viewport height (measured from the DOM rects), and the
      hero's projected centre (`__coldgas.carRoot` through `__coldgas.camera`) is inside that region in
      ≥ 90 % of replay frames over one full replay of the Show reference.
- [x] One tap (or Esc) returns the full sheet with its scroll position, and the judges' words are
      complete or still typing (not restarted).
- [x] 844×390, 820×1180 and 1440×900 behave as today (no regression: the sheet stays where it is).
- [x] `node scripts/hud-audit.mjs` and `node scripts/title-audit.mjs` clean at every viewport they
      cover, including the results/peek state at the phone sizes. `flicker.mjs` regions unchanged or lower.
- [x] Before/after screenshots at 390×844 (results, then 2 s into the replay) in the PR.

## Test plan
An e2e (phone project): fly the reference with `fastForward()`, wait for `mode === 'results'`, skip the
theatre (`.th-skip`), tap Replay, then assert the uncovered-height and car-in-region bars above over the
replay's frames, and that one tap brings the sheet back.

## Out of scope
New replay cameras, replay scrubbing, and the theatre's own full-screen layout (it has a Skip).

## Critic re-measure (2026-10-22 22:00, production da53d64)
Still failing at every phone size measured. After Skip and then Replay, the results sheet is
0,0 → 390×844 (portrait) and 844×390 (landscape). 4 s after the tap the screen shows the same sheet
(`phone-9-replay.jpg`, `phoneL-9-replay.jpg`). At 1440×900 the replay shows in the left 62 %, but it
starts with the car under the sheet. In the first 36 frames of the replay behind the results, the car's
projected centre is at x 1037 → 693, and x ≥ 960 (the sheet's text column) in 9 of them. That's
about the first second. In `desk-9-replay.jpg`, 4 s after Replay, the car can't be seen in the
uncovered left 62 %: only the curl is there. Added criterion: at 1440×900 the hero's centre is left of the sheet's left edge in ≥ 90 % of
replay frames.

## Critic re-measure (2026-10-26 21:36, production 77cc6d5)
Still failing.
- **390×844**: 5 s after tapping Replay, the screen is the judges' cards and the score breakdown. There's no
  car (`docs/critique/2026-10-26-2136/phone-9-replay.jpg`).
- **844×390**: this time the probe reached Replay, 25 s after the results. The sheet fills the right 62 %.
  The uncovered left 38 % shows sky, black ground and three white plume puffs, and no car
  (`phoneL-9-replay.jpg`).

So uncovering a strip isn't enough. The replay's camera has to put the car in the strip, which is the
existing "car-in-region" criterion.
