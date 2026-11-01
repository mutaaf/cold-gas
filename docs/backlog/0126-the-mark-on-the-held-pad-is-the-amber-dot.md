---
id: 0126
title: The mark on the held pad is the amber dot every line names, not a black ring
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-01
pr:
by: critic
---

## Why
One-thumb aiming is the skill the Show now pays most for (0121: precision is 0.36 / 0.28 / 0.34 of the judges).
Every line that teaches it names one target: **"the amber dot"**. That's the how-to card (`src/pointer.js:72`
*"Slide onto the amber dot to hit the mark"*), the NEXT RUN pointer (`src/pointer.js:117`, `:120`) and the results'
*What happened* fix (`src/sim/aim-words.js:4`), five places in `src/`.

But the sight can only be used while the pad is held (the slide is the held finger's), and held, the pad turns light
and the mark is restyled **near-black**: `.thumb.on .thumb-aim .ta-mark { border-color:
#06080c; }` (`src/thumb-aim.css:14`). It's a 12 px hollow ring (`:9–10`). It fills amber only once you're already on it
(`[data-near]`, `:11`). On production `e92311b`, the first-visit run's air frame shows a dark hollow ring on the light pad
and no amber anywhere on it (`docs/critique/2026-11-01-1015/p-first-low-3-air.jpg`). A newcomer told to find the amber dot
finds no amber dot, and the one skill that moves the score is behind a colour that isn't there.

(The dark ring was presumably chosen for contrast: amber #ffbf5a on the light pad is ≈ 1.3:1. Keep the contrast, and
make it amber.)

## What
- `src/thumb-aim.css`: on the held (light) pad, the mark is amber-filled with a dark outline (or an amber disc with a
  ≥ 1.5 px #06080c keyline), so it reads as amber and holds ≥ 3:1 against the pad as a graphic object (WCAG 1.4.11).
  `[data-near]` still changes visibly (e.g. grows or gains a ring), so "on it" stays legible.
- The ink "you" dot stays visually distinct from the mark (not amber).
- No change to the words, the sim or the aim maths.

## Acceptance criteria
- [ ] e2e (extend `tests/e2e/thumb-mastery.spec.js`'s first test): with the pad held and the sight on, the computed
      `background-color` (or keyline + fill) of `.ta-mark` contains amber `rgb(255, 191, 90)`, both near and not near.
- [ ] Measured on a 390×844 screenshot of the held sight: the mark's fill pixels read amber (R > 200, G 150–220, B < 140),
      and the mark's outline vs the pad is ≥ 3:1 (number in the PR, with the screenshot).
- [ ] The un-held (dark) pad still shows the mark amber as today. `hud-audit` and `title-audit` clean.
- [ ] Works at 390×844 touch; 1280×720 keyboard unaffected (no pad).

## Test plan
The e2e assertion above, plus a before/after crop of the held sight in the PR.

## Out of scope
Changing the copy to "dark ring" instead (the amber is the HUD's caution/target colour and the words are right).
The sight's size or position.
