---
id: 0235
title: The panel speaks authored lines at the landing, free and instant, and on the web the AI panel is something you ask for
status: ready
priority: P1
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
The operator's call, 2026-11-13 (docs/proposals/ai-judge-audit.md, Option B; AGENTS.md pillar 3 and 5½): authored
commentary driven by the run's stats is the default voice everywhere, so it is free, instant and offline, and shown at the
landing moment. Today every scored web run makes an edge call whose words new players mostly never see (they sit under
More on the calm sheet), our own agents make most of the calls, and the edge has failed for hours at a time. Aim: zero
marginal inference cost, no paid AI.

## What
- A pure, deterministic commentary engine grown from `localWords` (src/panel.js), e.g. `src/commentary.js` + its lines as
  data (`src/commentary/lines.json` or similar) that the iPhone bundles as is, so new lines never need a Swift change.
  - Inputs: the `scoreRun` card, the coach's first finding (src/sim/coach.js), the damage zones, the player's previous run
    on this course (from the device), and milestones (first landing, first 720, first clear of the row).
  - Conditions on combinations (a high apex but a hard touchdown), a callback to the last run ("0.4 m/s softer than last
    time"), seeded variety from the run (no `Math.random`), so a retry doesn't repeat itself.
  - At least 40 authored lines per judge to start (headline + Engineer + Coordinator + Designer), covering landed, wrecked,
    no jump, contact, flipped, fell off, the deck, short of the row, on all three courses. 0240 turns the voices into the
    crew. Tone and IP: §3.7 and the What's-new tone rules (tropes only, family-friendly, every claim true to the run).
- Shown at the landing beat (src/beat.js: the headline and one line) and on the sheet, including the calm sheet (not
  under More).
- No edge call per run: `runPanel` (src/main.js) no longer calls `/api/judge/stream` by default. "Ask the AI panel" on the
  full sheet runs today's theatre (the docked strip on a phone). The rewarded "Watch an ad · ask the panel again" keeps
  working as the same opt-in call. A player who has connected their own key keeps the automatic call (their key, their
  choice).
- The receipt for authored lines: "written by the game, not a model", no tokens, $0. Portal builds use the same engine.
- `judge-ask` in PLAY_EVENTS (src/obs/signature.js) so the funnel shows who asks, if that needs no `src/worker/` change.
- `npm run vectors` emits each vector run's lines so the iPhone's port (0236) is held to the same words.

## Acceptance criteria
- [ ] Unit: the engine is deterministic (same run, same lines), a retry of the same course picks different lines, every
      condition branch has a line, numbers in a line match the card, and no line names a brand or a person.
- [ ] e2e: a finished scored run makes no request to `/coldgas/api/judge/stream` until "Ask the AI panel" is pressed; then
      the theatre and the receipt run as today. `tests/e2e/ads.spec.js`'s rewarded path still makes its call.
- [ ] The landing beat shows an authored line on a first-ever run at 390×844 touch and 1280×720 keyboard; the audits pass.
- [ ] Authored lines are never labelled as a model's, and a model's words are never labelled as authored.
- [ ] Vectors carry the lines; `npm run check` green. No `src/worker/` or `wrangler.jsonc` change.

## Test plan
New `tests/unit/commentary.test.js`; `tests/unit/vectors.test.js` regenerated; e2e: a judging spec that counts requests
before and after Ask; the ads spec unchanged and green.

## Out of scope
The iPhone (0236). The crew's names and Wreck lines (0240). Removing the theatre, BYOK or the Worker's endpoints (they stay
for the opt-in call and old clients).
