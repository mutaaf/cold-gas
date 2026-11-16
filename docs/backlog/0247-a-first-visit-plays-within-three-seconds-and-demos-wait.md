---
id: 0247
title: A first-time visitor is flying within about three seconds, and the reference demo is a second choice
status: shipped
priority: P0
size: M
lens: engagement
created: 2026-11-13
pr: 372
by: operator
---

## Why
Phase 2 brief: "first-time players sometimes land in the demo show instead of playing". On the web the title doesn't loop a
demo, but a newcomer still reaches a passive one: a `?play=reveal` link (the launcher and other inbound links use it) drops
them straight into the autopilot's reference run (src/main.js:2089, :429, touch controls hidden), and "Watch the reference"
sits beside Jump on the title (index.html:91). A newcomer who does tap Jump meets the how-to card first ("Got it · Jump"),
then a 3 s READY/GO: two taps and about 3 s after load before the car answers (audit, docs/proposals/phase-2-growth.md §2).

## What
**Note for the builder:** another agent is redoing the native UI (ios/ColdGas/UI/: title, results, HUD; 0230, PR #368).
This ticket is the web's and doesn't wait for it; 0249 is the iPhone's.
Depends on: 0245 (`first_input`, to prove it).
- **First run = no landed Jump on this device yet** (from `coldgas_flown` / 0254's store when it exists; `coldgas_howto` stays
  for the how-to only).
- **One tap to fly.** On a first run the title's primary CTA (Jump · The Show) starts the run directly: no how-to card in
  front of it (0248 teaches inside the run instead). The countdown on a first run is one short beat (GO), not READY/GO's 3 s.
  The title folds Watch the reference, Practice, Board and the settings strip under "More ways to play" (absorbs 0196).
- **A demo link is a taste, then your turn.** `?play=reveal` on a first run plays the reference up to the release (a few
  seconds), then cuts to "Your turn" and starts the player's own first jump from the mark with the controls showing. For a
  returning player `?play=reveal` is exactly today's. The deep link keeps working (AGENTS.md §4 table, §7 launcher policy).
- "Watch the reference" stays one tap away for everyone; it never autoplays.
- The physics load is warmed while the title shows (it is today: 0043); a first tap before it is ready shows the car rolling
  the moment it is, never a dead tap.

## Acceptance criteria
- [x] e2e (fresh context, 390×844 touch): from load, one tap on the CTA starts a run, and the car answers a touch within 3 s
      of the title being wired on a production build (`first_input`'s `ms_since_load` in the stub); no how-to card.
- [x] e2e: `?play=reveal` on a fresh context hands control to the player after the release; with a landed jump stored it is
      today's full reference run.
- [x] e2e: with a landed jump stored, the title and the CTA are exactly today's.
- [x] `npm run audit` (title + HUD) passes in both states; works at 390×844 touch and 1280×720 keyboard.

## Test plan
`tests/e2e/first-run.spec.js` (fresh vs returning contexts, `?play=reveal` both ways); the title audit on both states.
After shipping: `visit-new → run` (obs) and `first_input` p50 in PostHog over a week.

## Out of scope
The guided jump itself (0248). The iPhone (0249). Removing the reference run.
