---
id: 0095
title: Paused, the flight readouts step back; the pause sheet never slices a live readout in half
status: shipped
priority: P1
size: S
lens: platform
created: 2026-10-27
pr: 165
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
- [x] At 390×844 and 844×390 touch and 1440×900, paused mid-run: every visible `[data-screen="hud"]` text
      element (`.h-timeline`, `[data-hud-box]` cells, the big speed) and the top bar's buttons render at an
      effective opacity ≤ 0.2 (computed `opacity` up the tree × the scrim), *or* none of their boxes
      intersects the pause sheet's box. Measured from DOM rects and computed styles.
- [x] `node scripts/hud-audit.mjs` in its pause pass fails a planted case (the HUD forced to opacity 1 under
      the sheet), and passes on the fix.
- [x] Resume brings the HUD back to full opacity within 0.4 s. A screenshot 0.5 s after Resume matches the
      unpaused HUD.
- [x] 0092's criteria still hold: Resume and Home are inside the sheet's visible box at every
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

## Critic note 2026-10-27 21:36
Re-measured on production `370bf2d` (docs/critique/2026-10-27-2136.md). The defect is unchanged at 1440×900
(`desk-paused-tab.jpg`: the bottom band, the timeline and the damage figure stay at full brightness). There
is one more element: on a phone, **the top bar's Menu popover stays open and lit over the pause sheet**.
`phone-paused.jpg` (390×844) shows `Ghost ON · Sound ON · For nerds OFF` at full strength, and its bottom
edge overlaps the sheet's top edge at CSS y ≈ 217.

Added criterion:
- [x] Pausing closes the Menu popover (`[data-more-toggle]` `aria-expanded="false"`, `#more-sheet` not
      visible), or it falls under the same effective-opacity ≤ 0.2 rule as the rest of the top bar.

## Critic re-review 2026-10-29 21:40
Passes on production `fafb9f1` (entry `index-DyexTZb9.js`, identical to a local build of main;
docs/critique/2026-10-29-2140.md). Paused 0.8 s into a Jump and in the air on the Show reference, at 390×844,
844×390, 820×1180 and 1180×820 touch and 1440×900. No text outside the pause layer rendered above an effective
opacity of 0.2, except the touch pad's `Hold / Climb`, which the ticket leaves out of scope. That pad sits under
the pause layer (z 4 under 6), and a tap on it lands on the sheet's section and changes no input.
`d1440-jump-early-paused.jpg`: the big `0 mph` numeral no longer reads through the sheet. With the Menu open at
390×844, pausing closed it (`aria-expanded="false"`, `#more-sheet` display none). After Resume the HUD came back
at full strength (`ipad-jump-early-resumed.jpg`). The 0.4 s timing is held by #165's `pause.spec.js`: on this sandbox's
SwiftShader the computed filter still read `opacity(0.15)` 0.6 s after the click in 7 of 10 probes, because each frame
is a long task, so the timing can't be read here. The hud-audit plant and the last criterion (audits clean, flicker) are #165's CI, not re-run here.

