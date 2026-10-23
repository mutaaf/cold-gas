---
id: 0086
title: The title scene reads blue-hour, with one signal red, on every tier
status: proposed
priority: P2
size: M
lens: player-feel
created: 2026-10-23
pr:
by: scout
---

## Why
The vision (AGENTS.md § 1) is blue-hour light, matte concrete and a single signal red. The scout's
SwiftShader captures of the title at 390x844 and 1280x720 show the whole frame washed in red: the searchlight
bloom and the Wall's LED ring spill red over the sky, the truss and the concrete, so the first impression is
a red scene, and the white body text sits on that glow (it is why 0069 keeps finding low-contrast footer
copy). Keynote restraint means the red is a small, exact accent. This ticket is a look pass, not a feature.
It must be checked on a real GPU capture as well as software GL before it lands, since the bloom differs.

## What
- `src/render/scene.js` / `src/render/wall.js`: cap the LED ring's emissive spill and the bloom strength on
  the title camera so red covers a small share of pixels and the sky stays blue-black.
- Keep the Wall's ring as the one red object; searchlights go cool white.
- No sim, no layout, no copy change.

## Acceptance criteria
- [ ] A new title-colour check on the title screenshot at 1280x720 and 390x844: pixels whose hue is red and
      saturation > 0.5 are under 12 % of the frame (today's capture is far above).
- [ ] title-audit and hud-audit stay clean; `flicker.mjs` regions do not rise (bloom changes can pop).
- [ ] `?gfx=low|mid|high` all pass the check.
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse.

## Test plan
Add the colour-share measure to `scripts/title-audit.mjs` output (report-only first), with a unit test of the
measure on a synthetic image; attach before/after screenshots to the PR.

## Out of scope
Changing the Wall's ring geometry, the in-run lighting, or the vehicles' paint.
