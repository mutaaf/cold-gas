---
id: 0260
title: Share sends the moment in one tap, a card that names the stunt and the score, and a link to the very same challenge
status: ready
priority: P0
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 brief: instant result sharing (stunt name, score, the moment) through the share sheet with fallbacks, plus a deep
link that opens the same challenge. The web is most of the way there (src/share-card.js, 0081: a 1080×1350 card from the
replay frame, `navigator.share({ files })` → text + link → copy + toast; the link is the `#vs=` challenge when it has one).
Gaps from the audit: the card never names the stunt (no 360/720, no "on the mark"), the address printed on the image is the
plain base, not the challenge; there is no personal best on it; and the text leads with the verdict, not a dare.

## What
Depends on: 0245 (`share_tap`, `share_done`).
- **A stunt name**, pure (`src/stunt-name.js`, exported to the vectors for 0252): the course plus what the card says was
  flown, from `scoreRun`'s card only: "The Show · 360 · on the mark", "The Wall · hang 2.1 s · stuck it", "The Lineup · over
  five"; a wreck names its cause (the coach's first finding, or 0237's top combo once that lands). Original words only (§3.7).
- **The card**: the stunt name as its headline, the score and the verdict, three numbers, "Personal best" when it is one
  (src/medals.js), and the short challenge address in print so a screenshot still carries it.
- **The message**: "Beat my 82.4 on The Show · 360" + the link. The link is always a challenge link when the run can be
  packed (src/comeback.js, lossless or coarsened); every flown run can be shared, landed or wrecked.
- **The fallbacks stay**: files → link → clipboard + toast → the URL shown; never a blocked share on an unsupported browser.
- Share is one tap from the calm sheet and from the first-landing moment (after Next jump and Beat this score, 0257).

## Acceptance criteria
- [ ] Unit: the stunt name for every vector run and a wreck; names never contain a brand or a real model (a word list
      check); `src/stunt-name.js` is pure.
- [ ] e2e: Share on a landed and a wrecked run calls `navigator.share` with a PNG and a `#vs=` URL; without `share`, the
      link is copied and the toast shows; the card's headline is the stunt name.
- [ ] The card renders in under 300 ms on a 4× CPU-throttled phone profile, after the beat, never during a run.
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
`tests/unit/stunt-name.test.js`; the existing share e2e extended; a card screenshot per course in `docs/shots/0260/`.

## Out of scope
The recipient's side (0251). Video. Any server-side short link.
