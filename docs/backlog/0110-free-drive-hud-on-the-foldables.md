---
id: 0110
title: Free Drive's HUD fits the foldables - the closed fold sideways, the flip's cover screen and its tall screen sideways
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-28
pr: 153
by: operator
---

## Why
Part of the operator's foldables suite (0102: "Free Drive's HUD" on every screen state). 0103–0107 fitted the
Show, the Wall, the Lineup, the theatre, the pause sheet, the results and the replay at the foldables' sizes,
but the HUD audit flies Free Drive only at `scripts/audit-plan.mjs` DRIVE (phones, iPads, desktops), so its
HUD was never measured there. Measured on main (`3cf2be2` with 0107, after 0109's AI DRIVE pill), with DRIVE extended
locally to the foldables (`node scripts/hud-audit.mjs <url> <dir> 594x368,669x871,951x589,360x380,424x360,800x300,360x748 drive compact`):
88 frames, **12 overlaps, 2 offscreen**:
- 594×368 (the fold closed and turned, left inset 84): BRAKE (0103's slot column, B under A) on `.fd-stats`;
  `.fd-stats` past the right edge (it is centred between 250 px and 150 px in from the edges: 594 − 84 leaves
  it no room).
- 360×380 (a flip's cover screen upright): the cue line on the stick and GO; the stick's STEER label on the
  AI DRIVE pill; LIFT on the chips (`.fd-ctl`) and on `.fd-stats`.
- 424×360 (a razr's cover): the cue line on two buttons; a button on `.fd-speed` and `.fd-stats`;
  `.fd-stats` offscreen.
- 800×300 (a flip's tall screen sideways with Chrome's bars): the cue line on a button; a button on `.fd-stats`.
Clean: 669×871, 951×589, 360×748.

## What
- `src/drive/drive.css`, by size (as 0103/0104 did for the Show): sideways under 720 px and under 330 px
  tall, the stats, the chips, the AI pill and the cue line keep clear of the stick and the slots' column;
  upright under 440 px tall the same. Keep every chip and the AI pill a 44 px target.
- `scripts/audit-plan.mjs` DRIVE: add 594x368, 360x380, 424x360 and 800x300 (≈ +4 × 30 s of Free Drive per
  CI shard plan; re-check the shard balance test).

## Acceptance criteria
- [x] The HUD audit, Free Drive frames at 594×368, 360×380, 424×360, 800×300: 0 overlaps, 0 offscreen, 0 text < 11 px, 0 labels < 4.5:1.
- [x] Those four sizes in DRIVE; `npm run audit` green on CI's six shards.
- [x] Works at 390×844 touch and 1280×720 keyboard (unchanged).

## Test plan
The HUD audit (it flies Free Drive at every DRIVE size); `tests/unit/audit-plan.test.js` / `foldables.test.js`
for the plan; screenshots in docs/shots/0110/.

## Out of scope
Free Drive in Flex Mode (the canvas already takes the top segment there, 0105; its HUD was not re-measured).
