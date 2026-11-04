---
id: 0141
title: On a decided run, "Post" names the rank it would get today ("Post · #1 on an empty board")
status: shipped
priority: P1
size: M
lens: engagement
created: 2026-11-03
pr: 242
by: scout
---

## Why
The players' funnel (digest 2026-11-01..03): 9 runs, 3 landed, 3 wrecked, 6 retries (the retry loop works), but
`post` 0, `share` 0, `board-open` 0, and `GET /scores?board=all` returns no rows at all. Nobody has ever put a
score on the board, so a landing ends in a bare "Post · ABC" with no reason to press it: a player can't tell
whether the board is empty, whether their score is any good, or what posting does. Seeing where you would
stand, or that you would be first, is the reason to post (no external source; this is design judgement).
The Worker already answers this: `POST /scores` with `dry: true` runs every check and returns the rank the run
would get, storing nothing (src/worker/index.js ~506-520), so no Worker change is needed.

## What
`src/post.js` + `src/panel.js`: when a results sheet is eligible to post, fire one `dry: true` request (same
log and telemetry the real post sends, deadline via src/net.js, never blocking the sheet) and put the answer
on the button's own line: "Post · would be #1 today" / "#4 of 9 today"; on an empty board "Post · first on today's board".
A failed or slow dry call leaves today's plain "Post · ABC". The count of dry calls per run is one.

## Acceptance criteria
- [ ] After a landed run the Post button shows the rank the dry call returned, within the deadline; with no answer it reads as today
- [ ] The dry call never delays Retry, the judges or the sheet, and fires once per run (not per sheet redraw)
- [ ] The dry request counts against nothing the player sees; it adds no new host and no stored data
- [ ] 390×844 touch and 1280×720: the button's line fits at 320 px without wrapping or pushing Retry off screen
- [ ] The `post` funnel event is unchanged (a dry call is not a post)

## Test plan
Unit: the label for rank/total/empty/failure. E2E: stub `/api/scores` (dry → rank 1 of 0, then real post) and
assert the label, one dry request per run, and that Post still posts.

## Out of scope
Showing the board on the results, seeding fake rows (never), changes to src/worker/.
