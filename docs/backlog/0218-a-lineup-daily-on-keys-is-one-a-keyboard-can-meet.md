---
id: 0218
title: A Lineup Daily on keys is one a keyboard player can meet, or it says it can't
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-12
pr:
by: critic
---

## Why
0198 (#326) moved both Lineup Dailies to two turns: `roll-lineup` is "Roll two turns over the row and land clean" and
`mark-lineup` is "Roll two turns and land within 13 ft of the mark". On one thumb that's right: 51 % and 35 % of the
careful population meet them (`node scripts/daily-reach.mjs 150`, seed 12345, rerun on `8120984` today).

On keys and on two thumbs, no modelled player can meet them. The builder's own measurements are in 0198's Shipped
section:
- `flyTouch`: 0/150 land two turns, and 0/60 with the roll held through a second turn.
- A keys Assist/Pro sweep of run-up speed, LIFT hold and roll: 4 of 48 roll two turns, and none of them land.

On those devices the miss line reads "Daily: rolled 360°, need 720° — try again"
(`tests/unit/daily.test.js`, 0198's last case), and the title gives no hint. So on 2 of the 10 objective days, a desktop
player is told to try again at something no measured way of flying achieves. Their streak breaks with no choice on
their part. That's the opposite of a reason to come back (focus item 2), and "try again" isn't honest about it (no dark
patterns).

The Lineup on keys still has real skill to measure: the clean 360, the mark, sink, and gas. A keyboard day can ask for
one of those.

## What
In `src/daily.js`, give a Lineup objective a keys and two-thumb form that those players can meet. One way is a
`check`/`goal` keyed on the run's ctx (as `hint`/`titleHint` already are), for example a clean 360 within N m of the
mark on keys. The other is to show the objective only on one thumb and give keys and two-thumb players another day's
objective, with the title saying so.

The number is set from a measured keys population, per LESSONS 2026-11-09 (print how many actually did it).
`scripts/lib/daily-reach.mjs` gains that population for the Lineup and prints it. Mirror the change in the iPhone app's
`Daily.swift` and the vectors (`npm run vectors`), as 0198 did.

## Acceptance criteria
- [ ] `daily-reach` (n 150, seed 12345): each Lineup objective, in the form a keyboard player sees, is met by
      **30–70 %** of a keys population (Pro, `human-show pro` cues, or a stated Assist one). The thumb population stays
      as 0198 left it (51 % / 35 %), or inside 30–70 %.
- [ ] No objective a device can be shown has a 0 % population on that device. `tests/unit/daily-reach.test.js` asserts
      it per device it models.
- [ ] A unit test: on keys, a held, clean 360 Lineup card's miss line names a change a keyboard player can make, or
      meets the day. It never says "need 720°" with "try again".
- [ ] The title card on a Lineup day at 1440×900 shows the keyboard objective's own words (screenshot in the PR).
- [ ] `ref-hash` unchanged. Vectors regenerated if `daily.js` changes (`npm run vectors`).
- [ ] Funnel number to move: `daily-run` → `retry` among key runs on Lineup days.

## Test plan
- Unit tests in `tests/unit/daily.test.js` for the keys form's `evaluate` and `missLine`.
- `daily-reach.test.js` gets the per-device floor.

## Out of scope
- The one-thumb objectives (0198, shipped).
- Making a keyboard 720 flyable (that's a sim and control question, not a Daily).
- The Show's and the Wall's objectives (0200).
