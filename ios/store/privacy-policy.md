# Cold Gas: privacy

The source text of https://mutaafaziz.com/coldgas/privacy (public/privacy/index.html; live since #255). It covers the
iPhone and iPad app and the web game. Keep the two word for word: change both in the same PR.

---

# Privacy

**Cold Gas has no accounts. The iPhone app has no ads and no tracking:** it talks to one server, ours, at
mutaafaziz.com/coldgas, and nothing from it goes to an advertising network, an analytics company or a data broker. The
web game is the same, except for the ads described below.

## What we receive, and why

- **Your run, when you post to the board, and when our server writes the judges' commentary.** The run is the inputs
  you flew and the flight's numbers (speed, height, rotation, touchdown and so on), with the course and the flight
  tier. We use it to score the jump and to write the judges' commentary. On an iPhone or iPad where the judges write on
  the device (below), nothing is sent for the commentary.
- **Three initials, when you post to the board.** Three letters, A to Z. They are shown publicly next to the score,
  with the day it was flown. The board keeps them.
- **A health report, from the web game.** Counts of errors (with a short message that has anything that looks like a
  key or a token removed), how smoothly frames were drawn, which features were used (for example "a run was flown",
  "the board was opened"), the build, and a rough device class such as "phone, high-end". It carries no identifier, so
  it can't be tied to you or to your device. We keep daily totals for 30 days and error examples for 14.

## Judges on your iPhone or iPad

Where Apple Intelligence is available and turned on (iOS 26 or later), the app's judges write their commentary on the
device itself, with Apple's on-device model. The model sees only the run's numbers, and nothing is sent to us or to
anyone else for it. Where Apple Intelligence isn't available, where you turn this off in Settings, or if the on-device
model can't answer, the run's numbers go to our server for the commentary, as described above. The score itself never
comes from a model.

## What we don't receive

Your name, email, contacts, location, photos, an advertising identifier, or any id for you or your device. Your IP
address is used only to stop abuse: it is turned into a hash that changes every day, counted for rate limits, and
never stored as an address.

## Ads on the web game

The web game shows ads from Google, through our own ad loader, on its menus and results, never during a run. A
rewarded ad plays only when you ask for one. Those ads can use the ad network's own cookies and identifiers, under
Google's privacy policy. None of this is in the iPhone app.

## Your own AI key (optional, on the web)

If you enter an API key for another AI provider, it stays on your device. It is sent with your own judging requests
only; our server passes it to that provider for that one call and never stores or logs it. That provider's own privacy
policy then applies to the request.

## On your device

Settings, medals, the daily streak and your initials are saved on your device only.

## Children

Cold Gas is not directed at children and collects no personal information from anyone.

## Deleting

There is no account to delete. To remove a board entry, write to the address on mutaafaziz.com.

## Changes

If what we receive ever changes, this page changes first.

Last updated 12 November 2026.
