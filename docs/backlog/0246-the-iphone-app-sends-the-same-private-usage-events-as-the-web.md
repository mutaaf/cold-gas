---
id: 0246
title: The iPhone app sends the web's privacy-conscious usage events to Box Office, with a switch in Settings and honest labels
status: shipped
priority: P0
size: M
lens: platform
created: 2026-11-13
pr: 370
by: operator
---

## Why
The operator's call, 2026-11-13: "we want iphone app metrics too" (AGENTS.md §3.3, docs/proposals/phase-2-growth.md §6).
Most players are on the iPhone, and Phase 2's first-run work (0249) can't be judged without numbers from day one. Today the
app sends nothing but board posts and the judges' fallback (ios/store/app-privacy.md).

## What
Runs on: the operator's Mac (Xcode, a device, App Store Connect).
Depends on: 0245 (the event vocabulary, `src/metrics/events.js` and its vectors file).
- **One module**, e.g. `ColdGasClient/Insights.swift` (pure: the queue, the batch format, the gates) + a thin sender in
  `ios/ColdGas/Net/`. Nothing else in the app names an event to a server.
- **Events:** exactly 0245's vocabulary, the same names and props (numbers and enums only): `session_start`
  {returning, days_since_last}, `first_input` {ms_since_launch}, `jump_start` / `jump_end` {n (1, 2, 3+), course, tier,
  landed, score}, `first_landing`, `share_tap` / `share_done` {course}, `challenge_open` / `challenge_play` {course},
  `license_pass` {license}. A unit test reads the vocabulary file and fails on any name or prop the web doesn't have.
- **Where they go:** the same first-party Box Office collector the web uses, on mutaafaziz.com (no other host). Box
  Office's relay (`/boxoffice/e/*`, mutaaf/box-office) forwards PostHog's capture API and accepts an event only when its
  Referer is a Cast List URL marked general-audience. The proposal's default: POST PostHog's `/batch/` shape to
  `https://mutaafaziz.com/boxoffice/e/batch/` with `Referer: https://mutaafaziz.com/coldgas/`, `platform: "ios"`,
  `surface: "app"`, `release` = the marketing version, and the project's public ingest key (the one the loader already
  serves). **Flag:** Box Office's own manual (rule 6) still says "native apps: not until the App Store reviews of Nov 2026
  have cleared, and only with the App Privacy label updated in the same submission". The builder opens a box-office PR that
  records the operator's 2026-11-13 call and, if the Referer route is judged too loose, adds an explicit native app header
  there. Never a change in `src/worker/` (frozen) and never a new host.
- **Data rules:** no third-party SDK (`make rules` keeps refusing them), no IDFA, no App Tracking Transparency prompt, no
  fingerprinting, no personal data, no initials, no free text. A random install id (UUID) made on first launch and kept in
  UserDefaults (not the Keychain, so a reinstall resets it), used as PostHog's distinct id and nothing else.
- **Sending:** queued in memory and on disk (capped, oldest dropped), sent in one batch on the title, the results after the
  beat, or `sceneDidEnterBackground`; never from the frame loop or during a countdown, run or replay; a failed send is kept
  for next time; an ephemeral URLSession with no cookies (like Net.swift). Never blocks or slows anything.
- **Settings → Privacy: "Share anonymous usage"**, on by default, off stops sending and clears the queue (and the install
  id). Its footer says what is sent in one line and links the privacy policy.
- **Paperwork in the same PR:**
  - `ios/store/app-privacy.md`: the new rows. Expected: Usage Data → Product Interaction (Analytics), and Identifiers →
    Device ID (Analytics) for the install id; tracking No. Whether they are "linked" is the operator's call (the file
    today says an install id makes rows linked; see the proposal's owner decisions).
  - `ColdGas/Resources/PrivacyInfo.xcprivacy`: the same types and purposes; `NSPrivacyTracking` stays false.
  - `public/privacy/index.html` and `ios/store/privacy-policy.md`: replace "None of it is in the iPhone app" with what
    the app sends, the switch, and the reset on reinstall; `tests/unit/privacy.test.js` updated to match (it asserts the
    app is out of it today).
  - `ios/store/review-notes.txt`: NETWORK AND DATA names the analytics, the host and the switch.
  - Release notes for the version that ships it say so truthfully.
- **Operator action at submission:** the App Store Connect App Privacy label has no API (ios/store/app-privacy.md). The
  operator changes and publishes it, or approves the change, in the same submission as the build. Nothing ships before.

## Acceptance criteria
- [ ] Unit (ColdGasClient): every event and prop matches 0245's vocabulary file; props are numbers or enums; no event is
      queued while `Game` is in countdown, live or replay; off in Settings sends nothing and clears the queue and the id.
- [ ] Unit: the queue survives a relaunch, caps its size, and retries after a failed send; a send never runs on the main
      thread's frame path.
- [ ] A debug build against the relay shows the events in PostHog with `platform: ios`, filtered from the web by it.
- [ ] `make rules` passes (no SDK, required-reason APIs declared); the privacy manifest, app-privacy.md, the privacy page,
      privacy-policy.md and review-notes.txt all say the same thing; `npm test` (privacy.test.js) passes.
- [ ] Frame times unchanged on the operator's iPhone (the bench of 0216 or the HUD's frame meter).

## Test plan
ColdGasClient unit tests for the queue, gates and vocabulary parity; `npm test` for the privacy page; one device session
watched in PostHog's live events with the switch on, then off.

## Out of scope
Any change to `src/worker/` or `wrangler.jsonc`. Session replay, heatmaps or autocapture in the app. Crash reporting.
