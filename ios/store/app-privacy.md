# App Privacy: the answers for App Store Connect

App Privacy (the "nutrition label") has **no API**: every documented path 404s (18-0). Set it by hand in App Store
Connect → the app → App Privacy, then **Publish**. `node scripts/asc.mjs store-check` prints a reminder every time
because it can't see it.

These answers hold for 1.1.0 (checked 2026-11-12, re-read for on-device judging and Free Drive, which sends nothing):
the board and the judges ship; **the health beacon (`/obs`) does not**, so nothing in Diagnostics or Usage Data is
collected. When a build adds the beacon, add those rows to the label and the manifest together.

## Does the app collect data? Yes.

What leaves the phone, all to one host, `mutaafaziz.com/coldgas/api/*` (the frozen Worker, `src/worker/`):

| Request | What it carries | Kept |
|---|---|---|
| `POST /scores` (posting to the board) | the run's input log and telemetry, the course, the tier, and **three letters A to Z** as initials | the initials, the score card and the day, on the public board |
| `POST /judge/stream` (the judges' commentary, **from 1.1.0 only when the device can't judge on-device**) | the run's input log and telemetry, the tier | nothing |

**On-device judging (1.1.0, 0219).** On a device with Apple Intelligence (iOS 26+) and Settings > Judges left on, the
judges' commentary is written on the device by Apple's on-device model (Foundation Models): **no request is made for
it and nothing leaves the device.** `/judge/stream` is called only when the on-device model is unavailable, turned off
or fails. The label below doesn't change: the board still collects Gameplay Content, and so does the fallback; but the
answer to "what does judging send" is now "nothing, where Apple Intelligence is available".

No account, no device identifier, no install id, no advertising identifier. The IP address is only ever a daily
salted hash in a rate-limit bucket (`ipHash` in `src/worker/index.js`).

## The label

| Data type (Apple's name) | Collected | Purpose | Linked to the user | Used for tracking |
|---|---|---|---|---|
| User Content → **Gameplay Content** (the run's log and telemetry; the three initials on the board) | Yes | App Functionality | **No** | **No** |

Everything else: **not collected**. No contact info, health, financial info, location, contacts, browsing or search
history, identifiers, purchases or sensitive info.

**Tracking: No.** Nothing is combined with other companies' data and nothing goes to an ad network or a data broker.
No App Tracking Transparency prompt. Adding any advertising or attribution SDK would change this answer
(`make rules` refuses them).

**Not linked**: true only while the app sends no persistent identifier. If a later build sends an install id with the
beacon or the board, every row above becomes "Linked to the user".

## The privacy manifest

`ColdGas/Resources/PrivacyInfo.xcprivacy` declares `NSPrivacyCollectedDataTypeGameplayContent` for
`NSPrivacyCollectedDataTypePurposeAppFunctionality`, not linked, not tracking. `NSPrivacyTracking` stays false.

FoundationModels (on-device judging) is not a required-reason API and sends nothing, so it adds no row. Required-reason
APIs the app calls today (`make rules` checks each one is declared): UserDefaults (CA92.1, the haptics
level and later the saves), `CACurrentMediaTime` (35F9.1, frame timing). C617.1 (file timestamps, inside the app's
container) is declared for the pipeline cache in Caches; nothing reads a timestamp yet, and declaring it is harmless.

## The privacy policy page

**https://mutaafaziz.com/coldgas/privacy** is live (public/privacy/index.html, #255). `store/privacy-policy.md` is its source text.
