---
id: 0111
title: The score and the verdict hold their lines on a 360 px phone
status: shipped
priority: P1
size: S
lens: platform
created: 2026-10-28
pr: 173
by: critic
---

## Why
The results header is the payoff of every run: the verdict and the score out of 100. At 360 CSS px wide
it breaks. 360 px is the most common Android width, and it is also the flip phone's cover screen. It was
measured on the build production serves (`ca1c5bb`, docs/critique/2026-10-28-0950.md), at the results of
the Show reference (`fastForward()`, DPR 2, touch):

| Viewport | `.total span` (`/ 100`) client rects | Verdict `Perfect 10` lines |
|---|---|---|
| 320×568 | **2** | **2** |
| 344×882 | **2** | **2** |
| 360×748 | **2** | **2** |
| 360×380 | **2** | **2** |
| 375×667 | 1 | 1 |
| 390×844 | 1 | 1 |

- `docs/critique/2026-10-28-0950/phone360x380-8-results.jpg` (production, 360×380): the right column reads
  `94.0 /` with `100` alone on the next line. The left column reads `Perfect` / `10`.
- At 375 and up, both hold one line.

Cause:
- `.total-row` (`src/styles.css:147`) is a flex row with `justify-content: space-between`. Neither child is
  told not to wrap.
- `.total span` (`/ 100`, `src/styles.css:150`) is an inline span that wraps at its space.
- The verdict (`clamp(22px, 3vw, 30px)` Michroma) takes whatever width is left.
- The longer verdicts in `src/sim/judge.js:152-164` (`Came down on the deck`, `Fell off the wall`,
  `Short of the row`) need more of the row still.

## What
- `src/styles.css`, the results header only. Changing `index.html` is fine if the markup needs it.
- **`/ 100` never breaks from its number.** Use `white-space: nowrap` on `.total`, or make the span not
  wrap. The total keeps its width.
- **The verdict gives way, not the score.** It may wrap onto two lines only when it really is two words
  that don't fit, and it never breaks a short verdict like `Perfect 10` or `Stuck it` at ≥ 320 px. Size it
  down on narrow screens (for example, a `clamp` floor lower than 22 px under 380 px, not under 18 px), or
  put the verdict above the total under a width.
- No change at ≥ 375 px wide or on desktop. The sheet's look is otherwise as it is.

## Acceptance criteria
- [ ] At 320×568, 344×882, 360×748, 360×380, 375×667 and 390×844 (touch, DPR 2), on the results of the Show
      reference: `.total span` has exactly **1** client rect, and its top is above the `b`'s bottom
      (it sits beside the number, not under it).
- [ ] At the same sizes, the verdict `Perfect 10` (reference) and `Wrecked` (valves-shut crash) take
      **1 line**. The longest verdict, `Came down on the deck` (set via the card in the test), takes ≤ 2
      lines and never overlaps the total (bounding boxes disjoint).
- [ ] The verdict text stays ≥ 18 px and the total ≥ 44 px at every size above.
- [ ] 1440×900, 1280×720 and 844×390: the header's boxes are unchanged (±1 px).
- [ ] `npm run audit` (hud-audit + title-audit) stays clean.
- [ ] Before/after screenshots at 360×748 and 320×568 in the PR.

## Test plan
Add a case to an existing results e2e (or a new `tests/e2e/results-header.spec.js`):
- Fast-forward the reference to the results at each viewport above, then assert the client-rect count,
  the line counts and the disjoint boxes.
- Set the verdict to the longest string to check the ≤ 2 lines bound.

## Out of scope
- The peek bar (`.peek-verdict` already ellipsizes).
- The judges' lines and categories below the header.
- The title's mode chips (their labels sit high in the box on 360×380; a separate nit).
