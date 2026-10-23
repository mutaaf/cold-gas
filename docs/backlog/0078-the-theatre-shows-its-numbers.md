---
id: 0078
title: The judges' theatre shows its numbers; the run's figures one by one, bright, then the call's own
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-10-22
pr: 104
by: operator
---

## Why
The operator: "none of the aurora-field AI metrics is visible and it scrolls by fast; we need it brighter
and way more of them."

Before this change, the theatre's TEXT stage (src/ai/theatre.js) spelled one frame of three figures
(`26.9M 177° 0.8M/S` on the Show) for 2.4 s, in SI whatever units the player had picked. The particle letters
sat on a plane at the centre of the field, where the field draws each point ~2 px at ~43 % alpha and fogs it
toward the background, so the figures were a grain of dim teal dots. Measured on screenshots (Chrome, Metal),
the brightest 5 % of the figure's box against its median was 2.2:1 on a 390×844 phone and 1.2:1 on a
1280×720 desktop. The text also swayed (the field's "facing" idle). The counters (`.th-stats`) were 12 px
values with 10 px labels in the dim ink. The raw stream kept the last 360 characters, so every token cut a
few characters off the top and reflowed every line, scrolling 8 lines of 12 px text past at 12–45 ms a token.

## What
- **The figures (src/ai/theatre.js)**
  - TEXT is now a sequence: each frame is one figure, label over value, in the player's units
    (src/units.js `one()`, as the HUD shows them; `U` swaps them).
  - The figures are the run's real facts from the judge's card (`card.facts`) and the run's telemetry:
    LIP (speed at the lip), WALL, INVERTED, APEX, OVER ROOF, AIR (lift-off to touchdown ticks), ROLL, PEAK (G),
    CLEAR, SINK, SYNC, MISS, N2 LEFT, HULL and SCORE. A figure shows only when the run really has it.
  - The six most telling play every time, in flight order: SCORE, APEX, ROLL, HULL when damaged, SINK,
    CLEAR, LIP, PEAK… If the call hasn't answered yet, up to four more fill the wait.
  - Each figure lasts `FIG_MS` 1.4 s: a 450 ms morph, then about 1 s settled.
  - Once the call answers, its own numbers are spelled during COMPUTE, `CALL_MS` 1.3 s each: OUT n TOK,
    SPEED n TOK/S, TTFT n MS. The stream steps aside (`data-spell`) while they show. They're skipped when
    the 35 s deadline is within 9 s.
  - Then the verdict.
  - **Added time, at most:** a fast call takes 6 × 1.4 − 2.4 + 3 × 1.3 ≈ 9.9 s longer than before. A slow
    call fills its wait with figures and adds nothing. Skip still ends the show on the tap once the words are
    in. Retry / Home are untouched, and the 35 s deadline still holds.
  - **Brighter:**
    - The glyph plane sits at z −0.7, toward the viewer. The field draws points there ~3.2 px at ~80 % alpha
      with a white core.
    - The spell palette is lifted to near-white (still the aurora's green-cyan tint), and the call's frames
      use it too.
    - Edges take 0.78 of the particles (was 0.72).
    - The field has 3000 particles on a phone and 4200 on a desktop (was 2600 and 3600).
  - **Bigger, where room allows:** each figure is fitted in screen px into the free box between the caption
    and the cards, measured when the figure is registered (≤ 84 % of the width, ≤ 680 × 340 px). The lines
    are centred.
  - **Steady:** a fixed pose (`setPose`) holds the text square to the viewer, with no sway. Autonomy is 0.
  - **No leaks:** aurora-field has no unregister, so the shapes come from a ring of 32 slot names. Reusing
    a name re-registers it, which clears the library's cache for it. When a show ends, its slots are stubbed,
    so its rasters are freed. The next figure is registered and compiled in idle time (`field.prepare`)
    while the current one shows. Nothing is added per frame.
- **The counters (src/styles.css, `.th-stats`):** values are 15 px / 500 mono in near-white (13 px on a
  short sideways screen), and labels are 11 px in the raised ink (0.86). "Billed by provider" became
  "By provider" so it stays on one line.
- **The stream:**
  - Tokens play at a reading pace: at least 34 ms each, at most 80 ms, and the backlog is sped up so it
    never takes more than 5 s.
  - The box keeps the whole text and clips to its last lines. It's trimmed only past 1,400 characters, at
    a line break, so lines no longer reflow on every token.
  - Fewer, larger lines: 5 lines at 14 px on a desktop and 15 px on a phone (was 8 lines at 12 px, and 7
    at 13 px).
- No sim change.

## Acceptance criteria
- [x] For a real run (the reveal on the Show), the TEXT stage spells ≥ 5 distinct figures in sequence,
      each held > 1 s (`tests/e2e/theatre.spec.js`).
- [x] The figure's region has a clear brightness margin: the brightest 2 % of its box is > 4.5× brighter
      than its median, in the e2e (software GL). On screenshots (Chrome, Metal), the brightest 5 % against
      the median rose from 2.2:1 to 17.4:1 on the phone and from 1.2:1 to 10.6:1 on the desktop.
- [x] The call's numbers (TOK, TOK/S, TTFT) are spelled once its `done` arrives; the counters show them.
- [x] Skip during the figures ends the show on the tap; the judges' words land.
- [x] Counters: text ≥ 11 px, on the cards' dark glass (well past 4.5:1), fit at 390×844 and 1280×720;
      no new hud-audit failures.

## Test plan
`tests/e2e/theatre.spec.js`: two new tests against a canned stream. One records every spelled figure
(`data-fig`) and its stage, measures the figure box (`data-fig-box`) on a screenshot, checks the call's
frames and the counters, then taps Skip. The other taps Skip mid-sequence.

## Out of scope
The theatre's sideways layout (844×390: the cards overlap the caption beside the sheet), its control sizes
and the rail / Skip positions are a parallel change.
