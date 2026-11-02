---
id: 0132
title: The coach names the side the touchdown missed on, not "long" for a miss that is mostly sideways
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-02
pr:
by: critic
---

## Why
The first thing a newcomer is told after their first Show is wrong about which way they missed. One thumb is what a
first visit on a phone gets, and with no slide the computer's touchdown lands **5.3 m to the side of the mark and only
2.7 m past it** (sim, `createOneThumb`, tap 0.25 / 0.35 / 0.5 / 1.0 s after the cue, hold to the ground:
`lateral ±5.31`, `landZ − pad.z = −2.67…−2.70`, heading ±8.6°). If the thumb is lifted after the tap, it lands
`lateral ±6.11`, 2.6 m past. About **80 % of the squared miss is sideways**. The coach's headline is still
**"Long of the mark"** in every one of those flights.

On production `index-aFPY3kIP.js` (390×844 touch, first visit, real CDP touches, docs/critique/2026-11-02-0400.md),
the results card read *"Long of the mark. You landed 20 ft 6.2 m from the mark (10 ft 3.1 m past it): about 11
points"* for a touchdown with `lateral 5.39`. A second run read *"…23 ft 7 m from the mark (12 ft 3.6 m past it): about
16 points"* with `lateral 5.94` (`11-results-8s.jpg`).

The cause is `src/sim/coach.js:201`: `past = show ? f.touch.along < 0 : false`. Any touchdown past the mark gets the
"Long" title and a "past it" figure, however small the along-track part is next to the sideways part.

The precision category is the one place a one-thumb player's skill shows in the score: hold scores 85.7, the slide's
careful median scores 93. A player told "long" slides *down* the pad (shorter). That fixes 2.7 m of a 6 m miss and
leaves the 5.3 m that cost the points. The operator's focus asks for skill that shows in the score. The coach has to
point at the miss the player actually made. Every number it prints must be the one that matters.

## What
- `src/sim/coach.js` (the `mark` finding): split `padMiss` into along (`landZ − pad.z`, signed by the run's direction)
  and across (`lateral`). The title names the bigger part:
  - **"Wide of the mark"** when |across| > |along|. The detail gives the side in the car's frame, for example
    "5.3 m right of it, 2.7 m past".
  - **"Long of the mark"** when it's past and |along| ≥ |across|.
  - **"Short of the mark"** when it's short and |along| ≥ |across|.
  - **"Off the mark"** for the Lineup and drills, as today.
- The side's word must match what the pad's sight shows (src/thumb-aim.js, `markOffset` in src/onethumb.js). A player
  told "right" sees the amber dot to the left of centre, and sliding to it fixes the miss. Same word in the keyboard
  and classic schemes (`say` words, src/pointer.js `coachWords`).
- The weight and the points figure are unchanged (`markCost`). Only the words change.
- No sim change: ref-hash, determinism, 32/32 naive landings, scores unchanged.

## Acceptance criteria
- [ ] Unit (tests/unit/coach*.test.js): a Show flight with `lateral 5.31`, along −2.67 (the one-thumb no-slide flight
      above, re-flown from its input log) gives the title "Wide of the mark" and a detail with the side and both
      distances. The mirror flight (`lateral −5.31`) gives the other side.
- [ ] Unit: a flight past the mark with |along| > |across| (e.g. the reference's carry at 11 m/s) still says "Long of
      the mark". One short of it says "Short of the mark".
- [ ] The side word agrees with the sight. For both mirror flights, the sign of `markOffset(...).x` at 3 m up is the
      opposite of the side named. In words: the dot is on the side to slide toward.
- [ ] e2e or screenshot at 390×844 one-thumb, first visit, no slide: the What happened card reads "Wide of the mark".
      Before/after screenshots are in the PR.
- [ ] `human-phone.mjs 300 --scheme=thumb --skill=none --coach`: the tally of first findings is reported before and
      after. "Long of the mark" no longer leads a flight whose |lateral| > |along|.
- [ ] ref-hash, determinism, `naive-players` 32/32 and `naive-show` unchanged. Desktop 1440×900 keyboard results read
      the same for the reference flight.

## Test plan
- `tests/unit/coach.test.js`: the three titles and the side, using the flights above (fly `createOneThumb` with the tap
  0.25 s and 0.5 s after the cue: they land on opposite sides).
- A results-card e2e on the one-thumb Show, if one already reads the What happened card. Otherwise a screenshot in the
  PR.

## Out of scope
- Where the computer's hands-off touchdown lands (≈ 6 m off is the designed room for the slide, src/onethumb.js:14).
- The Next run line and the pad's sight itself (0126 owns the held pad's mark).
