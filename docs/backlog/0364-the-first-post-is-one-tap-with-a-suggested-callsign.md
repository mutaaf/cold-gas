---
id: 0364
title: A first Post is one tap: three suggested letters are already in the field, selected, so typing replaces them
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-24
pr:
by: scout
---

## Why

SCOUT 2026-11-26: promoted to ready. Funnel, human sessions to 2026-11-25: 31 people, 21 landed, 0 post, 0 share, 0 board-open; visit-return 5.
Players' funnel, 14 days to 2026-11-23 (`human` sessions): 33 people, 54 runs, **21 landed**, and **0 `post`, 0 `share`,
0 `board-open`** (the same zeros on every day since 11-12). Landing is the one moment a player holds a result worth
sharing and the board is the only reason to come back. A first-time Post today (`src/post.js` ~124, `sync()` state
`new`) shows an empty `placeholder="AAA"` field; the first tap on Post can only focus it, which on a phone raises the
keyboard over the card, and the player must then invent three letters and tap again. That is two taps, a keyboard and a
decision, at the point of highest delight. Prefilled values lower the work, but defaults need care because users rarely
change them (https://www.nngroup.com/articles/eas-framework-simplify-forms/; "minimise typing" in
https://www.smashingmagazine.com/2018/08/best-practices-for-mobile-form-design). Initials are not personal data we
collect: the player's own letters, kept on the device.
Funnel number to move: `post` per `run-landed` (today 0 of 21).

## What
- `src/post.js`: in state `new`, fill `input.value` with a suggestion (three letters from a fixed list of ~40 invented
  crew callsigns, picked by a hash of the day plus run count, never random per frame so tests are stable) and call
  `input.select()` when the player taps the field. Do **not** focus on render.
- The Post button in state `new` reads `Post · KRW` and posts the suggestion on one tap (same path as the `known`
  state, storing it as `coldgas_initials`); a small `Change` link (already in the markup) edits it.
- No change to `src/worker/`, to eligibility (`postEligible`) or to the wreck rule (no Post on a crash).

## Acceptance criteria
- [ ] Fresh storage, 390×844 touch, after a landed board jump: the form shows a three-letter suggestion, no keyboard is raised, and one tap on Post sends it (`post` counted once, row shown as "Posted · #n").
- [ ] Typing in the field replaces the suggestion; `Change` still works; stored initials from an earlier session win over any suggestion.
- [ ] A suggestion is always `/^[A-Z]{3}$/` and never a real-brand or offensive string (unit test over the whole list against the repo's existing word filter).
- [ ] `npm run audit` (no overlap) passes at 390×844 and 1280×720.

## Test plan
Unit: suggestion list shape and filter; deterministic for a fixed day/run. e2e (extend `tests/wreck-post.spec.js` style): fresh storage, land, one tap, assert the request body's `initials` and that no `input:focus` happened.

## Out of scope
Auto-posting without a tap; accounts; any change to the board's server checks.
