---
id: 0237
title: Every scored run gets a Wreck score too, with destruction combos that come from the physics
status: proposed
priority: P1
size: M
lens: player-feel
created: 2026-11-13
pr:
by: operator
---

## Why
The operator's call, 2026-11-13: Wreck Club (docs/proposals/creative-direction.md, Direction 2; AGENTS.md §1 and
invariant 5). Wrecks outnumber landings 2:1 in production's funnel, and today a wreck ends with "write-off". A second score
turns the most common outcome into a payoff, from the crash physics players already praise.

## What
- A pure scorer beside `scoreRun`, e.g. `src/sim/wreck.js` `wreckRun(run)`, reading only what the sim already records:
  impact energy and parts from `run.impacts`, damage zones (src/sim/damage.js), parts torn off, parked bodies displaced or
  toppled, distance tumbled, time airborne after the first hit. dmath only; no `Math.random`, wall clock or DOM.
- A combo detector: events chained within a window (roof-scrape → topple → tumble → part off = ×4), each step with its tick
  so the HUD can show it live and the replay can show it again.
- Output: a Wreck card (total, categories, the combo chain), separate from the Style card. Never blended.
- No sim change: outcomes and replays are bit-identical, so no `SIM_VERSION` bump. The vectors carry the Wreck card so the
  iPhone (0239) is held to it.
- A wreck counterpart to the naive-players gate (scripts/naive-players.mjs or a sibling): simple strategies (hold GO, mash,
  nothing) can't score near the top of the Wreck range; set the bar from a few hand-flown and autopilot wrecks.

## Acceptance criteria
- [ ] Unit: the same log gives the same Wreck card; a clean landing scores ~0 Wreck; a combo needs each step inside its window;
      a toppled parked body counts once.
- [ ] `node scripts/ref-hash.mjs` and the determinism check are unchanged (no sim change).
- [ ] The naive-wreck gate passes and is documented in AGENTS.md §5.
- [ ] `npm run vectors` regenerated; `npm run check` green.

## Test plan
New `tests/unit/wreck.test.js` over recorded wreck logs from each course; vectors test; the new gate script.

## Out of scope
Showing it (0238, 0239). A server board (0244). Any change to `scoreRun` or the sim.
