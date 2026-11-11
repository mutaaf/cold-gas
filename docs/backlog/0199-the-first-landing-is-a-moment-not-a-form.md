---
id: 0199
title: The first landing is a moment, not a form
status: in-progress
priority: P1
size: M
lens: player-feel
created: 2026-11-11
pr:
by: operator
---

## Why
The owner asked for "the first run is magic". Since 11-01 the funnel shows 10 human sessions, 12 runs and 3 landings,
and nothing celebrates the landings that do happen. On a phone (docs/critique/2026-11-11-2136/S-follow-results.png on
the critic's branch) the car touches down, and 1.4 s after it rests a dense sheet covers the whole screen. It holds the
headline and score, a medal row, RUN 1 and "your first mark", a receipt line ("Judged by <model id> 618 → 81 tok
$0.000086"), NEXT RUN, ASSIST ON, WHAT HAPPENED, the judges, initials and Post, then Retry, Home, Replay and Share. The
landing a newcomer just earned reads like a form. Pillar 1 asks for a landing you can feel in the sound, and pillar 4
asks for motion with an ease and a reason. A newcomer should get one clear moment, then one clear next step: Retry.

## What
1. **The beat** (src/beat.js, index.html, src/styles.css, src/main.js, src/audio.js). On a landed run of the player's
   own (not a wreck, not a drill, not the reference), from the frame its card is decided until the sheet: about 2.4 s
   over the live scene. The verdict word and the score count up big in the game's type (Michroma and Geist, a hairline,
   one signal-red tick). Then the three judges' numbers land one by one, like scorecards going up, each with the
   panel's chime. There's one soft settle tone (src/audio.js `settle`) and a short haptic (touch-settings `buzz`, where
   `navigator.vibrate` exists). A tap (after a short guard, so a thumb still on the pad doesn't skip it), Enter or
   Space skips straight to the sheet. Reduced motion shows the final numbers at once and holds for about 1.2 s. The
   numbers are `S.card` from closeCard: the beat computes nothing. It's driven by the live step's clock, so pause holds
   it and `fastForward` steps through it. A wreck, a drill and the reference keep today's flow.
2. **A calmer sheet for a player's first runs** (`S.flown` ≤ 3: runs ever finished on this device; src/ui.js,
   index.html, src/styles.css). The sheet leads with the verdict, the score, the medal and the NEXT RUN line, and Retry
   is the big action. Everything else is one tap away under "More": the run line, the tier, the call strip (model,
   tokens, cost), Assist, WHAT HAPPENED, the judges and their words, the receipt, the categories, the facts, and Post.
   A player with their own AI key still sees the call strip. Rookie and Adapt offers stay on the calm sheet. Nothing is
   removed. After a beat, the sheet opens on the final score (no second count) and doesn't repeat the chimes.
3. An automated browser counts as a returning player (as the how-to card does) unless `coldgas_howto = 'new'` is set
   at boot, so the agents' first-visitor pass sees the calm sheet and the rest of the suite sees the full one.

## Acceptance criteria
- [ ] A landed jump shows the beat (verdict, score equal to `S.card.total`, three judges' scores equal to `S.card.judges`) before `S.mode === 'results'`; a wreck, a drill and the reference go straight to the sheet as before
- [ ] A tap on the beat opens the sheet at once; with prefers-reduced-motion the score is final on the first frame of the beat
- [ ] For a first-time visitor's first run the sheet shows verdict, score, medals, NEXT RUN and Retry; the judges, the coach, the call strip and Post are hidden until "More" is tapped, and are all there after it
- [ ] Returning players' sheet is unchanged
- [ ] Works at 390×844 touch and 1280×720 keyboard (screenshots looked at); the audits pass
- [ ] No per-frame allocations beyond the beat's own DOM-on-change text; no sim file touched; ref-hash unchanged

## Test plan
tests/e2e/first-landing.spec.js: a first-visit phone run flown by the reference autopilot as the player (a landed run)
shows the beat with the card's numbers. A tap skips it. The calm sheet hides the judges and Post until More. A
returning player gets the full sheet. A wreck skips the beat. Reduced motion shows the final score at once. Unit:
tests/unit/beat.test.js for the beat's timeline (eligibility, count-up, judge reveal times, reduced motion).

## Out of scope
The judges' theatre on a wide screen (it still opens beside the sheet). The receipt line on a returning player's sheet.
The flight computer (0190/0194) and the run-up's look (0193). Any change to a score.
