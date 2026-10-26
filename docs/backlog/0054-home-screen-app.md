---
id: 0054
title: Add to Home Screen runs full screen like an app on iPhone, iPad and Android
status: ready
priority: P1
size: S
lens: content
created: 2026-10-21
pr:
by: operator
---

## Why
GROOMED 2026-10-26: the manifest, icons, apple meta tags and install e2e shipped in #102 (0081). What is still open is the focus half: no
`inert`/trap code exists in src/ui.js or src/main.js, so Tab leaves an open pause sheet or controls dialog.

iPhone has no Fullscreen API, so the address bar and toolbar eat the game; Add to Home Screen is the only
full-screen path and there's no manifest or `apple-mobile-web-app-capable`. Pause and controls dialogs
are `aria-modal` but don't move or trap focus (ui.js ~61).

## What
Focus moves into and is trapped inside open dialogs (pause, controls, results, board), and returns to the opener on
close. (Manifest and apple meta: done in #102, do not touch.)

## Acceptance criteria
- [ ] Tab stays inside the pause sheet
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: open the pause sheet, press Tab 20 times, focus never leaves it; Escape closes it and focus returns to its opener.

## Out of scope
A service worker / offline play; any manifest change.
