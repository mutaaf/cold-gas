---
id: 0363
title: A Lineup wreck is never coached "Clean · nothing big to fix · try Pro"; it names the row and the fix
status: ready
priority: P0
size: S
lens: player-feel
created: 2026-11-23
pr:
by: critic
---

## Why
The coach on the results sheet tells a player who just put the car into the row that the run was clean. On production
(`057f041`, 1440×900, keys, Assist, `docs/critique/2026-11-23-1630/desk-lineup-keys-floor-sheet-clean.png`), a Lineup run that
hit the row scores **4.0 · No jump · crashed**. Its NEXT RUN line says **"Clean. Next: try Pro and fly the landing yourself
(×1.08)"**. WHAT HAPPENED says **"Clean · No jump: nothing big to fix."** The player is told to turn the help off after the
worst run the game can score.

This is not one bad run. Over the keys population the daily-reach model flies (`scripts/lib/daily-reach.mjs flyKeysLineup`,
200 players, seed 777), **87 of 200 crash**. The coach's first finding is `clean` on **64 of the 87 (74 %)**. That's 13 No jump,
28 Contact and 23 Wrecked (`docs/critique/2026-11-23-1630/lineup-coach.out.txt`).

**Cause:** `src/sim/coach.js:154-175`.
- The "never got off the ground" findings are gated `wall && …`, and the row hit (`short`, "Came down on the row") is gated
  `show && t.contact`.
- The Lineup has neither, so a Lineup row hit falls through to `finish()`, which writes `clean` (`coach.js:249-252`).
- The funnel files the same runs under `wreck-other`, because `WRECK_OF` has no `clean`. That's 3 of today's 4 human wrecks;
  today's humans were all on keys, and 3 of the 5 Lineup runs wrecked. Scout's 0362 counts them better; this ticket makes the
  words true.

The real kickflip cleared the row by metres ("I think we could have cleared more than our whole fleet", Musk, OFFICIAL,
`docs/REVEAL_RESEARCH.md` §2.2). A crash into the row is the one thing the coach must name. Operator focus (1): the score right
after landing, and retry. A coach that says "clean" after a wreck gives the retry nothing to go on.
**Number it moves:** `retry` after a `wrecked-lineup`, and `landed-lineup` on the next run.

## What
In `src/sim/coach.js`, give the Lineup its own wreck findings, ahead of `finish()`, from the replay it already reads
(`readFlight`). Every number comes from that replay.
- **`no-lift`** (Lineup, `t.airStartTick < 0` or the car never rose above the row's height): "You never got off the ground:
  `<speed>` km/h at the line." The fix names LIFT by the player's own words (`say.lift` or the cue's `kbd('LIFT', 'Space')`), the
  line, and a run-up of 25–30 km/h (the reveal's 7–9 m/s, REVEAL_RESEARCH §2.2, ESTIMATE).
- **`row`** (Lineup, `t.contact`): "Came down on the row: `<clearance>` m over the `<vehicle>`." The fix comes from the
  two things that decide the Lineup: the run-up speed at the line, and how long LIFT was held. Read both from the input log
  (the lift group's ticks, as `LIFT_IDX`). Example: "held LIFT 0.35 s: hold it about half a second".
- Map both ids in `src/obs/signature.js WRECK_OF` (to `short`, or new `wreck-lift`/`wreck-row` if 0362 lands first: coordinate
  with it and don't break its tests).
- `finish()` never writes `clean` for a card with `facts.crashed`. A crashed run with no finding gets a neutral "Wrecked: `<what
  the card says>`" with no "try Pro" line.

Pure coach/obs change: no sim, scorer, vector or ref-hash change.

## Acceptance criteria
- [ ] Over the 200-player keys population (`flyKeysLineup`, seed 777), **0** crashed runs have `clean` as any finding.
      Every one of the 87 has a finding that names the row or the lift. Today 64 are `clean`.
- [ ] No crashed card, on any course or tier, gets the "Try Pro" fix. Unit test: sweep `cards()` for the thumb, touch, keys and pro
      populations on all three courses.
- [ ] The floored run on production (`docs/critique/2026-11-23-1630/lineup-keys.mjs.txt`, `floor floor 500`) shows a NEXT RUN line
      and a WHAT HAPPENED that name the speed at the line (≈ 115 km/h) and the 25–30 km/h to aim for. Screenshot it beside
      `desk-lineup-keys-floor-sheet-clean.png`.
- [ ] A 0.35 s LIFT at 7 m/s (`lineup-keys-sim-grid.mjs.txt`: Wrecked 32) is coached with how long LIFT was held and what
      clears the row.
- [ ] Show and Wall coach outputs are unchanged for every card in `tests/unit/coach*.test.js`. `npm test` green; ref-hash unchanged.
- [ ] 390×844 touch: the one-thumb Lineup (200/200 land today) is unaffected; a forced thumb wreck gets the same row finding.

## Test plan
- A `tests/unit/coach-lineup.test.js` that:
  - flies `flyKeysLineup` × 200 (seed 777) and asserts no `clean` on any crash;
  - checks the two new ids, their numbers against the run's facts, and the population tally;
  - covers the floored case.
- Extend the obs signature test for the new `WRECK_OF` entries.

## Out of scope
- The run-up speed itself and the cue for it (0364).
- The funnel's general `other` bucket (0362).
- The Wreck score (0237).
