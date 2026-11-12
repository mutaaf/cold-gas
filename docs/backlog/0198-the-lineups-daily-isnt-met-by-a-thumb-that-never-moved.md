---
id: 0198
title: The Lineup's Daily isn't met by a thumb that only held the pad
status: shipped
priority: P1
size: S
lens: engagement
created: 2026-11-11
pr:
by: critic
---

## Why
The focus's item 2 is reasons to come back, and the Daily is the title's headline one. On a phone, both of the
Lineup's Daily objectives are met by a thumb that only holds the pad. On production today (`index-BfrEcyEr.js`,
390×844 touch, first visit):
- The thumb held from Go and never moved.
- Run 1 scored 91.3 Silver, 1.3 m off the mark.
- The card reads **"Daily ✓ complete · streak 1"** (`docs/critique/2026-11-11-2136/L-held-results.png`).

`node scripts/daily-reach.mjs 150` (seed 12345) gives the same result:
- `roll-lineup` ("Roll a clean 360° over the row"): 150/150
- `mark-lineup` ("Land within 23 ft of the mark"): 150/150

`src/daily.js:25-27` admits these are "a phone's easy days". On a Lineup day, the Daily is over before the player has
made a single choice, and the streak counts a run nobody flew.

The Show's and the Wall's Dailies sit in the 30–60 % band on the same population. Those are days you can miss, and so
days worth coming back for.

#315 (0191) gave the Lineup's thumb a real choice: slide up on the run-up for two turns, then aim onto the mark. The
Daily can ask for that.

## What
In `src/daily.js`, re-set the Lineup's two objectives on the one-thumb population. For example:
- `roll-lineup` → "Roll two turns over the row and land clean". This needs the run-up call (`src/onethumb.js`
  `LINEUP_TWICE`). On keys it's a 720 by hand.
- `mark-lineup` → within the distance where a held-from-Go thumb doesn't meet it but an aimed one does. Today the held
  thumb misses by 1.3 m, so the bar has to be under that. Set it from the measured split, per LESSONS 2026-11-09:
  print how many of the population actually slid.

Each objective's miss line names the choice that meets it, in the device's words (0139/0150). For example: "slide up
on the run-up for two turns".

`scripts/lib/daily-reach.mjs` models the call share it assumes, and prints it.

## Acceptance criteria
- [ ] A one-thumb Lineup flight held from Go with no slide meets **neither** Lineup objective. Add a unit test in
      `tests/unit/` on `evaluate` with the held flight's card.
- [ ] `daily-reach` (n 150, seed 12345): each Lineup objective sits between **30 % and 70 %** on the careful one-thumb
      population, and the script prints the share that took the call or slid.
- [ ] Every other objective stays over the floor. `tests/unit/daily-reach.test.js` passes unchanged.
- [ ] Each Lineup miss line says what to do in the pad's words. Assert it in a unit test.
- [ ] Keys (Pro): each Lineup objective is met by ≥ 30 % of the keyboard population, or it's documented as
      phone-first with the number.
- [ ] `ref-hash` unchanged (Daily only; no sim or scorer change).
- [ ] Funnel number to move: `daily-run` → `retry` on Lineup days among touch runs.

## Test plan
- Unit: `evaluate` over a held-from-Go Lineup card, which must not be met. A 720-on-the-mark card must be met.
- `daily-reach.test.js`'s floor test stays as it is.

## Out of scope
- The Lineup's medals (0191).
- The judges' panel headline (0195, operator).
- The Show's and the Wall's objectives.

## Shipped (builder, 2026-11-12)
Measured on main `a3b6a4d` (`scripts/lib/daily-reach.mjs` flyThumbLineup, n 150, seed 12345; the held flight is
`tests/unit/daily.test.js` 0198's):
- Held from Go and never moved: a clean 360 1.3 m off the mark. The same thumb slid up on the run-up and never aimed:
  a 720 4.3 m off (wherever it was called). Slid back onto the mark in the air: a 720 under 1.5 m (Gold).
- The population: 76/150 slid up for two turns (the model's half, `P.twice`), and 76/76 of them land two clean turns.
  Their 720s land 1.5–4.3 m off. Of all 150 landings, only 8 come within 1.2 m of the mark, so a 360-only mark bar under the held thumb's 1.3 m
  can't be in the band (5 %). The mark day asks for two turns onto the mark instead.
- `roll-lineup` → "Roll two turns over the row and land clean": **76/150, 51 %**. `mark-lineup` → "Roll two turns and
  land within 13 ft (4 m) of the mark": **53/150, 35 %**. n 40: 48 % / 35 %. Every other objective is as before.
- Keys / two thumbs: phone-first. flyTouch: 0/150 land two turns. With the roll held through a second turn: 0/60. A keys
  Assist/Pro sweep of run-up speed, LIFT hold and roll: 4 of 48 rolled two turns, and none of them landed. The miss line there says "try again" rather than
  name a way that isn't modelled. That's a call for the critic/operator if keyboard Lineup days matter.
- `ref-hash` unchanged (no sim or scorer file touched). The vectors are regenerated (client.json: the goals, the checks
  and the miss lines), and `ColdGasClient/Daily.swift` mirrors the change.
