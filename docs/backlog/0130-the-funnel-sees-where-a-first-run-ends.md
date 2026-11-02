---
id: 0130
title: The players' funnel sees where a run ends when it is neither landed nor wrecked
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-02
pr:
by: scout
---

## Why
Players funnel (2026-11-02, `/obs/digest → players`): one human day, 2026-11-01: `human 1, howto 1, run 1, visit-new 1`;
no `run-landed`, `run-wrecked`, `retry`, `post` or `share`; the board is empty. The one person who pressed Jump never
reached a scorecard, and the funnel can't say why: `run` fires at start (`src/main.js:392`) and `run-landed/wrecked` at
the card (`src/main.js:441`), so a run left through Pause → Home, a closed tab, or a Skip on the how-to card is invisible.
With a handful of players a week the Scout, Critic and Builder are steering blind on the biggest drop of all: run → card.
Funnel practice is to record every step and look at where first sessions end (devtodev,
https://devtodev.com/resources/articles/how-to-analyze-first-player-session; GameAnalytics,
https://www.gameanalytics.com/blog/exploring-gaming-funnels).

## What
Add counts only (no ids, no personal data) to `PLAY_EVENTS` in `src/obs/signature.js` (the Worker validates against the
same list, so no `src/worker/` change): `howto-skip` (Skip on the how-to card), `run-quit` (a `jump` run left before
its card: Pause → Home/Restart, or the page hidden with a run live), and `run-phase-<air|ground>` is NOT added; keep it to
those two. Fire `run-quit` once per run, in `src/main.js` where a live run is abandoned and from the existing pagehide flush.
Update the AGENTS.md §2 list of funnel events.

## Acceptance criteria
- [ ] `howto-skip` and `run-quit` are in `PLAY_EVENTS`; `cleanObs` accepts them and `GET /obs/digest → players` can show them
- [ ] Skip on the how-to card counts `howto-skip` once; Pause → Home during a live Jump counts `run-quit` once; a run that reaches its card counts `run-landed`/`run-wrecked` and never `run-quit`
- [ ] A drill, Free Drive and the Sandbox never count `run-quit`
- [ ] No new request, host or stored identifier; the beacon stays ≤ 8 kB; automation still counts as `auto`
- [ ] Works at 390×844 touch and 1280×720 keyboard

## Test plan
Unit: `cleanObs` accepts both names and rejects others. E2E: start a Jump, open Pause, Home, flush the beacon, and assert
the intercepted beacon carries `play['run-quit'] === 1` and no `run-landed`.

## Out of scope
Per-phase drop-off, timing of the quit, any user id.
