---
id: 0136
title: The players' funnel counts a Daily start, and a Daily miss apart from a Daily done
status: shipped
priority: P1
size: S
lens: engagement
created: 2026-11-03
pr:
by: scout
---

## Why
The digest's `daily-run` is emitted only when a finished Daily run did not meet its objective (`src/comeback.js:203`,
`obs.play(r.ok ? 'daily-done' : 'daily-run')`), so its name says "ran" while it means "missed", and a player who taps
Play today's and quits sees nothing. 2026-11-02: `daily-run` 6, `daily-done` 0, with no way to tell whether the other
players never tried. The next scout needs "tapped → finished → met" to pick the right fix (reach: 0135, gas: 0134).

## What
- `src/obs/signature.js` `PLAY_EVENTS`: add `daily-start` and `daily-miss`. `src/comeback.js`: `obs.play('daily-start')` in
  the Play today's click; on a finished Daily emit `daily-done` or `daily-miss`. Keep emitting `daily-run` on a miss for
  one release so the digest's history stays readable, noted in the comment. Plain counts only, no ids.
- `src/worker/` is frozen: change nothing there; it already accepts any name in `PLAY_EVENTS`. Update the
  documentation that lists the events (AGENTS.md observability section, `docs/CHANGELOG.md` entry).

## Acceptance criteria
- [x] Tapping Play today's counts `daily-start` once; a missed Daily counts `daily-miss` (and still `daily-run`); a met one `daily-done`
- [x] `tests/unit` obs tests: the new names are accepted by `PLAY_EVENTS`, an unknown name is still dropped
- [x] No new network call or host; the beacon stays ≤ 8 kB
- [x] `npm run check:fast` passes

## Test plan
Extend the existing e2e/unit obs spec (`tests/e2e/obs.spec.js`) to click Play today's with the beacon stubbed and assert the counts.

## Out of scope
Per-objective breakdowns, any personal data, any dashboard.
