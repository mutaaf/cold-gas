---
id: 0254
title: One progress store on the device, and the licenses (Rookie to Legend) as pure rules read from the score card
status: proposed
priority: P1
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 proposes licenses as the skill ladder; Wreck Club (operator's call 2026-11-13) already approved ranks earned by
crash feats (0242). Both, plus medals (`coldgas_medals`), the daily streak (`coldgas_daily`), `coldgas_flown` and the
first-run state, are progress kept on the device in separate keys. docs/proposals/phase-2-growth.md §5 reconciles them:
licenses are the skill spine and replace the difficulty selector; Wreck ranks are a parallel, cosmetic track; one store
holds both. This ticket is the pure foundation both read.

## What
- **`src/progress.js`** (pure, no DOM; a thin `localStorage` adapter beside it like medals.js): one versioned record
  `coldgas_progress` = { v, firstSeenDay, lastSeenDay, sessions, jumps, landings, firstLandingRun, licenses: {id: {passed,
  tests: {id: best}}}, feats: {}, rank, unlocks: [] }. A one-time migration reads `coldgas_flown` and `coldgas_medals` (a
  returning player with medals is credited with every license their medals already prove). The old keys stay readable for
  one release.
- **`src/licenses.js`** (pure): six licenses, each 2–4 measurable tests judged only from `scoreRun`'s card and the run's tier
  (the numbers the server agrees with), never a new score:
  - **Rookie**: launch and land upright (any course, Assist).
  - **Bronze**: a controlled single rotation: a 360 landed on the Show; touchdown sink under the Assist bar.
  - **Silver**: consistency and precision: three landings in a row inside the mark's ring; a landing with no contact.
  - **Gold**: aerial control on Pro: the Show landed on Pro; the Wall's hang held to the ledge's mark.
  - **Ace** (the brief's "Pro", renamed so it isn't confused with the Pro flight tier): combinations: a 720 over the row
    and on the mark; the Lineup cleared and stuck.
  - **Legend**: high-risk mastery on Advanced: the Show on Advanced at Gold-medal score; a 720 on Advanced.
  Exact thresholds are set from the reference flights and the human-show/naive populations so every test is reachable by
  play (a scripted or recorded run per test), and Rookie by a careful newcomer on their first few jumps.
- `nextGoal(progress)`: the one next test to show on the title and the results ("Next: Bronze · land a 360").
- Names, words and any badge art are our own (§3.7): no racing game's license names, letter grades, test layouts or art.
- Vectors: `npm run vectors` emits each vector run's test results so the iPhone (0256) is held to the same rules.

## Acceptance criteria
- [ ] Unit (`tests/unit/licenses.test.js`, `tests/unit/progress.test.js`): each test passes and fails on recorded cards;
      the migration credits medals; the store round-trips and survives a corrupt or old record.
- [ ] Every test is reachable: a scripted run per test passes it (`scripts/` or the unit fixtures).
- [ ] Nothing in a run's log, card, tier multiplier or board entry changes (`npm run determinism` and the vectors check).

## Test plan
The two unit files above, plus a fixture run per test; `npm run vectors -- --check`.

## Out of scope
Any UI (0255, 0256). Wreck feats' rules (0242 adds them to this store). Any server.
