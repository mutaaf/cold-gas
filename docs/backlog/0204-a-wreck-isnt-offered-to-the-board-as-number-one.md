---
id: 0204
title: A wreck isn't offered to the board as "#1 today"
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-12
pr:
by: critic
---

## Why
Pillar 2 is an honest leaderboard. On production `index-DxnlFBnX.js`, 1440×900, Pro, the car was held up the curl,
released on the ledge, and never braked:
- It hit the ground at 22.7 m/s (74.5 ft/s), flipped and took 69 % damage.
- The card is **35.0 "Wrecked"**, and the timeline reads "07 WRECKED".
- The sheet still offers **"Post · would be #1 today"** beside the initials
  (`docs/critique/2026-11-12-0407/D-crash-impact.png`, sheet text in the critique §4).

On a quiet board (the funnel: 10 human sessions in 11 days) the first row of the day can be a destroyed car. The
people who built the real car would not put a wreck at the top of a results board. A run that ends in a crash is a
lesson, not a placing. 0141 made Post name its rank "on a decided run". A wreck is decided, but it isn't a placing.

## What
On a run whose card says `facts.crashed` (or the verdict Wrecked), the sheet doesn't offer Post or a rank
(`src/post.js`, `src/ui.js`). The coach's "what happened" and Retry stay. The Worker is frozen (`boardCheck`), so this is
the client's offer only. If the operator wants the Worker to refuse crashed rows too, that's a `proposal/`.

## Acceptance criteria
- [ ] A crashed run (Show Pro, released and never braked, as above; and `crash-probe`'s Show `carry3`) shows no Post
      button and no "would be #N" on the sheet, at 390×844 touch and 1280×720.
- [ ] A landed run still shows Post with its rank (0141 unchanged). Covered by the existing e2e.
- [ ] "Leave without posting?" (src/post.js) is never asked after a wreck.
- [ ] Funnel: `post` among `run-landed` unchanged. Wrecked posts go to 0.

## Test plan
An e2e in `tests/e2e/wreck-hud.spec.js` (or a new `wreck-post.spec.js`): fly the crash (full throttle, release, no
LAND, Pro) via `liveStep`. Assert `[data-r-post-btn]` is hidden and no rank text shows. Assert the
landed reference still shows it.

## Out of scope
- The wreck's score (35.0). That's the scorer's call; the critic doesn't ask to change it here.
- The Worker's `boardCheck` (frozen).
