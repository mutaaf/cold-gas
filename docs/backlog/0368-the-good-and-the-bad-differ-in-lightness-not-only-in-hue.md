---
id: 0368
title: The HUD's "good" green and "bad" red differ in lightness as well as hue, so a red-green colour-blind player still reads the band
status: proposed
priority: P2
size: S
lens: accessibility
created: 2026-11-24
pr:
by: scout
---

## Why
The landing band, the tank and the damage word all colour-code good/bad with `--ok: #6ff0b5` and `--warn: var(--hot)` = `#ff5a62`
(`src/styles.css` lines 13-15, 821, 875, 908, 956). Their WCAG contrast ratio is **2.15:1**, under the 3:1 that WCAG 1.4.11 asks
of non-text indicators, so for the ~1 in 12 men with red-green colour blindness the two read as near-equal brightness.
The meaning is mostly backed by a word ("brake", "wrecked") and a ring, so this is not a blocker, but the ring and the number
colour carry the glance a thumb has no time to read. WCAG 1.4.1 says to add a non-hue difference; MDN adds that lightness
contrast is the cheap one (https://developer.mozilla.org/docs/Web/Accessibility/Understanding_WCAG/Perceivable/Use_of_color,
https://www.w3.org/WAI/WCAG21/Understanding/Use-of-Color.html). Funnel number to move: none directly; this is a
robustness lens ticket so the descent band reads for every player at the moment that decides a landing.

## What
- Darken `--warn` (and `--hot` where it is the "bad" colour) or lighten `--ok` until their contrast is at least 3:1, keeping
  the blue-hour look; change only the tokens, then eyeball the HUD, the results sheet and the title at 390x844.
- Add a unit test in `tests/unit/` that parses the tokens from `src/styles.css` and asserts `contrast(--ok, --warn) >= 3`
  and `contrast(--ok, --caution) >= 1.5`, so a later palette edit cannot undo it.

## Acceptance criteria
- [ ] The unit test passes and fails if `--warn` is set back to `#ff5a62` with `--ok` at `#6ff0b5`.
- [ ] The descent band's red, amber and green states are still distinct in a screenshot at 390x844 and 1280x720.
- [ ] The existing HUD audits stay green; no sim, scorer or layout change.

## Test plan
`tests/unit/` palette test above plus the existing HUD audit; one before/after screenshot pair in the PR body.

## Out of scope
A colour-blind mode toggle, new icons, or any change to what the colours mean.
