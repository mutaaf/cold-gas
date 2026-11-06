---
id: 0143
title: The players' funnel sees a visit that ends on the title, and says whether Jump was ever tapped
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-04
pr:
by: scout
---

## Why
The players' funnel (digest `players`, 2026-11-01..04, human sessions only): 5 people, 5 `visit-new`, 0
`visit-return`, 9 `run`, 3 `run-landed`, 3 `run-wrecked`, 6 `retry`, 0 `post`, 0 `share`, 0 `board-open`, and
`GET /scores?board=all` is empty. Of 5 human visits only 2 days show any run at all, so at least 3 people
loaded the title and never started one. Since 0130 the funnel can see a run that ends early (`run-quit`), but it
cannot see a visit that never reaches `run`: we cannot tell "left while the title was loading", "read the
how-to card and left", "tapped Jump and the run never started" or "looked and left". That is the largest drop
in the funnel and the one we are blind to. Web-game funnel guidance starts the same way: title seen → start
tapped → first interaction → core loop (e.g. https://www.abratabia.com/game-marketing/game-analytics.php).
Counts only, no ids, no timing per person (invariants stand).

## What
`src/obs/signature.js` (PLAY_EVENTS, shared by client and Worker validation; no `src/worker/` edit) gains
`jump-tap` (a tap or key on the primary Jump, once per page load, before any `run`) and `title-left` (the page
is hidden for good, `obs.beforeLeave`, while the player has never reached `run` this session; at most one per
session). `title-left` carries its one reason as a second count, picked at leave: `left-booting` (Jump never
became tappable), `left-howto` (the first-jump card was open), `left-title` (nothing was tapped). Wire in
`src/main.js` beside `obs.play('run')` and the howto handlers (lines ~406, 1633, 1659). Document the new
events in the AGENTS.md § 2 obs paragraph and the `signature.js` comment.

## Acceptance criteria
- [ ] A page load that never taps Jump and is then hidden posts exactly one `title-left` and one of the three reasons; a load that reaches `run` posts none
- [ ] `jump-tap` is counted once per page load, however many times Jump is tapped; `run` still counts as today
- [ ] The Worker accepts the new names (`cleanObs` uses PLAY_EVENTS) and the digest `players` days list them; automated browsers stay in `sessions:auto`
- [ ] No new network call, host, id or storage key; the beacon stays ≤ 8 kB

## Test plan
Unit: `test/obs.*` builds a beacon with the new events and checks `cleanObs` keeps them and drops unknown names.
e2e (390×844 touch, `coldgas_howto='new'`): load, hide the page (`pagehide`) → beacon has `title-left` +
`left-title`; open the how-to then hide → `left-howto`; tap Jump through to a run → `jump-tap`, `run`, no `title-left`.

## Out of scope
Any change to what the player sees. Time-on-title per person. Fixing whatever the new counts reveal (a new ticket).
