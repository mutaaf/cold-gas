---
id: 0262
title: A missed daily offers one tap to go again, with the gap to the target named
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-14
pr:
by: scout
---

## Why
Funnel (`/obs/digest` → players, 2026-11-01…13): 16 human sessions, 13 runs, 3 landed, 6 wrecked, 6 retries (all on one
day, 11-02). On 2026-11-13 a human played the daily, missed it (`daily-miss`) and no `retry` followed; on 11-10 two
wrecks, no retry. A near-miss is the strongest reason to go again when the next attempt costs one tap and the gap is
concrete ("2.1 short of 84"). Short-session games retain on "so close" feedback paired with a fast restart
(Juul, "A Casual Revolution", on instant retry; Vlambeer's "The Art of Screenshake" talk on restart speed:
https://www.youtube.com/watch?v=AJdEqssNZ-U). No dark pattern: no timer, no streak loss shown, one dismissible button.

## What
`src/main.js` results card for a daily run that scored under the target: the primary button reads "Again · 2.1 to go"
(target minus score, one decimal) and calls `retry()` (1 s READY·GO path). Landed dailies are unchanged. Wrecks keep
0184/0257's wording. Copy only; no sim, scoring or SIM_VERSION change.

## Acceptance criteria
- [ ] After a daily scored below target, the card's primary button names the exact gap and one tap starts the next attempt.
- [ ] After a daily met or beaten, no gap line appears.
- [ ] `daily-miss` then `retry` both fire through src/insights.js/obs once per tap.
- [ ] Fits at 390×844 touch and 1280×720; no HUD audit regression.

## Test plan
e2e in the daily spec: force a sub-target score, assert the button text and that one tap starts a READY countdown; unit
test the gap formatter (0.0 edge, rounding).

## Out of scope
Changing the daily target, the streak rules, or the board.
