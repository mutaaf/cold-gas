---
id: 0173
title: The modelled careful and sloppy thumbs act on what they read, even when they re-read faster than they react
status: shipped
priority: P1
size: S
lens: tech-health
created: 2026-11-09
pr:
by: critic
---

## Why
Every one-thumb gate and every one-thumb PR body since 0121 quotes `scripts/human-phone.mjs --scheme=thumb
--skill=careful|sloppy` as the population of phone players who use the slide. The focus's item 1 is "skill that shows
in the score", and this script is how the agents measure that. More than a quarter of its "careful" thumbs never slide.

The read-react loop (`scripts/human-phone.mjs:176-191`) works like this:
- Each read sets `want` and `aimAt = t + lagT`, and the next read comes at `t + A.every`.
- `lagT` is 0.2–0.36 s (48–86 ticks). `A.every` is 0.25–0.5 s (60–120 ticks).
- When `A.every < lagT`, every read pushes `aimAt` out again before it arrives, and `th.move` is never called.

Critique `docs/critique/2026-11-09-1540.md` §3 measured this on main `875cd37`. It ran `human-phone.mjs 150 --scheme=thumb
--skill=careful -v`, with the thumb's choice and a read counter printed (a local patch, not committed):

| choice | n | landed > 3.5 m from the mark | median miss | median score |
|---|---|---|---|---|
| held from the tap · slid | 29 | 0 | 1.9 m | 94.7 |
| lifted, pressed again · slid | 80 | 1 | 2.3 m | 93.7 |
| held from the tap · **no slide** | 10 | 10 | 6.0 m | 85 |
| lifted, pressed again · **no slide** | 31 | 31 | 5.9 m | 85.3 |

The 41 "careful · no slide" thumbs never moved. In a 40-thumb rerun with a read counter, each of them read the dot 14–19 times, at up to 52 px (|x| + |y|). So the careful
p10 (84.7) and part of its median are the no-slide flight relabelled. Every careful and sloppy number in #265, #269,
#272 and #276 is diluted by about 27 %. A slide regression that only bites those thumbs would also be invisible.

## What
`scripts/human-phone.mjs`: a read is queued, not overwritten. Keep a list of pending reads, each `{ x, y, at }`, and apply each
one when its `at` arrives. Model it on `thumb-mastery.test.js`'s re-reading thumb (`pend` / `at`), which acts on every read
exactly once. The reading rate and the lag stay as they are.
Check whether `scripts/daily-reach.mjs` and `scripts/play-human.mjs` share the pattern, and fix them the same way if
they do.

## Acceptance criteria
- [ ] `human-phone.mjs 150 --scheme=thumb --skill=careful`: no thumb counts as "no slide" if it read a dot ≥ 2 px while
      held in the air. Print a "careful · no slide" count; it is 0 or explained.
- [ ] A unit test in `tests/unit/` drives the read-react loop with `every` < `lag` and asserts that `th.move` is called
      with the first read's offset, `lag` after that read.
- [ ] The PR body re-runs careful and sloppy (n 150) and gives the before → after table by choice: median miss, median
      score, count inside the 7 m ring, and jets-out gaps. Any gate threshold that rested on the diluted number is
      re-checked, not loosened.
- [ ] `naive-players` 32/32 (unchanged: no sim change).

## Test plan
Pull the read-react step out into a small pure helper in `scripts/lib/` and unit-test it. Then re-run the populations.

## Out of scope
- Changing the modelled reaction time, the reading rate, or the sloppy model's errors.
- Any sim, pad or sight change.
