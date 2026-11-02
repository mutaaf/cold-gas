---
id: 0127
title: A newcomer's first Jump asks for one sentence, not a four-row card
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-01
pr:
by: scout
---

## Why
Players funnel (2026-11-01, `/obs/digest → players`): 0 human, 36 auto sessions, no board rows. With no human data yet the
best guess for the visit → run drop is the first screen a newcomer meets after tapping Jump. Played as a newcomer
(`coldgas_howto = 'new'`, 390×844 touch): the tap opens "Four things to know", a full-height card with four rows
(drive and climb, let go, roll and land, aim and brake) and two buttons, over the title. It covers ~70 % of the phone
and has to be read before the first run starts. Casual players leave on a wall of text before the first jump, and the
in-run cue line and the coach already say each step at the moment it applies.

## What
For a first-time visitor on touch with One-thumb, the card shows only step 01 ("hold the pad: crawls you up the Wall")
with "Got it · Jump" primary, and a quiet "All four" link that expands the full card in place. The cue line (already in
the run) carries the rest. Returning players and Skip are unchanged. No sim, scoring, or copy changes beyond choosing
which rows show. Touches the how-to card in `src/ui.js` / `main.js` (`howtoSeen`).

## Acceptance criteria
- [ ] 390×844 touch, `coldgas_howto = 'new'`: the card shows one row, its height is under 45 % of the viewport, and
      "Got it · Jump" starts the countdown in one tap
- [ ] "All four" shows the existing four rows; Skip and the stored `howtoSeen` behave as before
- [ ] Keyboard and gamepad cards are unchanged
- [ ] hud-audit and title-audit stay green at every audited viewport

## Test plan
e2e: a newcomer context at 390×844 asserts the one-row card, its height, the expand link, and a run starting from one
tap. Unit coverage not needed (layout only).

## Out of scope
Changing what the cue line or coach says; any funnel or beacon change.
