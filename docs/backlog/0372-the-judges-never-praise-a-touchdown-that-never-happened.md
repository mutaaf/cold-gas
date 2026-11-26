---
id: 0372
title: The judges never praise a touchdown that never happened
status: ready
priority: P1
size: S
lens: authenticity
created: 2026-11-26
pr:
by: critic
---

## Why
On a Lineup wreck that never touched down, the judges praise the landing. Their score for it is 0.0 on the same sheet.

- **Live on production `7efa88f` (`index-l6Ykvvkp.js`), 1440×900, keys, Assist** (`docs/critique/2026-11-26-1538/`):
  - **Run-up at full throttle, Space held at the cue** (`lineup-keys-floor.out.txt`). The car goes into the row 0.8 m up at
    79 km/h and is **Wrecked 4.0**, with LANDING 0.0. The Engineer, model `gemma-4-26b-a4b-it`, says:
    **"Touchdown parameters were perfect, but the collision preceded a stable sink rate and level attitude."**
  - **The late LIFT, pressed 1.6 m past the line** (`lineup-keys-late.out.txt`, `lineup-keys-late-3-sheet.png`). The car goes
    into the row 0.7 m up and is **Wrecked 4.7**, with LANDING 0.0. The Engineer says: **"Despite the perfect sink rate and
    attitude, the impact with the vehicle caused catastrophic structural failure."**
  - That is 2 of the 2 never-touched-down runs I flew today.
- **Why the model says it:** the Lineup brief, `src/worker/ai/prompt.js:67`, always prints
  `Touchdown sink ${f.sink} m/s, tilt ${f.tiltDeg} degrees, heading ${f.headingDeg} degrees …`.
  - On a card with no touchdown, those facts are zeros (`src/sim/judge.js` `scoreLineup`: `t.sink`, `t.tiltDeg` and
    `t.headingDeg` are never set). So the model reads "sink 0 m/s, tilt 0 degrees, heading 0 degrees", which is a
    textbook landing.
  - Over seed 777 (`brief.mjs.txt`, `brief.out.txt`), **13 of 87** crashed keys Lineup cards (`flyKeysLineup`) and
    **21 of 128** crashed touch Lineup cards (`flyTouch('lineup')`) never touched down. **Every one** carries
    `sink 0 · tilt 0 · heading 0`. These are exactly the runs 0369 re-judged as Contact and Wrecked.
  - The Show's brief prints its touchdown only when `f.jumped`, at `:45`, so the Show doesn't have this problem.
- **The 0282 guard can't catch it.** `src/check-words.js` rejects a remark that states a number the card doesn't have.
  "Perfect" isn't a number, and "0 m/s" is on the card.

**The bar:** the panel is the game's voice on the sheet a player shares (pillar 3; invariant 5½: AI usage honest). A judge
who calls a landing perfect when the car never landed is the kind of fake the reveal's own crew would laugh off the stage.
In Wreck Club the crash is the punchline (AGENTS.md §1), and the punchline has to be true.

**Number it moves:** `retry` after `wrecked-lineup`. The Lineup is the course humans wreck most (3 of 5 runs on 11-23, the
funnel's last human day with runs).

## What
The brief is the operator's: `src/worker/` is frozen. That half is filed on 0195, which already rewrites the Lineup
branch of `prompt.js`. This ticket is the client's half, which works whatever the brief says:
- `src/check-words.js`: a remark is unfaithful when the card has no touchdown and the remark describes one.
  - On the Lineup, a card has no touchdown when `!facts.jumped && facts.contact` (0369's row hit). Read it through one
    helper, not inline.
  - A remark describes a touchdown when it gives the sink, the attitude, the tilt or the landing a quality: perfect,
    clean, soft, stable, level, textbook, and so on. The pattern is the builder's call. Test it on the two production
    remarks above.
  - An unfaithful remark is replaced by the same judge's `localWords` line, as 0282 does today.
- Mirror it wherever 0282's check is mirrored (Swift, if any), and in its vectors.

## Acceptance criteria
- [ ] Unit test: the two production remarks above (verbatim), on a Lineup card with `jumped: false, contact: true, sink: 0,
      tiltDeg: 0`, are both rejected, and the sheet shows the judge's local line.
- [ ] The same two remarks on a landed Lineup card (`jumped: true`, sink 0.8 m/s) are **not** rejected for this reason.
- [ ] Over `flyKeysLineup` ×200 and `flyTouch('lineup')` ×200 (seed 777), every card with no touchdown (today 13 and 21)
      rejects a remark that says "perfect sink rate". No landed card rejects it.
- [ ] Production probe (`docs/critique/2026-11-26-1538/lineup-keys.mjs.txt`, `floor floor 500`, and `late 18 500 <url> 2.0`):
      the sheet shows no judge line praising a touchdown. Screenshot it beside `lineup-keys-late-3-sheet.png`.
- [ ] No sim, scorer or vector-card change: `ref-hash` bit-identical (show `6b2cb98b`, wall `f1b9fab`, lineup `4fc4af6b`).
      `npm test` green.

## Test plan
- Extend `tests/unit/check-words.test.js` (0282) with the cases above.
- A population test in `tests/unit/judge-lineup-contact.test.js` (0369's), reusing its seed-777 flights.

## Out of scope
- `src/worker/ai/prompt.js` (frozen; 0195 carries the brief's fix for the operator).
- The Lineup categories a row hit zeroes (Height and Rotation 0.0 for a 414° roll): 0369 chose the verdict only, on purpose.
