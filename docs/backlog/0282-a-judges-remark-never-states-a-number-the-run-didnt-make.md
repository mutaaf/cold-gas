---
id: 0282
title: A judge's remark never shows the player a number the run didn't make
status: shipped
priority: P1
size: S
lens: authenticity
created: 2026-11-18
pr: 494
by: critic
---

## Why
On production (main `ffa215a`, 2026-11-18 09:36 UTC), the Show's reference run at 1440×900 scored Perfect 10 · 97.3. The
card's `invertedS` was **3.7 s** (`scoreRun` facts; `run.t.invertedTime` 3.65). The edge model's Coordinator told the
player: "That **thirty-six second** hang under the ledge was pure nerve and absolute theater."
(docs/critique/2026-11-18-0936/desk-ref-results.png). It dropped the decimal point and made the hang ten times too long.
The prompt forbids this ("Never change them or invent numbers that are not in the facts", src/worker/ai/prompt.js:12),
but nothing checks the answer. `parseWords` (prompt.js:76) only splits the labels, and the client shows whatever comes
back (src/ai/theatre.js `done`, src/main.js `runPanel`).

It's rare, but it lands on the most watched words in the game. 12 more edge calls on the Show and Wall references
stated every number correctly (docs/critique/2026-11-18-0936/judge-sample.txt). So the rate is about 1 sheet in 16
seen today. On every scored web run the model writes these words, and on a first visit they're the first thing that
explains the score. The Coordinator who stood under the real ledge knows the hang is a few seconds. A
thirty-six-second hang on the scoring sheet is exactly what someone who built the car would read out on stage as fake.
Pillar 3 and invariant 5½ say the numbers come from `judge.js` and nowhere else. Today the model can add its own.

The fix belongs on the client: the client already holds the card and `localWords(card)`. No `src/worker/` change is needed.

## What
- A pure `checkWords(words, card)` (e.g. in src/panel.js beside `localWords`):
  - For each of headline/engineer/coordinator/designer, extract every stated number: digits (`3.7`, `48%`, `4 ms`) and
    spelled-out numbers up to ninety-nine (`thirty-six`, `forty-eight`, `five`).
  - Accept a number if it is within ±10 % or ±0.5, whichever is larger, of something the player can be told:
    - any numeric value in `card.facts`, the judges' scores, or the total;
    - that value converted the way src/units.js converts it (m→ft, m/s→ft/s, km/h→mph, kg→lb);
    - 360/720, 0, one, two, ten, or "Perfect 10".
  - Anything else marks that remark as unfaithful.
- Where words arrive from a model (the edge default, "Ask the AI panel", the rewarded re-ask, a player's own key), an
  unfaithful remark is replaced with the same judge's line from `localWords(card)` before it is shown. The receipt says
  so in a line: "1 remark replaced with the game's own line: it stated a number the run didn't make". The words the
  model sent stay visible under Inspect the call (5½: honest about what the model said).
- The funnel or obs counts how many sheets had a remark replaced, if that needs no `src/worker/` change. Otherwise
  leave it out.

## Acceptance criteria
- [x] Unit (`tests/unit/check-words.test.js`): with the Show reference's card (`invertedS` 3.7), "That thirty-six second
      hang…" fails, and "Hanging inverted for nearly four seconds" and "for 3.7 seconds" pass.
- [x] Unit: every remark in docs/critique/2026-11-18-0936/judge-sample.txt passes unchanged against its reference card
      (12/12 sets, Show and Wall). That includes "forty-eight percent", "4 ms", "26.8 meters" and "over five seconds".
- [x] Unit: the crash card from the same critique ("A 10.8 ft/s 3.3 m/s sink rate and 60 feet 18.2 meter deviation",
      sink 3.3, padMiss 18.2) passes: US conversions are accepted.
- [x] e2e at 390×844 touch and 1280×720: a judge stream stubbed to answer the "thirty-six second" remark shows the
      Coordinator's `localWords` line on the sheet (calm sheet and full sheet). The receipt carries the replacement line,
      and Inspect the call still shows the model's raw text.
- [x] No `src/worker/` change and no sim change. `npm run check` green.

## Test plan
New `tests/unit/check-words.test.js` built from the recorded sample. The theatre's existing e2e stub (the judge stream
answered locally) gets one case with the bad number.

## Out of scope
Making authored lines the default voice (0235, the operator's). Wrong claims that aren't numbers ("the parked semi"
when the car hit a crossover). Changing the prompt or the model (src/worker/, frozen).
