---
id: 0236
title: On the iPhone, the authored lines speak first and Apple's on-device model is the free upgrade, with no automatic cloud call
status: proposed
priority: P1
size: M
lens: platform
created: 2026-11-13
pr:
by: operator
---

## Why
The operator's call, 2026-11-13 (Option B, AGENTS.md 5½): the iPhone keeps Apple's on-device judge (0219) as a $0
upgrade, and the authored lines are the default everywhere. Today, without Apple Intelligence or on any on-device failure,
the app calls the edge model; under Option B the authored lines stand instead, and nothing waits on a network.

## What
Runs on: the operator's Mac (Xcode).
Depends on: 0235 (the engine and its lines as data, and the vectors that carry them).
- ColdGasClient: port 0235's engine (Panel.swift grows, or a new Commentary.swift) and bundle its lines file unchanged;
  held to the web's words by the vectors.
- The landing moment and the sheet show the authored lines at once. Where Apple Intelligence is available and Settings →
  Judges is on, the on-device words replace them as they arrive, with the "Judged on device" mark and today's receipt.
- Without it, or on any on-device failure: the authored lines stand. Judges.swift makes no automatic edge call.
  Settings → Judges says which voice is in use.
- Release notes for the next version (ios/release-notes/) mention the change truthfully; store copy keeps "JUDGED ON YOUR
  DEVICE".

## Acceptance criteria
- [ ] `cd ios && make test` green with the vectors bit-exact, including each vector run's lines.
- [ ] With no Apple Intelligence, a finished run makes no network call for the judges and shows authored lines labelled as
      the game's own.
- [ ] With Apple Intelligence, the on-device words arrive and the receipt says on this device, tokens, $0, no data left the
      device; on a forced failure the authored lines stand.
- [ ] The app builds for the simulator; shots in docs/shots/0236/ of the landing line and the sheet.

## Test plan
ColdGasClient tests for the route (on-device, else authored; never the edge without an ask) with a fake model; vectors.

## Out of scope
An "Ask the AI panel" button on the iPhone (a follow-up if the owner wants it). The crew's voices (0240 ships them as data).
Building before the in-flight UI, rendering and collision work in `ios/ColdGas/UI/` has landed.
