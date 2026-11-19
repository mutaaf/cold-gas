---
id: 0294
title: A wreck is not a missed Daily: the sheet's Daily line and the daily-miss count wait for a run that landed
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-19
pr:
by: scout
---

## Why
Players' funnel, 2026-11-18 (the digest's `players`, `human` sessions only): 11 people, 23 runs, **6 landed, 10 wrecked,
7 quit**; `daily-miss` 7, `daily-done` 0. Every one of those Daily "misses" is most likely a wreck, because
`src/comeback.js` (~line 270) evaluates the Daily on *every* finished run on the Daily's course, and a wreck fails every
objective. Run on a wrecked card (24.7, crashed) today, `evaluate` + `missLine` give:
`Daily: 24.7, need 84 — try again` (stick-wall), `Daily: no clean landing yet — try again` (mark-show, soft-wall,
mark-lineup), `Daily: clear the row and land clean first — try again` (gas-show, scratch-show). So the player who has
just crashed a car and has not yet learned to land is handed a second, red "you failed" line about a game mode they
did not choose, and the funnel cannot tell "the Daily is too hard" (0 met of 7) from "they have not learned to land yet".
That mis-steers the Daily tickets: 0200 and 0176 want the Dailies *harder* on a model population that lands 97 %, while real
players land 6 in 16. Design: a failure message should say what to do next, not add a second verdict
(Nielsen Norman Group on error messages, https://www.nngroup.com/articles/error-message-guidelines/). No guilt: the
streak is unaffected either way (it only moves on a met Daily).
Funnel number to move: `retry` per wreck (a first wreck should read as "again", not "twice failed"), and a clean
`daily-miss` / `daily-done` ratio for every later ticket.

## What
- `src/comeback.js` results line: when the run's card is a crash (`isCrash(card)` from `src/rookie.js`, the same rule
  that already withholds Post in 0204), draw **no** `data-daily-line` and count neither `daily-done` nor `daily-miss` /
  `daily-run`. A landed run is unchanged: met → "Daily ✓ complete", else the miss line.
- Count the wrecks that happened on the Daily's course as `daily-wreck` (new name in `PLAY_EVENTS`,
  `src/obs/signature.js`; the Worker already accepts any name in that list, as 0276 notes, so no `src/worker/` change;
  if it does need one, drop the counter and say so). Numbers only.
- The streak, the title's Daily card and the Daily's evaluation for a landed run do not change.

## Acceptance criteria
- [ ] A wrecked run on the Daily's course shows no Daily line on the sheet and counts no `daily-done` / `daily-miss`
  / `daily-run`; it counts `daily-wreck` once.
- [ ] A landed run on the Daily's course that misses still shows "Daily: <reason> — try again" and counts `daily-miss`;
  one that meets it counts `daily-done` and moves the streak exactly as today.
- [ ] A wreck on another course shows and counts nothing Daily, as today.
- [ ] `hud-audit` clean at 390×844 and 320 px with and without the Daily line; works at 1280×720.

## Test plan
Unit (`tests/unit/daily.test.js` or a new `comeback.test.js` case): over a crashed card on every objective's course,
the results helper returns no line and no counters; over a clean landed card that misses and one that meets, the
line and counters are as before. e2e: fly the Daily's course into the ground with the existing helpers; assert no
`[data-daily-line]` on the sheet and the streak storage is untouched.

## Out of scope
Changing any objective's bar (0200, 0176, 0218). Hiding the Daily on the title. Any new copy on a wreck (the coach's
NEXT RUN line already speaks there).
