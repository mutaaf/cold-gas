---
id: 0248
title: The first jump is taught by playing it, one hint at a time, and the first landing is celebrated with nothing in its way
status: ready
priority: P0
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 brief: a skippable guided first jump, taught through play (launch, a hint at takeoff, the flip, an assisted landing
that's achievable, then the payoff), no text walls or passive demos, and a first landing that is celebrated, not
interrupted. The web has the parts: one-thumb Assist (src/onethumb.js), the AIM sight (src/thumb-aim.js), live pointers for
the first five runs (src/adapt.js NEW_PLAYER_RUNS), the landing beat (src/beat.js, 0199) and the calm sheet. But the
teaching is a card before the run (the how-to; 0172 and 0197 polish it), and the beat is the same for the first landing as
the fiftieth.

## What
**Note for the builder:** another agent is redoing the native UI (ios/ColdGas/UI/; 0230, PR #368); this is the web's ticket
and doesn't wait for it. 0249 mirrors it on the iPhone with the same beats and words.
Depends on: 0247 (the first run starts without the card), 0245 (events).
- **A first-jump guide**, e.g. `src/guide.js` (pure: phase + inputs → which hint, when it's done), drawn by the HUD, on the
  first run only and only on one-thumb touch, keyboard and pad (each in its own words, src/pointer.js):
  1. On the mark: the pad breathes, "Hold to go" (absorbs 0144's nudge).
  2. On the climb: "Keep holding" until the ledge; at the ledge "Tap to let go".
  3. In the air: "Let it roll" while the flight computer rolls it; the AIM sight appears.
  4. Coming down: "Hold to land" with the touchdown ring.
  Each hint is one line, appears only when that input is due, and goes the moment it's done. No sentence over 5 words, no
  card, no pause of the sim. A "Skip" chip on the first hint ends the guide for good.
- **Achievable:** the guide uses the Assist flight computer's existing help (auto-land, LAND roll-out, the line hold, the
  carry over the row); no sim or scorer change. Measure with `node scripts/human-show.mjs 300 assist --cues=new`: players
  who follow the guide land ≥ 95 % (the existing gate).
- **The payoff, on the first landing:** beat.js gets a first-landing variant: a "First landing" headline, the score
  counting up, a short crowd/sting in src/audio.js, `navigator.vibrate` where haptics are on, and confetti-free restraint
  (dust and the crowd line, Wreck Club's look). After it, the calm sheet with Next jump and Retry first (0257's order).
  Nothing else on that screen: no Post form, no ad (the interstitial already skips a session's first run; keep it so), no
  modal, no prompt.
- **A wreck on the first jump** shows one line ("Hold sooner to land") and Retry as the one button; the guide runs again on
  the next attempt from the beat that was missed.
- The how-to card stays reachable from the title (Learn) for anyone who wants it; it no longer gates a first run.
- Events: `first_landing` (0245).

## Acceptance criteria
- [ ] Unit (`tests/unit/guide.test.js`): the guide's hint sequence for a reference one-thumb log, for keys and for a pad;
      Skip ends it; a returning player never sees it.
- [ ] e2e (fresh context, 390×844 touch, scripted thumb): each hint appears at its beat and clears on the input; a landed
      first jump shows the first-landing beat, then the calm sheet with Next jump and Retry and no Post form or ad.
- [ ] `node scripts/human-show.mjs 300 assist --cues=new` ≥ 95 % landed; `node scripts/naive-players.mjs` 32/32.
- [ ] HUD audit passes with the hints at every viewport (no overlap, ≥ 11 px, 4.5:1); reduced motion honoured.

## Test plan
The unit test above; `tests/e2e/first-run.spec.js` (shared with 0247) extended with the guide and the first-landing beat;
the human-show gate.

## Out of scope
Licenses (0255). Any sim change. The iPhone (0249).
