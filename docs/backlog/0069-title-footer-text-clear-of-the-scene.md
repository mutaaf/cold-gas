---
id: 0069
title: The title's fine print, controls row and spec strip stay legible over the 3D scene
status: ready
priority: P1
size: S
lens: accessibility
created: 2026-10-22
pr:
by: scout
---

## Why
Scout play-through (headless, `?gfx=low`): at 390x844 the fine print ("Inspired by the October 2026 roadster
reveal...") draws straight over the roadster's wheels and the red plume glow; at 820x1180 the CONTROLS row and the
SUCTION / POWER labels of the spec strip sit across the parked vehicles and the roadster body. The text is 11-12 px
hairline type on a bright, moving background, so the 4.5:1 floor (invariant 3.8) is not met on those pixels, and the
legal line is the one line that must stay readable. W3C F83 says the test is the lightest region behind light text:
https://www.w3.org/WAI/WCAG22/Techniques/failures/F83. `title-audit.mjs` checks overlaps and the CTA but not
contrast of title text against the rendered scene.

Scout 2026-10-26 (desktop 1280x720, `?gfx=low`): the tertiary link "Today's board" also sits across the bright arc of the Wall's
ring, so its grey text loses contrast there too; include the whole controls row in the backing.

## What
Give the title's lower block (controls row, spec strip, fine print) a backing: a bottom gradient scrim in CSS
(transparent to ~0.72 ink, no new colours) that sits above the canvas and below the text, or lift the scene's
framing on tall/short viewports so the car clears the block. CSS and, if needed, the title camera in
`src/render/director.js`; no sim change.

## Acceptance criteria
- [ ] `scripts/title-audit.mjs` also samples the screenshot behind every title text node (as hud-audit does) and
      fails under 4.5:1 for text under 24 px; passes at all audited viewports including the iPads and 320 px
- [ ] The fine print and spec strip never sit on the plume glow at 390x844 and 820x1180
- [ ] hud-audit and title-audit clean; no flicker.mjs region rises
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Extend title-audit with the contrast sampler (shared helper with hud-audit); run it at every viewport.

## Out of scope
Redesigning the title layout or copy.

## Scout re-check (2026-10-23, 1440×900, SwiftShader)
Still reproduces on `main` (39ae0db): "Today's board" (the ghost button, no glass) is white-on-white where the red
ring's bloom passes behind it, and the spec strip's "THRUSTERS" label vanishes against the lit fog. Both are
legible only by luck of the camera angle, so the fix must be a backing (glass or scrim), not a colour nudge.

Scout 2026-10-28 (390x844, `?gfx=low`): still reproduces, and the AI ASSIST pill's second line ("rolls you out, levels and
brakes") also runs across the roadster's wheel and body, so include it in the backing. At 844x390 the fine print sits
clear of the car but over the Wall's ring glow.

Critic 2026-10-29 (production 7c617be, 820×1180 touch, `?gfx=low`, docs/critique/2026-10-29-0411.md,
`ipad-0-title.jpg`): still reproduces on the iPad held upright. `SUCTION 10,341 lbf 46 kN` runs across the
roadster's flank and wheels, `POWER 1,341 hp` across the parked Sedan's windscreen, the fine print is cut by the
red plume beam, and the top-left `COLD GAS` wordmark has the Wall ring's pink edge through its last letter. Add the
wordmark to the sampler's node list. The bar is the same as above: ≥ 4.5:1 against the lightest pixels behind each
text node, at 820×1180 as well as 390×844.
