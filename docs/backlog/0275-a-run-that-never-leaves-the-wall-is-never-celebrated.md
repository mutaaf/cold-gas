---
id: 0275
title: A run that never leaves the wall is never celebrated as a "first mark"
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-17
pr:
by: critic
---

## Why
`src/ui.js:419` says it outright: "A crash or a wreck is never celebrated (no 'first mark', no 'new best')". A run that
never jumps slips past that rule, because the neutral branch only runs when `facts.crashed` is set (`src/ui.js:430`).

Measured on production (`index-DKHuk_UU.js`, main `d69816c`), 390×844 touch, first visit, Show, Assist, no input:
- The card is **11.7, "No climb"**, with `facts.jumped = false`, `crashed = false` and `damagePct = 0`.
- The header reads "TOTAL FAILURE ON THE SHOW" (returning sheet) or "FAILURE TO LEAVE THE WALL" (calm sheet). The coach
  says "Stopped on the climb · You stopped before the Wall".
- Under More, the run line still carries the gradient pill **"YOUR FIRST MARK ON THIS EVENT"** (`data-state="first"`).
  Evidence: `docs/critique/2026-11-17-2140/phone-noclimb-post.png` and `phone-crash-results.png`.

A car that stopped on the climb hasn't made a mark. Praising it is exactly the false note 0204 removed for wrecks: the
sheet says "failure" and celebrates in the same view. The neutral line for this case already exists
("No jump · not a mark yet", `src/ui.js:432`). It just never shows, because a stall isn't a crash.

Players: the operator's focus (1) is the core loop on a phone, and the first run is where a newcomer most often stops on
the climb. This should move `run → second run` honesty, not a count. Nothing in the sim or the score changes.

## What
In `ui.runline` (`src/ui.js`), a card whose run didn't jump (`!facts.jumped`, covering No climb, fell off the wall, and
stopped on the ledge) takes the neutral state like a crash: `data-state="neutral"`, with the text "No jump · not a mark yet".
That holds whether or not there's a stored best. A non-jump below the best keeps today's "Best x · −y to beat it"
line, as a crash does. Check that the local best isn't raised by a non-jump either: if `best == null`, an 11.7 stall must not
become the best that the next landed run is measured against ("New best +85.6" after a stall would be the same false
note).

## Acceptance criteria
- [ ] The probe above (Show, no input, first visit, 390×844 touch): the run line reads "No jump · not a mark yet" and
      `[data-runline]` has `data-state="neutral"`. No gradient pill. Same at 1280×720 keys.
- [ ] A landed first run still reads "Your first mark on this event" (`data-state="first"`), and a crash still reads
      "Crashed · not a mark yet". Existing tests stay unchanged.
- [ ] After a stall and then a landed run on a fresh device, the landed run reads "Your first mark on this event", not
      "New best +x" measured from the stall.
- [ ] No sim, scorer or reference-hash change (`ref-hash`: show 3501 · 97.3 · `6b2cb98b`).

## Test plan
Add a unit or e2e case next to the 0204 wreck test: fly the Show with no input via `liveStep` and assert the runline's
state and text. Then fly the autopilot reference as the player's next run and assert it reads "first".

## Out of scope
The judges' lines and the coach's copy. Post is already hidden for this run (measured: no visible Post button), so this
ticket doesn't touch it.
