# App Privacy: the answers for App Store Connect

App Privacy (the "nutrition label") has **no API**: every documented path 404s (18-0). Set it by hand in App Store
Connect → the app → App Privacy, then **Publish**. `node scripts/asc.mjs store-check` prints a reminder every time
because it can't see it.

**From 1.2.0 (0246, the operator's call 2026-11-13): the app sends usage events**, so the label gains two rows, Usage Data →
Product Interaction and Identifiers → Device ID, both for Analytics, **linked**, **not tracking** (the operator's decision of
the same day). Change the label in App Store Connect and publish it **in the same submission as the 1.2.0 build**; nothing
ships before. The 1.1.0 answers (Gameplay Content only) hold for 1.1.0. **From 1.2.0 the health
reports (`/obs`, 0293) ship too**, so the label gains three Diagnostics rows: Crash Data, Performance Data and Other
Diagnostic Data, for App Functionality, **not linked**, **not tracking** (they carry no id). Set them in the same
submission. **From 1.2.0 the same `/obs` batch also carries a session summary (0300)**: performance in coarse buckets and
which new features the session touched, as flags. It adds **no new row**: it's Performance Data (already ticked, not linked)
and Product Interaction (already ticked for the usage events; this copy carries no id, and the row stays linked because the
usage events are).

## Does the app collect data? Yes.

What leaves the phone, all to one host, mutaafaziz.com: the game's own API, `mutaafaziz.com/coldgas/api/*` (the frozen
Worker, `src/worker/`), and from 1.2.0 Box Office's first-party relay, `mutaafaziz.com/boxoffice/e/*` (mutaaf/box-office):

| Request | What it carries | Kept |
|---|---|---|
| `POST /boxoffice/e/batch/` (usage events, **from 1.2.0, unless Settings > Privacy > Share usage stats is off**) | the events of 0245's vocabulary (session start, first input, a jump started and ended with its course, tier, score and whether it landed, the first landing, a share, a challenge opened or played): numbers and enums only; a random install id; the app's version; `platform: ios` | in the operator's PostHog project (through the relay: cookies stripped, the IP cut to /24 before it's forwarded, and `$geoip_disable` so no location is derived) |
| `POST /coldgas/api/obs` (health reports, **from 1.2.0, unless Settings > Privacy > Share usage stats and crash reports is off**; 0293, docs/AUDIT-2026-11-18.md) | per fault: a normalised message we wrote ("renderer: no command queue", "crash EXC_BREAKPOINT SIGTRAP"), the Swift function and file or up to six `0x<offset>@<binary>` frames, a module, a kind and a count; the app's version and build; the constants `phone-hi` and `high`. **From 1.2.0 (0300), once a session** (going to the background, or every ten minutes from the title or the results): the session's frame-time histogram (13 buckets, hitches over 50 ms, two-second windows under 30 fps, frames that lost sim time) and one line of coarse buckets (p50 and p95 frame time, hitch rate, 120 or 60 Hz, the look most drawn, the mean render scale to 10 %, the peak thermal state, the peak memory footprint in one of five ranges, the launch time in one of four), plus a second line naming which of the new features the session touched (a look chosen in Settings, stability control, ABS / traction / drift assist switched, the brake bias moved, the handbrake, a roam, a roam challenge, Free Drive, a replay, Wreck Club opened) as flags, never counts or times. **No id, device model, OS version, locale or user content** | aggregated per day and build in our D1 (`obs_err`, `obs_evt`, a month), example stacks two weeks; the IP only as the daily salted rate-limit hash |
| `POST /scores` (posting to the board) | the run's input log and telemetry, the course, the tier, and **three letters A to Z** as initials | the initials, the score card and the day, on the public board |
| `POST /judge/stream` (the judges' commentary, **from 1.1.0 only when the device can't judge on-device**) | the run's input log and telemetry, the tier | nothing |

**On-device judging (1.1.0, 0219).** On a device with Apple Intelligence (iOS 26+) and Settings > Judges left on, the
judges' commentary is written on the device by Apple's on-device model (Foundation Models): **no request is made for
it and nothing leaves the device.** `/judge/stream` is called only when the on-device model is unavailable, turned off
or fails. The label below doesn't change: the board still collects Gameplay Content, and so does the fallback; but the
answer to "what does judging send" is now "nothing, where Apple Intelligence is available".

