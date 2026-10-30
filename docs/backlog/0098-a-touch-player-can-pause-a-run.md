---
id: 0098
title: A touch player can pause a run without leaving the game
status: shipped
priority: P1
size: S
lens: platform
created: 2026-10-27
pr: 169
by: critic
---

## Why
A keyboard pauses with Escape or P, and a pad pauses with Start. A phone or tablet has no way to pause a
run except leaving the app. Measured on production `370bf2d`, 2026-10-27 (docs/critique/2026-10-27-2136.md),
390×844 touch, mid-air in the Show reference:

- The visible buttons are exactly `Home (H)`, `Retry (R)`, `Menu` and `Show all instruments (I)`, listed
  from the DOM. Menu holds Ghost, Sound and For nerds (`phone-menu-open-air.jpg`), and tapping it leaves
  `S.paused === false`.
- The only touch pause path is `visibilitychange` (src/main.js:1592), which is a call or an app switch.
  0054's own phone e2e has to fake a hidden tab to reach the sheet (tests/e2e/focus-trap.spec.js:114).
- So 0092's touch pause sheet ("DRIVE & CLIMB hold the pad …", `phone-paused.jpg`) is unreachable on
  purpose. Meanwhile a thumb that lands on the top bar mid-flight finds Retry and Home, which throw the
  run away with no confirm.

The lockdown asks for "input on every device" and "lifecycle (pause/background/return)". Every mobile game
puts pause one tap away. This one makes you leave it.

## What
- A pause control in the run's top bar on touch (and on mouse, since it costs nothing). It should be a
  labelled icon button, `aria-label="Pause (P)"`, with the same 44 × 44 CSS px target as Home and Retry. It
  calls the existing `pause()` (src/main.js:1165), and it is hidden outside a run (title, results, replay).
- In Free Drive it pauses `fd()` the same way, through the same `pause()`.
- Placement must keep 0063's and 0061's measures. It must not cover more of the car's projected box than
  the top bar does today, so take a slot in the existing bar (it can replace Menu's place in the row, with
  Menu folding into the sheet), not a new floating button.
- index.html (the button), src/main.js (wire it, show/hide by mode), src/styles.css.

## Acceptance criteria
- [x] At 390×844, 844×390, 820×1180 and 1180×820 touch, in countdown and live (ground and air): exactly one
      visible `[aria-label^="Pause"]` button, with a box ≥ 44 × 44 CSS px fully inside the viewport and the
      safe area. A tap pauses (`S.paused === true`, `[data-screen="pause"]` visible). A tap on Resume
      resumes.
- [x] Hidden (`getClientRects().length === 0`) on the title, the results and the replay.
- [x] At 1280×720 mouse, clicking it pauses, and it keeps no focus afterwards, as src/input.js wants for a
      mouse click. Escape and P still toggle.
- [x] The Show reference paused mid-air with the button still scores 94.0, sink 0.817 m/s (determinism).
- [ ] 0063's in-frame measure is not worse: the car's centre is in the top 15 % in no more air frames than
      before at 390×844 (12 of 41 on `7866072`).
- [ ] hud-audit and title-audit clean, and no flicker.mjs region rises.

## Test plan
Replace the faked `visibilitychange` in tests/e2e/focus-trap.spec.js's 390×844 case with a tap on the
Pause button. Add to tests/e2e/pause.spec.js: at each touch viewport above, start a run, assert the
button's box, tap it, assert paused, tap Resume, assert live. On the title and results, assert it's hidden.

## Out of scope
A confirm on Retry and Home mid-run (worth a look, but separate). The pause sheet's own layout (0092) and
the HUD under it (0095).

## Critic re-review 2026-10-30 09:45
Passes on production `d87f057` (entry `index-D0wnJqDo.js`, identical to a local build of main;
docs/critique/2026-10-30-0945.md). On the Show reference at 390×844, 844×390, 820×1180, 1180×820 and the flip's
360×748 inner screen, touch: exactly one visible `[aria-label^="Pause"]`, 44×44 CSS px at y 16, inside the
viewport, in the countdown and in the air. A real touch tap paused (`S.paused` true, the sheet shown), a tap on
Resume resumed, and the run still scored 94.0 with a 0.8175 m/s touchdown at all five. No visible Pause on the title
or the results (the replay and live-on-the-ground cases were not probed separately here; #169's `pause.spec.js` holds them). At 1280×720 mouse, a click paused, focus went into the sheet's dialog, and after Resume
`document.activeElement` was `BODY`; P paused and Escape resumed. The 0063 in-frame count and the audits/flicker
are #169's CI (main run 41008155007 green), not re-run here.

