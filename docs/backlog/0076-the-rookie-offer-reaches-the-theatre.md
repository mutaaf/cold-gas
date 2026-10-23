---
id: 0076
title: The Rookie mode offer reaches the judges' theatre on a phone
status: in-progress
priority: P1
size: S
lens: accessibility
created: 2026-10-22
by: operator
---

## Why
0074 put a ROOKIE MODE button on the results sheet after three crashes in a row. On a phone held upright
the judges' theatre (src/ai/theatre.js) plays full screen over that sheet, with its own Retry / Home bar.
A player who has just crashed for the third time and taps the theatre's Retry never sees the offer: it
waits on the sheet underneath until Skip or the end of the show. The player who most needs the way out
is the one tapping Retry straight away.

## What
- `src/ai/theatre.js`: the theatre's phone bar (`.th-quick`) gets a third button, **ROOKIE MODE · easier
  car · auto-land** (`data-rookie-go`), hidden by default.
- `src/main.js`: one offer, drawn twice. `syncRookie()` (the same `offerRookie` from src/rookie.js) now also
  sets `.th-rookie` on the theatre's root, which shows the button. Both buttons go through one handler,
  `goRookie()`, on the delegated click that already handles the theatre's Retry / Home: Easy driving,
  Assist flight, both saved, the streak back to 0, and the retry. No streak logic is duplicated.
- `src/styles.css`: while the offer is up, the button is a second row of the bar, the width of the
  screen, ice-edged like the sheet's, at least 44 px tall. The rail and the caption step down one row. On
  short phones the streamed ticker is capped so it stays under the caption. The bar itself stops taking
  clicks (only its buttons do), so Skip stays tappable. Sideways phones and wide screens keep the theatre
  beside the sheet, where the sheet's own button shows, so nothing changes there.
- No sim change.

## Acceptance criteria
- [x] At 390×844 touch, after three crashes in a row with the theatre playing, its bar shows ROOKIE MODE;
      after two it doesn't. (`tests/e2e/rookie.spec.js`.)
- [x] Tapping it sets level `easy` and tier `assist`, saves both, closes the theatre and starts a run.
- [x] At least 44 px tall, text 11 px or larger, ink on a dark field (well past 4.5:1), reachable by Tab
      from the theatre's Retry, and on top at its centre.
- [x] No overlap with Retry, Home, Skip, the rail or the caption at 390×844, 382×580 and 669×825
      (measured and checked by eye). At 844×390 the theatre has no phone bar, and the sheet beside it
      carries the offer.
- [x] `node scripts/hud-audit.mjs <url> <dir> phones`: 116 frames, 0 overlaps, 0 text < 11 px, 0 labels
      < 4.5:1.

## Test plan
`tests/e2e/rookie.spec.js` adds a phone test. The judge's stream is held open (never answered), so the
theatre keeps playing while the test crashes three times (aftermath.spec.js's full-throttle run, stepped
by `liveStep`) and then measures and taps the theatre's button. The two 0074 tests now scope their
locators to the sheet's button, since the theatre carries one too.

## Out of scope
The theatre's Retry / Home pills are still 34 px tall (unchanged). The theatre's sideways-phone layout.
