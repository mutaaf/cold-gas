---
id: 0245
title: On keys and two thumbs, Assist's clean line names what the score still pays for
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-13
pr:
by: critic
---

## Why
The operator's focus item (1) is "skill that shows in the score". After a clean run on keys (or two thumbs) in
Assist, the one line the game gives for the next attempt asks for two things the score no longer pays for. On
production (`index-ZPjhJIpE.js` = main `91cdf7b`), desktop 1440×900, the Show flown by the reference autopilot in
Assist scored **97.3 Perfect 10**, and the sheet said **"NEXT RUN · Clean. Next: a softer touchdown, closer to the
mark"** (`docs/critique/2026-11-13-2155/desktop-show-results-contradiction.png`). Measured against the scorer:

- **Softer** is worth 0.0: the touchdown sank at **0.81 m/s**, and `landingScore` gives full marks for sink at
  **≤ 0.9 m/s** (`src/sim/judge.js:121`, `band(t.sink, 6, 0.9)`). It is also already at the reveal's soft touchdown
  (1.1–1.4 G, REVEAL_RESEARCH §2.1.4).
- **Closer to the mark** is worth 0.0: the miss was **1.5 m**, and the Show's precision is full inside **3.5 m**
  (`SHOW_PRECISION`, `src/sim/judge.js:107`); the card shows precision **10**.
- The points left are elsewhere: clearance **8.8** (the row crossed at **5.1 m**; full marks at ≤ 2 m, `CLEARANCE`,
  `src/sim/judge.js:133`), landing **9.4** (heading **6.5°**, wheel spread **58 ms**).

The same sheet, two boxes lower, says "Perfect 10: nothing big to fix. Want more? Try Pro" — the sheet contradicts
itself. The line comes from `src/pointer.js:136` (`case 'clean'`, the non-thumb Assist branch), which is a fixed
string. One thumb got the right treatment in 0156 (it names the step the score shows); keys and two thumbs did not.
The Pro branch has the same problem in smaller form: "under 1 m/s and the 2 m ring" quotes neither the 0.9 m/s nor the
3.5 m the scorer pays at.

## What
`src/pointer.js` `pointerText('clean', …)` for every non-thumb context (and `pickPointer` where it feeds it): name
the controllable category with the most points left on this run's card, in the player's units, with the scorer's
own threshold. On the Show and the Wall, read the categories off the card (`card.categories`/`card.facts`): never
name a category already at 10. If nothing controllable has ≥ 0.1 point of headroom, say what the What-happened box
says (Try Pro, ×1.08) so the two never disagree. Thresholds come from `src/sim/judge.js` exports, not new literals.
No sim or scorer change (`ref-hash` unchanged; vectors unchanged unless the native port's goldens carry these
strings, in which case `npm run vectors` in the same PR).

## Acceptance criteria
- [ ] Show reference in Assist on keys (score 97.3, sink 0.81 m/s, miss 1.5 m, clearance 5.1 m): the line does
      **not** say "softer" or "closer to the mark", and names the row clearance with the 2 m (6.6 ft) figure.
- [ ] For any clean card where `categories.precision === 10`, no clean line names the mark; where the sink is
      ≤ 0.9 m/s, none names a softer touchdown (unit test over the three references and a table of synthetic cards).
- [ ] The Pro clean line quotes the scorer's thresholds (0.9 m/s; the course's full-marks ring), checked in a test
      against `judge.js` exports.
- [ ] On the desktop results sheet the NEXT RUN line and the What-happened box never give conflicting advice for the
      same run (e2e: a reference Show in Assist on keys at 1280×720).
- [ ] Phone one-thumb lines (0156) unchanged: existing `pointer.test.js` cases still pass verbatim.
- [ ] Works at 390×844 touch (two thumbs) and 1280×720 keyboard.

## Test plan
`tests/unit/pointer.test.js`: new cases for `pointerText('clean', KEY, flight)` and the two-thumb context fed the
three reference cards (built in node with `createAutopilot`), asserting the named category has headroom. One e2e
assertion in the existing results spec that NEXT RUN and What happened agree on the reference Show.

## Out of scope
The one-thumb clean line (0156, shipped). Any change to the scorer's weights or curves. The AI panel's words.
