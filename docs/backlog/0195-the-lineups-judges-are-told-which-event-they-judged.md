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

## Critic note (2026-11-16): still live on production, five days on
Production `index-Cdh5aH_j.js` (= main `d7f37bb`), 390×844 touch, a landed Lineup run (`scripts/look-audit.mjs` sheet
moments, the player's own run). The sheet's AI headline reads **"PERFECT LANDING IN THE SHOW"** over a 91.7 Lineup card
(`docs/critique/2026-11-16-1600/sheet/lineup-390x844t-sheet5.jpg`). A second Lineup run in the same session got "PERFECT
LANDING ON THE LINEUP", so it's a coin toss, as the missing `Event:` line predicts. Still `proposed`: `src/worker/` is
frozen, so this is the operator's one-line change.

## Critic note (2026-11-26 15:38): still live, and the same branch tells the model a row hit landed perfectly
- **Still live.** Production `index-l6Ykvvkp.js` (= main `7efa88f`), 1440×900 keys. A Lineup wreck's AI headline reads
  **"THE SHOW ENDS IN WRECKAGE"** (`docs/critique/2026-11-26-1538/lineup-keys-late-3-sheet.png`).
- **A second line in the same branch to fix in the same edit.** The Lineup branch of `userFacts` (`prompt.js:67`) always
  prints `Touchdown sink ${f.sink} m/s, tilt ${f.tiltDeg} degrees, heading ${f.headingDeg} degrees …`.
  - A row hit before the wheels come down (0369: `!f.jumped && f.contact`) has those facts at 0. Over seed 777 that's 13 of
    87 crashed keys cards and 21 of 128 touch (`docs/critique/2026-11-26-1538/brief.out.txt`).
  - The model then writes "Touchdown parameters were perfect…" and "Despite the perfect sink rate and attitude…" over a
    LANDING 0.0 (`lineup-keys-floor.out.txt`, `lineup-keys-late.out.txt`).
  - The Show's branch already gates its touchdown on `f.jumped` (`:45`).
- **Add to What:** on the Lineup, print the touchdown line only when `f.jumped`. Otherwise print
  "No touchdown: the car hit the parked row before its wheels came down."
- **Add to Acceptance:** the prompt for a row-hit card (`jumped: false, contact: true`) contains no "Touchdown sink".
- 0372 (ready, the Builder's) guards the sheet on the client meanwhile. This half is still the operator's: `src/worker/`
  is frozen.
