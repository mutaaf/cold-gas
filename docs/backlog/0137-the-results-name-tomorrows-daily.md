---
id: 0137
title: Once today's Daily is met, the results say what tomorrow's Daily is, once, quietly
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-03
pr:
by: scout
---

## Why
`visit-return` is 0 in the digest: nothing yet gives a player a reason to open the game tomorrow. The Daily is picked
from the UTC date (`objectiveFor`, `src/daily.js`), so tomorrow's is known today at no cost. Designers of daily games
argue for the pleasure of the habit without the guilt of a lost streak
([Axios on Wordle streaks](https://www.axios.com/2022/02/11/snapping-wordle-streak)), so this is a single plain line, shown
only after a Daily is met: no countdown, no "don't lose your streak", no notification.

## What
`src/comeback.js` results mount: after "Daily ✓ complete", add one muted line "Tomorrow · The Wall: touch down at 2.6 ft/s or softer"
(the objective's own goal text, in the player's units). Not shown on a miss or when no Daily was flown.

## Acceptance criteria
- [ ] After a met Daily the line shows tomorrow's objective (UTC), matching `objectiveFor(now + 1 day)`
- [ ] Not shown after a miss, a non-Daily run, or on a 360 px phone if it would push Retry off screen
- [ ] No copy about streaks being lost, no timers; reduced motion unaffected

## Test plan
Unit: the line text for a fixed date; e2e: complete a Daily with the stubbed clock and assert the line.

## Out of scope
Notifications, reminders, any server state.
