---
id: 0082
title: The HUD and title audits are a gate; the full HUD fits a 340 px landscape screen; the judges' theatre has 44 px controls and fits sideways
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-23
pr: 105
by: builder
---

## Why
The accessibility floor (AGENTS.md invariant 3.8: 0 HUD overlaps, no text under 11 px, labels at 4.5:1,
44 px targets) is measured by `scripts/hud-audit.mjs` and `scripts/title-audit.mjs`, but they only print:
nothing fails when a number goes up, so the floor erodes between audits. To make them a required CI check
they have to be green today, deterministic on software GL, and split across parallel jobs. Three things
kept them red or blind: the full HUD (after MORE) overlapped itself 28 times closed-sideways on the folding
phone (678×340: the seven readings got 239 px in one wrapped row, the attitude dial ran into the thumb pad,
the mission row into the vehicle panel) and twice at its 466×498 mid-swing size (the cue line on the pad,
0075's out of scope); the judges' theatre was never measured at all, and its Retry, Home and Skip were
34 px tall; and sideways at 844×390 the theatre was a 324 px column beside the sheet, its step rail
clipped on the left, Skip sitting on it, its panels piled on each other.

## What
- `src/styles.css`, the full HUD on a very short landscape screen (≤ 370 px tall: the height the band's
  stack needs, not a device): the mission row rides up into the top bar's gap between the brand and the
  buttons; the cue line takes the band it leaves, between the primary and the right column; the dial
  carries its roll beside it and the damage reads in one line under it, all above the thumb's arc; the
  primary packs down (time to ground stays on the tape); the readings sit in two rows of three between the
  stick and the right thumb (N₂'s units each on a line), LESS on their top edge. Upright under 540 px
  (466×498) the cue line keeps left of the pad, just under the strip. Nothing else matches the queries.
- The judges' theatre: every control is a 44 px target (the pills keep their size; a `::after` hit area runs
  past them up and down, as the top bar's Menu does, 0073); its 10 px labels (the rail, the card's eyebrow,
  the counters' names) are 11 px. On a short landscape screen (≤ 480 px tall) it takes the screen as on a
  phone, with Retry · Home (and the Rookie offer, 0076, inline) and Skip in a bar along the top, the rail
  and the caption under it, and the model card, the stream and the counters side by side (30 · 40 · 30 of
  the width inside the insets). An opened folding phone (951×543) gets the bar too: its theatre already
  covered the sheet's Retry and Home (0075).
- Found by the new theatre frame: beside the sheet on a tablet the theatre is a 248–660 px column, and
  Skip sat on the rail (all six iPad sizes and 1080×1920) and the stream's glass on the card. By the
  column's own width (a container query, only where it stands beside the sheet): under 700 px Skip goes up
  to the corner; under 560 px the column stacks as a phone's (counters at the foot, the card over them, the
  stream over the card, as tall as the room under the caption); under 360 px the rail names only the stage
  it is on. On a phone the stream's glass is capped by the room under the caption (it reached a three-line
  caption at 320×568, 382×580 and 466×498).
- The critic's 0077 (the wreck frame's false contrast failure), found here independently: the audit held
  the cue line on whenever it had text, even after it had faded, racing the page's own clock (a stale
  "The reference run…" from the wreck's autopilot measured 1.93:1 at 430×932s). Now it is held only if it
  is showing at the freeze, pinned until the thaw; the wreck clears the autopilot's announcement, which a
  player's own wreck never shows; and `measure()` compares every measured box and label (rect, effective
  opacity) between the frame shot and the text-hidden shot, reporting and counting any "changed during
  measure".
- Found by the second gate run: at 678×340 a wide LIMIT (`63.5 ft/s 19.4 m/s`) pushed the primary into the
  cue line (the limit reads in one unit system there now, as at 320×568), and in Free Drive sideways with a
  notch's insets the arrival title sat on LIFT (`src/drive/drive.css`: the cue stops at the right thumb's
  arc, 271 px in, as the strip does).
- `scripts/hud-audit.mjs`: once per viewport the theatre is measured, held up by a judge stream that is
  never answered (`page.route`), at COMPUTE with a fixed worst-case call (the stream on its glass, a long
  model id), its motion stopped and its particle field hidden (any frame of it is a sample;
  `scripts/theatre-shots.mjs` measures the field's legibility); its boxes for overlaps and for leaving the
  theatre, its text for size and contrast, and every button for a 44 × 44 px target (the square on its
  centre, sampled with `elementFromPoint`, must all be the button). On a phone it is measured again with
  the Rookie row.
- Both audits are a gate: exit code 1 when any count is non-zero (overlaps, offscreen, text < 11 px,
  labels < 4.5:1, targets < 44 px, frames never reached), offenders listed at the end. `--shard=N/M` runs
  every M-th viewport; the old positional usage is unchanged. Deterministic: while a frame is measured the
  3D renderer is held (the sim was already frozen; render-time sparks, dust and drift now hold too) and
  every CSS animation is at rest (a blinking BRAKE is measured lit, not at a random phase). Software GL off
  macOS (as the e2e config), and every wait × `AUDIT_SLOW` (2 when `CI` is set).
- `scripts/serve-and-audit.mjs` (`npm run audit`): serves `dist/` with `vite preview --strictPort` on a
  private port (4655), waits for it, runs one HUD shard and (with shard 1) the title audit, stops the
  server, exits with their code.
- No sim change.

## Acceptance criteria
- [x] `node scripts/hud-audit.mjs <url> <dir> 678x340,466x498` (both states): 0 overlaps, 0 offscreen (was 30
      overlaps in the full HUD); every other viewport's layout unchanged.
- [x] The theatre at 844×390, 932×430, 678×340, 951×543 and 390×844: no overlaps, nothing outside it, Retry,
      Home and Skip present, every control a 44 px target (`tests/e2e/theatre.spec.js`).
- [x] `npm run audit -- --shard=1/3`, `2/3`, `3/3` each exit 0 (all 27 viewports, both HUD states, the theatre
      at each), and the title audit exits 0; the whole gate run twice, green both times.
- [x] Any non-zero count fails the run with exit code 1 and names the frame and the offender.
- [x] Works at 390×844 touch and 1280×720 keyboard (unchanged there; the theatre's labels 10 → 11 px).

## Test plan
`tests/e2e/theatre.spec.js`: at five viewports a crashed run's theatre, held up, gets a fixed long call;
its panels and controls must not overlap or leave it, Retry/Home/Skip must be there and every button's
44 px square must hit it. The HUD audit and the title audit, all shards, twice; screenshots of the full HUD
at 678×340 and of the theatre at 390×844, 844×390 and 678×340 looked at.

## Out of scope
Wiring the check into CI (`.github/workflows/` is the operator's: the recommended steps are in the PR). The
particle field's legibility under the theatre's text (scripts/theatre-shots.mjs). Target size of the HUD's
own controls and the top bar (other tickets); the gate checks the theatre's.
