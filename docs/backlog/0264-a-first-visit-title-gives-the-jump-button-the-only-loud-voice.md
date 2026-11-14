---
id: 0264
title: A first-ever visit's title gives Jump the only loud voice, not the iPhone chip or the daily card
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-14
pr:
by: scout
---

## Why
Players' funnel (`/obs/digest` → players, 2026-11-01…14): 16 human sessions in two weeks (2–4 a day), 9 new visits,
2 returns, 13 runs, 3 landed, 6 wrecked, 0 posts, 0 shares. Of the new visits, several never press Jump (0143 measures
that). At 390×844 with `coldgas_howto=new` the title shows, above and below the one white Jump button, an "iPhone beta"
pill, a "Judges · Free" pill, a Menu pill, three mode tabs, a "More ways to play" row and a full daily card with its own
gold "Play today's" button (a Wall score of 84+, a stranger's first jump). That is two primary-looking buttons and four
chips for someone who has never flown. A single dominant action with secondary choices visually quieter is the
standard first-screen rule for casual games (Nielsen Norman Group, "Visual Hierarchy",
https://www.nngroup.com/articles/visual-hierarchy-ux-definition/). Jump stays; nothing is hidden or removed.

## What
`index.html` and `src/styles.css` (and the small boot code that sets the first-visit flag, src/main.js `howtoSeen`):
when this device has never run (`coldgas_howto` absent or `new`), the title is rendered "first-visit": the beta chip
and Judges chip drop to a smaller, lower-contrast style (still reachable and still labelled), and the daily card
collapses to its one-line header until the player has landed once; "Play today's" returns afterwards. Returning
players see today's title unchanged. No new network call, no new element, no sim change.

## Acceptance criteria
- [ ] With `coldgas_howto=new` at 390×844, Jump is the only filled/bright button above the fold; the chips are
  visibly quieter (measured contrast ≥ 4.5:1 for their text, so still legible) and the daily card shows no gold button.
- [ ] After one landed run (or any stored medal) the title is exactly today's.
- [ ] 1280×720 keyboard/mouse title unchanged for returning players; first-visit variant also fits with no overlap
  (`npm run audit`), and tab order still reaches every control.
- [ ] Moves: `run` per `visit-new` in the players funnel (and `visit-new` → `run-landed`).

## Test plan
E2E (title spec): fresh context with `coldgas_howto='new'` asserts the first-visit class, the quiet chips and the
collapsed daily card; a context with a stored medal asserts the original title. Screenshot at 390×844 for the PR.

## Out of scope
Removing the beta link or the daily; copy changes; any returning-player layout change.
