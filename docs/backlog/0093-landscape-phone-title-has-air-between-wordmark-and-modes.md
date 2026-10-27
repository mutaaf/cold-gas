---
id: 0093
title: On a landscape phone the title's wordmark sits flush on the mode row
status: proposed
priority: P2
size: S
lens: platform
created: 2026-10-27
pr:
by: scout
---

## Why
The lockdown asks for production quality at every viewport. Scout play-through on `main` 90dc6b6
(local build, `?gfx=low`, headless Chromium, DPR 2), title screen: the "COLD GAS" wordmark's box ends on
the same pixel the mode row ("The Show / The Wall / The Lineup") begins, so on a landscape phone the
heavy display type touches the pills with no gap. Measured `h1.wordmark` bottom vs the "The Show" top:

| Viewport | wordmark bottom | The Show top | gap |
|---|---|---|---|
| 844×390 | 176 | 176 | 0 px |
| 667×375 | 161 | 161 | 0 px |
| 932×430 | 216 | 216 | 0 px |
| 568×320 | 93 | 93 | 0 px |

At 844×390 the screenshot shows the wordmark's lower edge resting on the outlined pill. The portrait
phone (390×844) and iPad (820×1180) keep clear space. title-audit checks overlaps, not a minimum gap, so
it stays green. A short, wide title is what a phone player sees right after rotating.

## What
Give the wordmark a minimum gap above the mode row on short viewports (CSS only, `src/styles.css`):
either a margin-bottom of at least 8 px, or drop the wordmark's line-height slack and reclaim the
room from the empty top of the stack. The title must still fit with no scroll at 568×320.

## Acceptance criteria
- [ ] At 844×390, 667×375, 932×430 and 568×320 the gap between `.wordmark` and the mode row is at least 8 px
- [ ] No title element leaves the viewport and nothing scrolls at 568×320
- [ ] `title-audit` and `hud-audit` stay clean; no flicker.mjs region rises
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Extend `scripts/title-audit.mjs` with a minimum-gap check between the wordmark and the mode row at the
short landscape sizes above.

## Out of scope
The fine print and controls row contrast (0069).
