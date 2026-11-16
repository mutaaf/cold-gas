---
id: 0263
title: The guided first jump teaches the one thing a thumb does in the air (aim the touchdown), not a "Hold to land" that never shows
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-14
pr:
by: critic
---

## Why
0248 (#375) teaches the first jump by playing it, in five hints: go, keep, tap, roll, land. On production, on one thumb at
390×844, the first four work: "Hold to go · Skip" is up at T+00:00.3 with the pad breathing
(`docs/critique/2026-11-14-0955/phone-guide-go.png`), and a thumb that does as told lands **Stuck it 86.7**, followed by the
"First landing" beat and the calm sheet. **The fifth hint never shows.** In a sweep of obedient thumbs (each press timed
from the hint's appearance plus a reaction of 0.15, 0.3, 0.5, 0.8 or 1.2 s, with and without pressing in the air), the
guide shows `go, keep, tap, roll` and then nothing, **10 of 10**
(`docs/critique/2026-11-14-0955/guide-reaction-sweep.jsonl`):

| reaction (s) | hints shown | land shown | total | miss from the mark | clearance |
|---|---|---|---|---|---|
| 0.15 | go keep tap roll | no | 86.3 | 5.7 m | 1.3 m |
| 0.3 | go keep tap roll | no | 86.7 | 5.7 m | 1.4 m |
| 0.5 | go keep tap roll | no | 86.3 | 5.8 m | 1.4 m |
| 0.8 | go keep tap roll | no | 86.7 | 5.6 m | 1.3 m |
| 1.2 | go keep tap roll | no | 86.7 | 5.6 m | 1.3 m |

Pressing in the air or not gives **identical** results at every reaction. The cause is by design elsewhere:
`land` is due only while `!landOn` (`src/guide.js` DUE.land), and Assist's auto-land (`src/sim/vehicle.js` autoLand)
starts LAND before the roll-out finishes, so `land` is marked done without ever showing. The pad already knows this:
from that moment it says **HOLD · AIM** (`src/thumb-words.js:2-7`; `phone-guide-air-hold-aim.png`, T+12.0 s, while the
cue line is empty), because a hold then changes one thing only, the touchdown slide (0121, 0164).

So a newcomer's first jump asks them for nothing for the 4.6 s between "Let it roll" clearing (T+11.97) and touchdown (T+16.55, `phone-guided-flight.jsonl`), which is the whole
landing, the part the game is named for. The first time anyone mentions the one input that moves their score in the
air is the sheet's NEXT RUN, after the jump: "Aim for the rings: holding the pad in the air, slide onto the amber dot"
(`phone-first-landing-results.png`). The guided landing is 5.6–5.8 m from the mark every time, and nothing the player does
changes that. The operator's focus (1) names "skill that shows in the score". On the first jump today, the score is the
same whatever the player does.

## What
- On one thumb (Show and Wall), the guide's air step after "Let it roll" teaches the thing the pad says: hold and slide
  onto the dot (≤ 5 words, the pad's own vocabulary, e.g. "Hold · slide to the dot"). It comes up when the AIM sight
  appears and a slide can still move the touchdown (above `THUMB.aimFloor` plus its fade), and it goes when the thumb
  holds and slides, or the car is below the floor. `src/guide.js` (a step whose due/done read the aim state) and
  `src/main.js` guideCue (fill it). No sim or scorer change.
- Keys and a pad: measure whether their "Hold Shift / Hold B to land" ever shows under Assist's auto-land. If it doesn't,
  give them the equivalent (their aim input) in the same PR, or say in the PR why not.
- Price it first (LESSONS 2026-11-11, "Price a new trick against the scorer"): in Node, fly the guided thumb with and
  without the slide the hint asks for, and read every category of the card, not only PRECISION.

## Acceptance criteria
- [ ] Reaction sweep on the guided Show, one thumb, 390×844 (presses timed from each hint's appearance plus 0.15, 0.3,
      0.5, 0.8 and 1.2 s; the probe in `docs/critique/2026-11-14-0955/` is the model): the air aim hint shows on
      **10/10** thumbs, on screen for **≥ 1.0 s** before touchdown. Today: 0/10. Same on the Wall.
- [ ] A thumb that obeys it (holds and slides onto the sight's dot) lands **≤ 2.0 m** from the mark on ≥ 8 of 10 sweep
      points, against 5.6–5.8 m for a thumb that ignores it today, and its total is **≥** the ignoring thumb's.
- [ ] A thumb that ignores the hint still lands Stuck it on 10/10 (today 86.3–86.7). `node scripts/human-show.mjs 300
      assist --cues=new` ≥ 95 % landed; `naive-players` 32/32; `naive-show` 54/54; `ref-hash` unchanged.
- [ ] `tests/unit/guide.test.js`: the step sequence for a reference one-thumb log now includes the aim step, and `land`
      does not count as taught when auto-land took it. `tests/e2e/first-jump.spec.js` asserts the aim hint appears.
- [ ] HUD audit with the hint up at 390×844 and 844×390: no overlap with the pad, the AIM sight or the descent tape,
      ≥ 11 px, 4.5:1.
- [ ] The PR names the funnel number it should move: `players` → `first_landing` → second run (retry/next) rate.

## Test plan
Unit: guide steps on a recorded one-thumb flight with auto-land engaging before the roll-out. e2e: first-jump.spec's
scripted thumb sees the aim hint and, sliding as told, lands nearer the mark than the hands-off run in the same test.

## Out of scope
Auto-land's timing and the slide's law (0164, 0190); the sheet's NEXT RUN wording (0261); the Lineup (the computer
rolls and lands it on one thumb by design, 0181).
