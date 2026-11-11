---
id: 0197
title: The first-run how-to card closes its dead gap and Skip says what it skips
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-11-11
pr:
by: scout
---

## Why
Played at 390×844 touch with `coldgas_howto='new'`, the card after tapping Jump ("One thing to know") shows one step
(Drive & climb: "hold the pad") and then about 90 px of empty card before "All four steps", then "Got it · Jump" beside a plain
"Skip". Two reads for a newcomer: the card looks unfinished, and "Skip" could mean skip the card, the run or the game. It is the
last screen before the first run, where `visit-new` → `run` is decided, and it is where the player learns the one control
they need. (Goal-first wording is 0172; this is layout and one label.)

## What
In the one-thumb short card (src/main.js how-to wiring, index.html markup, the how-to CSS) remove the fixed gap so the card
is as tall as its content, keep "All four steps" as a quiet link under the buttons or beside the step, and relabel Skip
to "Skip tips" (the run still starts). Other schemes' cards keep their shape.

## Acceptance criteria
- [ ] At 390×844 the short card has no vertical gap taller than 24 px between its step and the next element (measured from bounding boxes in the e2e).
- [ ] The secondary button reads "Skip tips" and starts the run exactly as Skip did (obs: `howto` skip still counted once).
- [ ] No overlap or text under 11 px: `node scripts/hud-audit.mjs` passes on the card at 320, 390, 430 and 1280×720.
- [ ] Works at 390×844 touch and 1280×720 keyboard (Enter = Got it, Esc = Skip tips).

## Test plan
Update the how-to e2e (tests/e2e) to assert the label, the gap and that both buttons start the countdown; screenshot the card at 390×844.

## Out of scope
The card's wording and goal (0172); the other schemes' cards; the "How to play" guide page.
