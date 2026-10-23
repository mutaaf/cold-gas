---
id: 0073
title: On a touch screen the top bar says what it does; the icon-only controls fold into one labelled Menu
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr: 97
by: operator
---

## Why
The operator, playing on a phone: "no one knows what the icons on the top right corner mean on mobile".
After Home and Retry (which say what they are), the top bar ends in three icon-only buttons:
`[data-nerds]` (`{·}`, the For nerds engineering readout, `` ` ``), `[data-ghost]` (two circles, the ghost
of your best run, G) and `[data-mute]` (a speaker). On a desktop each has a title tooltip on hover. A
touch screen can't hover, so on a phone they are unlabelled glyphs, and the ghost's only state cue is
its opacity. The Sound button had no title at all, and its `aria-pressed` meant "muted" under the name
"Sound".

## What
- `index.html`: the three buttons move into `.more-sheet` behind one toggle, `[data-more-toggle]`
  (a hamburger glyph with the word **Menu**, `aria-expanded` / `aria-controls`). Each row carries its
  name and what it does (`Ghost` · your best run alongside, `Sound`, `For nerds` · engineering readout)
  and an On / Off word. The rows are the same `[data-ghost]` / `[data-mute]` / `[data-nerds]` elements,
  so every existing hook, key and test keeps working.
- `src/styles.css`: on a fine pointer the toggle is hidden and the sheet is `display: contents`, so the
  bar is the same icon row as before (with title tooltips). Under `(pointer: coarse)` the toggle shows
  (36 px tall to sit level with Home and Retry, a 44 px hit area) and the sheet drops under it: rows
  48 px tall, the state as a word (`ON` filled, `OFF` outlined), not colour alone.
- `src/main.js`: the disclosure. Escape (captured before the game reads it) or a tap outside closes it
  and focus returns to the toggle; focus leaving the sheet closes it; For nerds closes it as its panel
  opens. `[data-mute]`'s `aria-pressed` now means sound on, so the name "Sound" and the word agree.
- No sim change.

## Acceptance criteria
- [x] Touch (390×844, 844×390): the bar shows no unlabelled glyph; one `Menu` button opens a sheet of
      three labelled rows, each ≥ 44 px tall with its state in words; Ghost and Sound toggle in place,
      Escape and an outside tap close it, focus returns to the toggle, For nerds opens its panel.
      (`tests/e2e/top-bar-menu.spec.js`.)
- [x] In a run (touch, both orientations, compact HUD) the toggle sits in Home and Retry's row and the
      top bar overlaps no HUD box; Escape closes the menu without leaving the run.
- [x] The dual-screen phone, folded 382×580 and 678×340, unfolded 669×825 and 951×543 (touch): the bar
      and the open sheet fit inside the screen, rows ≥ 44 px.
- [x] Desktop: the icon row stays in one row, each button with a title; G still toggles the ghost.
- [x] `node scripts/hud-audit.mjs … all`: 0 overlaps, 0 text < 11 px, no new label under 4.5:1.
- [x] `tests/e2e/nerds.spec.js` and `obs.spec.js` still drive `[data-nerds]` unchanged.

## Test plan
`tests/e2e/top-bar-menu.spec.js`: touch 390×844 and 844×390 on the title (menu, labels, states,
toggles, Escape, outside tap, 44 px targets, For nerds) and in a run (row, no overlap, Escape stays in
the run); the four dual-screen sizes (fit); desktop 1280×720 (icon row, titles, G, mute). Plus
nerds, hud, hud-collapse, layout, touch, smoke, overlays and obs specs, and the HUD audit.

## Out of scope
Home and Retry's own 36 px height (already labelled); the AI and tier chips (they carry words).
