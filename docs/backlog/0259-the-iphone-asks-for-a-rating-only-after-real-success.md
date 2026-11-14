---
id: 0259
title: The iPhone asks for a rating only after real success, never mid-run and never over the first landing
status: proposed
priority: P1
size: S
lens: platform
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 brief: the native review prompt only after several successful sessions or a milestone, within Apple's guidelines,
never mid-run. The app has no StoreKit review call today. Apple's guidance: ask after a positive moment, not on first
launch or mid-task; the system shows it at most three times in 365 days and may show nothing, so the app must never wait on
it (developer.apple.com/design/human-interface-guidelines/ratings-and-reviews).

## What
Runs on: the operator's Mac (Xcode).
Depends on: 0249 (the first-run counters), 0256 (license milestones; until then, sessions and landings only).
- A pure gate in ColdGasClient (e.g. `ReviewGate.swift`): ask when at least 3 sessions on different days each had a landing,
  **or** a license (Bronze or above) was just passed; never on the first landing, never in a session that had a crash
  report, at most once per app version, and not within 30 days of the last ask.
- Fired with `requestReview` (SwiftUI `@Environment(\.requestReview)` / `AppStore.requestReview(in:)`) only on the title,
  or on the results after the landing beat has finished and the player has acted once (e.g. back on the title); never during
  a countdown, run, replay or the first-landing moment, never over the share sheet.
- No custom "Do you like it?" pre-prompt (Apple discourages it), no reward for rating.
- Not in UI tests or tools (like `WhatsNewGate`).

## Acceptance criteria
- [ ] Unit: the gate's truth table (first landing → no; 3 landed sessions on 3 days → yes once; a new version → may ask
      again; mid-run states → never).
- [ ] UI test: no prompt call in any run, countdown, replay or the first-landing moment (a test hook counts calls).

## Test plan
ColdGasClient unit tests for the gate; a UI test with the hook.

## Out of scope
The web (there's no store prompt on the web). Any in-app review form.
