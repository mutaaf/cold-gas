---
id: 0172
title: The first-run card opens with the goal in one line, before the thumb controls
status: dropped
priority: P1
size: S
lens: engagement
created: 2026-11-09
pr:
by: scout
---

**Dropped 2026-11-13: superseded by 0248.** 0248 (Phase 2, 2026-11-13) takes the how-to card out of a first run: the jump is taught inside the run, one hint at a time.

## Why
On a 390×844 capture with `coldgas_howto='new'`, a newcomer's Jump opens "One thing to know · 01 Drive & climb ·
hold the pad: crawls you up the Wall on suction; let go to stop." It says how to hold a button, not what the game is
for. The title's tagline ("Stick the landing.") is gone by then, and a first run that doesn't know the goal is the
likeliest to quit: the only human to start a run on 2026-11-06 left before the card (`run-quit`, digest players).
Reference: first-session clarity in Nielsen Norman's "Onboarding tutorials vs. contextual help"
(https://www.nngroup.com/articles/onboarding-tutorials/): state the goal, teach controls in context.
Funnel number to move: `run-landed` / `run` on first sessions, and `run-quit`.

## What
- `src/main.js` openHowto (the short, first-run form only): a one-line goal above step 01 in the card's existing type:
  "Clear the row, roll, land on the pad." (Show; the Wall / Lineup take their own one-line goal from the course's tagline).
- Pointer-aware words stay in `src/pointer.js`; no new steps, the card stays one screen at 390×844 and 320×568 without scroll.

## Acceptance criteria
- [ ] The first-run card's first line states the course's goal; the full four-step card is unchanged.
- [ ] No overlap or scroll at 390×844 and 320×568; contrast ≥ 4.5:1 (`hud-audit`); no HUD text under 11 px.
- [ ] Keyboard, pad and touch variants each read right (the words come from pointer.js).

## Test plan
e2e in `tests/e2e/coach-onboarding.spec.js`: with `coldgas_howto='new'` the card's first text contains the goal on each
course; layout audit at the two sizes.

## Out of scope
New tutorial steps, video, a forced practice run.
