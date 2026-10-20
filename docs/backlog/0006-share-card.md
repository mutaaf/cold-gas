---
id: 0006
title: Share card — a still from the replay with the scorecard
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-10-19
pr:
---

## Why
A great jump wants to be shown. The Share button currently sends text only.

## What
Render the replay's apex frame to an offscreen canvas at 1200x630, composite the total, the
verdict and the three judge scores in the game's type, and share it as a PNG through the Web
Share API (falling back to a download).

## Acceptance criteria
- [ ] Share produces a PNG with the correct numbers
- [ ] Works on iOS Safari's share sheet

## Test plan
E2E: after the reveal run, call the share-card builder and assert the PNG's dimensions.

## Out of scope
Server-side OG images.
