---
id: 0083
title: The audit gate is green on CI — two layouts that depended on a pixel of text, a faint clock, deterministic waits, shards by cost
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-23
pr: 108
by: operator
---

## Why
#105 made `scripts/hud-audit.mjs` and `scripts/title-audit.mjs` a gate (`npm run audit`), green twice on a
Mac. #106 ran it on CI (ubuntu-latest, SwiftShader, `CI=1`) in three shards, and all three failed:
- 678×340 compact 2-climb: the phase tab over the band (3173 px²) and its handle (355 px²);
- 393×659 full 1-runup … 4-carry: the cue line on the strip (≈ 2400–3000 px²);
- Free Drive at 768×1024 and 820×1180 compact: `0:00.0` at 4.28:1 and 4.37:1;
- 1080×1920 compact and full: the results never came up inside the 60 s wait;
- shard 1 (both 1080×1920s, 1280×720, the title audit) ran into the job's 45 minute timeout.
And a stray "E" showed behind QUESTS in Free Drive at 844×390 with a notch's insets.

## Root causes
- **678×340 (real):** the band's cells were wrapping lines. With `11 mph · 31.1 ft · 655 lb` the N₂ cell had
  58 px of content in 59 px on a Mac and in 58 px on the runner (Linux's font rasterising), so there `lb`
  broke under `655`, the band grew a row (47 → 63 px) and ran into the phase tab, which stands at a fixed
  height on it. Reproduced in the Playwright Linux image: 63 px with 11/31.1, 47 px with 9/0.0. The same
  wrap, found by the first local gate run in that image, at 814×380 with a notch's insets on the wreck
  frame: `18.5 ft` beside `WRECKED 66 %` (a band of 281 px).
- **393×659 full (real):** N₂'s second line (`297 kg · 10.0k psi 690 bar`) wrapped to two lines or three by
  a pixel of the cell's width; at three (the runner) the strip's foot was at 425 px and the short-portrait
  cue line at 414.
- **Free Drive's clock (real):** waiting to start, the timer is drawn at 0.6 opacity; over a day sky at the
  top of an iPad's frame that is ≈ 4.3:1. Which bit of sky is behind it moved with the frame rate (a 2.5 s
  wall-clock press).
- **1080×1920 results (audit):** the aftermath and the results' 1.4 s beat ran on the wall clock. The clock
  caps the sim at 0.1 s a frame, and a 1080×1920 frame on software GL takes ≈ 0.5 s, so the sim ran at a
  fifth of real time and missed a 60 s wait.
- **Timeout (audit):** `--shard=N/M` took every M-th viewport; the costs differ 4× (320×568 ≈ 110 s,
  1080×1920 ≈ 360 s on the runner) and the title audit (≈ 40 s a viewport there, 23 viewports) rode with
  shard 1.
- **The "E" (real):** the stick's STEER label stands 26 px above the stick, outside its box, so the audit
  never measured it; in Free Drive sideways the full set's third row of chips (BUILD · QUESTS · ARCADE)
  reaches down to it once a notch's insets lift the stick, and its E showed between two chips.
- **Thin margins (found by `minLabel` in the local gate runs, all above 4.5 but not by much):** the wreck
  frame's aftermath beat was 600 ms of wall clock, so the car and its debris behind the labels moved with
  the frame rate (393×659 full: FAN's `0 kgf` at 5.79:1 in one run, 4.51:1 in the next); the strip's
  second units are drawn at 0.72; the one-thumb pad's glass is 0.5, and HOLDING over the parked row's gold
  car read 4.73:1 at 669×825.
- Also found: `npm run audit` never got an answer from `vite preview` in a Docker image whose `/etc/hosts`
  lists `localhost` as both 127.0.0.1 and ::1 (vite bound ::1, Node's fetch tried 127.0.0.1).

## What
- `src/styles.css`: sideways, a cell of the compact band is a grid: its label over one line, the reading
  and its unit, which never part (a reading that outgrows its cell spills sideways by a few px; the band's
  height never depends on text). On a band ≤ 260 px the cells pack 1 px tighter a side:
  `11 mph · 31.1 ft · 655 lb` leave 9 px.
  Upright under 740 px, N₂'s line reads in the leading units only (as at 320×568): one line, whatever the
  reading; the strip's foot is at 396 px under a cue line at 414.
- `src/styles.css`, margins: the strip's second units at a label's weight (`--lbl`, 0.86; still the smaller
  line); the one-thumb pad's glass as dark as the HUD's (0.62).
- `src/drive/drive.css`: the waiting clock at a label's weight (0.86, as `--lbl`, ≈ 6.5:1 over that sky);
  sideways, the stick's STEER label sits inside its ring, at the top above the dashed circle.
- `scripts/audit-plan.mjs` (new): the viewports and a shard plan by estimated cost (seconds on a runner,
  fitted on #106's run: 90 + 155 per CSS megapixel + 50 with Free Drive + 15 with touch; within 0.8–1.3×
  of every viewport), the title audit one item of it; longest first to the least-loaded shard.
  `hud-audit.mjs --shard=N/M` flies its share; `serve-and-audit.mjs` runs the title with the shard that
  holds it. 6 shards: 1123–1206 s estimated (1.07×).
- `scripts/hud-audit.mjs`: after touchdown the aftermath and the results are stepped in the page
  (`fastForward`, the e2e hook); every wait is on a condition and generous (120 s, × 2 on CI; a frame is
  taken as soon as it holds); Free Drive presses on to 6 m/s instead of 2.5 s of wall clock; the stick's
  label is a measured box; the wreck's 0.6 s aftermath beat is stepped in the page and frozen there; each
  frame reports its lowest label (`minLabel`), so a margin can be watched, and each
  viewport's seconds (the report's `seconds`, the title audit's log), to re-fit the cost model.
- `scripts/serve-and-audit.mjs`: serves on 127.0.0.1 and browses there.
- No threshold, viewport or frame was loosened or dropped. No sim change.

## Acceptance criteria
- [x] In the Playwright Linux image (v1.64.1, Node 22, SwiftShader, 4 CPUs, `CI=1`): the band at 678×340
      stays 47 px with every reading tried (9/0.0 … 112/131.2 and a near-empty tank); the strip at 393×659
      ends at 396 px (it ended at 425 with three N₂ lines).
- [x] `npm run audit -- --shard=N/6` for N = 1…6 each exit 0, the whole gate twice, in that image
      (one shard at a time, a runner each); per-shard times in the PR.
- [x] `tests/unit/audit-plan.test.js`: every viewport and the title once for 1–8 shards; 3–6 shards within
      1.5× of each other; deterministic.
- [x] Works at 390×844 touch and 1280×720 keyboard (unchanged there).

## Test plan
The six-shard gate twice in the Linux image; the band/strip probe with worst-case readings before and
after; `npm run lint`, `npx vitest run`, `npm run build`, the HUD/drive/touch/fold e2e specs with
`--workers=1`. Screenshots of 393×659 full and 844×390s Free Drive looked at.

## Out of scope
`.github/workflows/ci.yml` (the operator's, #107: the matrix to `[1..6]` with `--shard=N/6`, 40 minutes
a shard); making the job required once it has run green there.
