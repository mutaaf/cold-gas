---
id: 0071
title: A WebKit device sweep in CI (iPhone, iPad, desktop)
status: proposed
priority: P0
size: M
lens: tech-health
created: 2026-10-22
pr:
by: operator
---

## Why
Split out of 0050, whose flicker gate shipped. Every iOS browser is WebKit, and nothing boots the game
on WebKit or at an iPad viewport. CI installs only Chromium (`npx playwright install --with-deps
chromium` in `.github/workflows/ci.yml`), and that file is a frozen path, so an agent can't add the
WebKit project on its own: it needs the operator. Proposed until the operator adds WebKit to CI's
install step (and, with #84, decides which shard runs it).

## What
- `.github/workflows/ci.yml` (operator): `npx playwright install --with-deps chromium webkit`.
- `playwright.config.js`: a `webkit` project that runs only `tests/e2e/devices.spec.js` (tag `@webkit`).
- `tests/e2e/devices.spec.js`: iPhone SE, iPhone 15, iPhone landscape, iPad mini, iPad Pro 12.9 (Mac
  UA + touch), desktop: boot with zero console errors, no horizontal overflow, start a Show, rotate,
  return; the canvas tracks the viewport.

## Acceptance criteria
- [ ] devices.spec passes on WebKit and Chromium locally and in CI, adding under 3 min to the suite
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
devices.spec itself, on both engines.

## Out of scope
The flicker probe on WebKit (`scripts/flicker.mjs --engine=webkit` already runs; it needs a budget label).
