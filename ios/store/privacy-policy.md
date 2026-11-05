# Cold Gas: privacy

Draft text for https://mutaafaziz.com/coldgas/privacy (not yet published; see store/app-privacy.md). It covers the
iPhone app and the web game, which send the same things to the same server.

---

**Cold Gas has no accounts, no ads and no tracking.** It talks to one server, ours, at mutaafaziz.com/coldgas.
Nothing goes to an advertising network, an analytics company or a data broker.

**What we receive, and why**

- **Your run, when you ask for the judges or post to the board.** The run is the inputs you flew and the flight's
  numbers (speed, height, rotation, touchdown and so on), with the course and the flight tier. We use it to score the
  jump and to write the judges' commentary.
- **Three initials, when you post to the board.** Three letters, A to Z. They are shown publicly next to the score,
  with the day it was flown. The board keeps them.
- **A health report.** Counts of errors (with a short message that has anything that looks like a key or a token
  removed), how smoothly frames were drawn, which features were used (for example "a run was flown", "the board was
  opened"), the app's build, and a rough device class such as "phone, high-end". It carries no identifier, so it
  can't be tied to you or to your device. We keep daily totals for 30 days and error examples for 14.

**What we don't receive.** Your name, email, contacts, location, photos, an advertising identifier, or any id for
you or your device. Your IP address is used only to stop abuse: it is turned into a hash that changes every day,
counted for rate limits, and never stored as an address.

**Your own AI key (optional).** If you enter an API key for another AI provider, it stays on your device (in the iOS
Keychain, or in the browser on the web). It is sent with your own judging requests only; our server passes it to that
provider for that one call and never stores or logs it. That provider's own privacy policy then applies to the
request.

**On your device.** Settings, medals, the daily streak and your initials are saved on your device only.

**Children.** Cold Gas is not directed at children and collects no personal information from anyone.

**Deleting.** There is no account to delete. To remove a board entry, write to the address on mutaafaziz.com.

**Changes.** If what we receive ever changes, this page changes first.

Last updated: (the publish date)
