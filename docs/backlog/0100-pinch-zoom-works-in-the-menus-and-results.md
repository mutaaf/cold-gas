---
id: 0100
title: Pinch-zoom works in the menus, sheets and results; only the road and the sticks keep touch-action none
status: proposed
priority: P2
size: S
lens: accessibility
created: 2026-10-28
pr:
by: scout
---

## Why
`index.html` ships `viewport ... user-scalable=no` and `body { touch-action: none }` (src/styles.css:29), so on
Android Chrome and any browser that honours it a low-vision player cannot pinch-zoom the settings, how-to, results or
the judges' text. Practitioner rules fail this under WCAG 1.4.4 Resize Text (AA); the same markup also has no
`maximum-scale`. Sources: https://www.accesslint.com/core/docs/rules/distinguishable/meta-viewport/ and
https://getwcag.com/en/accessibility-guide/meta-viewport. (No official technique number: the W3C failure draft was never
published, see https://lists.w3.org/Archives/Public/public-wcag2-techs/2016Oct/0001.html.) The game surface must keep
its gestures, so the fix is per surface, not global. 0047 already notes pinch-out is blocked.

## What
Drop `user-scalable=no` from the viewport meta. Keep `touch-action: none` on the canvas, the stick, nozzle pad and
touch layer (already set on `.touch`, `.nozzle-pad`). Give sheets (menu, how-to, results, settings, pause) and the
title `touch-action: manipulation pan-y pinch-zoom` so the browser zooms them while the sim ignores it. Verify that a
pinch on the canvas during a run does not zoom the page and that double-tap-zoom stays off.

## Acceptance criteria
- [ ] Viewport meta has no `user-scalable=no` and no `maximum-scale` under 2
- [ ] A test reads `getComputedStyle(...).touchAction` on the canvas, `.touch` and `.nozzle-pad` (`none`) and on the
      results sheet and menu (`pinch-zoom` allowed)
- [ ] hud-audit and title-audit stay clean at 390x844, 844x390 and 1280x720; no flicker.mjs region rises
- [ ] Inputs stay at least 16 px so iOS does not zoom on focus (0047)

## Test plan
Add a case to an existing e2e spec (keep assertions) for the computed `touch-action` values and the meta content.

## Out of scope
Text-size scaling of the HUD, or a zoom control of our own.
