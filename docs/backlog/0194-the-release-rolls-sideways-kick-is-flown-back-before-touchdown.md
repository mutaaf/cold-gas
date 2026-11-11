---
id: 0194
title: The release roll's sideways kick is flown back to the line before touchdown, not carried onto the pad
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-11-11
pr:
by: critic
---

## Why
On the reveal the car "flew forward … did a barrel roll" and was set down "gently" on four wheels (REVEAL_RESEARCH
§2.1.4, Car and Driver). It moved forward, away from the ramp. Nothing in the footage or the reports has it sliding
sideways. On our Show and Wall, the half-roll off the ledge pushes the car sideways at about 2.9 m/s. Then one of
two things happens:
- **The one-thumb flight never takes the drift back.** Assist's LAND stops the sideways motion but holds the new
  line, so the car lands 5–7 m beside the mark.
- **The reference does fly back, but too late.** It swings back across and touches down still sliding sideways at
  2.5 m/s.

The painted mark is on the car's own line (`pad.x = 0`, `src/sim/courses.js:36,192`). A first-timer who does
exactly what the pad says lands on the right-hand ring's edge and reads "16 ft 5 m right of it"
(production, `docs/critique/2026-11-11-0410/S-results.png`).

Node, main `a6bf28b`, `x` sampled every 0.2 s from the release (`scripts`' temp harness in the critique: the
`thumb-mastery` `flyThumb` loop and `createAutopilot`):

| flight | lateral kick | `t.lateral` at touchdown | vx at touchdown | padMiss, total |
|---|---|---|---|---|
| Show, reference | vx +2.69 m/s by 1.2 s | +1.04 m | **−2.56 m/s** (sliding in) | 1.5 m, 97.3 |
| Show, one thumb, no slide (held from the tap) | vx −2.88 m/s by 1.0 s | **−5.14 m** | 0.0 m/s | 6.0 m, 84.7 |
| Show, one thumb, pressed again 1.0 / 2.0 s | — | **−4.45 / −5.72 m** | — | 5.6 / 6.2 m |
| Wall, reference | — | +3.58 m | — | 3.6 m, 97.7 |
| Wall, one thumb, no slide (held / again 2.0 s) | — | **+6.06 / +7.24 m** | — | 11.4 / 11.0 m |

- **On the Show**, the one-thumb sideways miss is 5.1–5.7 m. Its along-run miss is 2.3–3.4 m. So the sideways miss
  is most of the 6 m.
- **On the Wall**, 6–7 m of 0190's 11 m miss is sideways. 0190 asks for ≤ 7 m in total; it can't get there on the
  along-run brake alone.
- **Production (first visit, 390×844, the thumb doing what the pad says):**
  - The Show: **6.8 m off, "16 ft 5 m right of it"**, 81.0 Clean.
  - The Wall: **15.5 m off**, 75.0 Clean.
- **The mechanism.** `src/sim/vehicle.js:336-349`: the roll is torque from one side's down-jets. Once the car is
  past sideways, that thrust has a sideways component. That part is physical. What's not is the flight computer
  keeping the line it was knocked onto, or landing with a sideways slide.

## What
- In Assist's LAND / line hold (`src/sim/vehicle.js`, the "hold-the-line" branch the 0164 lessons describe), hold the
  line the car was released on (pad.x), not the line it holds after the roll's kick. Fly the drift back while there's
  height to do it. The reference already does this, from about 1.8 s. Kill the sideways speed before the wheels touch.
- The reference (`src/sim/autopilot.js`) should arrive with the sideways speed gone, not swing across and slide in.
- Write the per-0.2 s `x`, `vx` trace from release to touchdown in the PR, for the reference and the no-slide thumb,
  on both courses.
- Keep the one-thumb sideways slide (0164, 0177) working: the slide moves the line the computer holds. It doesn't
  fight it.

## Acceptance criteria
- [ ] Show and Wall, one thumb, no slide (held from the tap; tapped and never pressed again; pressed again at 0.5, 1.0 and 2.0 s):
      `|t.lateral|` **≤ 1.5 m** at touchdown. Today it's 4.45–7.24 m.
- [ ] Every one of those flights, and both references, touch down with sideways speed **|vx| ≤ 0.5 m/s**. Today the
      Show reference touches down at 2.56 m/s.
- [ ] The release-to-touchdown time stays 4.1–4.95 s, with sink ≤ 1.3 m/s and touchdown g ≤ 1.6 (the reveal's
      numbers, §2.1.4; today 4.08–4.95 s).
- [ ] References: Show ≥ 97.0, Wall ≥ 97.0. `ref-hash` changes, so bump `SIM_VERSION`, run `npm run vectors`, and
      follow AGENTS.md §3.4 (the Swift mirror rides along).
- [ ] The slide still pays: `thumb-mastery`'s 0164 / 0177 sideways tests and its 0182 test (best slide ≥ 5 points over no
      slide on the Wall) pass as written.
- [ ] `naive-players` 32/32, `naive-show` 54/54, `human-show.mjs 300 assist --cues=new` ≥ 95 %, and `daily-reach` with every
      objective over the floor. Paste the before → after table.
- [ ] Funnel number to move: on touch runs, `run-landed` with a medal over bronze on the Show and the Wall.

## Test plan
Add a unit test that flies the five no-slide thumb patterns and both references on the Show and the Wall. It
asserts `|t.lateral| ≤ 1.5` and `|vx| ≤ 0.5` at the touchdown tick.

## Out of scope
- The along-run (z) part of the Wall's long touchdown. That's 0190; land this first or with it, and re-measure 0190's
  table after.
- The roll's own physics: one-sided down-jet torque is a modelling choice with a source.
- The sight and the pad's words (0180, 0188).
