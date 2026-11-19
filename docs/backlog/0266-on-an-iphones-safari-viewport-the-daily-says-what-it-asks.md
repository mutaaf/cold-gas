---
id: 0266
title: On an iPhone's Safari viewport, the title's Daily says what it asks, not "Clear t…"
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-16
pr:
by: critic
---

## Why
The focus's item 2 is "reasons to come back: the daily jump". The Daily is only a reason if a player can read what it
asks. On production (`index-Cdh5aH_j.js` = main `d7f37bb`), the title's Daily objective reads **"Clear t…"** on the
viewport a real iPhone gives a page in Safari.
- **Playwright's `iPhone 13` profile (390×664 CSS, Safari's toolbars subtracted, DPR 3), returning player:** `.title` has
  `data-extra-fit="1"`. `.xc-goal` is `scrollWidth` **420** vs `clientWidth` **186**, so 7 characters of "Clear the roofs
  by under 4.9 ft and land clean" show (`docs/critique/2026-11-16-1600/daily-seen-iphone13.jpg`). It's the same on a
  first visit (`phone-first-reveal-title.jpg`), at 3 s and at 12 s after load.
- **430×932 touch, returning:** also cut, 420 vs 222 (`daily-seen-430t.jpg`).
- **390×844 touch and 1440×900:** whole (`daily-new-390t.jpg`).
- **No ad frame was placed in any of these.** It's the title's own fit, not the banner. The fit's level 1
  (`src/comeback.js` `fit()`, `src/comeback.css:50`) packs the card to one `nowrap` + `ellipsis` line. That line
  keeps the "DAILY · THE SHOW" kicker and the "Play today's" button and cuts the objective, which is the one thing the
  card is for.

0142 (by: critic, shipped) set the bar "the Daily's `.xc-goal` has `scrollWidth <= clientWidth`" with the frame forced
to 90 px at 390×844. It didn't measure the shorter viewport Safari actually hands an iPhone. A Daily whose ask
can't be read is a gold button that says "play something".

## What
At fit level 1, the packed Daily keeps its objective readable. Pick whichever measures best:
- let `.xc-goal` wrap to two lines;
- or drop the kicker's course name (the selected tab already says it);
- or step aside something lower in value first (the controls/assist/learn strip, or "More ways to play") before the
  goal is cut.

`src/comeback.js` (`fit()` levels) and `src/comeback.css`. No sim, scorer or Daily change.

## Acceptance criteria
- [ ] At 390×664 touch DPR 3 (`devices['iPhone 13']`), 393×659 touch (an iPhone 15 Pro's Safari viewport), 430×932 touch
      and 390×844 touch, first visit and returning: the Daily's `.xc-goal` has `scrollWidth <= clientWidth` and no
      `text-overflow` cut, for the longest objective `src/daily.js` can emit (assert over every objective the generator
      yields across 30 consecutive days).
- [ ] Jump stays fully on screen at every size above, and `scripts/title-audit.mjs` passes (nothing under the top bar,
      nothing past the bottom).
- [ ] 0142's boxes still hold: a filled 90 px frame steps aside first, an unfilled frame moves nothing, and in light mode
      the frame paints no slab.
- [ ] 0264's first-visit title (if shipped first) is respected. If the first visit collapses the Daily, this applies to
      every visit after it.
- [ ] Before and after screenshots at 390×664 in the PR.
- [ ] Funnel number to move: `daily-run` per `visit-return` (today 7 / 2 all-time, so too few to read yet).

## Test plan
An e2e in `tests/e2e/` (beside the title-fit tests) that loads the title at each size above, with the clock pinned to
days whose objective is the longest. It asserts `.xc-goal` isn't cut and Jump's rect is inside the viewport.

## Out of scope
- The Daily's objectives themselves (src/daily.js).
- The ad frame's policy (0142, 0262).
- The first-visit hierarchy (0264).
