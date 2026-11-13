---
id: 0240
title: The panel becomes our own invented stunt crew, who talk about the stunt and the wreck
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club and Option B (operator's call 2026-11-13). Today the Chief Vehicle Engineer and the Head of Design are a launch
event's on-stage roles, and the title's fine print says the game is "Inspired by the October 2026 roadster reveal". The
operator's call drops that frame (AGENTS.md §1): the judges become an invented crew of our own.

## What
Depends on: 0235 (the engine), 0237 (the Wreck card).
- Three invented crew members with names and voices of our own (§3.7: no real people, brands or likenesses):
  the Coordinator cheers the wreck, the Engineer keeps a running repair bill ("that's a door, a wheel and my weekend"), and
  the Designer only loves clean landings. Their lines join 0235's data file, reading both the Style and the Wreck cards.
- The crew's names replace the role titles everywhere the client names a judge (src/ui.js, the sheet, the beat, the share
  card). The model's brief is in frozen `src/worker/ai/prompt.js`, so an opt-in AI call keeps today's roles: note that for the
  operator in the PR.
- The fine print (index.html) drops "Inspired by the October 2026 roadster reveal" and keeps "An independent fan game, not
  affiliated with any automaker" (§3.7).
- Family-friendly: no people in the cars' world, only drones and dummies.

## Acceptance criteria
- [ ] Every line names only the crew; a unit test scans the lines for real names and brands.
- [ ] A wreck gets lines about the wreck (the repair bill counts the zones and parts 0237 reports); a clean landing gets
      the Designer's approval.
- [ ] The fine print no longer mentions the reveal; tests/unit and e2e that read it are updated.
- [ ] Vectors carry the new lines so the iPhone (0236) speaks them unchanged; `npm run check` green.

## Test plan
`tests/unit/commentary.test.js` extended; the fine-print assertion updated; vectors regenerated.

## Out of scope
The model's prompt in `src/worker/ai/prompt.js` (frozen; the operator decides). A hero-car redesign (an open question for the
owner).
