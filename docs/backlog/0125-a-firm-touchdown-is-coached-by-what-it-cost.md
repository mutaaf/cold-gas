---
id: 0125
title: The coach weighs a firm touchdown by the points it cost, and gives the one thumb a fix it can do
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-01
pr: 201
by: critic
---

## Why
The operator's focus puts "skill that shows in the score" in the core loop. 0124 fixed the results card for the
player who doesn't aim. The player who does aim is now told the wrong thing. Measured on main `e92311b` (= production,
docs/critique/2026-11-01-1015.md):

- `node scripts/human-phone.mjs 300 --scheme=thumb --skill=careful --coach`: median **93**, and the coach's first
  finding is **`ran-out` on 150 of 300 runs** (`mark` 86, `clean` 64). A 40-run `-v` sample shows who gets it: runs at
  **92–93.3** with sink **1.6–1.7 m/s** and the pad 3.2–3.9 m off.
- The `ran-out` finding fires on any sink over `SINK_SOFT` = 1.5 m/s (`src/sim/coach.js:132`), at a fixed weight of
  **6** (`src/sim/coach.js:151`), whatever it cost. On the Show a 1.6 m/s touchdown against a perfect 0.9 m/s costs
  `band(sink, 6, 0.9)` 0.863 vs 1 → 10 × 0.38 × 0.137 = 0.52 landing points × the judges' mean landing weight 0.247
  (`SHOW_W`, `src/sim/judge.js:85`) → **≈ 1.3 points of the total**. 0124 set the bar at 3 points (`MARK_POINTS`).
- Its words can't be followed on one thumb: *"Stay on the brake through the last 2 m: hold the sink in the green
  band to the ground."* On one thumb with Assist the held pad *is* the brake, and these players held it to the ground;
  the computer paces the sink, and there is no green band to hold on the pad.
- The real car braked to about 1.5 m/s by about 2.5 m, hovered 1–1.5 s and settled (REVEAL_RESEARCH §2.1.4, line 179–181):
  a 1.6 m/s touchdown is a firm but honest landing, not the run's headline.

So half of the best one-thumb players read a headline about a ~1-point loss, in words for a device they aren't using.

## What
- `src/sim/coach.js`: weigh `ran-out` (and `late-brake` / `no-brake` on the Show) by the points the sink cost: re-score
  the run with the sink at 0.9 m/s through `scoreRun`, as `markCost` does for the mark (one helper, so it can't drift
  from judge.js). Under the same 3-point bar the finding drops below anything that cost more, and a run with
  nothing over 3 points is `clean`. State the cost in the detail ("1.6 m/s at touchdown: about 1 point").
- One thumb (`coachWords(ctx)`, `src/pointer.js:46`): the fix is the device's, e.g. "keep holding the pad to the
  ground, and slide less in the last metres: a slide spends the jets the brake needs", or whatever the sim actually
  supports (check that a slide does cost braking before you write it). Keyboard/stick words unchanged.
- No change to judge.js, the sim or SIM_VERSION.

## Acceptance criteria
- [ ] Unit (`tests/unit/learn.test.js`, "the coach"): a Show, Assist, one-thumb telemetry with sink 1.6 m/s and the
      pad 3.4 m off yields `clean` (or a finding that cost ≥ 3 points), not `ran-out`. A sink of 3.5 m/s still yields
      a braking finding first, with its cost within ±1 of the re-score.
- [ ] `human-phone.mjs 300 --scheme=thumb --skill=careful --coach`: `ran-out` as first finding drops from 150/300 to
      under 30/300; the median stays 93 (no sim change). `--skill=none` stays `mark` 300/300.
- [ ] At 390×844 touch, the one-thumb braking fix text never says "green band" or "stay on the brake" (the pad has
      neither); 1280×720 keyboard keeps its words. Screenshot of each in the PR.
- [ ] Determinism, `naive-players` 32/32, the reference Show 97.7 unchanged; `hud-audit` clean.

## Test plan
Extend `tests/unit/learn.test.js` ("the coach") with the two sink fixtures and the one-thumb words. Run
`human-phone.mjs --coach` at `careful` and `none` before and after and paste both tallies in the PR.

## Out of scope
The Assist governor's touchdown sink itself (a sim change). The Wall and the Lineup thresholds. The "Never let go"
finding on a run that never climbed (noted in the critique).
