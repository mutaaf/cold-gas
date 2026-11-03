---
id: 0134
title: On one thumb the computer flies the push-off and the carry on the reference's nitrogen, so a phone player can meet the gas Daily
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-02
pr:
by: critic
---

## Why
Most players are on phones, and a phone flies the Show on one thumb by default. On one thumb the
computer, not the player, burns about a fifth of the tank before the brake. That puts one of the ten
Daily objectives out of reach of every phone player.

- **The objective:** `gas-show`, "Clear the row with more than 40 % gas left" (`src/daily.js:25`). It is
  the Daily on **7 of the next 60 days**, the first on 2026-11-15 and the next on 2026-11-20
  (`objectiveFor`).
- **What phone players can reach:** `node scripts/human-phone.mjs 300 --scheme=thumb`, re-scored with
  `scoreRun` and checked with the objective's own `check`:

  | population | meets `gas-show` | gas left (min / median / max) |
  |---|---|---|
  | skill none | **0 / 300** | 26 / 26 / 33 % |
  | skill careful | **0 / 300** | 23 / 24 / 37 % |
  | skill mixed | **0 / 300** | 23 / 26 / 35 % |

  The reference (`createAutopilot('show')`, also Assist) lands with **48 %**.
- **Where the gas goes** (sim, kg drawn from `c.air` per segment, one thumb held from the tap vs the
  reference):

  | segment | one thumb | reference |
  |---|---|---|
  | ramp (the push-off: `THUMB.push` = 36 ticks of LIFT on the deck, `src/onethumb.js:34`, `:125`) | **20.6** | 3.0 |
  | release → over the row (the carry: `out.thrust = 1` until `-vz ≥ THUMB.carry`, `:138–141`) | **112.3** | 71.1 |
  | below 8 m to the touchdown (the brake) | 64.3 | 80.0 |

- **The extra gas buys nothing.** The thumb clears the roofs by 4.5 m, and the reference by 5.1 m.
- **What the player sees.** On the gas day the results say "Daily: 33 % gas left, need 41 % — try
  again" (the same line as `docs/critique/2026-11-02-1540/phone-results-daily.jpg`, which shows today's
  mark Daily). A careful player can't fix that by flying better: the spend is the computer's, before
  the player has any control over it. Telling them to try again at something they can't do is the dark
  pattern the operator's focus rules out.
