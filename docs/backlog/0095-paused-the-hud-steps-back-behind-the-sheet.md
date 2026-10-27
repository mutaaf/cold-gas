---
id: 0095
title: Paused, the flight readouts step back; the pause sheet never slices a live readout in half
status: ready
priority: P1
size: S
lens: platform
created: 2026-10-27
pr:
by: critic
---

## Why
0092 made the pause sheet fit, and it does (Resume and Home in view at every viewport measured). But
the sheet still lands on top of a HUD that stays lit, and its edges cut the readouts in half. On
production `c304318`, 2026-10-27 (docs/critique/2026-10-27-1006.md), paused 0.8 s into a live run:

- **390×844 touch** (`phone-P-paused.jpg`): the sheet's top edge (y 217) runs through the compact HUD's
  `N₂ 655 lb` row and its `MORE` row. Above the sheet the whole stack (`T +00:00.5 · 01 RUN-UP · SPD 0 mph ·
  ALT 0.0 ft · G 1.0 g`) is still legible next to the word "Paused".
- **844×390 touch** (`phoneL-P-paused.jpg`): the timeline tab `T +00:00.4 01 RUN-UP` and the
  `SPD / ALT / G / N₂ / MORE` strip read *through* the lower third of the glass, between "ROLL & LAND" and
  "BRAKE". The top bar's Home icon shows through the sheet's top-right corner.
- **1440×900** (`desk-P-paused.jpg`): the sheet's bottom edge cuts the big `0 mph` speed numeral in half, and
  its `SPEED` label reads through the glass under "ANY TIME".

The cause: the HUD (`z-index: 3`) and top bar (`z-index: 5`) sit under the pause layer (`z-index: 6`), which
dims them only to 55 % (`.pause { background: rgba(3, 4, 7, 0.45) }`, src/styles.css:136). The sheet is
86 % glass with a blur (src/styles.css:139), so whatever lies under its edges is half-hidden, not hidden.
A paused game on a console steps the world back. This one stacks two layers of white text, which is
exactly what the lockdown's "layout at every viewport" asks to remove.

## What
- `src/styles.css` (and `src/main.js` only if a body attribute is needed): while `[data-screen="pause"]`
  is up, the flight HUD, the timeline and the top bar step back. One way: `body[data-paused] .hud
  { opacity: ≤ 0.15 }` with the same 0.35 s ease, or a darker pause scrim. Either way, no live readout stays
  legible under or beside the sheet.
- The touch pad can stay as it is (it isn't text in the sheet's box), but it must not read through the sheet.
- No layout change to the sheet itself (0092's fit holds).

## Acceptance criteria
- [ ] At 390×844 and 844×390 touch and 1440×900, paused mid-run: every visible `[data-screen="hud"]` text
      element (`.h-timeline`, `[data-hud-box]` cells, the big speed) and the top bar's buttons render at an
      effective opacity ≤ 0.2 (computed `opacity` up the tree × the scrim), *or* none of their boxes
      intersects the pause sheet's box. Measured from DOM rects and computed styles.
- [ ] `node scripts/hud-audit.mjs` in its pause pass fails a planted case (the HUD forced to opacity 1 under
      the sheet), and passes on the fix.
- [ ] Resume brings the HUD back to full opacity within 0.4 s. A screenshot 0.5 s after Resume matches the
      unpaused HUD.
- [ ] 0092's criteria still hold: Resume and Home are inside the sheet's visible box at every
      `scripts/audit-plan.mjs` viewport.
- [ ] Works at 390×844 touch and 1280×720 keyboard/mouse. hud-audit and title-audit clean, and no
      flicker.mjs region rises.

## Test plan
Extend `tests/e2e/pause.spec.js`: at 390×844 and 844×390 touch and 1440×900, pause, then assert the
effective opacity of the timeline, the HUD cells and the top bar ≤ 0.2. Resume, wait 500 ms, and assert ≥ 0.95.
Add the opacity check to hud-audit's pause pass, with a `--plant=pause-hud-lit` plant that must fail.

## Out of scope
The Free Drive pause sheet (`[data-drive-pause]`), unless it shares the rule. The theatre and the results
screens.
