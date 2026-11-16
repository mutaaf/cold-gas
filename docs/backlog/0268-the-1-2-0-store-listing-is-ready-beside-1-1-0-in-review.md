---
id: 0268
title: The 1.2.0 App Store listing is ready beside 1.1.0 in review (copy, review notes, a dry-run store-prep, a shot plan)
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-11-16
by: operator
---

## Why
1.1.0 waits for review (submitted 2026-11-13, manual release). The plan: once it is approved, hold it and submit 1.2.0 on the
owner's fresh yes. 1.2.0 needs its own listing: main has gained Roam, Free Drive's world, the layout editor, the guided first
jump, share and challenge links that open the app, the sound rebuild and private usage counts since 1.1.0. 1.0.0 was rejected
under 4.3 and 4.2.6, so the copy leads with what is distinct: the native sim and haptics, the Duo layouts, the on-device judge,
Free Drive and Roam, challenge links.

## What
Runs on: the operator's Mac (the screenshots; the copy and tooling are plain files).
- `ios/store/` copy for 1.2.0: description, promotional text, keywords, an App Store What's New (`whats-new.txt`, shorter than
  `release-notes/1.2.0.md`), `listing.json` forVersion 1.2.0. Subtitle and name unchanged (the app info is locked while 1.1.0
  is in review).
- Review notes for 1.2.0: how to reach every feature, first-party usage counts and their switch, challenge links opening the
  app, the judges on device and their fallback, and the standing correction (the server scores telemetry after plausibility
  checks and does not re-fly runs). Under 4,000 characters.
- `asc.mjs store-prep [--shots <dir>] [--version <v>] [--yes]`: a dry run by default (GETs only); `--yes` creates the 1.2.0
  version if absent and uploads copy, review details, What's New (once a version is live) and screenshots to it. Addresses
  the version by its versionString, checks it before any write, never submits and never touches another version.
- Closes two hazards: `store-meta` no longer renames whatever version is editable without `--rename`, and `store-shots` no
  longer creates a version or uploads to one that isn't MARKETING_VERSION.
- A shot plan (`ios/store/shots-1.2.0.md`) for the 6.9" iPhone, 13" iPad and Duo sets.
- **Simulators are silent (the owner's rule, 2026-11-16).** A Debug/simulator-only `-mute` launch flag: the audio engine never
  starts (the log says `SOUND muted (-mute): the engine stays off`); every capture script and UI test passes it.

## Acceptance criteria
- [x] `asc.mjs store-lint` passes with the 1.2.0 copy; every claim checked against the code on main.
- [x] Unit tests: a dry run makes no writes; `--yes` writes only to 1.2.0, never to 1.1.0, never submits; the copy fits
      Apple's limits and keeps the correction.
- [x] `store-prep` dry run against App Store Connect: plans 1.2.0 beside 1.1.0 WAITING_FOR_REVIEW, changes nothing.
- [x] `-mute` proved on a simulator: one `SOUND muted` line, no `SOUND engine started`, a whole run to the results.
- [x] Screenshots captured on simulators (one at a time, `-mute`), reviewed and committed.
- [ ] Uploaded to the 1.2.0 version, only on the owner's word.

## Test plan
`tests/unit/asc-store-prep.test.js` (a fake App Store Connect: 1.1.0 in review, no 1.2.0); `node scripts/asc.mjs store-lint`;
`node scripts/asc.mjs store-prep` against App Store Connect without `--yes`; the screenshots looked at full size and as
thumbnails before they are committed.

## Out of scope
Creating the version, uploading, submitting, the App Privacy label (already published by the operator).
