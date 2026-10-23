---
id: 0085
title: Forced-colors and prefers-contrast: more keep every control and HUD reading visible
status: proposed
priority: P2
size: M
lens: accessibility
created: 2026-10-23
pr:
by: scout
---

## Why
The accessibility floor (AGENTS.md § 3.8) measures 4.5:1 on our own palette, but the page has no
`forced-colors` or `prefers-contrast` rules (grep of `src/` and `index.html` finds none). The hairline pills
and glass panels rely on faint borders and translucent fills; under Windows High Contrast or "Increase
contrast" those can vanish or lose their edges, and a player cannot find the Jump button.
References: WCAG 2.2 SC 1.4.11 Non-text Contrast (https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html);
MDN `forced-colors` (https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors).

## What
- `src/styles.css` (and the HUD, results, pause and theatre sheets it owns): under `@media (forced-colors: active)`
  give buttons, pills, inputs and panels a real `1px solid CanvasText` border and `ButtonText`/`Canvas`
  colours, and keep focus rings visible (`outline: 2px solid Highlight`).
- Under `@media (prefers-contrast: more)` raise hairline borders and secondary text (the dim metric values,
  the fine print) to at least 7:1.
- The red/amber state colours on the HUD keep meaning state; in forced colours state also reads in text
  (the cue line already says it; add the band word where only colour carries it).

## Acceptance criteria
- [ ] Playwright with `forcedColors: 'active'` at 390x844 and 1280x720: every `button`, `a`, `input` on the
      title, HUD, results and pause sheet has a non-transparent border or outline (asserted by a test).
- [ ] With `contrast: 'more'`, hud-audit reports ≥ 7:1 on the fine print and dim values, and no overlaps.
- [ ] hud-audit and title-audit stay clean in the default mode; no flicker.mjs region rises.
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse.

## Test plan
New `tests/e2e/forced-colors.spec.js` (emulated media), plus one hud-audit pass with `contrast: 'more'`.

## Out of scope
A light theme; recolouring the 3D scene.
