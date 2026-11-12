---
id: 0193
title: On a phone, the run-up and the replay's opening show the pad and the car, not a red room
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-11-11
pr: 322
by: critic
---

## Why
The reveal's set was "a dark tarmac pad lit by white floodlight pools … long red LED edge strips" (REVEAL_RESEARCH
§1.1, "Set"). Red is an edge on that set, not the light it's lit by. 0187 (#303) fixed the climb and the hang: the
deck now reads grey with a thin red edge (critique 2026-11-11 §1). But 0187 only switches on while the car is on
the deck (`src/render/deck-look.js`, k = 0 off it). The first frame of every run on the Show and the Wall, and the
first seconds of every replay, are still the red room.

Measured on production `index-D7OCgFGt.js` (main `a6bf28b`), SwiftShader, DPR 1. "Red share" is
`scripts/look-measure.mjs` `redShare` (largest channel red, HSV saturation > 0.5, value > 40/255), the same
definition 0187 and 0086 use:

| frame | 390×844 touch | 1440×900 |
|---|---|---|
| the countdown, `?play=reveal` (`docs/critique/2026-11-11-0410/desk-count.png`, `phone-count.png`) | **60.0 %** | 16.9 % |
| the run-up, tick 264, car at z −1.5 m, 13 mph (`phone-runup.png`, `desk-runup.png`) | **62.0 %** | 15.3 % |
| the first frame after Go, first visit, one thumb (four runs: Show ×2, Wall, the crash) | **48.9–49.6 %** | — |
| the replay at 2 s and 4 s (`C-replay2.png`, `C-replay4.png`) | **51.9 / 49.4 %** | — |
| the climb and the hang, for comparison (0187 shipped) | 6.2–6.4 % | 0.2–1.7 % |

- **On the desktop run-up** (`desk-runup.png`), the car at the curl's foot is a white smear inside the ring's
  bloom. Its tyres and glass don't show. That's the same defect 0187 fixed on the deck, one second earlier.
- **The phone is 3–4× redder than the desktop** at the same tick. That's the phone's narrow frame filling with the
  ring's near arc, the same cause 0187 measured.
- **The replay is what a player shares.** It opens on half a screen of saturated red, then cuts to the grey deck
  (`C-replay6.png` 24.3 %, `C-replay8.png` 9.5 %).

0086 (ready) is the title's grade and puts in-run lighting out of scope. 0187 is the deck. This ticket is the
run-up and the replay's opening shots: the gap between them.

## What
- Extend the look that 0187 applies on the deck (`src/render/deck-look.js`, `stage.setDeck`, `look.setDeck` in
  `src/render/wall.js`) to the run-up, or find the run-up's own lever (the camera's distance from the ring's near
  arc, the strips' HDR level). Do it the same way live and in the replay (position-driven, no clock), as 0187 did.
- Draft #304 (the soft-knee bloom over the whole Wall look, waiting on the operator) may meet this ticket as
  written. If the operator takes #304, re-measure this table on it first and close this ticket with the numbers if
  it passes.
- Add the countdown, the run-up (tick 264) and the replay at 2 s and 4 s to `scripts/look-audit.mjs` as moments.

## Acceptance criteria
- [ ] At 390×844 and 430×932 touch, the saturated red share is **≤ 12 %** at the countdown, at the run-up (tick 264) and in
      the replay at 2 s and 4 s. Today it's 49–62 %. 12 % is 0086's and 0187's bar.
- [ ] At 1440×900, at the run-up, the car box's P10 luma is **≤ 60**: its tyres and glass show dark. Measure it with
      `look-audit`'s projected box, as 0187 did.
- [ ] The red still reads as a red edge, not pink: on the run-up crop, the LED strip's core pixels have red as the
      largest channel with saturation > 0.5 (0187's lesson: an HDR red without bloom tone-maps pink).
- [ ] The climb and the hang keep 0187's numbers (red ≤ 12 %, P10 ≤ 60).
- [ ] `flicker.mjs --only=show-approach,show-wide,show-replay` A/B, main vs the branch, same machine, both labels, before
      the PR opens (LESSONS 2026-11-11). No region rises past its stored budget. If one does, the PR stays a draft and
      says so.
- [ ] `ref-hash` unchanged (renderer only). `npm run audit` clean.

## Test plan
Add the moments to `scripts/look-audit.mjs`. Paste main and branch tables in the PR. If the deck factor is
extended, extend `tests/unit/deck-look.test.js` to assert the factor at the run-up's positions.

## Out of scope
- The title (0086).
- The Wall's geometry and the lip height.
- The Lineup, which has no ring.

## Critic note (2026-11-11 15:30)
Re-measured on production `index-Jdqb08Zp.js` (main `6e508e7`) at 390×844 touch, DPR 1, using `redShare`'s definition on
the whole screenshot. The run-up 2 s after Go is **49.9 %** (`docs/critique/2026-11-11-1530/S-start.png`). The Show's replay
≈ 5 s in is **42.9 %** (`S-replay2.png`).

**The Wall's replay opens the same way: 45.9 % at 1.5 s** (`W-replay1.png`). Add the Wall's replay opening to the look-audit
moments above and hold it to the same ≤ 12 % bar. The Lineup's replay is 0.0 %, because it has no ring.

## Builder pass 1 (2026-11-12, #322)
0187's deck look now holds from the start line until the run has launched, then fades back over 1 s of sim time
(`src/render/deck-look.js` `flownFor`: the Wall's pad is on its own run-up, so position alone can't separate the two). The red
base light and its slab glow at the curl's foot dim with it, to 25 %. Same machine, SwiftShader, main → branch, saturated red:
- Countdown: 49.6–50.9 % → 3.2–3.3 %.
- Run-up: 50.1–56.9 % → 3.3–5.1 %.
- Replay at 2 s, Replay tapped: Show 17.1–17.5 % → 8.9–9.1 %, Wall 46–50 % → 8.7–8.8 %.

At 1440×900 the run-up's car P10 goes 62 → 42. Flicker: no region past its limit; `show-replay-rigs/car` +5 %. The full tables
are in the PR. The film's red air halo at the foot is not dimmed.
