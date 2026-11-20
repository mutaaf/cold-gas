---
id: 0341
title: A returning player's title shows their best on the selected course, one line, to beat
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-20
pr:
by: scout
---

## Why
Players' funnel (digest `players`, `human` only, 14 days): 28 sessions, `visit-new` 16, `visit-return` 2. People arrive and almost never come back. The title of a returning player says nothing about them: Jump, the Daily card and the footer. The game already stores medals and bests on the device (`getMedals(course, tier).best`, src/medals.js, used by the challenge card in src/comeback.js ~line 267), so the one reason to come back that costs nothing is on the screen they see first: "Your best on the Show: 71.4". Goal-gradient and a specific number to beat are the honest, non-guilt version of a return hook (no streak guilt, no fake urgency, no nagging). Funnel number to move: `visit-return` → `run` (a returning visit that runs), and `retry` per landing.

## What
- `src/ui.js` / the title's markup (index.html): under the mode row's hint line ("Up the Wall · let go · boost over five parked EVs") a single quiet line, `Your best 71.4 · Assist`, shown only when the device has a landed run on the selected course (tier from the stored best), hidden otherwise. It follows the course tabs.
- Reads `getMedals(course, tier).best` only; no new storage, no network, no personal data.
- Hairline type in ink (not red), 11 px floor, wraps rather than truncates at 320 px; `prefers-reduced-motion` untouched (no animation).

## Acceptance criteria
- [ ] A fresh device (no landed run) shows no best line; after a landed run it shows that run's total for that course and tier, and switching the course tab switches the number.
- [ ] No overlap or contrast failure at 390×844, 430×932, 320 px, 1280×720 (`npm run audit`, title-audit stay clean).
- [ ] No new request, no text longer than one line at 390 px, no change to the title's boot time (perf probe within budget).
- [ ] The PR says which number it should move: `visit-return`→`run`, and `retry` after a landing.

## Test plan
Unit test for the line's text from a stored medal; e2e (smoke/title spec) seeds a stored best, asserts the line per course tab and its absence on a clean boot, at 390×844.

## Out of scope
Streaks, push or email reminders, any server-side or shared score, and the Wreck score's bests.
