---
id: 0258
title: On the iPhone the results lead with the next jump, then beat this score, then share
status: shipped
priority: P1
size: S
lens: engagement
created: 2026-11-13
pr: 377
by: operator
---

## Why
The same as 0257 on the iPhone. The app's results put the Post row first, then Fly again and Roam, then Watch it, Share,
Board, Home (ios/ColdGas/UI/GameUI.swift:478-506); there is no Next.

## What
Runs on: the operator's Mac (Xcode).
**Waits for the native UI redo:** an agent is redoing `ios/ColdGas/UI/` (title, results, HUD; 0230, PR #368) right now. Build
on its results (Fly again as the tall button, the quiet words under a hairline), not today's.
Depends on: 0257 (the web's order and words), 0252 (the image share), 0256 when licenses exist.
- Landed: Next jump (the tall primary) · Beat <score> · Share; Watch it, Board, Home and Post quieter. Wrecked: Fly again
  first, then Share.
- Matches 0249's first-landing moment (the same order after the first landing).

## Acceptance criteria
- [ ] UI test: the order on a landed and a wrecked run; Next starts the right run.
- [ ] Look-shots of the results in portrait, landscape and the Duo's poses.

## Test plan
ColdGasUITests for the order; `ios/scripts/look-shots.sh`.

## Out of scope
The rating prompt (0259).
