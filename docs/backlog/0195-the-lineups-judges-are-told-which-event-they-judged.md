---
id: 0195
title: The Lineup's judges are told which event they're judging, so the headline never calls it the Show
status: proposed
priority: P1
size: S
lens: authenticity
created: 2026-11-11
pr:
by: critic
---

## Why
Pillar 3: the panel's words "must be specific, short and in character, never generic". On production at 390×844
touch (critique `docs/critique/2026-11-11-0937.md` §3), a first-visit one-thumb run on **the Lineup** scored 91.3
"Stuck it". The AI headline above the score read **"PERFECT LANDING ON THE SHOW"**
(`docs/critique/2026-11-11-0937/L-results.png`, model `gemma-4-26b-a4b-it`). That's the wrong event, on the first
line of the sheet a player shares.

The cause is in the prompt, not the model:
- `SYSTEM` (`src/worker/ai/prompt.js:5`) describes three events, THE SHOW first, and ends "The event is named in the
  facts."
- `userFacts` names the event for the Show (`:40`, "Event: THE SHOW. …") and for the Wall (`:51`, "Event: THE WALL. …").
- The Lineup takes the fall-through branch (`:62-71`). It has **no "Event:" line**, so the model gets facts that never
  name the event, and it picks the first one it was told about.

The same run's Show and Wall headlines named their events correctly ("A CLEAN SHOW PERFORMANCE", "A SUCCESSFUL
VERTICAL CLIMB"). Only the Lineup's facts are missing it.

**This is a frozen path** (`agents/control.json` → `frozen_paths`: `src/worker/`). It's the operator's change, not the
Builder's. It's filed `proposed` so the Builder doesn't pick it up.

## What
In `src/worker/ai/prompt.js` `userFacts`, give the Lineup branch its own first line, in the Show's and the Wall's
style. For example: "Event: THE LINEUP. No ramp: the car lifts off flat ground on its down-jets, rolls 360 degrees
over five parked EVs (a semi among them), brakes and lands on a pad beyond them." Make it `f.course === 'lineup'`
explicitly, so a future course can't silently fall through to it.

## Acceptance criteria
- [ ] A unit test (`tests/unit/` over `userFacts`, or the prompt builder it feeds) asserts that, for a card of each
      course (`show`, `wall`, `lineup`), the user prompt contains exactly one `Event: THE <COURSE>` line, and that it
      names that course.
- [ ] An unknown course gets no Show or Wall facts. It gets a plain generic line, or the call isn't made.
- [ ] On a preview or production at 390×844, three Lineup runs on the edge model: no headline names "Show" or
      "Wall" (screenshots of the three results headers).
- [ ] No score change: `ref-hash` identical, and `scoreRun` untouched (the AI writes words only, invariant 3.5).

## Test plan
Unit: build the prompt for one reference card per course and grep the Event line. Live: three Lineup runs on a preview.

## Out of scope
- The local fallback lines (`src/panel.js`), which already split by course.
- The model choice.
