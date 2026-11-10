---
id: 0188
title: On one thumb, the pad never asks for a LAND hold that changes nothing
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-10
pr:
by: critic
---

## Why
The focus asks for "skill that shows in the score". On one thumb, the pad teaches three verbs: Hold · Climb,
Tap · Let go, Hold · Land (`THUMB_WORDS`, `src/main.js:1057`). The third is mostly a placebo. Assist's
auto-land (`autoLand`, `src/sim/vehicle.js:593`) "flies exactly what LAND held from the release would have
flown from that point", and it engages **1.17 s after the tap on the Show and 1.19 s on the Wall** (0.37–0.39 s
after the release). From then on, a press changes nothing. If the thumb doesn't press, the pad pulses amber and
asks for it anyway (`warn`, `src/main.js:1075`).

Critique 2026-11-10 16:00 flew it in Node, the way `thumb-mastery.test.js` does: hold up the curl, tap on the
ledge, lift 20 ticks later, press again N s after the tap, no slide. "=" marks an end state (x, z, gas)
identical to the bit to a thumb that never presses again:

| course | never pressed again | pressed again 0.3–0.7 s | 0.75–0.85 s | 0.9–1.1 s | 1.2–2.5 s (every 0.1 s) |
|---|---|---|---|---|---|
| Show | 83.7 Clean, 6.2 m | 84.7 | **78.0–79.0** (6.9 m) | 85.7–86.7 | **83.7 =** |
| Wall | 90.7 Stuck it, 11 m | 90.7 | 90.3 | 90.3–90.7 | **90.7 =** |

- **A thumb that presses a reaction or more after the tap gets the same flight as one that walks away.** In
  `human-phone.mjs`, that's most players: "lifted, pressed again" is 111 of 150 careful thumbs (critique
  2026-11-10 09:50).
- **The only window where a press changes the flight is 0.3–1.1 s after the tap.** In that window, a press
  around 0.8 s costs about 5 points against no press (the precision curve at 6.9 m).
- **On production at 390×844,** a first-visit thumb that held LAND as told scored 81.0. One that let go at the
  ledge and never touched the pad again scored **82.7** (`r1-results.png`, `c-results.png`).
- **The amber pulse, timed per frame on production** (390×844, a thumb that lets go at the ledge and never presses
  again, `c-warn.png`):

  | run time | what happens |
  |---|---|
  | 12.80 s | the pad goes amber, "Hold · Land" |
  | 13.16 s | `autoLand` engages |
  | 14.23 s | the pulse stops, 13 m up |

  So for 1.07 of its 1.43 s, the pulse asks for a press that can no longer change anything. The pad reads
  "Hold · Land" all the way to "Stopping".
- **What the hold does do is carry the slide** (0121, 0164, 0165): the slide only acts while the thumb is down.
  That's the skill the score shows: a careful slide is worth about 10 points (median 93.3–94.7, against 83.7).
  The pad never names it in the air. The coach does, after the run ("Aim for the rings: holding the pad in the
  air, slide onto the amber dot").

So the pad spends the air telling the player they are landing the car, which the computer already does. The
amber pulse warns of a state with no consequence (§3.8: colour on the HUD means state). And the press that
would earn points, the slide, goes unnamed until the results.

## What
`src/main.js` (`THUMB_WORDS`, `syncThumb`'s `warn`), `src/pointer.js` (the how-to rows) and `src/thumb-aim.js` if
the sight carries the words. No sim change unless the builder takes the second option below, and then
`SIM_VERSION`, vectors and the naive gates follow.

Either:
1. **Say what the hold does.** In the air, the pad's words name the slide (for example "Hold · Aim" / "Slide ·
   onto the dot"), not Land. The amber pulse fires only while a press can still change the flight, that is before
   `c.autoLand` engages. Once auto-land flies it, an empty pad is calm. Or:
2. **Make LAND's hold mean something,** without costing the naive or careless players a landing.

The first is the small, honest change. The second is a design call: if the builder thinks it's right, it goes
back to `proposed` with the numbers.

## Acceptance criteria
- [ ] A unit test pins the table above: on the Show and the Wall, no slide, pressed again at every 0.1 s from 1.2
      to 2.5 s after the tap, the end state is bit-identical to never pressing again. With option 2, it asserts
      instead that the press changes the flight and the score, in the direction the words promise.
- [ ] Option 1: once `c.autoLand` is 1 (or LAND is otherwise flying), `data-warn` is never set on the pad (a test
      of `syncThumb`'s decision as a pure function, both courses, thumb pressed and not). Before then it behaves as
      today.
- [ ] Option 1: in the air, the pad's verb and action never read "Land" while the hold's only effect is the slide.
      The first-run how-to (`pointer.js`) and the pad agree on the word. Screenshot at 390×844: tap, the air with
      the sight, touchdown.
- [ ] `node scripts/naive-players.mjs` 32/32, `naive-show` 54/54, `human-phone.mjs 150 --scheme=thumb` for each
      skill: clean share and median score not lower than main.
- [ ] The PR says which funnel number it should move (`run-landed`, `retry`) and states the one-thumb population's
      slide share before and after. The bar is that the share of thumbs that slide does not fall.
- [ ] Works at 390×844 touch, and 1280×720 keyboard/mouse is unchanged.

## Test plan
`tests/unit/thumb-mastery.test.js` (or a new `thumb-land.test.js`): the press-again sweep against hands-off on both
courses. A pure test of the pad's word and warn state at autoLand 0/1 × held/not. An e2e step in the phone spec:
fly the Show on the pad, lift after the tap, and assert no `data-warn` once auto-land is on.

## Out of scope
Auto-land itself (an accessibility gate). The slide's law (0164, 0165, 0177). The Lineup's scheme (0181).
