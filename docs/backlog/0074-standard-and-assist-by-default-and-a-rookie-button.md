---
id: 0074
title: Standard driving and Assist flight by default on every device; a Rookie mode button after three crashes in a row
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr: 95
by: operator
---

## Why
The operator: "we need to default to standard and assisted mode; one button should be for rookies that
crash 3-5 times in a row".

0066 started phones on Easy driving (a road-speed governor, lane keep, slide catch) and desktops on
Standard. Every gate (naive-players, human-show, human-phone, drive-feel) was tuned on Standard, so a
phone player started on a car nobody tuned the Show's run-up for, and nothing told them. The flight tier
already defaults to Assist (auto-land, LAND rolls out and brakes).

The other half: a newcomer who crashes again and again has no obvious way out. Easy and Assist exist,
but Easy sits in the Controls sheet and the flight tier is a chip on the title. A player who has just
crashed three times in a row should be offered both in one tap, right where they're looking: the
results.

## What
- `src/driving.js`: `defaultLevel` is Standard on every device. A saved choice is still respected
  (`coldgas_driving` in localStorage), so a phone player who picked Easy keeps it. An unsaved phone moves
  from Easy to Standard. The flight tier's default stays Assist (`coldgas_tier`).
- `src/rookie.js` (new, pure): the streak. A crash is the card's `facts.crashed` (what 0072's
  `crashStep` names: FLIPPED / CONTACT / WRECKED / FELL OFF / CRASH) or the judge's `Wrecked` verdict. A
  crash adds one, and any other finished run ends the streak. A run quit before its card doesn't count, and
  neither does the reference jump. Drills count. `offerRookie(n, level, tier)` is true from the third crash
  in a row (and the fourth, the fifth…) unless the car is already on Easy + Assist. The streak is kept for
  the tab's session (sessionStorage, in try/catch).
- `src/main.js`: counts each run once when its results come up. Changing the driving level or the flight
  tier (the Controls sheet, the tier chip, Rookie mode itself) resets the streak, so after an opt-out the
  offer waits for three new crashes.
- `index.html`, `src/styles.css`: the results sheet gets one wide, ice-edged button under the actions row,
  **ROOKIE MODE · easier car · auto-land**, with one line saying why and how to undo it. Tapping it (or
  Enter) sets driving to Easy and the tier to Assist, saves both, and starts the retry (a drill retries
  the drill). On a phone it sits at the top of the sheet's scroll, clear of the pinned Retry bar.
- No sim change.

## Acceptance criteria
- [x] A fresh device (desktop or phone) starts on Standard driving and Assist flight, and a saved Easy is
      kept across a reload. (`tests/e2e/driving-levels.spec.js`; `tests/unit/driving-levels.test.js`.)
- [x] Crash three times in a row: the button shows on the third results, not on the first or second, and
      still shows on the fourth. A clean landing in between resets the count. (`tests/e2e/rookie.spec.js`,
      `tests/unit/rookie.test.js`.)
- [x] Tapping it sets level `easy` and tier `assist`, saves both (`coldgas_driving`, `coldgas_tier`), and
      a new run starts. On Easy + Assist the button never shows. After going back to Standard in Controls
      it waits for three new crashes.
- [x] Keyboard: Tab from the sheet's Retry reaches it, and Enter takes it. It is at least 48 px tall, its
      text is 12 px or larger, and it holds ink on a dark field (well past 4.5:1).
- [x] It fits the sheet at 390×844, 844×390, 382×580 and 1280×720 (screenshots checked by eye: under the
      tier line on phones, under Retry · Home · Replay · Share on wide screens, never under the pinned bar).
- [x] `node scripts/hud-audit.mjs <url> <dir> phones`: 116 frames, 0 overlaps, 0 text < 11 px, 0 labels
      < 4.5:1.

## Test plan
Unit: `tests/unit/rookie.test.js` (crash rule against `crashStep`, the streak, the offer, storage), and
`tests/unit/driving-levels.test.js` (the new default). e2e: `tests/e2e/rookie.spec.js` crashes with
aftermath.spec.js's full-throttle run (no release, it falls off the curl), stepped by `liveStep` with the
canvas stubbed. The clean run is the reference autopilot flying a run of the player's own.
`tests/e2e/driving-levels.spec.js` checks the phone default and a kept Easy.

## Out of scope
The judges' theatre's own Retry / Home bar on a phone: it doesn't carry the offer, which waits on the
sheet under it (Skip or the show's end reveals it). Changing what Easy or Assist do.
