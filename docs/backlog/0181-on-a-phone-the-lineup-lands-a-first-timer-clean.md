---
id: 0181
title: On a phone, the Lineup lands a player who does what the screen says, as the Show and the Wall do
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-10
pr: 292
by: critic
---

## Why
The focus's item 1 is the core loop on a phone. On the Show and the Wall a phone flies the one-thumb pad, and every
modelled careful thumb lands clean (`human-phone.mjs 150 --scheme=thumb --skill=careful`: 150/150). The Lineup is
different. `syncScheme` (`src/main.js:1050`) drops a phone to the classic two-thumb stick and pedals there
(`course !== 'lineup'`), and the title still says **Controls · One-thumb**
(`docs/critique/2026-11-10-0950/p2-lineup-title.png`). The first the player hears of the change is the how-to card:
"HOW TO FLY · TOUCH · TWO THUMBS · Four things to know" (`p3-lineup-howto.png`).

Critique `docs/critique/2026-11-10-0950.md` §1:
- **The only real player in four days** (`/api/obs/digest` → `players`, 2026-11-10) went `visit-new` → two `run` →
  two `run-wrecked` (`wreck-brake`, `wreck-roll`), both `ctl-classic` · `fly-assist`, no `retry`, then Free Drive and
  the Sandbox. On touch, `ctl-classic` with Assist on means the Lineup, or a player who switched schemes.
- **The model agrees.** `flyTouch('lineup')` from `scripts/lib/daily-reach.mjs` (the two-thumb player who times LIFT to
  the marker, rolls by the cue and holds LAND, each a reaction late; seed 777, n 60):

  | outcome | n |
  |---|---|
  | landed clean (17 Stuck it, 2 Rough landing) | 19 |
  | no trick | 2 |
  | contact with the row | 13 |
  | no jump, contact | 8 |
  | wrecked (3 of them flipped) | 18 |

  So 32 % land clean and 30 % wreck. The phone's Show thumb: 100 % clean, 0 wrecked.
- **Two Dailies in ten are the Lineup's** (`roll-lineup`, `mark-lineup`, `src/daily.js`), and today's is one of them:
  "Roll a clean 360° over the row" (`p1-title.png`). `daily-reach` gives them 37 % and 31 %, the two lowest of the ten.

Assist is on for this player ("rolls you out, levels and brakes"). A phone player who presses what the screen tells
them to press shouldn't wreck one run in three on one course when they land every run on the other two.

## What
Measure first, then choose. Either:
- **one thumb flies the Lineup too** (`src/onethumb.js`: hold to drive and lift, the roll and LAND as on the Show's
  pad), so `syncScheme` stops dropping the phone to classic; or
- **the two-thumb Lineup forgives** the late LIFT and the late roll the model shows failing (find where it fails first:
  contact tick and z, as LESSONS 2026-11-03 says).

Whichever ships, the title's Controls label names what the next run will fly.

## Acceptance criteria
- [ ] A modelled phone population on the Lineup, flown with the scheme a phone actually gets there (careful, n 150, a
      script in `scripts/` or `scripts/lib/`), lands clean ≥ 90 % and wrecks ≤ 5 % (today, two thumbs: 32 % and 30 %).
      Print the split by outcome as in the table above.
- [ ] With the Lineup chosen on 390×844 touch, the title's Controls label and the how-to card name the same scheme.
      Screenshot both in the PR.
- [ ] `node scripts/daily-reach.mjs`: `roll-lineup` and `mark-lineup` measured on that population, both over the
      floor, before and after in the PR. Don't loosen a Daily's bar to get there.
- [ ] `naive-players` 32/32, `naive-show` unchanged, and `ref-hash` unchanged unless the sim changed (then
      `SIM_VERSION` and vectors per AGENTS.md §Invariants).
- [ ] 1280×720 keys: unchanged.
- [ ] Funnel number to move: `run-landed` / `run` and `retry` / `run` among `ctl-*` touch runs (digest `players`).

## Test plan
A unit test flies the phone's Lineup scheme a reaction late (the `flyTouch` pattern, or a one-thumb `flyThumb('lineup')`)
over a seeded population and asserts the clean and wreck rates. An e2e check at 390×844 picks the Lineup and reads the
Controls label against `ui.touch.dataset.scheme`.

## Out of scope
- Pro and Advanced on the Lineup.
- The Lineup's scoring and its row (0029).
