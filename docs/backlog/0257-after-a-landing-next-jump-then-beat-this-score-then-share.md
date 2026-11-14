---
id: 0257
title: After a landing the sheet offers the next jump first, then beat this score, then share, and stays light
status: in-progress
priority: P1
size: S
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 brief: post-landing, the order is next jump, then beat this score, then share; lightweight and fast. The web sheet's
buttons today are Retry (primary) · Home · Replay · Share · Post (index.html:393-404); there is no "Next" outside Practice,
so a player who just landed has no obvious step forward except doing the same jump again.

## What
**Note for the builder:** another agent is redoing the native results (ios/ColdGas/UI/; 0230, PR #368); the iPhone's order
is 0258. This is the web.
Depends on: 0254/0255 for "next" when licenses exist; until then "next" is the next course in the Show → Wall → Lineup
order, or the medal above the one just won.
- **Landed run**: Next jump (primary: the next license test, or the next goal) · Beat this score (Retry, labelled with the
  score to beat: "Beat 82.4") · Share (0260). Replay, Home, Post and More stay, quieter, after them.
- **Wrecked run**: Retry stays primary (with the coach's one line), then Share; no Next.
- The calm sheet (first three runs, 0199) uses the same order and stays as short as it is.
- Keyboard: Enter = the primary, R = Retry as today, N = Next; gamepad A = primary.
- No new screens, no extra beats: the sheet appears as fast as today (after the 0199 beat).

## Acceptance criteria
- [ ] e2e: a landed run's sheet has Next jump, Beat <score>, Share in that order, Next focused; a wrecked run's has Retry
      first; R still retries.
- [ ] Next starts the right run (the next license test, or the next course) with one tap.
- [ ] `npm run audit` passes on the sheet at every viewport; 390×844 touch and 1280×720 keyboard.

## Test plan
The results e2e extended for the order and the keys; the HUD audit's results frames.

## Out of scope
The iPhone (0258). New share mechanics (0260).
