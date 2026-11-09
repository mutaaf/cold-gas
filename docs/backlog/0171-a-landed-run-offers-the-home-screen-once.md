---
id: 0171
title: After a second landed run the results offer "Add to Home Screen" once, quietly
status: proposed
priority: P1
size: M
lens: engagement
created: 2026-11-09
pr:
by: scout
---

## Why
Players' funnel (digest, 2026-11-01…06): 7 human visits in six days, one run-landed day, and nothing that brings a
visitor back: the game is installable (0054, 0081 shipped the manifest and icons) but nothing ever says so, and iOS
Safari never prompts. An icon on the home screen is the cheapest honest reason to return and it costs the player one
tap. Design: Web.dev's install guidance recommends offering install from a user gesture after the person has seen
value, never on load (https://web.dev/articles/promote-install). Never a dark pattern: once, dismissible, no nagging.
Funnel number to move: `visit-return` (and `run` per returning visitor).

## What
- `src/install-hint.js` (new, pure decision + tiny DOM): after the player's 2nd landed run in this browser, show one
  quiet line under the results' Retry row. Chromium (a captured `beforeinstallprompt`): button "Install" calls
  `prompt()`. iOS Safari (not standalone): text "Share → Add to Home Screen". Already standalone
  (`display-mode: standalone` or `navigator.standalone`) or already dismissed/shown: nothing.
- Remember it in localStorage `coldgas_install_hint` ('shown' | 'dismissed' | 'installed'); never again after any of those.
- Never on the title, in a run, a drill or Free Drive. Never delays Retry, the judges or the board.
- Count `install-hint-shown`, `install-tap` in the obs funnel (PLAY_EVENTS in src/obs/signature.js; the Worker already
  stores unknown-free counts only for known events, so add the names to the shared list in the same PR and check
  `src/worker/obs.js` accepts them without a change; if it needs a Worker change, drop the counters and note it).

## Acceptance criteria
- [ ] No hint after one landed run or after any wreck; the hint appears after the second landed run, once.
- [ ] Dismissed or shown once, it is never drawn again (localStorage); standalone mode never sees it.
- [ ] No new hosts, no third-party script; the hint has a keyboard path and a ≥ 44 px target; `hud-audit` clean at 390×844 and 320 px.
- [ ] Works at 390×844 touch and 1280×720 keyboard (desktop Chromium shows Install, Safari-desktop shows nothing).

## Test plan
Unit: the decision function over (landedRuns, standalone, stored flag, platform). e2e: fire a synthetic
`beforeinstallprompt`, finish two landed runs (the existing e2e helpers), assert the line once and not on a third.

## Out of scope
A service worker (on purpose none), push notifications, any "come back" copy, ads.
