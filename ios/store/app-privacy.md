# App Privacy: the answers for App Store Connect

App Privacy (the "nutrition label") has **no API**: every documented path 404s (18-0). Set it by hand in App Store
Connect → the app → App Privacy, then **Publish**. `node scripts/asc.mjs store-check` prints a reminder every time
because it can't see it.

These answers are for 1.0 as docs/NATIVE.md defines it: the board, the judges and the health beacon all ship.
**The build in TestFlight today makes no network calls**, so for it the true label is "Data Not Collected", and
`PrivacyInfo.xcprivacy` declares no collected types. The day `ColdGas/Net/` lands, `make rules` fails until the
manifest declares the types below, so the label and the manifest change together.

## Does the app collect data? Yes.

What leaves the phone, all to one host, `mutaafaziz.com/coldgas/api/*` (the frozen Worker, `src/worker/`):

| Request | What it carries | Kept |
|---|---|---|
| `POST /scores` (posting to the board) | the run's input log and telemetry, the course, the tier, and **three letters A to Z** as initials | the initials, the score card and the day, on the public board |
| `POST /judge/stream` (the judges' commentary) | the run's input log and telemetry, the tier; with BYOK, the player's own key in `x-cg-key` | nothing: the key is used for that one call and never stored or logged |
| `POST /obs` (the health beacon, `src/obs/` on the web) | the build, a device class (`phone-hi` and so on), the graphics tier, error signatures with counts and a redacted message, a frame-time histogram, recoveries, tripped breakers, and counts of play events (run, retry, post, share, board-open, daily-start …) | aggregates by day and build for 30 days; error exemplars for 14 |

No account, no device identifier, no install id, no advertising identifier. The IP address is only ever a daily
salted hash in a rate-limit bucket (`ipHash` in `src/worker/index.js`); `/obs` reads no user agent and no headers.

## The label

| Data type (Apple's name) | Collected | Purpose | Linked to the user | Used for tracking |
|---|---|---|---|---|
| User Content → **Gameplay Content** (the run's log and telemetry; the three initials on the board) | Yes | App Functionality | **No** | **No** |
| Diagnostics → **Crash Data** (error signatures and redacted messages) | Yes | App Functionality, Analytics | **No** | **No** |
| Diagnostics → **Performance Data** (frame-time histogram, recoveries) | Yes | App Functionality, Analytics | **No** | **No** |
| Diagnostics → **Other Diagnostic Data** (device class, graphics tier, build) | Yes | Analytics | **No** | **No** |
| Usage Data → **Product Interaction** (play-event counts) | Yes | Analytics | **No** | **No** |

Everything else: **not collected**. No contact info, health, financial info, location, contacts, browsing or search
history, identifiers, purchases or sensitive info.

**Tracking: No.** Nothing is combined with other companies' data and nothing goes to an ad network or a data broker.
No App Tracking Transparency prompt. Adding any advertising or attribution SDK would change this answer
(`make rules` refuses them).

**Not linked**: true only while the app sends no persistent identifier. If a later build sends an install id with the
beacon or the board, every row above becomes "Linked to the user".

## The privacy manifest when the network lands

`ColdGas/Resources/PrivacyInfo.xcprivacy`, `NSPrivacyCollectedDataTypes`, one dict per row above, each with
`NSPrivacyCollectedDataTypeLinked` false and `NSPrivacyCollectedDataTypeTracking` false:

- `NSPrivacyCollectedDataTypeGameplayContent`: `NSPrivacyCollectedDataTypePurposeAppFunctionality`
- `NSPrivacyCollectedDataTypeCrashData`: `...PurposeAppFunctionality`, `...PurposeAnalytics`
- `NSPrivacyCollectedDataTypePerformanceData`: `...PurposeAppFunctionality`, `...PurposeAnalytics`
- `NSPrivacyCollectedDataTypeOtherDiagnosticData`: `...PurposeAnalytics`
- `NSPrivacyCollectedDataTypeProductInteraction`: `...PurposeAnalytics`

`NSPrivacyTracking` stays false and `NSPrivacyTrackingDomains` empty.

Required-reason APIs the app calls today (`make rules` checks each one is declared): UserDefaults (CA92.1, the haptics
level and later the saves), `CACurrentMediaTime` (35F9.1, frame timing). C617.1 (file timestamps, inside the app's
container) is declared for the pipeline cache in Caches; nothing reads a timestamp yet, and declaring it is harmless.

## The privacy policy page

`store/listing.json` points at **https://mutaafaziz.com/coldgas/privacy**, which answers **404 today** (checked
2026-11-04; the web repo has no privacy page, and `mutaafaziz.com/privacy` is a 404 too). App Store Connect needs a
policy URL for every app, so the page has to exist before submission. It is a web change (`public/` or a route in
the site), the owner's call. `store/privacy-policy.md` is a draft of its text, matching the table above.
