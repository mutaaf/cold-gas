---
id: 0256
title: On the iPhone, licenses lead the title and Free play keeps every tier open, held to the web's rules by the vectors
status: ready
priority: P1
size: M
lens: platform
created: 2026-11-13
pr:
by: operator
---

## Why
The same as 0255, on the platform most players use. The app's tier is three capsules on the title saved as `cg.tier`
(ios/ColdGas/UI/GameUI.swift:176), and its progress is split across `coldgas.save.v1` (medals, the daily) and loose keys.

## What
Runs on: the operator's Mac (Xcode).
**Waits for the native UI redo** (0230, PR #368, `ios/ColdGas/UI/`: title, results, HUD); build on its title.
Depends on: 0254 (rules and vectors), 0255 (the web's design), 0249 (first-run counters).
- ColdGasClient: port `progress.js` and `licenses.js` (e.g. `Progress.swift`, `Licenses.swift`) into `SaveData`, with the
  migration from today's medals; held to the web's test results by the vectors.
- The title (as 0230 left it) leads with the next license test as the tall primary button; Free play holds today's course
  and tier choice, all tiers open. A licenses sheet in the same style as Board and Practice.
- Passing a test: a line in the landing beat and a Core Haptics flourish of its own (ios/ColdGas/Haptics/), once.
- `license_pass` through 0246.

## Acceptance criteria
- [ ] Unit (ColdGasClient): every vector run's license results match the web's; the migration credits medals.
- [ ] UI test: a fresh install leads with Rookie's test; Free play shows all three tiers; passing a test shows once.
- [ ] Look-shots of the title and the licenses sheet in portrait, landscape and the Duo's poses.

## Test plan
ClientVectorTests extended; UI tests above; `ios/scripts/look-shots.sh`.

## Out of scope
Wreck Club ranks on the iPhone (a follow-up to 0242 and 0239).
