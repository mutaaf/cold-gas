---
id: 0033
title: The HUD audit passes at every phone, iPad and desktop viewport, with safe-area insets
status: shipped
priority: P0
size: M
lens: accessibility
created: 2026-10-21
pr: 77
by: operator
---

## Why
Invariant 8 is failing on main today. Lockdown sweep 2026-10-21 (`node scripts/hud-audit.mjs` against a
production build of bbcb526): 65 frames, **18 overlaps, 49 texts under 11 px, 50 labels under 4.5:1**.
- `.top-actions` × `[data-hud-box=mission]` at 844×390, 932×430 and 1024×768: the phase timeline and
  "01 RUN-UP" sit under Home and Retry (141×10 px overlap, 188×10 with notch insets).
- On the Lineup in landscape, the attitude dial sits under LIFT (69×45 px).
- Desktop keyboard hint caps (`.quick kbd`, "H" / "R") are 9 px at 1280×720 and 1920×1080; contrast 4.39.
- 720×1280 brake frame: a label at 2.29:1.
- Portrait iPhone (393×659, WebKit): the "HOLD THE PAD TO CLIMB" cue overlaps the CLIMB pad.
- iPad title (768×1024, 1024×1366): `.spec dt` labels are 10 px.
- iPad Slide Over (320 px): the stick overlaps BRAKE by 60×64 px and the top buttons run off screen.
The audits never ran an iPad viewport or a notch inset, so none of this was caught.

## What
- `src/styles.css` / `index.html`: hide the AI and tier chips during runs on `(pointer:coarse) and
  (orientation:landscape)`, move the landscape mission block below the top bar, relocate the dial off
  the LIFT slot, lift the `.quick kbd` caps to ≥ 11 px and ≥ 4.5:1, `.spec dt` ≥ 11 px, keep the cue
  clear of the one-thumb pad, a 320 px layout for Slide Over.
- `scripts/hud-audit.mjs` and `scripts/title-audit.mjs`: add 320×568, 814×380, 820×1180, 1180×820,
  1024×1366, 1366×1024, and a pass with simulated safe-area insets (`--safe-*` on `:root`, 47 px
  notch side in landscape, 34 px home indicator).

## Acceptance criteria
- [x] `hud-audit` reports 0 overlaps, 0 texts < 11 px and 0 labels < 4.5:1 at every viewport, inset pass included (except a run at 320×568, split to 0055)
- [x] `title-audit` reports 0 issues at every viewport including the iPad ones
- [x] Screenshots at 390×844, 844×390, 820×1180 and 1280×720 attached to the PR and looked at
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Extend both audit scripts as above. Add an e2e in `tests/e2e/` that boots 844×390 touch, starts the
Show and asserts the mission block and `.top-actions` rects don't intersect.

## Out of scope
Moving the telemetry strip off the car on portrait phones (0026).

## Shipped (2026-10-22, Builder)
`hud-audit` (Show + Free Drive) is clean at every phone (390×844, 430×932, 844×390, 932×430,
814×380), every iPad (768×1024, 1024×768, 820×1180, 1180×820, 1024×1366, 1366×1024), every desktop
and the notch-inset pass. `title-audit` is clean at all 16 viewports, 320×568 and the insets
included. The one exception is a *run* at 320×568 (Slide Over), which needs a compact touch layout of
its own; that, and the short-portrait iPhone case (393×659), moved to 0055. The audit's default set
keeps 320×568 in it, so it stays visible until 0055 lands.
