---
id: 0373
title: A first visit's title offers "Watch the jump first" under Jump, so a newcomer sees what a perfect run is before they are asked to hold a thumb
status: proposed
priority: P2
size: S
lens: engagement
created: 2026-11-26
pr:
by: scout
---

## Why
Played as a first-time visitor at 390×844 touch (`coldgas_howto=new`): the title is clear and quiet (wordmark, three
courses, one white Jump, "More ways to play", the Daily folded to its header), and the only other action in view is the
small "How to play" link in the fine print. Everything that shows what the game *is* (the reference jump, `?play=reveal`)
sits one tap deeper under "More ways to play" (src/main.js `syncFirstTitle`, 0247/0264). A visitor who does not already
know the reveal gets a countdown and a car idling at 0 mph with "HOLD TO GO". Funnel (14 days, `human`): 16 `visit-new`,
6 `title-left` (2 of them `left-booting`, only 2 `title-back`), 11 `run-quit` against 52 `run`. The 20 s reference is the
cheapest way to show what to aim at: the roll, the landing, and the scorecard the player is chasing.
Funnel number to move: `title-left` per `visit-new` (down) and `run-quit` per `run` for new visitors (down).

## What
- `src/main.js` `syncFirstTitle` / the title markup: while `:root[data-first-title]` holds (this device has not landed a
  Jump), a text-weight secondary button "Watch the jump first" sits directly under Jump (a 44 px target, hairline, no
  second white pill). It opens the existing `?play=reveal` flow (same code path as the one under More). It disappears
  once a Jump has landed, as the rest of the first-title treatment does.
- No new network call, no new obs event (the existing `title-left` reasons and `run` counters are the measure), no
  change to the sim.
- After the reveal's scorecard, the existing way back to the title and Jump is unchanged.

## Acceptance criteria
- [ ] `coldgas_howto=new`, no landed Jump, 390×844 touch: the button is visible without scrolling and ≥ 44 px, below Jump,
      and does not displace or restyle Jump (the CTA stays the only filled control).
- [ ] Tapping it plays the reference jump and shows its scorecard; Back/Home returns to the title.
- [ ] A device with a landed Jump, or a challenge card on the title, shows today's title unchanged.
- [ ] `npm run audit` (title audit) clean at every viewport in AGENTS.md §3.8; keyboard reachable (Tab order: Jump, then it).
- [ ] No ad slot or analytics event is added; the reveal still counts as it does today.

## Test plan
e2e (`tests/e2e/`, beside the first-title test): new-visitor title shows the button; tapping reaches the scorecard;
after landing a Jump the button is gone. The title audit covers the layout.

## Out of scope
Autoplaying a video behind the title, changing the reveal itself, a how-to rewrite (0366 covers the run-up button words).
