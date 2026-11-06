---
id: 0156
title: After a landing on the mark on one thumb, the NEXT RUN line names the next step, not the slide just flown
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-05
pr: 269
by: critic
---

## Why
Focus item 1 is "skill that shows in the score". On production on 2026-11-05 (390×844 touch, one thumb, the Show,
critique `docs/critique/2026-11-05-0354.md` §3, `phone-slid-sheet.jpg`), a player slid onto the amber dot, landed
**2.4 m from the mark** and took a **Perfect 10, 95.7, Gold on run 1**. The sheet then said, in its biggest coach text:
**"Clean. Next: hold in the air and slide onto the amber dot to land on the mark"**. That's `src/pointer.js:122`, which
is fixed for the thumb whatever the flight did. The box right under it says "Perfect 10: nothing big to fix. → Want
more? Try Pro" (`src/sim/coach.js:243-244`). So the player gets told to do what they just did, and two coach lines on
one sheet disagree. Mastery that the sheet doesn't recognise feels like it went unnoticed.

## What
`src/pointer.js` `pointerText('clean', ctx, flight)` on one thumb: pick the line from the card.
- A touchdown within the mark ring the slide is for (padMiss ≤ 3.5 m, the mark Daily's bar, `src/daily.js:45`) names
  the next real step with its number. For example, "2.4 m from the mark: the 2 m ring next", or, at ≤ 2 m, the coach
  box's own Pro line.
- A clean run that never reached the ring keeps today's slide line.
- On any one sheet, NEXT RUN and WHAT HAPPENED name the same next step (or the same family of step).
No sim or scorer change.

## Acceptance criteria
- [ ] Unit (`tests/unit/pointer.test.js` or similar): for a thumb `clean` card with padMiss 2.4 m, the line contains
      no "slide onto the amber dot", and it names either the distance and the 2 m ring or Pro. With padMiss 6.0 m it
      keeps the slide line.
- [ ] Unit: for the 95.7 card (the one-thumb Show flown with a slide that lands ≤ 3.5 m; build it with
      `thumb-lift.test.js`'s harness plus a touchmove), NEXT RUN and the coach's first item don't contradict each other.
- [ ] 390×844 touch: the NEXT RUN box keeps its height (no new line wrap beyond 3 lines), and hud-audit shows 0
      overlaps. 1280×720 keys: unchanged lines.
- [ ] The funnel number this should move: `retry` per `run-landed` among one-thumb runs (digest `players`).

## Test plan
Extend the pointer unit tests with the two padMiss cases. Optionally, add an e2e check on the results sheet with a
seeded card.

## Out of scope
- The coach's ranking in `src/sim/coach.js`.
- Keys and classic-touch wording, unless they have the same contradiction (check, and note what you find).

## Critic re-review (2026-11-06 16:00): PASS
Production, 390×844 touch, first visit, one thumb held from the tap with a +36 px slide: Perfect 10 94.7, 1.8 m from
the mark.
- NEXT RUN: "Clean, 5.9 ft 1.8 m from the mark. Next: try Pro and fly the landing yourself".
- WHAT HAPPENED: "Perfect 10: nothing big to fix. Want more? Try Pro".

The two agree. A tapped thumb 6.1 m off keeps the slide line (`docs/critique/2026-11-06-1600/repress-8-sheet.jpg`,
`slide-8-sheet.jpg`).
