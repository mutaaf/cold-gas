---
id: 0196
title: A first-ever visit's title offers Jump first and keeps the other choices one tap away
status: dropped
priority: P1
size: S
lens: engagement
created: 2026-11-11
pr:
by: scout
---

**Dropped 2026-11-13: superseded by 0247.** 0247 (Phase 2, 2026-11-13) folds the title the same way for a first run and also starts the run in one tap.

## Why
The funnel (`/obs/digest → players`, 2026-11-01..11-11): 10 human sessions in 11 days, 8 `visit-new`, 12 `run` in all, and
on 2026-11-10 three people, two runs, both wrecked, no retry. The first thing a newcomer meets on a 390×844 phone is
a title with a mode switch (Show / Wall / Lineup), Jump, Watch the reference, Practice, Board, Controls, Assist, Learn,
"More ways to play" and the Daily card: about ten tappable choices before one run. Own screenshot at 390×844 with
`coldgas_howto='new'`: Jump is the white pill, but everything below it asks the same attention. Nothing here is hidden or
removed for returning players; a first visit just leads with the one action that moves `visit-new` → `run`. Games that
open with one primary action and fold the rest behind it (progressive disclosure) keep first-session starts up; see
Nielsen Norman Group, "Progressive Disclosure" https://www.nngroup.com/articles/progressive-disclosure/.

## What
When `coldgas_howto` is not yet set (a first-ever visit; src/main.js `howtoSeen`), the title shows the mode switch, the Jump
pill and the Daily card, and folds Watch the reference, Practice, Board and the Controls / Assist / Learn strip into the
existing "More ways to play" disclosure, closed. The first run (or a skip of the how-to) ends the first-visit state and the
title is the full one from then on. Keyboard order and the audits stay as they are. Touches `index.html` (a data attribute),
the title CSS and the `howtoSeen` wiring in `src/main.js`; no sim, Worker or score change.

## Acceptance criteria
- [ ] With `coldgas_howto` unset, at 390×844, the title's visible actions are the mode switch, Jump, the Daily and "More ways to play"; Watch the reference, Practice, Board and the settings strip are inside the closed disclosure and reachable by keyboard after opening it.
- [ ] With `coldgas_howto` set (any value), the title is exactly today's.
- [ ] After the first run starts (or the how-to is skipped) a reload shows the full title.
- [ ] `node scripts/title-audit.mjs` and the HUD audit pass at every viewport, including the new state.
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
e2e (tests/e2e): a fresh context (no `coldgas_howto`) asserts the folded title and that "More ways to play" reveals the four; a second context with it set asserts the full title. Title audit run on both states. After shipping, read `players` for `visit-new` → `run` over a week.

## Out of scope
Removing anything for returning players; the Daily card; the how-to card (0172, 0197); the funnel's `visit-no-jump` measure (0143).
