---
id: 0184
title: In a first-ever session the rookie offer comes after the second wreck, not the third
status: ready
priority: P0
size: S
lens: engagement
created: 2026-11-10
pr:
by: scout
---

## Why
The week's funnel (`/obs/digest` → players, 2026-11-01…10): 10 human sessions, 12 runs, 5 wrecked against 3 landed,
2 quit before the card. Today's two human runs were both wrecks (`wreck-brake`, `wreck-roll`) with no `retry`
after either. Rookie mode (src/rookie.js, `ROOKIE_AFTER = 3`) offers Easy driving + Assist in one tap only from the
third crash in a row; a first-time phone visitor who wrecks twice has usually left by then. Early difficulty
adjustment for novices is the standard retention lever in short-session games (Hunicke, "The Case for Dynamic
Difficulty Adjustment in Games", https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf). No dark pattern:
the offer is one dismissible button, not a nag, and nothing about a score changes.

## What
`src/rookie.js` / `src/main.js`: `offerRookie` takes a second threshold, 2, when this device has never landed a run
(no `coldgas_medals` entry and the howto flag says first session). Everyone else keeps 3. The sheet's wording and
the one-tap action are unchanged. Pure change in rookie.js; main.js passes the "never landed" bit it already knows.

## Acceptance criteria
- [ ] Never-landed device: the offer shows on the second crash in a row; a clean run resets it.
- [ ] A device with any stored medal or landed run still needs three crashes.
- [ ] No offer on a run already on Easy + Assist; no sim, scoring or SIM_VERSION change.
- [ ] Works at 390x844 touch and 1280x720 keyboard; the sheet still fits without overlap (`npm run audit`).
- [ ] Moves: `retry` after `run-wrecked` in the players funnel.

## Test plan
Unit (tests/unit rookie): table of (streak, neverLanded, level, tier) → offer. E2E (rookie.spec.js): two forced
crashes in a fresh context show the button; with a seeded medal they do not.

## Out of scope
Changing the third-crash rule for returning players; any change to difficulty itself.
