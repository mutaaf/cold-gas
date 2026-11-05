---
id: 0154
title: The native app archives, signed for the App Store, and its listing is written
status: in-progress
priority: P2
size: M
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
Phase 7 (docs/NATIVE.md §9) needs signing, TestFlight and a listing that survive App Review's preflight, and
moon-club, kin and 18-0 already paid for each of those. Setting it up now, while the app is small, proves signing
and export early and keeps the privacy label honest as the network lands.

## What
Runs on: the operator's Mac (Xcode, the App Store Connect key).
- Copy moon-club's `asc.mjs`, `testflight.sh`, `provision.sh` and `check-rules.sh` into `ios/scripts/` and adapt them.
  Build numbers are UTC timestamps (kin). The key config is the owner's `.env.testflight`, never committed.
- `make rules | provision | archive | validate | testflight | store-check`.
- Info.plist: `UIRequiredDeviceCapabilities` arm64 + metal, display name "Cold Gas", the racing category.
  MARKETING_VERSION is 1.0.0.
- `ios/release-notes/1.0.0.md`, and `ios/store/`: the listing, the age rating, the App Privacy answers, the review
  notes and the 2.1 reply.

## Acceptance criteria
- [x] `make archive` exports `build/archive/out/ColdGas.ipa`, signed Apple Distribution with the "Cold Gas App Store"
      profile (get-task-allow false). Build 202611050125, 2026-11-04.
- [x] `com.mutaafaziz.coldgas` registered. No app record, upload, group or submission was made.
- [x] `make rules` holds: own packages only, own origin only, no ad/analytics SDKs, no force-unwrapped
      state/content lookups, no device-model branches, release notes, plist, privacy manifest, store limits.
- [ ] Owner: the App Store Connect app record, the privacy policy page, App Privacy in the browser, and the
      initials-moderation decision (store/review-reply.md).

## Test plan
`make rules`, `ASC_ENV=… make archive`, then `node scripts/asc.mjs status`.
