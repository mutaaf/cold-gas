---
id: 0092
title: On a landscape phone the pause sheet shows Resume; a touch player isn't handed a keyboard map
status: shipped
priority: P1
size: S
lens: platform
created: 2026-10-26
pr: 126
by: critic
---

## Why
The lockdown asks for layout at every viewport and input on every device, and 0060 made pausing
quiet. But the sheet a phone player sees when they pause is built for a keyboard on a desktop. Measured
on production `38a345f` and a local build of the same commit, 2026-10-26
(docs/critique/2026-10-26-1558.md), paused in a live run, touch emulation at DPR 2. "Hidden" counts the
sheet's buttons that are not fully inside the sheet's visible box without scrolling:

| Viewport | Sheet height | Content height | Buttons not in view |
|---|---|---|---|
| 390×844, 430×932, 768×1024, 1024×768, 1280×720, 1440×900 | 496 | 496 | none |
| 932×430 | 380 | 428 | How to fly, Home |
| 320×568 | 518 | 646 | How to fly, Home |
| **844×390** | 340 | 428 | **all five, Resume included** |
| **667×375** | 325 | 428 | **all five** |
| **568×320** | 270 | 428 | **all five** |

- `pause-568x320.jpg`: the whole sheet is the four key lists. No button is drawn at all. The sheet scrolls
  (`.sheet { overflow-y: auto }`, src/styles.css:137), but nothing tells you so.
- `phoneL-5a-paused.jpg` (844×390): Resume, Restart and Controls are cut off by the sheet's bottom edge;
  How to fly and Home are below it.
- On every touch viewport, 70 % of the sheet is keyboard shortcuts ("↑ throttle · Space lift · Shift
  boost · Q E Z C the down-jets …", index.html:396–401). A phone has none of those keys. src/pointer.js
  already knows the device's own controls (0079) and the sheet doesn't use it.
- The "Advanced" label runs into its text with no gap: `ADVANCEDQ E Z C` (`pause-390x844.jpg`,
  `phoneL-5b-paused-rotated.jpg`) at every width.
- No audit opens the pause sheet: `hud-audit` freezes the sim but never shows `[data-screen="pause"]`, and
  `title-audit` stops at the title. So the gate passes this.

A landscape phone is how many people hold a game, and the pause sheet is where they go when the phone
rings. Today they get a keyboard map and no visible way back.

## What
- `index.html` / `src/main.js` / `src/styles.css`: the actions come first (or stay pinned at the sheet's
  foot), so Resume is always visible; the key lists follow and scroll.
- On a touch device the sheet shows the touch controls for the current scheme (one-thumb or classic) from
  `src/pointer.js`, or none, with Controls one tap away; keyboard and pad keep their own lines.
- A gap between each `<b>` label and its text (the grid column or a margin), so no label touches its text.
- `scripts/hud-audit.mjs`: open the pause sheet at every audit viewport and run the existing overlap,
  offscreen, text-size and contrast checks on it.

## Acceptance criteria
- [ ] At every viewport in `scripts/audit-plan.mjs` (phones both ways, the iPads both ways, 320 px, the
      desktops, the notch inset), the pause sheet's Resume and Home buttons sit fully inside the sheet's
      visible box and the viewport with the sheet scrolled to the top. Measured by bounding boxes.
- [ ] At 390×844 and 844×390 with touch, the sheet contains no keyboard-only key name (Shift, Space, Q E,
      W S A D, V B N M); at 1280×720 with a keyboard the key lists are still there.
- [ ] No label overlaps its text: the bounding box of each `.keys b` ends ≥ 4 px before its text starts,
      at 320, 390 and 1440 wide.
- [ ] `npm run audit` opens the pause sheet and stays clean; a sheet with Resume pushed off screen (a
      planted 600 px spacer) fails it.
- [ ] Works at 390×844 touch and 1280×720 keyboard/mouse.
- [ ] hud-audit and title-audit clean; no flicker.mjs region rises (no rendering change expected).

## Test plan
e2e (`tests/e2e/pause.spec.js` or the 0060 spec): at 844×390 and 568×320 touch, pause a live run and
assert the Resume box is inside the viewport and tapping it resumes (`S.paused === false`); at 390×844
touch, assert the sheet text has no "Shift"/"Space"; at 1280×720, assert it does. The audit change is
its own gate.

## Out of scope
The Free Drive pause sheet (`[data-drive-pause]`) has the same keyboard lists; fix it the same way only
if it's the same component, otherwise a follow-up. The focus trap is 0054.
