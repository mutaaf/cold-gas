---
id: 0112
title: The scene reads first - the HUD's footprint on phones and the foldables, and the installed app edge to edge
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-28
pr: 153
by: operator
---

## Why
The operator, 2026-10-28, on the simulated book fold in Safari and installed to the home screen: "ok the HUD is
still in the way and rendering as a PWA should use more". 0103–0107 and the HUD audit check that the instruments
don't overlap each other or leave the glass, never how much of the scene they take. Measured on main (`48a9353`)
with a new probe (`node scripts/hud-cover.mjs <url> <dir> cover thumb,classic`: the Show's run-up and the reference
in the air with both touch schemes, Free Drive rolling; 15 sizes):
- **Shade.** Compact on a touch screen every instrument stands on its own glass, but the HUD's two gradient scrims
  still darkened 51 % of a phone upright, 90 % of one sideways and 93–100 % of the fold closed and turned or a flip's
  tall screen turned. On 844×390 the car in the air was a dark shape in a dark band.
- **The car under the cue line.** Sideways and short (678×445 installed, 594×368, 424×360, 800×300) the car on the
  ground sat under the cue line and the phase tab at the start of a run: 64–100 % of its screen box covered.
- **Free Drive** (0110): 12 overlaps and 2 offscreen at 594×368, 360×380, 424×360, 800×300; the full set at 466×657
  (installed, closed upright) filled the screen down to the thumbs with the cue line on them; the AI switch carried a
  two-line sentence on every phone. Chrome covered 31 % of 390×844 and 58 % of a flip's cover screen.
- **Installed.** The canvas was `100vw × 100dvh`, a second answer to "how tall is the window" beside innerHeight
  (which the director, the replay's region and the HUD use), and WebKit computes it apart in an installed app; and the
  installed poses measured on the fold are 21 px short of their glass (466×657 and 678×445 on a 466×678 screen; the
  open ones the same 21 px), so anything past innerHeight showed the page's black.

## What
- `src/styles.css`, compact on a touch screen: the scrims go (a 28 px shade under the status bar stays); the wordmark is
  put away mid-run (its place kept); sideways under 460 px tall the cue line rides at the top on the ground (the car is
  low) and comes back down in the air.
- `src/drive/drive.css`, compact on a touch screen: shades only where text stands bare; the AI switch is one line (its
  sentence while offered and in the full set); layouts for upright under 440 px tall (360×380), sideways under 720 px
  wide (594×368, 678×445, 424×360) and sideways under 320 px tall (800×300).
- `src/hud-mode.js`: driving, an upright touch screen under 700 px tall shows the compact line (the full set has no room).
- The canvas is 100 % of the window's box; installed (`:root[data-installed]` from index.html: display-mode standalone
  or fullscreen, or iOS's navigator.standalone) it bleeds 24 px past the window's bottom.
- `scripts/hud-cover.mjs` (the probe); `scripts/audit-plan.mjs` measureCover + coverCeiling; the HUD audit gates every
  touch frame of a run with the HUD compact at the ceiling (by area: 33 %; 40 % under 300 000 px²; 60 % on a flip's cover screen). DRIVE gains 594×368, 678×445, 466×657,
  360×380, 424×360, 800×300 (0110).

## Acceptance criteria
- [x] The HUD audit: Free Drive at 594×368, 678×445, 466×657, 360×380, 424×360, 800×300 with 0 overlaps, 0 offscreen,
      0 labels < 4.5:1 (0110); `npm run audit` green on CI's six shards with the cover ceiling on.
- [x] Before/after cover, solid and shade per size in the PR (scripts/hud-cover.mjs); the shade on a phone sideways
      under 10 %; the car's box ≤ 25 % covered at every size measured on the Show's run-up.
- [x] Installed (emulated: navigator.standalone), the canvas is the window's width and its height + 24 px and its
      buffer follows at the 'high' tier's ratio; in a tab exactly the window (tests/e2e/install.spec.js).
- [x] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
`npm test` (foldables: the drive's room for the full set), `npm run audit` (cover ceiling, DRIVE sizes), the install
e2e, the flicker budget (--phone). Emulated only: Chromium with forced insets; no WebKit standalone, no device.

## Out of scope
0111 (the results header at 360 px: not the HUD). The full set's own footprint (the player asked for it). Proving the
21 px strip's cause on WebKit: needs the simulator or a device.
