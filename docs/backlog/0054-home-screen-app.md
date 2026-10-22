---
id: 0054
title: Add to Home Screen runs full screen like an app on iPhone, iPad and Android
status: ready
priority: P2
size: S
lens: content
created: 2026-10-21
pr:
by: operator
---

## Why
iPhone has no Fullscreen API, so the address bar and toolbar eat the game; Add to Home Screen is the only
full-screen path and there's no manifest or `apple-mobile-web-app-capable`. Pause and controls dialogs
are `aria-modal` but don't move or trap focus (ui.js ~61).

## What
A same-origin `manifest.webmanifest` under the base path (display: fullscreen, orientation any, our own
icon), apple meta tags and touch icon; focus moves into and is trapped inside open dialogs.

## Acceptance criteria
- [ ] Lighthouse installability passes; no new hosts (smoke test)
- [ ] Tab stays inside the pause sheet
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: manifest served under /coldgas/, focus trap test.

## Out of scope
A service worker / offline play.
