---
id: 0070
title: The countdown numeral is never half-hidden behind the telemetry panel
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr: 196
by: scout
---

## Why
Scout play-through at 390x844: during the countdown the big "2" sits at the bottom edge of the telemetry table
(SPD / ALT / G / N2 / PITCH / FAN), its upper half behind the panel, so the one number the player waits on reads as a
smudge. On 820x1180 the one-thumb hint ("HOLD THE PAD TO CLIMB") is clear, so the numeral's position is a phone-only
collision. The audits miss it because the numeral is a canvas/overlay element that appears for a second.

## What
Place the countdown numeral in the centre of the free space below the telemetry panel and above the thumb pad, from
measured rects (CSS custom properties or a measure-on-show step in src/ui.js), at 320 / 390 / 430 / 768 and both
orientations. Hold the numeral still across ticks (no layout shift when it changes).

## Acceptance criteria
- [x] During the countdown, the numeral's rect intersects no HUD, top-bar, panel or touch-pad rect at every viewport hud-audit covers
- [x] hud-audit samples a countdown frame (it currently flies the Show past it) and fails on overlap
- [x] No flicker.mjs region rises; reduced motion unchanged
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
hud-audit: add a countdown capture and the overlap check; unit test for the placement helper if one is added.

## Out of scope
Restyling the numeral or adding sound.
