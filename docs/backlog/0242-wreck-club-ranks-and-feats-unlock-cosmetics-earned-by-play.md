---
id: 0242
title: Wreck Club ranks, earned by crash feats, unlock cosmetics by play alone
status: ready
priority: P2
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club (operator's call 2026-11-13): ranks and cosmetic unlocks earned only by play, with no dark patterns. Rank feats
double as the player's own stunt goals.

## What
Depends on: 0237, 0238.
- A pure `src/ranks.js`: lifetime feats from Style and Wreck cards ("Topple a semi", "Lose all four wheels", "Land after
  losing a door", "Clear the row with a 720"…) on the device (localStorage, like medals), and ranks from feats.
- Cosmetic unlocks only: paint, plume tint, a number decal of our own (src/render/roadster.js, plumes.js). Never a score,
  never physics, never a tier.
- A ranks screen from the title, listing every feat and how to earn it.
- No energy timers, loot boxes, paid or ad-bought progress, fake scarcity or streak punishment; every unlock is reachable by
  play.

## Acceptance criteria
- [ ] Unit: feats are detected from recorded cards; ranks and unlocks persist; no unlock changes a run's log, card or
      Wreck card.
- [ ] Every feat is reachable (a scripted or recorded run for each).
- [ ] 390×844 touch and 1280×720 keyboard; audits and the flicker budget pass for the new paints and tints.

## Test plan
New `tests/unit/ranks.test.js`; an e2e that earns one feat and applies its unlock.

## Out of scope
The iPhone (a follow-up after 0239). Any board.
