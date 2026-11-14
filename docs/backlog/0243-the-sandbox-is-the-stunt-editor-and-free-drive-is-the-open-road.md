---
id: 0243
title: The Sandbox is the stunt editor and Free Drive is the open road, with wrecks reported there
status: proposed
priority: P2
size: M
lens: content
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club (operator's call 2026-11-13): the Sandbox becomes the stunt editor, and Free Drive stays the unscored open road.
Players already build with pieces and share `#b=` links; now they can build a crash course for a friend.

## What
Depends on: 0237.
- The Sandbox (src/build/) is presented as the stunt editor: build a stunt or crash course from the existing pieces, see
  0237's combos on a wreck there (reported, unscored), and share it with `#b=` as today.
- Side quests (quest-gen.js and the quest schema) can ask for wrecks (a ×3 combo, topple a piece); the quest schema change
  stays in `src/build/quest-schema.js` (the Worker checks it too, so only additive, backward-compatible fields).
- Free Drive reports combos when you crash out there, unscored, never on a board.

## Acceptance criteria
- [ ] A Sandbox wreck shows its combo chain and no score is posted anywhere.
- [ ] A generated wreck quest passes `quest-schema.js` and an old quest still passes.
- [ ] Free Drive shows combos after a crash; no scored run changes.
- [ ] 390×844 touch and 1280×720 keyboard; audits pass.

## Test plan
Unit tests for the quest generator's wreck quests and the schema; an e2e Sandbox crash.

## Out of scope
New build pieces. The iPhone's Sandbox and Free Drive reports (follow-ups after 0239). Roam's backlot (0239).
