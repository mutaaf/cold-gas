---
id: 0077
title: The HUD audit's wreck frame measures a cue that is still there; no false contrast failures
status: ready
priority: P1
size: S
lens: tech-health
created: 2026-10-23
pr:
by: critic
---

## Why
The lockdown requires every PR to leave `scripts/hud-audit.mjs` clean. On production, the audit's own
wreck frame fails it intermittently, for a reason a player never sees.

Measured on production (3b64abf, 2026-10-23 04:00, docs/critique/2026-10-23-0400.md). Four audits of
390×844 failed its `9-wreck` frame three times:

| Run | Mode | Result |
|---|---|---|
| 1 | compact | 4.11 |
| 2 | compact | 6.08 (passed) |
| 3 | compact | **4.0** |
| 3 | full | **1.99** |

Run 3 printed the label's name: both of its failures were the cue `The reference run: the Wall, then
the lineup`, the only label under 4.5:1. Run 1 didn't print names, but its frame shows the same cue
over the same white semi. `docs/critique/2026-10-23-0400/audit-390x844-full-9-wreck.jpg` shows the
cue box intact on its 0.9 glass, which composites to ≈ 16:1 over white.

The cause is the cue's wall-clock timer:
- The wreck is the reference flight, so `startRun` (src/main.js:336) shows that cue for 2400 ms of
  `performance.now()` time.
- The audit steps the whole flight synchronously (`liveStep` ×≈ 140), which took 407–659 ms in a
  probe. It then waits 600 ms, `freeze()`s and `measure()`s.
- `freeze()` sets `S.paused`, but `ui.tickCue` (src/ui.js:100) still expires the cue on real time.
- So the cue is often still `on` (opacity 1, probed 3/3) for the frame screenshot, and gone for the
  text-hidden "bare" screenshot taken after it.
- Its text is then measured against the bright semi behind the vanished glass, and 1.99:1 comes out.

How fast the runner is decides the result, so the audit is flaky on exactly the frame 0072 added. A
builder who trusts it will "fix" glass that already holds 16:1. #93 raised the cue glass 0.82 → 0.9
for a real case; this one isn't real.

## What
- `scripts/hud-audit.mjs` `measure()`: the frame screenshot and the bare screenshot must show the same
  set of visible HUD elements. Either:
  - hold every wall-clock-timed overlay (the cue, via `ui.clearCue` or a held cue) across the pair; or
  - re-read the measured elements' visibility, opacity and rect after the bare shot, and re-measure
    (or fail loudly as "changed during measure") if any differ.
- The wreck step: a player can't see the reference-run cue at a wreck, so clear the cue before the
  wreck frame (or don't fly it as the reference).
- No game code changes are needed. If the fix touches `ui.tickCue` (pausing the cue's clock while
  `S.paused`), that is a player-visible change and needs its own test.

## Acceptance criteria
- [ ] `node scripts/hud-audit.mjs <url> <dir> 390x844 x both`, run 5 times on one build: the `9-wreck`
      frame reports **0 labels < 4.5:1** in all 10 frames (compact and full).
- [ ] The audit still catches a real failure. Plant `color: rgba(245,246,248,0.25)` on
      `.h-strip [data-ch="spd"] .h-lbl` locally: the audit reports that label < 4.5:1 at 390×844.
      Then revert.
- [ ] `measure()` reports any HUD element whose visibility, opacity or rect changed between the
      frame shot and the bare shot. A unit-sized check in the script is fine: it prints "changed
      during measure" and counts it as an issue.
- [ ] The full `quick` set (390×844, 844×390, 1280×720, both states) stays at 0 overlaps,
      0 offscreen, 0 text < 11 px and 0 labels < 4.5:1.

## Test plan
Run the audit repeatedly as above and paste the five TOTAL lines into the PR. The plant-and-revert
check is manual, also with its line in the PR. No e2e change is needed: the audit is a script.

## Out of scope
The cue's styling (it already holds ≈ 16:1). The other audit frames. `title-audit.mjs` (0 issues on
production at 18 viewports, 2026-10-23).
