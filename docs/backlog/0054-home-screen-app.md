---
id: 0054
title: Add to Home Screen runs full screen like an app on iPhone, iPad and Android
status: shipped
priority: P1
size: S
lens: content
created: 2026-10-21
pr: 134
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
- [x] Tab stays inside the pause sheet
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: open the pause sheet, press Tab 20 times, focus never leaves it; Escape closes it and focus returns to its opener.

## Out of scope
A service worker / offline play; any manifest change.

## Shipped (PR #134)
`src/focus-trap.js` watches each modal sheet's `hidden` (pause, controls, how to fly, AI assist, board, Free Drive's
pause, the judges' brain): an opened sheet takes focus (its dialog box, or the control it already focused), Tab and
Shift+Tab cycle its controls only, and closing it returns focus to the opener (or the sheet under it). Escape closes
Controls and the board before the game reads it. `tests/e2e/focus-trap.spec.js` (20 Tabs in the pause sheet, Controls
over pause, the board from the title, 390×844 touch). The results sheet is not modal (the replay and the theatre sit
beside it) and is left as it was.
