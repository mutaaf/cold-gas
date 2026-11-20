---
id: 0338
title: Trees sway under a hit they hold, and delineator posts bend and break
status: ready
priority: P2
size: M
lens: authenticity
created: 2026-11-19
pr: 
by: operator
---

## Why
A tree under its strength is rigid, and delineator posts have no collider at all.

## What
- A tree hit under its strength sways (a damped spring on its instance); delineator posts are breakable items.

## Acceptance criteria
- [ ] A 10 m/s hit on a thick tree shakes its crown
- [ ] A post is knocked flat and lies there

## Test plan
Simulator shots and a test like TreeSnapTests.
