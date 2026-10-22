---
id: 0064
title: The judges' theatre never draws with a deleted WebGL program or buffer
status: ready
priority: P1
size: S
lens: tech-health
created: 2026-10-22
pr:
by: critic
---

## Why
Every judged run on production spills WebGL errors into the console. Reproduced 2026-10-22 on
production (81899cb) at 390×844 touch, one Show reference and nothing else: at the results, with the
theatre on its compute stage, eight errors in 3 ms:

```
WebGL: INVALID_OPERATION: useProgram: attempt to use a deleted object
WebGL: INVALID_OPERATION: uniform2f: location is not from the associated program
WebGL: INVALID_OPERATION: uniform1f: location is not from the associated program
WebGL: INVALID_VALUE: getUniformLocation: attempt to use a deleted object   (×4)
WebGL: INVALID_OPERATION: bindBuffer: attempt to use a deleted object
```

The 1440×900 play-through (Show reference, results, replay, back to the title, a second run) logged the
same set. `getUniformLocation`/`uniform2f` are raw WebGL calls: three.js caches locations, the
`aurora-field` particle field does not. The theatre creates a field on one shared canvas per call
(`src/ai/theatre.js:149`, `:197`, `:417`), so every call gets the same WebGL context, and `destroy()`
(`aurora-field` 3.2.0, src/aurora-field.js:2013) deletes its programs while a frame or a queued
`setShape`/`signal` of the same or the next field can still draw with them. Today it's console noise
(and noise in the obs beacon); on a strict driver a draw with a deleted program is a black or garbage
frame in the one screen that shows the AI working. Invariant 1 asks for a clean console.

## What
- `src/ai/theatre.js`: make field teardown ordered: stop the pulse and any pending morph timers, cancel
  the field's frame before `destroy()`, and never let a new call's `create()` share a context with a field
  that is still alive (destroy the old one first, or give each call its own canvas and release its
  context with `WEBGL_lose_context` when it closes).
- If the fault is inside `aurora-field` (a frame after `destroy`), guard it here and note it in
  docs/LESSONS.md; don't patch node_modules.

## Acceptance criteria
- [ ] e2e: with the judge stream stubbed (no network), three judged runs in a row at 390×844 touch and
      at 1440×900, including a Skip mid-stream and a Retry while the theatre is still fading: **0** console
      messages matching `/WebGL: INVALID_/`.
- [ ] The quest theatre (Free Drive or the Sandbox side quest) opened twice: 0 such messages.
- [ ] After 20 theatre opens, the page holds at most 2 live WebGL contexts (the game's and the theatre's);
      the game canvas never logs "context lost".
- [ ] Theatre visuals unchanged: `node scripts/theatre-shots.mjs` before/after in the PR.

## Test plan
A new e2e that stubs `/coldgas/api/judge/stream` with a canned SSE (verify → prompt → tokens → done),
flies `startRun('reveal')` + `skipCountdown()`, and collects console messages through the theatre.

## Out of scope
The theatre's design and copy, the AI providers, deadlines (0048).
