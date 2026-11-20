---
id: 0339
title: Mud, snow and ice sound like themselves under the tyres
status: ready
priority: P2
size: S
lens: player-feel
created: 2026-11-19
pr: 
by: operator
---

## Why
The tyre bed has paved, gravel, grass and wet voices; mud squelches, snow creaks and ice hisses as gravel or nothing.

## What
- SoundFeed reads GroundMatter, and the bed gets three voices.

## Acceptance criteria
- [ ] Each matter has its own voice
- [ ] AudioTests cover them

## Test plan
`make test` (AudioTests); listen on the simulator.
