---
id: 0252
title: On the iPhone, Share sends a picture of the moment with the stunt, the score and a link to the same challenge
status: shipped
priority: P0
size: M
lens: engagement
created: 2026-11-13
pr: 380
by: operator
---

## Why
Phase 2 brief: "share effortlessly". The app's only share is `ShareLink(item: challengeURL, message: "… Beat it.")`
(ios/ColdGas/UI/GameUI.swift:515), a text link, offered only for board-qualifying runs. The web already draws a
1080×1350 card from the replay (src/share-card.js, 0081). A picture is what travels in a chat.

## What
Runs on: the operator's Mac (Xcode).
**Waits for the native UI redo** (0230, PR #368: `ios/ColdGas/UI/`, title/results/HUD): the Share button lives on the new
results; build on that.
Depends on: 0260 (the web card's design and the stunt name rules), 0246 (events).
- A share card drawn on the device (SwiftUI `ImageRenderer` or the Metal renderer's frame): the frame at the moment (the
  apex or the touchdown, from the replay), the stunt name (0260's rules: course + what was flown, e.g. "The Show · 360 ·
  on the mark", or the Wreck combo once 0239 lands), the score and the verdict, three numbers, the player's best beside it
  when it is one, and the short link. Original art only (§3.7), the app's type and one signal red.
- `ShareLink` (or `UIActivityViewController`) with the image **and** the challenge URL and a one-line "Beat my 82.4 on
  the Show" message; every run that flew can be shared (a wreck too), not only board-qualifying ones. The link is the
  existing `Challenge.encode` URL (ColdGasClient/Challenge.swift), so it opens the same challenge on the web and, after
  0253, in the app.
- Share is one tap from the results and from the first-landing moment, after Next jump and Beat this score (0258's order).
- Events: `share_tap`, `share_done` (the activity's completion), through 0246.

## Acceptance criteria
- [ ] Unit: the stunt name and the card's numbers come from the score card, identical to the web's for the same vector run
      (a vectors check against 0260's names).
- [ ] UI test: Share on a landed and a wrecked run presents the share sheet with an image and a URL.
- [ ] The image renders in under 300 ms on the operator's iPhone, off the frame loop; nothing renders while a run is live.
- [ ] Screenshots of the card for the three courses and a wreck in `docs/shots/0252/`.

## Test plan
Unit test for the stunt name parity; UI test for the share sheet; a manual share to Messages on the device.

## Out of scope
Opening links in the app (0253). Video clips. Any server.
