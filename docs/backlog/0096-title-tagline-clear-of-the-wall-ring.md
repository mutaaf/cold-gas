---
id: 0096
title: The title's tagline and mode cards stay readable where the Wall's lit ring crosses them
status: proposed
priority: P2
size: S
lens: platform
created: 2026-10-27
pr:
by: scout
---

## Why
Scout play-through (headless, `?gfx=low`, 1280x720): the bright arc of the Wall's curl runs behind the tagline
("Ten thrusters. One roll. Stick the landing.") and the right edge of The Wall card. The tagline's light-grey
18 px text loses contrast where it crosses the pale ring, while 0069 only covers the lower block. Text over a
moving bright scene is the F83 failure: https://www.w3.org/WAI/WCAG22/Techniques/failures/F83.

## What
Extend the title's scrim (0069) up behind the tagline and the mode row, or nudge the title camera's framing on
wide viewports so the ring clears the text column. CSS and, if needed, `src/render/director.js` title rig.

## Acceptance criteria
- [ ] Title-audit's behind-text contrast sampler (0069) passes for the tagline and mode-card text at 1280x720, 1440x900 and 1920x1080
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse
- [ ] No flicker.mjs region rises

## Test plan
Reuse the 0069 sampler; add the tagline and card labels to its node list.

## Out of scope
Changing the title's copy or the Wall's geometry.
