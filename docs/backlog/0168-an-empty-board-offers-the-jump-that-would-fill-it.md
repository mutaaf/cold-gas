---
id: 0168
title: An empty board says what a first row needs and offers the Jump that would fill it
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-06
pr:
by: scout
---

## Why
Players' funnel (digest `players`, 2026-11-01..05, human sessions only): 6 people, 6 `visit-new`, 9 `run`,
3 `run-landed`, 3 `run-wrecked`, 6 `retry`, 0 `post`, 0 `share`, 0 `board-open`, and
`GET /scores?board=all` returns no rows: the board has never held one. Today an empty board reads "No jumps on
the Show yet today. Be the first." with only Close under it (`src/main.js` openBoard, `ui.board`): it names the
gap but gives no next action, and it never says what earns a row (a landed jump, posted with initials). Empty-state
guidance is the same everywhere: say the value, show what the filled screen looks like, give one clear next action
(https://thisisglance.com/learning-centre/how-do-i-design-empty-states-that-keep-users-interested). Until a first
row exists the board is a dead end for every visitor who taps it, which is the people most likely to start one.
Not a dark pattern: no urgency, no counters, no nagging.

## What
`src/ui.js` `ui.board` and `src/main.js` `openBoard`: when `rows` is an empty array, render the empty line plus one
short second line ("Land a jump, then Post · ABC from the results.") and a primary "Jump · <course>" button that
closes the board and starts that course's countdown exactly as the title's Jump does (same handler, so ads, the
how-to card and the funnel counts are unchanged). Offline (`rows` null) stays as is. Board CSS only as needed.

## Acceptance criteria
- [ ] Empty board (today and all time, every course tab) shows the line, the one-line how-to-earn-a-row text and a Jump button for the tab's course
- [ ] The button starts the same flow as the title's Jump (how-to card for a new player), never skipping it, and never from the results sheet
- [ ] A non-empty board and the offline state render exactly as before
- [ ] 390×844 touch and 1280×720: no overlap, button ≥ 44 px, reachable by keyboard, `npm run audit` clean
- [ ] No new network call, host, key or funnel event beyond the existing `board-open`

## Test plan
e2e (`tests/e2e`): stub `/api/scores` to `{rows: []}`, open the board, assert the button's text names the course and
that tapping it reaches the countdown or the how-to card. Unit-free otherwise; audit covers layout.

## Out of scope
Seeding fake rows (never: scores are honest), notifications, friend lists, any new endpoint.
