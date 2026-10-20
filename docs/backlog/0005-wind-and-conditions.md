---
id: 0005
title: Daily conditions — seeded crosswind and air temperature
status: proposed
priority: P2
size: M
lens: content
created: 2026-10-19
pr:
---

## Why
A daily board is more interesting when every day is slightly different: a crosswind that
pushes the car off the centreline, or cold air that changes thrust.

## What
Seed the conditions by UTC date (shared by the client and the Worker). Add a lateral wind force
in `step()` and change blowdown with temperature. Show the conditions on the title and the HUD.
Bump `SIM_VERSION`. The Worker must use the date the run was flown on (send it in the payload and
reject runs dated more than a day away).

## Acceptance criteria
- [ ] Same date gives the same conditions on client and server; the replay stays bit-exact
- [ ] The reference autopilot still lands clean in every condition the generator can produce

## Test plan
Unit tests: the generator's range, autopilot sweeps across 30 seeds, and determinism.

## Out of scope
Rain or visual weather.
