---
id: 0251
title: A friend's challenge plays in one tap on the same stunt, and beating it sends it straight back
status: in-progress
priority: P0
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 brief: the challenge flywheel, play → share → a friend opens it → beats the score → shares again, with no accounts
or backend. The web has the loop (src/challenge.js, src/comeback.js: the card "ABC scored 92.3 on The Show — beat it",
Take the challenge, the sender's ghost, "You beat ABC by 2.1", Send it back). Gaps from the audit: a first-time recipient
taps twice (Take, then the how-to card) before flying; `take()` doesn't switch to the sender's tier, so a Pro run is raced
on Assist and compared on raw totals (comeback.js:208); the comparison never mentions the recipient's own best; and the
recipient's funnel from open to play isn't visible in PostHog.

## What
Depends on: 0247 (a first run starts without the card), 0260 (the stunt name and the share), 0245 (events).
- **One tap**: the challenge card's Take the challenge starts the countdown, for a first-timer too (0248's guide runs inside
  the run if it's their first). Not now leaves them on the title with the card dismissed.
- **The same stunt**: the run takes the sender's course and tier (a tier the recipient hasn't used is fine: Assist, Pro and
  Advanced are all open). The card says it: "ABC · 82.4 · The Show · 360 · Pro". If 0255's licenses are in, a tier never
  becomes locked by this (nothing is locked).
- **Beat-my-score lines**: after the run, "You beat ABC by 2.1" / "ABC still leads by 0.8", and the recipient's personal
  best on that course and tier beside it ("Your best: 79.0"). Send it back is the primary button when they win, Retry
  when they don't, with Send it back beside it.
- **Send it back** packs the recipient's run as a new challenge (the existing `#vs=`), with the message "Beat 84.5 on The
  Show · 360" (0260's stunt name).
- The link format doesn't change (old links keep working; AGENTS.md §4). A stale `SIM_VERSION` behaves as today.
- On iOS Safari, the card may offer "Open in the app" once 0253 has shipped; never a redirect.
- Events: `challenge_open`, `challenge_play` (0245), plus the existing obs `challenge-open`, `challenge-run`.

## Acceptance criteria
- [ ] e2e (fresh context): opening a challenge link shows the card; one tap starts the countdown on the sender's course and
      tier; the result line compares against the sender and shows the recipient's best; Send it back produces a `#vs=`
      link that decodes to the recipient's run.
- [ ] e2e: a returning player's challenge flow is the same minus the guide; a stale link shows "from an older version".
- [ ] Unit: the comparison is like for like (same course and tier) and never compares across tiers silently.
- [ ] Works at 390×844 touch and 1280×720 keyboard; the title audit passes with the card.

## Test plan
`tests/e2e/challenge.spec.js` (or the existing comeback e2e) extended; unit tests in `tests/unit/comeback.test.js`.

## Out of scope
A server-side challenge store, short links or accounts. The iPhone (0253). Wreck challenges (after 0238: a follow-up).
