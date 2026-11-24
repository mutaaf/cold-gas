---
id: 0369
title: A Lineup run that leaves the ground and hits the row is never judged "No jump", and the judges never say it never left the ground
status: ready
priority: P0
size: S
lens: authenticity
created: 2026-11-24
pr:
by: critic
---

## Why
The Lineup sheet contradicts itself, and it contradicts what the player just watched.

- **Live on production `8405507`, 1440×900, keys, Assist.** ↑ was held as the cue says, then Space for 0.5 s at "Hold Space
  at the line". The car reaches the line at 116 km/h and is 0.1 m off the ground when it meets the first car of the row
  (`docs/critique/2026-11-24-1537/lineup-keys-floor-2-over-row.png`).
  - The sheet's headline is **"No jump · 4.0"**, and the run line says **"NO JUMP · NOT A MARK YET"**.
  - Its own WHAT HAPPENED, two cards lower, says "the car peaked 36 ft 11 m up and came down on the roofs"
    (`lineup-keys-floor-3-sheet.png`, `desk-lineup-floor.json.txt`).
- **Over the populations (seed 777, 200 players each, `no-jump-airborne.out.txt`):**
  - Keys (`flyKeysLineup`): 13 of 87 crashes are judged "No jump".
  - Touch (`flyTouch('lineup')`): 21 of 128.
  - In every one, the car left the ground (`t.airStartTick >= 0`).
  - On the Show and the Wall it is 0 of 201 crashes, so this is the Lineup only.
- **The runs (`no-jump-runs.out.txt`):** the car is airborne for 2.2 s, rolls 186° to 371°, and peaks up to 7.4 m. The run
  ends `contact` (`src/sim/run.js:382`, 480 ticks after the hit), and the wheels never touch the ground, so `touchTick`
  stays −1.
  - Then `jumped = t.airStartTick >= 0 && t.touchTick >= 0` (`src/sim/judge.js:239`) is false, and `verdictOf` returns
    "No jump" (`:302`). Every category is zeroed (`:276`), so a 368° kickflip scores 0 for Height and 0 for Rotation.
- **The judges say worse.** The authored panel (`localWords`, `src/panel.js:134-136`) reads `!f.jumped` as a car that
  never moved. On 6 of the 13 keys runs (damage < 60 %) it says, for a card with `apex` 7.4 m and `rollDeg` 368
  (`no-jump-panel-words.out.txt`):
  - "No jump recorded".
  - "The car never left the ground long enough to measure. Nothing to grade."
  - "The ramp is right there. Hit it with intent and give me something."
  - "Restraint is a virtue. This was too much of it."
  This goes to a player who flew the car into the row at highway speed. The AI panel's prompt is built from the same card
  and verdict.
- **The coach's row line is false for a hit on the way up.** It reads the apex after the hit (the bounce) as the flight's
  peak: "peaked 11 m up and came down on the roofs", for a car that was 0.1 m off the ground when it hit (the HUD's ALT).

**The bar:** in Wreck Club the crash is the punchline (AGENTS.md §1), and a punchline that says "nothing happened" is no
punchline. The reveal's car cleared the row on cold gas (`docs/REVEAL_RESEARCH.md` §2.2). A car that leaves the ground and
meets the row has jumped and hit the row, and every surface on the sheet has to say so, with the card's own numbers.

**Number it moves:** `retry` after `wrecked-lineup`. On 11-23 humans wrecked 3 of 5 Lineup runs, the course they wreck most.

## What
- `src/sim/judge.js`: on the Lineup, a run that left the ground (`airStartTick >= 0`) and ended on the row
  (`t.contact`, no `touchTick`) is not "No jump".
  - Its verdict is "Contact" (or "Wrecked" by damage, as today).
  - It takes the "jumped" path for Height and Rotation, with the crash cap (≤ 3.5 a judge) unchanged.
  - The smallest correct change is the builder's call: the verdict only, or `jumped` too. Say which in the PR.
- `src/ui.js:433`: the run line follows the verdict ("Crashed · not a mark yet").
- `src/panel.js` `localWords`: the Lineup's `!f.jumped` lines are only for a car that never left the ground. A car that hit
  the row gets lines that name the row and a number from the card.
- `src/sim/coach.js` row finding: read the car's height at `t.contactTick` from the replay. If it is under the roofs, say the
  car went into the row before it rose ("hit the row 0.1 m up at 116 km/h"), not "peaked … and came down on the roofs".
- A scorer change: bump `SIM_VERSION` if outcomes change, regenerate the vectors (`npm run vectors`), and mirror it in
  Swift (docs/NATIVE.md). Keep the ref-hashes (no reference run hits the row).

## Acceptance criteria
- [ ] Over `flyKeysLineup` ×200 and `flyTouch('lineup')` ×200 (seed 777), **0** runs with `t.airStartTick >= 0` are
      judged "No jump". Today: 13 and 21.
- [ ] Over the same populations, **0** cards with `facts.apex > 1 m` or `facts.rollDeg > 90` get a `localWords` line
      containing "never left the ground" or "Restraint". Today: 6 on keys.
- [ ] The production probe (`docs/critique/2026-11-24-1537/lineup-keys.mjs.txt`, `floor 500`): the headline is not
      "No jump", and WHAT HAPPENED does not say "came down on the roofs" for a car that was under 1 m at `contactTick`.
      Screenshot the sheet beside `lineup-keys-floor-3-sheet.png`.
- [ ] 390×844 touch: the forced Lineup wreck (`phone-lineup-row.mjs.txt`) still reads "Contact" and "Came down on the
      row". Screenshot it.
- [ ] A Lineup run that never leaves the ground (no Space, ↑ released before the line) is still "No jump".
- [ ] The Show and the Wall cards are unchanged for every vector. `npm test` is green, `ref-hash` is unchanged (show
      `6b2cb98b`, wall `f1b9fab`, lineup `4fc4af6b`), naive-players is 32/32 and naive-show is 54/54.

## Test plan
- `tests/unit/judge-lineup-contact.test.js`: fly both populations and assert the verdict and the local panel lines above.
- Extend `tests/unit/coach-lineup.test.js`: a row hit under the roofs gets "into the row" words with the height and speed
  at `contactTick`.

## Out of scope
- Why keys players reach the line at 116 km/h (0363) and the held LIFT's height (0362).
- The Wreck score (0237).
