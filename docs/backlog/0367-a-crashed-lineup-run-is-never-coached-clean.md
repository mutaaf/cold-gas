---
id: 0367
title: A crashed Lineup run is never coached "Clean · nothing big to fix · try Pro"; it names the row or the lift
status: ready
priority: P0
size: S
lens: player-feel
created: 2026-11-24
pr:
by: critic
---

## Why
The coach on the results sheet tells a player who just put the car into the row that the run was clean, and suggests
turning the help off.

This was first measured in the 2026-11-23 16:30 critique (PR #502, which never merged; its ticket number 0363 has since
gone to another ticket). I re-ran the same probe on main `927dc5c`, and nothing has changed
(`docs/critique/2026-11-24-0800/lineup-coach.out.txt`):
- **The population:** 200 keys players on the Lineup, Assist (`scripts/lib/daily-reach.mjs flyKeysLineup`, seed 777).
- **87 of them crash.**
- **The coach's first finding on 64 of those 87 (74 %) is `clean`:** 13 No jump, 28 Contact and 23 Wrecked.
- **The words a wrecked player reads:** "Clean · Wrecked: nothing big to fix. → Want more? Try Pro: you fly the landing
  yourself, and it scores ×1.08."
- **Live on production today:** 1440×900, keys, Assist, ↑ held as the cue says, Space 0.5 s at the "Hold Space at the
  line" cue (`docs/critique/2026-11-24-0800/lineup-keys.mjs.txt`).
  - The car reaches the line at 32.3 m/s and hits the row: **4.0 · No jump · crashed**, clearance −0.4 m
    (`desk-lineup-floor.json.txt`).
  - The sheet's NEXT RUN says **"Clean. Next: try Pro and fly the landing yourself (×1.08)"**.
  - WHAT HAPPENED says **"Clean · No jump: nothing big to fix"** (`desk-lineup-floor-sheet-clean.png`).

**Cause** (`src/sim/coach.js`):
- `:154` sets `wall = courseId !== 'lineup'` and `show = courseId === 'show'`.
- Each "never got off the ground" finding is gated `wall && …` (`:158`).
- The row hit (`short`, "Came down on the row") is gated `show && t.contact` (`:172`).
- So a Lineup row hit has no finding, and `finish()` (`:250-252`) writes `clean` with the "Try Pro" fix. It doesn't check
  `card.facts.crashed`.
- The funnel files these runs as `wreck-other` (`src/obs/signature.js:135`, `WRECK_OF` has no `clean`). On 11-23 that was
  3 of 4 human wrecks, and 3 of 5 human Lineup runs wrecked.

**Open work doesn't cover it:**
- 0362 and its PR #507 change the Lineup's lift and don't touch `coach.js`. 0362 only asks for a Pro finding above 12 m.
- 0363 is the run-up speed.
- A row hit stays possible after both land, and the sheet will still call it clean.

**The bar:** the real kickflip cleared the row with room to spare (`docs/REVEAL_RESEARCH.md` §2.2). Hitting the row is the
one failure this course has, and the coach has to name it. Operator focus (1) is the score right after landing, and retry.
A wrecked player who is told "clean" learns nothing to retry with.

**Number it moves:** `wreck-other` → a named cause, and `retry` after `wrecked-lineup`.

## What
In `src/sim/coach.js`, give the Lineup its own wreck findings, ahead of `finish()`. Every number comes from the replay that
`readFlight` already runs.
- **`no-lift`**: on the Lineup, the car never rose above the row's roof height (or `t.airStartTick < 0`).
  - Detail: "You never got off the ground: `<speed>` km/h at the line."
  - Fix: name LIFT in the player's own words (`say.lift`), the line, and a run-up of the reveal's 7–9 m/s
    (§2.2, ESTIMATE).
- **`row`**: on the Lineup, `t.contact` is set.
  - Detail: "Came down on the row."
  - Fix: name the two things that decide this course, the speed at the line and how long LIFT was held. Read both from
    the input log.
- Map both ids in `WRECK_OF` (to `short`, or to new `wreck-lift` / `wreck-row`).
- `finish()` never writes `clean`, and never writes "Try Pro", for a card with `facts.crashed`. A crash with no finding gets
  a neutral line built from the card's own verdict.

Pure coach and obs change: no sim, scorer, vector or ref-hash change. If #507 has merged, rebase onto it and keep its tests.

## Acceptance criteria
- [ ] Over the 200-player keys population (`flyKeysLineup`, seed 777), **0** crashed runs have `clean` as any finding.
      Today 64 of 87 do.
- [ ] Every crashed Lineup run whose card has `t.contact` gets the `row` finding first, and every one that never rose
      above the roofs gets `no-lift`.
- [ ] No crashed card, on any course or tier, gets the "Try Pro" fix. Unit-test it across the thumb, touch, keys and pro
      populations on all three courses.
- [ ] Production, 1440×900 keys: a run with ↑ held through the line and no LIFT shows a sheet whose WHAT HAPPENED and
      NEXT RUN name the speed at the line and the 25–30 km/h to aim for. Screenshot it beside
      `docs/critique/2026-11-24-0800/desk-lineup-floor-sheet-clean.png`.
- [ ] 390×844 touch: a forced one-thumb Lineup wreck gets the same row finding. Screenshot the sheet.
- [ ] The Show and Wall coach outputs are unchanged for every card in `tests/unit/coach*.test.js`. `npm test` is green and
      `ref-hash` is unchanged.

## Test plan
- Add `tests/unit/coach-lineup.test.js`:
  - fly `flyKeysLineup` × 200 (seed 777) and assert no `clean` on any crash;
  - check the two new ids and that their numbers match the run's facts.
- Extend the obs signature test with the new `WRECK_OF` entries.

## Out of scope
- The Lineup's lift height (0362) and the run-up speed (0363).
- The Wreck score (0237).
