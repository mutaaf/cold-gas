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
Depends on: 0237, 0238, **0254** (re-sequenced 2026-11-13, Phase 2: docs/proposals/phase-2-growth.md §5).
- **Reconciled with licenses (0254, 0255):** licenses are the skill spine (Style, measurable tests, they replace the
  difficulty selector); Wreck Club ranks are the parallel, cosmetic track. Ranks never gate a license, a tier or a course,
  and licenses never gate a cosmetic. Both live in 0254's one store (`coldgas_progress`: `feats`, `rank`, `unlocks`), not
  a key of their own, and the ranks screen is the second tab of 0255's licenses screen (Licenses | Wreck Club).
- A pure `src/ranks.js`: lifetime feats from Wreck cards and the crash ("Topple a semi", "Lose all four wheels", "Land after
  losing a door"…) and ranks from feats. Stunt feats that are really skill tests ("Clear the row with a 720") belong to
  the licenses instead; a feat may still unlock a cosmetic for a clean stunt as long as it isn't a license test.
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
