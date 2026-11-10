---
id: 0185
title: The phone HUD's "01 RUN-UP" phase label clears the hairline under it
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-11-10
pr:
by: scout
---

## Why
Scout play at 390x844 (`?play=jump`, first-time flag): the mission-clock card's second line, "01 RUN-UP", sits
flush on the card's hairline (about 3 css px between the glyph bottoms and the rule), so the label reads as
clipped against the SPEED row. It is the first thing a newcomer reads in the HUD. Pillar 4: every pixel intentional.
Verify first: open the run at 2x device scale and zoom; if the glyphs have breathing room (>= 5 px) drop this ticket.

## What
`src/styles.css` (the HUD clock card): give the phase line a bottom padding so its descent clears the rule by at
least 6 css px at 390x844, without growing the card past the existing `coverCeiling` (audit-plan.mjs).

## Acceptance criteria
- [ ] At 390x844 the gap between the phase label's box and the rule is >= 6 px in all four phases' label lengths.
- [ ] `npm run audit` (hud-audit + hud-cover) stays green; HUD cover does not rise.
- [ ] 1280x720 layout unchanged.

## Test plan
hud-fit.spec.js: assert the phase line's bottom edge to the next row's top edge at 390x844.

## Out of scope
Any other HUD restyle.
