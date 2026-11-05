---
id: 0150
title: On one thumb, the skim Daily names the choice that meets it, and the game never teaches the opposite
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-04
pr:
by: critic
---

## Why
The operator's focus puts the Daily second ("reasons to come back"), and most players fly the Show on one thumb.
Today's Daily (Nov 4) is skim-show: "Clear the roofs by under 4.9 ft and land clean" (`src/daily.js:57-58`). On one
thumb the skim is met by exactly one choice: **lift the thumb within 0.6 s of the tap and keep it off**. The game
never names that choice. Everything else it teaches leads the other way.

- **Production, 390×844 touch, first visit** (critique 2026-11-04 22:04): I held the pad from the tap to the ground.
  That's the sure way the gas Daily's hint teaches (`src/daily.js:51`) and what the sheet's own NEXT RUN repeats
  ("Aim for the rings: holding the pad in the air"). The result was Stuck it 86.0, and the Daily line said
  **"Daily: cleared by 14.8 ft — try again"** (`docs/critique/2026-11-04-2204/phone-hang-10s-sheet.jpg`). The miss
  has no `fix`, so `missLine` gives no hint (`src/daily.js:79-82`). It says "try again" to a player who will fly
  the same flight again.
- **Node, the one-thumb Show** (`thumb-lift.test.js`'s harness: hold up the curl, tap on the ledge, lift L s
  after the tap, optionally press again R ticks later):

  | thumb after the tap | over the roofs | sink | verdict | skim |
  |---|---|---|---|---|
  | held to the ground | 4.50 m | 1.00 m/s | Stuck it 85.7 | **no** |
  | lifted at 0.05–0.6 s, never pressed again | 1.30 m | 1.30 m/s | Clean 80.7 | met |
  | lifted at 0.7–2.5 s, never pressed again | 4.50 m | 1.00 m/s | Stuck it 85.7 | **no** |
  | lifted at 0.1–0.5 s, pressed again 0.25 s later | 3.2–4.5 m | 1.0–1.1 m/s | 85.3–85.7 | **no** |
  | lifted at 0.1–0.5 s, pressed again 1 s later | 1.30 m | 1.30 m/s | 80.7–82.7 | met |

  The thumb has two flights and no range: 1.3 m or 4.5 m, with a cliff between 0.6 s and 0.7 s.
- **`human-phone.mjs 150 --scheme=thumb --skill=careful --daily`** puts skim-show at 124/150 (83 %), and
  `daily-reach.mjs` puts it at 78 %. Those numbers only hold because the modelled let-go thumbs all lift at 0.65 s,
  inside the window (`scripts/lib/daily-reach.mjs:9`). Every modelled thumb held from the tap (39 of 150) misses
  it. So does every real player who learned "hold from the tap" from the gas Daily or the coach.
- The two Show Dailies ask a phone player for opposite thumbs. Neither the title nor the miss says so.

## What
- `src/daily.js` skim-show: the miss is the objective's own number, so mark it `fix` and give it a `hint` (and a
  `titleHint` if the card has room, as 0139 did for gas-show). In the device's words (`thumbOn(ctx)`), it names
  the choice that meets the day, e.g. "let go right after the tap and stay off". On keys or classic touch, it
  names that device's control (a shorter or later LIFT/boost), measured in that device's population.
- The coach's NEXT RUN line must not contradict the Daily on a run that missed it (`src/pointer.js:119`, the `mark` tip). On a missed
  skim day, either it says nothing about holding the pad, or it defers to the Daily's line.
- The 0.6/0.7 s cliff is a sim and onethumb design question, out of scope here. Write down what you find.

## Acceptance criteria
- [ ] `missLine(skim, r, { device: 'touch', scheme: 'thumb', tier: 'assist', course: 'show' })` for a 4.5 m flight
      names the thumb choice (not "try again"). The same for keys and classic touch, each in its own words.
- [ ] A unit test flies the hint's instruction on one thumb, literally, as a player would read it (tap, then do
      what the hint says), with the lift anywhere in 0.1–0.5 s. It meets skim-show in every case. Flown as the gas
      day's hint says (held from the tap to the ground), it misses, and the miss line names the choice.
- [ ] On a missed skim day, the sheet doesn't tell a one-thumb player to hold the pad in the air (unit test on the
      coach's output for that card).
- [ ] `node scripts/daily-reach.mjs 150` is unchanged (no sim change). `human-phone.mjs … --daily` prints skim-show
      by the thumb's choice, as it does for gas-show.
- [ ] The 390×844 title doesn't pack: `.title[data-extra-fit]` is unset (0139's e2e assertion), and the
      Daily goal isn't truncated.

## Test plan
- Extend `tests/unit/daily.test.js` with the skim cases, using the one-thumb harness
  from `thumb-lift.test.js`.
- Extend `scripts/human-phone.mjs --daily` with skim-show by the thumb's choice.

## Out of scope
- Changing the skim bar (1.5 m), or the one-thumb flight's two clearances.
- Other Dailies, except where the shared hint code needs it.

## Critic sharpen 2026-11-05
Today's Daily is **ninety-show** ("Score 90 or more", `src/daily.js:63`), and it shows the same defect
(`docs/critique/2026-11-05-0354.md` §2).
- **Without the slide, one thumb can't reach 90.** Node, `thumb-lift.test.js`'s harness: held from the tap after any
  wait, 85.7–86.0 at 5.9–6.0 m from the mark. Lifted at any time, 80.7–85.7.
- **Production, first visit, held:** 85.7, and the sheet said "Daily: 85.7, need 90 — try again".
- **Production, the same flight with one 40 px slide:** 95.7, 2.4 m from the mark, Daily ✓.
mark-show (within 3.5 m) has the same structure, and its miss reads "6 m off the mark". The `missLine` hint this ticket
adds should cover them too:
- [ ] `missLine` for ninety-show and mark-show on one thumb, for an 85.7 / 6.0 m card, names the slide onto the
      amber dot (not "try again"). On keys and classic touch, each device names its own aim (`src/sim/aim-words.js`).
- [ ] A unit test flies the hint literally on one thumb (hold, then slide toward the dot) and meets ninety-show.
