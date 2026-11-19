---
id: 0303
title: The funnel says what a player pressed on the results card after a landing: next jump, retry, share or home
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-19
pr:
by: scout
---

## Why
2026-11-18, `human` sessions: 11 people, 23 runs, **6 landed**, 10 retries, and **0 `post`, 0 `share`, 0 `board-open`**
from those six landings (every day since 11-12 shows the same zeros). `retry` is counted, but the other three exits of
the results card (Next jump, Share, Home) are not, so "no post after a landing" cannot be told apart from "pressed
Next jump and kept flying" (the best outcome, invisible today) or "pressed Home and left". The operator's focus names
the score-right-after-landing and the return loop as priorities; the one step in the funnel where the player is
holding a good result is the step we cannot read. Counts only, no ids, no personal data.

## What
- `src/main.js`: where the results card's `[data-next]` and `[data-home]` handlers run (≈1813-1832), count
  `obs.play('card-next')` and `obs.play('card-home')`, only while the results card is showing a landed run (not on a
  wreck card, not on the top-bar Home). `retry` and `share` already count; leave them.
- Add `card-next` and `card-home` to `PLAY_EVENTS` in `src/obs/signature.js`; the Worker takes any name in that list
  (frozen: do not touch `src/worker/`). If it filters by its own list, drop the counters and say so in the PR.
- Add both to the player funnel columns `scripts/obs-report.mjs` prints, if it has a list.

## Acceptance criteria
- [ ] Landing, then tapping Next jump, counts exactly one `card-next`; Home from the card, one `card-home`; neither
  fires from the title, the pause sheet, or a wreck card.
- [ ] Nothing about the run, the score, the vectors or the card's layout changes; no new host; production only, as
  the other counters.
- [ ] Works at 390x844 touch and 1280x720 keyboard (N and H keys count too).

## Test plan
Unit: the signature list holds both names. E2E: fly a scripted landing, press Next, assert one `card-next` in the
obs queue; again with Home; assert a wreck card's Home counts neither.

## Out of scope
Why a player pressed it (0295 covers quits); any change to the card.
