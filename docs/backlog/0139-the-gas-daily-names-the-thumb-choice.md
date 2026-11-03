---
id: 0139
title: On one thumb, the gas Daily names the choice that meets it, and aiming never makes it harder to read
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-03
pr:
by: critic
---

## Why
Most players are on phones and fly the Show on one thumb. Since 0134 and 0135 the gas Daily ("Clear the row with
more than 25 % gas left", `src/daily.js`) is reachable there, but surely only by one choice the game never names.

- **The choice:** hold the pad from the tap on the ledge to the ground. Two production flights held that way
  landed with **34 %** and **34 %** (critique 2026-11-03 09:55, `phone-held-touchdown.jpg`, GAS 222 lb). The
  builder measured 33–37 % held from the tap and **23–26 %** when the pad is picked up once the fall has begun,
  at any height (0134 Outcome).
- **The population** (`node scripts/human-phone.mjs 150 --scheme=thumb --daily`, 2026-11-03, gas left at touchdown):

  | skill | gas left min / median / max | > 25 % (today's bar) | median score |
  |---|---|---|---|
  | none | 26 / 26 / 33 % | **150/150** | 83.7 |
  | careful | 23 / 25 / 37 % | **73/150** (`scripts/daily-reach.mjs`: 76/150, 51 %) | **92.7** |

  The players who fly 9 points better meet it half as often as the ones who never touch the slide. 0135's own
  note (`src/daily.js` header) says the careful thumbs that let go land in two clusters, 24 % and 26 %, "split by
  nothing they choose, so for them the day is partly luck. Holding from the tap is the sure way." Steering onto the pad costs lift, which is physically
  honest (the real pilot's steering cost gas too), but the player is never told that the trade exists.
- **What a miss says today:** `Daily: 24 % gas left, need 26 % — try again` (`src/comeback.js:213` with the
  objective's miss text). It names the number, not the pad. The coach mentions gas only below 10 %
  (`src/sim/coach.js:233`). "Try again" at something the player can't see how to change is the dark pattern
  the operator's focus rules out.
- **When:** gas-show is the Daily on **2026-11-15** and **2026-11-20** (`objectiveFor`).
- **Funnel:** this should move `daily-done / (daily-done + daily-miss)` for `human` sessions on gas days (0136).

## What
- **Find the lever first.** In `scripts/human-phone.mjs --daily` (or a small sibling), split the careful
  population's gas-show by what the thumb did (held from the tap vs lifted and re-pressed; slid vs not) and
  print it. Name in the PR which choice separates > 25 % from ≤ 25 %. If it is not the hold, the words below
  follow the measurement, not this ticket.
- **The words, in the device's terms** (`src/pointer.js` / `coachWords`, `src/daily.js` miss text,
  `src/comeback.js` results line):
  - A missed gas Daily flown on one thumb says what to do, for example
    `Daily: 24 % gas left, need 26 % · keep your thumb on the pad from the tap to the ground`. On keys or the
    classic touch controls it names their own control (shorter boosts, one late brake), not the pad.
  - The title's Daily card on a gas day, on one thumb, carries the same hint in one line (no new row on a
    390×844 screen if it would push Jump down; then on the how-to/countdown tip instead).
  - If the slide costs the Daily, say so once (for example "slides onto the mark cost gas"), so a careful player
    can choose the mark or the gas.
- No sim, scorer or threshold change. `gas-show` stays > 25 % (set by 0135; `tests/unit/daily-reach.test.js` holds it).

## Acceptance criteria
- [ ] The PR prints the careful population split (n = 150, `--scheme=thumb --skill=careful`) by the thumb choice,
      with gas-show met for each group, and the words name the group that meets it.
- [ ] Unit (`tests/unit/daily.test.js` or `comeback.test.js`): a gas-show miss flown on one thumb produces a line
      that names the pad and the hold; on keys it names no pad; a met gas Daily is unchanged
      (`Daily ✓ complete · streak n`).
- [ ] At 390×844 touch on a stubbed gas-show day (production build): the results' Daily line after a miss is fully
      visible without scrolling past Retry, ≥ 11 px, ≥ 4.5:1 (`npm run audit` unchanged), and the title's Daily
      card holds the hint without overlap.
- [ ] A phone flight on the stubbed gas day that follows the words (held from the tap) meets the Daily (≥ 26 %).
- [ ] No sim change: `node scripts/ref-hash.mjs` identical (show `fedae05c`, wall `bacb4720`, lineup `8b2c2c9a`).

## Test plan
- Unit: the miss line per device for gas-show; the population split is printed by the script (not a gate).
- e2e: fold into the existing `challenge.spec.js` Daily flow (no new boot, LESSONS 2026-10-31): stub the day to
  gas-show and assert the miss line's words on touch.

## Out of scope
- Changing the gas bar or any other objective's bar (0135).
- The one-thumb push-off's 28.6 kg (0134's accepted trade).
- The other Daily objectives' wording.