- **The bar.** The real car flew the whole stunt on one fill (REVEAL_RESEARCH §5.1: "one charge … it's one
  time"). The game's own computer flies the reference on 52 % of the tank, so a computer-flown phone
  run spending 67–77 % is waste, not physics.
- **Funnel:** the first human with a Daily attempt today ran it twice with no `daily-done`
  (`/obs/digest` players, 2026-11-02). This ticket should move `daily-done` / `daily-run` for `human`
  sessions on gas days.

## What
- **`src/onethumb.js`** (input only, no sim change): the push-off and the carry spend what the
  reference's release and carry spend.
  - **The push-off:** a shorter or partial LIFT, or the reference's own release.
  - **The carry:** top up to `THUMB.carry` with the reference's thrust profile, not full rear thrust
    until the speed is reached. Or let go of the Wall at the reference's speed, so the top-up is
    smaller.
  - Keep the clearance: the row is still the one thing a late thumb can't recover from.
- **If the gas can't come down far enough without costing clearance,** then instead set `gas-show`'s
  threshold against the phone population too (`src/daily.js`'s header lists the populations the bars
  were set on). Say in the PR which you did and why. Don't drop the objective.
- **`scripts/human-phone.mjs`** (or a small sibling script): print each Show objective's completion for
  the thumb populations, so the next Daily bar is set on phones as well as keyboards.

## Acceptance criteria
- [ ] **Unit** (`tests/unit/thumb-gas.test.js`, flying the Show on one thumb like
      `thumb-mastery.test.js`, held from the tap):
  - Gas left at touchdown is ≥ 44 % (the reference is 48 %; today it's 33 %).
  - The nitrogen drawn on the ramp is ≤ 6 kg (today 20.6, reference 3.0).
  - The clearance over the roofs is ≥ 3 m, with no contact.
- [ ] **`node scripts/human-phone.mjs 300 --scheme=thumb`:**
  - `--skill=none`, `careful` and `mixed`: 300/300 landed clean, 0 contacts.
  - `gas-show` is met by **≥ 15 %** of the `careful` population (keyboard Assist: about 18 %,
    `src/daily.js:8`). Today it's 0 %.
  - The PR prints the per-objective table for all three populations.
- [ ] **No sim change:** `node scripts/ref-hash.mjs` is identical (show `fedae05c`, wall `bacb4720`,
      lineup `8b2c2c9a`), `SIM_VERSION` is unchanged, `naive-players` is 32/32 and `naive-show` is 54/54.
- [ ] **One-thumb replays still verify:** `simulate(run.inputLog)` reproduces the run, and the board
      accepts it (`thumb-mastery.test.js`'s replay check).
- [ ] **On a phone** (390×844, one thumb, real touches held from the tap):
  - The HUD's GAS at touchdown reads at least 44 %.
  - The descent box still reads only On profile / Hold · Land (0133).
  - 0 page errors.

## Test plan
- **Unit:** the test above, plus one more assertion in `thumb-mastery.test.js`: a careful slide still
  scores at least as well as no slide.
- **e2e:** the touch spec's one-thumb flight already flies the Show. Add one gas assertion at its
  touchdown, without adding a new test (LESSONS 2026-10-31: keep each file's test count).

## Out of scope
- The other Daily objectives.
  - `pro-show` names its tier.
  - `soft-wall` is met on one thumb held from the tap (0.8 m/s) but not on a late hold (0.9 m/s). That's
    a note for the next bar review, not this ticket.
- The brake profile (0028).
- The keyboard and classic schemes.

## Outcome (builder, 2026-11-03)
Shipped the ticket's fallback: `gas-show`'s bar is set on the phone population (> 30 %, was > 40 %). The input-only
fix could not reach the bar without costing the flight:
- **The ceiling.** The reference flown without its pad steering (`steerToPad`) lands with **41 %** and 10.3 m off the
  mark; its 48 % comes from pitching the lift back over the pad, which on one thumb is the player's slide (0121). The
  rest of the one-thumb spend is LAND's own set-down (a sim change, out of scope).
- **The push-off buys score.** Cutting `THUMB.push` 36 → 1 tick raised the held-from-the-tap flight 33 → 36 % but lifted
  the clearance 4.5 → 6.5 m and the miss 6.0 → 6.5 m (85.7 → 82.7); the careful population's median score fell
  93 → 84.7 and `ninety-show` 73 → 23 %. Stopping earlier on the ledge (0.93) and letting go later (0.995) peaked at
  39 % with `ninety-show` 45–50 %. No variant put a careful player over 41 %.
- **What a thumb chooses** is when to hold the pad: from the tap it lands with 33–37 %, held for the fall 23–26 %, so
  > 30 % rewards the efficient flight and is not a lottery.

`node scripts/human-phone.mjs 300 --scheme=thumb --skill=<…> --daily` (new flag), all 300/300 landed clean:

| population | gas-show (> 30 %) | mark-show | skim-show | ninety-show | scratch-show | gas left min / median / max |
|---|---|---|---|---|---|---|
| none | 78/300 (26 %) | 0 % | 68 % | 0 % | 100 % | 26 / 26 / 33 |
| careful | 57/300 (19 %) | 14 % | 82 % | 74 % | 100 % | 23 / 24 / 37 |
| mixed | 67/300 (22 %) | 10 % | 76 % | 41 % | 100 % | 23 / 26 / 35 |

Keyboard Assist (`human-show.mjs 300 assist --cues=new`): > 30 % on 195/300 (65 %), > 40 % on 47 (16 %).
