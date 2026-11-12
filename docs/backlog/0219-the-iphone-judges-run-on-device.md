---
id: 0219
title: On the iPhone, the judges' words come from Apple's on-device model when it is there (no network, $0)
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-11-12
pr:
by: operator
---

## Why
The owner (2026-11-12): "use Apple Intelligence locally as a judge, and update and promote that in our app submission and
app." On an iPhone or iPad with Apple Intelligence, the panel can speak without a network call, a key or a cost, and no
data leaves the device. Everywhere else nothing changes: the edge model, then the local lines.

## What
Runs on: the operator's Mac (Xcode 27.2: the FoundationModels SDK and the simulator).
- `ios/ColdGas/Net/OnDeviceJudge.swift`: Apple's on-device model (`SystemLanguageModel.default`) behind
  `#if canImport(FoundationModels)` + `@available(iOS 26, *)` (the app still targets iOS 18). Guided generation
  (`@Generable`) writes the same four parts as the cloud panel (headline, engineer, coordinator, designer), from the same
  brief as src/worker/ai/prompt.js (the three voices and the run's numbers only), streamed part by part.
- ColdGasClient `OnDeviceJudge.swift` (pure, tested on macOS with a fake model): the route (on-device when available and
  not turned off, else the cloud), the on-device call's own deadline inside JUDGE_MS, the fallback to the edge model and
  then the local lines, and the receipt's words.
- Settings → Judges: which brain judges on this device, and a switch to send the call to the edge model instead.
- The results sheet: a small "on device" marker and the receipt (Apple's on-device model, tokens, $0, no data left the
  device).
- What's new 1.1.0 (release-notes/1.1.0.md) and the next version's store copy.

## Acceptance criteria
- [ ] With Apple Intelligence available, the words come from the on-device model and the receipt says so: on this
      device, tokens (reported, or an estimate labelled as one), $0, no data left the device.
- [ ] Unavailable (old OS, ineligible device, turned off, model not ready) or failed (guardrail, context window, assets,
      language, deadline): the edge model, then the local lines; the results never wait past JUDGE_MS.
- [ ] Local lines are never labelled as the model's.
- [ ] `cd ios && make test` green (vectors bit-exact); the app builds for the simulator.

## Test plan
`OnDeviceJudgeTests` (ColdGasClient): route selection, success with no cloud call, each failure falling back to the
cloud with the time left, a hang cut at its deadline, incomplete words, the receipt lines, the brief's facts. One real
on-device judging on the simulator if Apple Intelligence is available there.

## Out of scope
The web game, the Worker, the scores. Submitting, uploading or changing the 1.0.0 version in App Review.
