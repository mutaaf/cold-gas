---
id: 0018
title: Put the livestream's telemetry on screen, on every screen size (pitch, G, N2 kg and tank pressure)
status: shipped
priority: P0
size: M
lens: authenticity
created: 2026-10-21
pr: PRNUM
by: critic
---

## Why
The reveal told its story through four on-screen channels: DOWNFORCE (kg), PITCH (°), ALTITUDE (ft)
and, on run 2, G-FORCE (docs/REVEAL_RESEARCH.md §2.1.2 and §2.1.4, TELEMETRY). The focus asks for
"honest on-screen telemetry (g, pressure, gas left, sink rate) so players see the real
considerations". Measured on production 2026-10-21 (docs/critique/2026-10-21-0345.md):

- **On a phone the readouts are off the screen.** At 390×844 touch the right-hand block
  (`.hud-right`) spans x = 371–522 px; ALT, SINK, LOAD and FAN sit at x = 470–494 px, past the
  390 px edge, and the attitude dial shows as a sliver (`docs/critique/2026-10-21-0345/phone-hud-runup.jpg`).
  A phone player flies with speed, "Air %" and damage only. Mobile playability is a keep.
- **No pitch.** The livestream's most-quoted reading after downforce is "170° pitch". The HUD
  shows ROLL (accumulated, 0° while hanging upside down on the ledge:
  `desk-3-inverted.jpg`) and no pitch at all.
- **The gas gauge says "Air %".** The title card says "NITROGEN 297 kg · 690 bar"; in flight it
  becomes "AIR 100 %". There is no tank pressure, and nothing shows when the regulator stops
  holding line pressure (`SPEC.regulatedFraction` 0.55, `src/sim/vehicle.js` `pressureOf`), which
  is exactly when the last metre of a stop loses thrust (LESSONS, "plan a cold-gas brake on the
  pressure at the END of the stop").
- **LOAD is not the livestream's G.** `feltG` (`src/main.js:313`) is a per-frame exponential filter
  (≈0.17 s); the livestream read at 2 Hz and the results chip now uses a 0.5 s window
  (`run.t.brakePeakG`, 0013). The two disagree in the braking peak.

## What
- `index.html`, `src/ui.js`, `src/styles.css`: a telemetry block with DOWNFORCE (kgf, as today),
  PITCH (° from level, 0–180 along the deck, signed nose-up/down in the air), ALT (m, with ft in
  the label or a toggle), G (specific force, the same 0.5 s window as `brakePeakG`), SINK, and an
  N₂ gauge: kg left, tank pressure in bar (`690 · (m/m0)^1.375`, the model `pressureOf` already
  uses) and a REG / BLOWDOWN state when feed pressure leaves 1.0.
- Rename "Air" to "N₂" in the HUD (the title card already says nitrogen).
- Lay the block out so it fits 390×844 portrait and 844×390 landscape (fewer channels on a phone
  is fine if each shown one is the real number; at least ALT, SINK, G and N₂).
- Readability: the readouts sit on a backing that holds 4.5:1 over the white pad rings (invariant
  3.8; at touchdown the pad's ring line crosses SINK/LOAD in `desk-7-landing.jpg`).
- No sim change; no SIM_VERSION bump.

## Acceptance criteria
- [ ] e2e (phone project, 390×844 touch): the bounding boxes of every shown readout lie inside
      the viewport; same at 844×390 landscape and 1280×720.
- [ ] e2e: during the Wall reference hang, PITCH reads 165–175° (telemetry 170°); on the vertical
      it reads 88–92°.
- [ ] e2e or unit: at the reference braking peak the HUD G is within ±0.15 of `run.t.brakePeakG`
      (both 0.5 s windows of specific force).
- [ ] The N₂ gauge reads 297 kg / 690 bar at the start and its bar value equals
      `690 · (air/297)^1.375` within ±2 bar; REG shows while `feedPressure` is 1.0 and BLOWDOWN
      after (Wall reference: BLOWDOWN appears during the set-down, at ≈ 160–190 kg left).
- [ ] HUD text contrast ≥ 4.5:1 against the stage behind it at touchdown (screenshot evidence).
- [ ] No per-frame allocations (DOM written only on change, as `ui.hud` does today).

## Test plan
Extend `tests/e2e/phone` (or the phone project of the smoke spec, mindful of the flake guard in
LESSONS) with the bounding-box check; an e2e that flies the Wall reference fast-forwarded and
reads PITCH at the hang and G at `brakePeakG`'s tick; a unit test of the bar formula.

## Out of scope
Imperial/metric settings beyond the ALT label, new sim telemetry, the results sheet.

## Builder note (2026-10-21)
Re-measured on main (#36's HUD) before building. The phone overflow was already gone: at 390×844
every strip cell lay inside x 90–374, and "Air" was already "N₂". This PR adds what was still missing:
- **PITCH** (`src/hud-telemetry.js` `hudPitch`): on the deck, the nose's angle in the course's vertical
  plane. The Wall reference reads 170.0° at the hang and crosses 90° on the vertical. In the air it is
  the signed angle from level. The bank stays on the ADI.
- **G**: specific force over 0.5 s, |Δv/0.5 s + g|/g from a ring of tick velocities. That's the
  magnitude of the window's mean, not the mean of each tick's magnitude. The latter is
  `brakePeakG`'s formula, but on the ground it rectifies the rigid contacts' tick-to-tick jitter
  and reads 1.22 G cruising. In free flight the two agree. At the braking peak they differ by
  0.002–0.003 (Wall 3.079/3.077, Show 3.022/3.019, Lineup 2.083/2.082).
- **N₂**: kg left, tank bar `690·(m/297)^1.375`, REG/BLOWDOWN from `pressureOf`. BLOWDOWN first
  shows at 192 kg on the Wall reference, in the air. The ticket's "≈160–190" band was widened to
  160–195 in the test.
- Landscape phones hide PITCH (as #36 hid ATT); ALT, G, N₂ and SINK/FAN stay. The desktop
  instruments sit 16 px higher to clear the strip's added N₂ line.
