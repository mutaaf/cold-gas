---
id: 0151
title: On a laptop screen the title's wordmark never sits on the course pills, and the Daily keeps its streak
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-04
pr:
by: critic
---

## Why
The focus's second item is reasons to come back, and the title's Daily card with its streak is that reason. The
0142 builder found that the desktop title already packs with no ad at all (0142's Builder note). I measured it
on production with no frame placed (`.title[data-ad-room="none"]`), `index-D8QPCiaL.js`:

| viewport | fit level | wordmark bottom → course pills top | streak row | tagline |
|---|---|---|---|---|
| 1440×900 | 2 | **0 px** (388 → 388) | hidden | hidden |
| 1536×864 | 2 | **0 px** | hidden | hidden |
| 1366×768 | 2 | **0 px** | hidden | hidden |
| 1280×720 | 2 | **0 px** | hidden | hidden |
| 1920×1080 | 1 | 80 px | hidden | shown |

These are the five most common laptop and desktop sizes. On every one of them the streak (the "come back
tomorrow" reason) is hidden. On four of them the wordmark's "GAS" stands right on the pills' top edge
(`docs/critique/2026-11-04-2204/title-1440x900-light.jpg`), and "COLD GAS" loses its eyebrow and tagline. The
390×844 phone and the 1024×1366 iPad fit at level 0 with room to spare (`title-390x844-light.jpg`,
`title-1024x1366-light.jpg`), so the desktop layout is spending its height badly. It isn't short of height: at
1440×900 the panel ends at y ≈ 820 with the wordmark ≈ 190 px tall.

## What
`src/styles.css` (the `.title` desktop layout and the wordmark's size), `src/comeback.js` (`fit()`), and
`src/comeback.css`. Options for the Builder to measure:
- Size the wordmark by the viewport's height as well as its width on landscape screens. Fit steps should shrink
  type before they hide content.
- Put the Daily card where the landscape title has room (beside the specs, or a second column), rather than
  under everything.
- Whatever the route, keep 0142's rule: the ad frame steps aside before anything of ours.

## Acceptance criteria
- [ ] At 1280×720, 1366×768, 1440×900, 1536×864 and 1920×1080 (no ad: `data-ad-room="none"` or the frame stubbed
      out), `.title[data-extra-fit]` is unset or `1`.
- [ ] At every one of those sizes, `.xc-streak` is shown and the wordmark's bottom sits **≥ 16 px** above the
      course pills' top (DOM rects).
- [ ] 390×844, 844×390, 430×932 and 1024×1366 are no worse than today: same or lower fit level, and no new
      overlap in `scripts/title-audit.mjs`.
- [ ] `scripts/title-audit.mjs` and its contrast checks stay green. 0139's 390×844 `data-extra-fit` assertion
      keeps passing.

## Test plan
- Add the five desktop sizes to the title audit's viewport list (or to a new e2e spec of its own, one boot per
  size, no run: LESSONS 2026-11-04), asserting fit ≤ 1, the streak shown, and the gap ≥ 16 px.

## Out of scope
- The ad frame's own placement rules (0142).
- The upright-iPad title's frame cost (LESSONS 2026-11-03).