No account and no advertising identifier (no IDFA, no App Tracking Transparency prompt, no fingerprinting). The one
identifier is the usage events' **install id**: a random UUID made on this device the first time an event is kept, stored in
UserDefaults (not the Keychain, so deleting the app resets it), sent only with the usage events (never with the board or the
judges), and deleted by the Settings switch. On our own Worker the IP address is only ever a daily salted hash in a
rate-limit bucket (`ipHash` in `src/worker/index.js`).

## The label

| Data type (Apple's name) | Collected | Purpose | Linked to the user | Used for tracking |
|---|---|---|---|---|
| User Content → **Gameplay Content** (the run's log and telemetry; the three initials on the board) | Yes | App Functionality | **No** | **No** |
| Usage Data → **Product Interaction** (the usage events; and, with no id, a session's feature-use flags in the health batch, 0300; from 1.2.0) | Yes | Analytics | **Yes** | **No** |
| Identifiers → **Device ID** (the random install id, from 1.2.0) | Yes | Analytics | **Yes** | **No** |
| Diagnostics → **Crash Data** (MetricKit crash reports: the exception and signal names, up to six code offsets in the app, from 1.2.0) | Yes | App Functionality | **No** | **No** |
| Diagnostics → **Performance Data** (hang and launch-time buckets, CPU and disk-write exceptions, the day's exit counts by reason; a session's frame-time histogram and its coarse buckets: frame time, hitches, cadence, render scale, look, thermal peak, memory peak, launch, 0300; from 1.2.0) | Yes | App Functionality | **No** | **No** |
| Diagnostics → **Other Diagnostic Data** (an error signature: a fixed message such as "the stage couldn't be drawn", the code's function and file, a count, the app's version, from 1.2.0) | Yes | App Functionality | **No** | **No** |

Everything else: **not collected**. No contact info, health, financial info, location (coarse or precise: the relay cuts the
IP and the events ask for no location), contacts, browsing or search history, user ID, purchases or
sensitive info.

**In App Store Connect (1.2.0):** Data Collection: Yes. Then tick, under Usage Data, *Product Interaction*, and under
Identifiers, *Device ID*, keeping User Content → *Gameplay Content*. For Product Interaction and Device ID: purpose
*Analytics* only; "linked to the user's identity": **Yes**; "used for tracking": **No**. Gameplay Content stays App
Functionality, not linked, not tracking. Under Diagnostics (0293) tick *Crash Data*, *Performance Data* and *Other
Diagnostic Data*: purpose *App Functionality* only; linked: **No**; tracking: **No**. Publish.

**Tracking: No.** Nothing is combined with other companies' data and nothing goes to an ad network or a data broker.
No App Tracking Transparency prompt. Adding any advertising or attribution SDK would change this answer
(`make rules` refuses them).

**Linked**: the usage rows are linked because they carry the install id (the operator chose linked over dropping the id,
2026-11-13). Gameplay Content stays **not linked**: the board and the judges never carry the install id. If a later build
sends the install id with the board or the judges, that row becomes linked too.

## The privacy manifest

`ColdGas/Resources/PrivacyInfo.xcprivacy` declares `NSPrivacyCollectedDataTypeGameplayContent` for
`NSPrivacyCollectedDataTypePurposeAppFunctionality`, not linked, not tracking; and from 1.2.0
`NSPrivacyCollectedDataTypeProductInteraction` and `NSPrivacyCollectedDataTypeDeviceID` for
`NSPrivacyCollectedDataTypePurposeAnalytics`, linked, not tracking. `NSPrivacyTracking` stays false and
`NSPrivacyTrackingDomains` empty (the relay is ours and nothing is tracking).

FoundationModels (on-device judging) is not a required-reason API and sends nothing, so it adds no row. Required-reason
APIs the app calls today (`make rules` checks each one is declared): UserDefaults (CA92.1, the haptics
level and later the saves), `CACurrentMediaTime` (35F9.1, frame timing). C617.1 (file timestamps, inside the app's
container) is declared for the pipeline cache in Caches; nothing reads a timestamp yet, and declaring it is harmless.

## The privacy policy page

**https://mutaafaziz.com/coldgas/privacy** is live (public/privacy/index.html, #255). `store/privacy-policy.md` is its source text.
