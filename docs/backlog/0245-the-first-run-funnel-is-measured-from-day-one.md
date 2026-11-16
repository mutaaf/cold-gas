---
id: 0245
title: The Phase 2 funnel is measured from day one, one event vocabulary for the web and the iPhone
status: shipped
priority: P0
size: M
lens: engagement
created: 2026-11-13
pr: 371
by: operator
---

## Why
Phase 2 (docs/proposals/phase-2-growth.md) asks for time to first interaction, first-jump completion, first landing rate,
second-jump conversion, share rate, share-open-to-play conversion, license progress and return rate. Today the web sends
three Box Office events (`game_start`, `game_over`, `share`; src/insights.js) and the obs funnel's fixed PLAY_EVENTS
(src/obs/signature.js). The obs list is checked by the frozen Worker (`src/worker/obs.js` keeps only listed names), so a new
obs name would be dropped on the server. The iPhone sends nothing (0246 fixes that with the same vocabulary). This ticket
ships first so every later Phase 2 ticket moves a number we can already see.

## What
- **One vocabulary**, pure and shared: `src/metrics/events.js` (names, props, enums, and which are numbers) and a generated
  `ios/Packages/ColdGasCore/Tests/Vectors/events.json` (by `npm run vectors`) that 0246 tests against. Names are Box Office's
  snake_case verbs; props are numbers and enums only (§3.3: never initials, free text or ids):
  - `session_start` {returning: 0|1, days_since_last: n} (from a local last-seen day; no id)
  - `first_input` {ms_since_load} (the first touch, key or pad input that reaches the car or the title's primary CTA)
  - `jump_start` / `jump_end` {n: 1|2|3+, course, tier, landed, score} (n = this device's lifetime Jump count, capped)
  - `first_landing` {n} (the jump number it took)
  - `share_tap`, `share_done` {course, via: file|link|copy}
  - `challenge_open`, `challenge_play` {course, stale: 0|1}
  - `license_pass` {license} (wired by 0255; declared here)
- **The web sends them** through `src/insights.js` `track()` only (production only, as today). The three existing events stay
  as they are so PostHog's dashboards don't break.
- **Local counters** the events need (`coldgas_flown` already counts runs; add last-seen day and lifetime jumps if missing),
  kept where 0254's progress store will adopt them.
- Where an existing obs PLAY_EVENT already counts the same thing (`visit-new`, `run`, `run-landed`, `share`,
  `challenge-open`, `challenge-run`), keep it: it is our own first-party count and doesn't need PostHog. No new obs names
  (they would need the frozen Worker).
- The privacy page (public/privacy/index.html) lists the new events in its usage analytics paragraph
  (tests/unit/privacy.test.js).
- A PostHog insight per metric is the operator's to pin; the PR lists the event → metric map from the proposal §6.

## Acceptance criteria
- [x] Unit: `events.js` validates every call (unknown names or non-enum props are dropped in dev with a warning, never
      thrown); `track()` never runs in the portal builds or on localhost.
- [x] e2e (production build, a stub `window.boxoffice`): a fresh visitor's load → first input → jump → landing → retry
      produces `session_start`, `first_input`, `jump_start`/`jump_end` (n 1, 2) and `first_landing`, in that order, with
      only numbers and enums.
- [x] No event is sent from the frame loop (queued, flushed on the title/results or `pagehide`); no per-frame allocation
      (`npm run alloc:bench` unchanged).
- [ ] `npm run vectors -- --check` passes with the events file.
      (Not in the web PR: the vectors live under ios/ and scripts/, the native track's; `src/metrics/events.js` exports
      `vocabulary()` as plain data for a generator.)

## Test plan
`tests/unit/metrics-events.test.js` for the vocabulary; an e2e in `tests/e2e/` with a stubbed `window.boxoffice` that
records calls; privacy.test.js updated.

## Out of scope
The iPhone (0246). New obs names (frozen Worker). Session replay settings (Box Office's own).
