---
id: 0304
title: The Free Drive tree-ram e2e drives the car at the tree dead on, so its verdict doesn't depend on runner speed
status: ready
priority: P0
size: M
lens: tech-health
created: 2026-11-19
pr:
by: critic
---

## Why
Main is red on `d77eeaa` (CI dispatch 1417, attempt 2). That commit only changed docs. One test failed on both tries:
`tests/e2e/scenery.spec.js:92` "@heavy Free Drive (Stelvio): … one stops the car", with `hit.past` −0.7924149865288257
against the bar < −1. The same src passed on `8ca7131` (dispatch 1415), and the diff since then is render-only.

The critic reproduced it in a sandbox (Chromium 1243, `?drive=stelvio&gfx=low`):
- **Unchanged test:** it passed 3/3 at first, then failed later with CI's exact value, −0.7924149865288257. Adding a
  1.5 s `waitForTimeout` between `ram()`'s set-up `evaluate` and its stepped `evaluate` also gives that exact value.
  - Between those two evaluates, the page's own rAF loop steps the car on wall-clock time, in 0.1 s capped frames,
    without the throttle. So the measured run starts from a state that depends on runner speed.
- **Set-up and stepping in one `evaluate`:** this is deterministic, but it fails every time at −0.49.
- **Per-frame log (along, lateral, speed, yaw):** the car isn't driven at the tree dead on.
  - Placed level and facing the trunk 12 m back, it yaws about 20°/s (181° → 199° in 1 s) with no steer input. It
    meets the trunk **1.58 m off-line**, a glancing blow: 7.9 → 2.4 m/s in one 0.1 s frame.
  - With the throttle still held, it then creeps round the bark at about 1 m/s. `past` drifts above −1 depending on
    how many of the 25 frames fall in that creep.
- **Zeroing `c.steer` in the set-up** changes nothing in the drift. One run then missed the tree entirely and **still
  passed** (`vMin` 5.1 < 9), because `vMin < 9` doesn't prove a hit.
- **Moving the run-in to 6 m:** the car slid 9 m sideways on that spot's slope, hit something else, and passed.

So the test is flaky, and in its passing runs it can also pass without hitting the tree. The trunk physics looks right:
a 5.5 m/s drop in one frame at contact. It's the scenario that's wrong.

## What
Rework `ram()` in `tests/e2e/scenery.spec.js` (shared with the Endless test at `:131`) so it proves what its comment
says: "dead on, the trunk stops it".
- Do the set-up and the stepped run in **one** `evaluate`, with the key already down, so the page loop can't run in
  between.
- Hold the car on the line to the trunk centre during the run-in:
  - either with a test-only steering pilot (e.g. `drive.autopilot` taking a target point, or a `drive.pilotTo(x, z)`
    hook in `src/drive/index.js`, test-only and deterministic);
  - or by placing the car settled on the ground's normal on a run-in the sim shows drifts < 0.3 m laterally.
- Assert the hit, not just a low speed: lateral offset < (car half-width + trunk r) at contact, a speed drop at contact,
  and the car's centre never closer to the trunk than its nose length along the line.

## Acceptance criteria
- [ ] `ram()` makes one `page.evaluate` for set-up and steps, and the result is identical with a 1.5 s
      `waitForTimeout` inserted before the call (deterministic, bit for bit).
- [ ] Stelvio and Endless: at contact, |lateral| < 1.0 m. `past` < −(nose length − 0.2) for the whole window.
      `vMin` < 3 m/s. 10/10 local repeats pass (`--repeat-each=10`).
- [ ] A run aimed 3 m off the trunk fails the hit assertion (a negative control in the spec), so a miss can never pass.
- [ ] No sim, scorer or `ref-hash` change. If a test hook is added to `src/drive`, it's off unless a test calls it.
- [ ] Main CI green.

## Test plan
`tests/e2e/scenery.spec.js`: the reworked `ram()`, a negative-control case, and the determinism check above.

## Out of scope
The Free Drive tree physics itself, which stops the car correctly when it is hit. The world streaming and draw/solid
parity checks in the same tests stand as written.
