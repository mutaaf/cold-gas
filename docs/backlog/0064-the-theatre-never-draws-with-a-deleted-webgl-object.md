---
id: 0064
title: The judges' theatre never draws with a deleted WebGL program or buffer
status: shipped
priority: P1
size: S
lens: tech-health
created: 2026-10-22
pr: 158
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
- [x] e2e: with the judge stream stubbed (no network), three judged runs in a row at 390×844 touch and
      at 1440×900, including a Skip mid-stream and a Retry while the theatre is still fading: **0** console
      messages matching `/WebGL: INVALID_/`.
- [x] The quest theatre (Free Drive or the Sandbox side quest) opened twice: 0 such messages.
- [x] After 20 theatre opens, the page holds at most 2 live WebGL contexts (the game's and the theatre's);
      the game canvas never logs "context lost".
- [x] Theatre visuals unchanged: `node scripts/theatre-shots.mjs` before/after in the PR.

## Test plan
A new e2e that stubs `/coldgas/api/judge/stream` with a canned SSE (verify → prompt → tokens → done),
flies `startRun('reveal')` + `skipCountdown()`, and collects console messages through the theatre.

## Out of scope
The theatre's design and copy, the AI providers, deadlines (0048).

## Critic re-measure (2026-10-22 10:15, production 2ad8d46)
Still failing, and it reaches the draw calls. One Show reference per viewport, the theatre left to run:
at 390×844 and 1440×900 the same burst as at 04:00 (`useProgram` / `getUniformLocation` on a deleted
object, `uniform2f/1f` from the wrong program, `bindBuffer` on a deleted buffer), plus, within the same
6 ms, **`drawArrays: no buffer is bound to enabled attribute` (×3), `bufferSubData: no buffer` (×2) and
`vertexAttribPointer: no ARRAY_BUFFER is bound and offset is non-zero` (×4)**: 23 WebGL `INVALID_*` errors per
judged run on both viewports (docs/critique/2026-10-22-1015.md). Those draws produce no pixels,
so a frame of the theatre's field is being dropped, not just logged. The bar is unchanged: 0 WebGL
`INVALID_*` messages over the e2e in this ticket's test plan.

## Critic re-measure (2026-10-22 22:00, production da53d64)
**Not reproduced in 6 judged runs** (4 Show references and 2 crashes, at 390×844, 844×390 and
1440×900, all with the theatre live and Skip pressed). There were 0 `INVALID_*` and 0 `pageerror`;
the console had only SwiftShader's ReadPixels and parallel-compile notices. At 10:15 it was 3 of 6.
The bug is intermittent and still unexplained, so it stays `ready`. Close it only with the ticket's
own probe, never on a clean manual run.

## Shipped (2026-10-29, builder)
Root cause: aurora-field 3.2.0 draws a still frame on `set()` / `setShape()` when its loop isn't running
(`if (!running) draw(0)`), and after `destroy()` its loop never runs. A show cut short by Skip, Retry or the
fade still had `startCompute` queued behind the figures; when it came due, `setStage('compute')` called
`field.set()` + `setShape()` on the destroyed field, which drew with its deleted programs and buffers: the
exact burst above, every time a show ends during TEXT with the answer already in. Separately, every show made a
new canvas, whose context lived until GC: 20 shows left 16 live contexts (Chrome's cap). Now each show's field
is nulled before it's destroyed (every call goes through `field?.`), and one canvas serves every show, the last
show's field ended before the next is created. `tests/e2e/theatre-gl.spec.js` fails on main (64 INVALID_*
messages at 390×844; 16 live contexts after 20 shows; 3 after two quest designs) and passes here.
