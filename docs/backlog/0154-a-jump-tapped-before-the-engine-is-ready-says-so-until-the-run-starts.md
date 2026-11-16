---
id: 0154
title: A Jump tapped before the engine is ready keeps saying "Starting…" until the run begins
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-05
pr:
by: scout
---

## Why
Players' funnel (digest `players`, human sessions, 2026-11-01..04): 6 `visit-new`, 9 `run`; on 3 of 4 days with a
visit there is no `run` at all. 0053's measurements say a Jump tapped at "usable" on a Slow 4G phone starts the run
only at about 19 s, while `whenPhysics` (`src/main.js` ~120) shows `ui.cue_('Loading physics', 1200)`, a cue that
disappears after 1.2 s. For the remaining ~10+ s the title looks exactly as it did before the tap: a first-time
visitor reads "nothing happened" and leaves, or taps again (the token logic keeps the start single, but the screen
never says it is working). The run does start by itself; the player just cannot tell. This is feedback, not a nag:
one state on the button the player pressed, and it ends the moment the run starts.

## What
In `src/main.js` `whenPhysics` (and the Jump button's markup in `src/ui.js` / `src/styles.css`): when a start is
deferred because `physicsReady()` is false, put the pressed Jump button into a `pending` state (label
"Starting…", a slow indeterminate bar or a dimmed arrow, `aria-busy="true"`, `aria-live="polite"` text) and
clear it when the token fires, is cancelled (`cancelPendingStart`, any mode change) or the load fails (then the
existing "couldn't load" cue stays, and the button returns to "Jump"). The 1.2 s cue is kept. Reduced motion:
a static "Starting…" label, no moving bar. No new network call, host, id or storage key.

## Acceptance criteria
- [ ] With the engine held back (e2e route delay on the WASM), tapping Jump shows "Starting…" on the button within 100 ms and it is still there 5 s later
- [ ] The run starts by itself once the engine arrives and the button is back to "Jump" for the next visit to the title
- [ ] Cancelling (Menu, another mode, Back) clears it; a failed load restores "Jump" and shows the existing error cue
- [ ] Several taps still start one run; with a ready engine nothing changes (no flash of "Starting…")
- [ ] 390×844 touch and 1280×720 keyboard: the button does not change width or shift the Daily card; hud-audit has 0 overlaps

## Test plan
e2e (touch 390×844): delay the Rapier WASM by 6 s, tap Jump, assert the pending state at +0.2 s and +5 s, then the
run starting and the state cleared; a second case taps Menu while pending and asserts it clears. Unit: none needed.

## Out of scope
Making the engine load faster (0053), a progress percentage, any copy beyond one word, sound.
