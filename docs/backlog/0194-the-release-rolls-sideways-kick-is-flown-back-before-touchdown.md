---
id: 0194
title: The release roll's sideways kick is flown back to the line before touchdown, not carried onto the pad
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-11-11
pr:
by: critic
---

## Why
On the reveal the car "flew forward … did a barrel roll" and was set down "gently" on four wheels (REVEAL_RESEARCH
§2.1.4, Car and Driver). It moved forward, away from the ramp. Nothing in the footage or the reports has it sliding
sideways. On our Show and Wall, the half-roll off the ledge pushes the car sideways at about 2.9 m/s. Then one of
two things happens:
- **The one-thumb flight never takes the drift back.** Assist's LAND stops the sideways motion but holds the new
  line, so the car lands 5–7 m beside the mark.
- **The reference does fly back, but too late.** It swings back across and touches down still sliding sideways at
  2.5 m/s.

The painted mark is on the car's own line (`pad.x = 0`, `src/sim/courses.js:36,192`). A first-timer who does
exactly what the pad says lands on the right-hand ring's edge and reads "16 ft 5 m right of it"
(production, `docs/critique/2026-11-11-0410/S-results.png`).

Node, main `a6bf28b`, `x` sampled every 0.2 s from the release (`scripts`' temp harness in the critique: the
`thumb-mastery` `flyThumb` loop and `createAutopilot`):

| flight | lateral kick | `t.lateral` at touchdown | vx at touchdown | padMiss, total |
|---|---|---|---|---|
| Show, reference | vx +2.69 m/s by 1.2 s | +1.04 m | **−2.56 m/s** (sliding in) | 1.5 m, 97.3 |
| Show, one thumb, no slide (held from the tap) | vx −2.88 m/s by 1.0 s | **−5.14 m** | 0.0 m/s | 6.0 m, 84.7 |
| Show, one thumb, pressed again 1.0 / 2.0 s | — | **−4.45 / −5.72 m** | — | 5.6 / 6.2 m |
| Wall, reference | — | +3.58 m | — | 3.6 m, 97.7 |
| Wall, one thumb, no slide (held / again 2.0 s) | — | **+6.06 / +7.24 m** | — | 11.4 / 11.0 m |

- **On the Show**, the one-thumb sideways miss is 5.1–5.7 m. Its along-run miss is 2.3–3.4 m. So the sideways miss
  is most of the 6 m.
- **On the Wall**, 6–7 m of 0190's 11 m miss is sideways. 0190 asks for ≤ 7 m in total; it can't get there on the
  along-run brake alone.
- **Production (first visit, 390×844, the thumb doing what the pad says):**
  - The Show: **6.8 m off, "16 ft 5 m right of it"**, 81.0 Clean.
  - The Wall: **15.5 m off**, 75.0 Clean.
- **The mechanism.** `src/sim/vehicle.js:336-349`: the roll is torque from one side's down-jets. Once the car is
  past sideways, that thrust has a sideways component. That part is physical. What's not is the flight computer
  keeping the line it was knocked onto, or landing with a sideways slide.

## What
- In Assist's LAND / line hold (`src/sim/vehicle.js`, the "hold-the-line" branch the 0164 lessons describe), hold the
  line the car was released on (pad.x), not the line it holds after the roll's kick. Fly the drift back while there's
  height to do it. The reference already does this, from about 1.8 s. Kill the sideways speed before the wheels touch.
- The reference (`src/sim/autopilot.js`) should arrive with the sideways speed gone, not swing across and slide in.
- Write the per-0.2 s `x`, `vx` trace from release to touchdown in the PR, for the reference and the no-slide thumb,
  on both courses.
- Keep the one-thumb sideways slide (0164, 0177) working: the slide moves the line the computer holds. It doesn't
  fight it.

## Acceptance criteria
- [ ] Show and Wall, one thumb, no slide (held from the tap; tapped and never pressed again; pressed again at 0.5, 1.0 and 2.0 s):
      `|t.lateral|` **≤ 1.5 m** at touchdown. Today it's 4.45–7.24 m.
- [ ] Every one of those flights, and both references, touch down with sideways speed **|vx| ≤ 0.5 m/s**. Today the
      Show reference touches down at 2.56 m/s.
- [ ] The release-to-touchdown time stays 4.1–4.95 s, with sink ≤ 1.3 m/s and touchdown g ≤ 1.6 (the reveal's
      numbers, §2.1.4; today 4.08–4.95 s).
- [ ] References: Show ≥ 97.0, Wall ≥ 97.0. `ref-hash` changes, so bump `SIM_VERSION`, run `npm run vectors`, and
      follow AGENTS.md §3.4 (the Swift mirror rides along).
- [ ] The slide still pays: `thumb-mastery`'s 0164 / 0177 sideways tests and its 0182 test (best slide ≥ 5 points over no
      slide on the Wall) pass as written.
- [ ] `naive-players` 32/32, `naive-show` 54/54, `human-show.mjs 300 assist --cues=new` ≥ 95 %, and `daily-reach` with every
      objective over the floor. Paste the before → after table.
- [ ] Funnel number to move: on touch runs, `run-landed` with a medal over bronze on the Show and the Wall.

## Test plan
Add a unit test that flies the five no-slide thumb patterns and both references on the Show and the Wall. It
asserts `|t.lateral| ≤ 1.5` and `|vx| ≤ 0.5` at the touchdown tick.

## Out of scope
- The along-run (z) part of the Wall's long touchdown. That's 0190; land this first or with it, and re-measure 0190's
  table after.
- The roll's own physics: one-sided down-jet torque is a modelling choice with a source.
- The sight and the pad's words (0180, 0188).

## Builder attempt 1 (2026-11-11, no fix shipped; docs only)
A line hold that flies back to the release line meets every lateral bar, but costs the references their score and
regresses `naive-show`. Status stays `ready`. Node, main `b3b45a1`, the critique's `flyThumb` loop (release = the ledge tap).

**What was built (not merged; the law, so the next run starts from it):**
- `s.lineX` = the car's x while any wheel is down, or while the pilot rolls roof up (the slide moves the line). `s.lineArm` = 1
  once LAND's roll-out runs from upside down (`rollOut && uy < -0.2`: the ledge release only; the Lineup's kickflip never arms it,
  so the Lineup stays bit-identical, hash `4fc4af6b`).
- Armed, roof up, stick centred, above 0.5 m: want `vw = −sign(ex)·min(2, 1·|ex|, √(2·0.5·|ex|))` m/s toward the line
  (`ex = x − lineX`), sideways accel `4·(vw − vx)`, bank = that accel ÷ max(g, the lift LAND has asked for, low-passed over 0.3 s),
  ≤ 0.3 rad above HOVER + 1.5 m and ≤ 0.2·min(1, 4·low) below it, flown at 3.5 rad/s per rad (LEVEL_K's 2 is too slow: τ ≈ 0.5 s).
  Unarmed, the old drift-kill law runs unchanged. The reference (`wallPilot`) stops steering sideways and lets the hold fly it.

| flight (no slide) | main `t.lateral` / vx at touchdown | attempt | main total → attempt |
|---|---|---|---|
| Show reference | +1.04 m / −2.55 m/s | +0.13 / −0.23 | 97.3 → **95.0** |
| Show thumb held · never pressed · again 0.5 / 1.0 / 2.0 s | −5.14…−5.72 m / ≤ 0.3 | −0.20…−0.07 / ≤ 0.19 | 83.7–86.7 → 91.3–93.3 |
| Wall reference | +3.58 m / −0.55 | +0.08 / −0.08 | 97.7 → **96.0** |
| Wall thumb, the same five | +6.06…+7.24 m / ≤ 1.74 | 0.01–0.09 / ≤ 0.29 | 77.3–78.0 → 78.3–81.7 (miss 7.6–10 m: the along-run part, 0190) |

**Why it doesn't ship:**
- **References lose on gas (efficiency Show 10 → 6.9, Wall 8.8 → 7.5).** Gas goes with flight time. The return isn't costly in
  itself (a 0.2–0.3 rad bank loses ≈ 3 % of the lift); the extra 1.0–1.2 s is. Back on the line, the Show reference comes down
  over the row's last roof at ≈ 3 m. LAND's altimeter reads the roof, the one-burn cap collapses to 0.02 m/s, the car bounces
  (vy +0.6 at 2.7 m), carries 4 m past the pad (landZ −33.4 against −28.95), and the reference's pitch-back plus the bank trips
  "level before the wheels touch" (`h < 1.2 && upW.y < 0.99` → sink held at 0.25 m/s) for ≈ 0.8 s. Drifting 4.4 m sideways on
  main, it came down **beside** that roof.
- **`naive-show` 54/54 → 51/54** (`climb 4, release 0.85/0.97, boost 0`: contact on the row, landZ −12 / 0). The same cause:
  the line runs over the row.
- **Show thumb sink:** never pressed again, 1.30 → 1.64 m/s (bar ≤ 1.3); release → touchdown + 0.1–0.3 s.
- **Unit suite: 53 failing in 11 files** (vectors and worker's reference card expected; also thumb-mastery 18, learn 6, daily 6,
  gtrace 5, coach-mark 3, thumb-lift 2, thumb-gas 2): tests pinned to today's no-slide touchdown, which has to be re-set with the law.
- Tried and measured, no better: P-on-velocity (overshoots: the 3 g brake gives 3× the authority), PD with ω 1.2–1.6, a
  time-to-go guidance law (refs 96–97 but touchdown vx 1.3–2.2), a lead term, roll-rate caps, LL 0.10–0.15 under 1.2 m.

**For the next run:** the line on the Show has to stay off the row's roofs until the car is past `rowFar`. Either hold the
drift (old law) until the car is beyond the row and only then fly back, or let the Show's `lineX` follow the pad only past the row.
Re-measure `naive-show` first, then the references. The Wall has no row, so its version may ship alone (Wall reference 96.0
here: its loss is efficiency 8.8 → 7.5 from the slower set-down). The sim change bumps `SIM_VERSION` and regenerates vectors, and
`ios/Packages/ColdGasCore/Sources/ColdGasPhysics/Vehicle.swift:227` (the hold) needs the same law.

## Builder attempt 2 (2026-11-11, no fix shipped; docs only)
Status back to `ready`. Node, main `9a79e44`. Two findings for whoever picks this up (and for the critic):

**1. On the Wall, this ticket's lateral bar and its own "0182 as written" bar can't both hold.** 0182 (thumb-mastery) asks
that the best slide in **−48 … 0 px, sideways only**, beat no slide by ≥ 5 points (again 1.25 and 2.25 s). A total point is
worth 1 / 2.67 of a precision point on the Wall (weights 0.30 · 0.20 · 0.30), so no slide must score precision ≤ 8.13: a miss
≥ 5.4 m (`SHOW_PRECISION`: 0.85 at 5 m, 0.45 at 7 m). With `|t.lateral|` ≤ 1.5 m, that miss is ≥ 5.2 m along the run, which a
sideways slide can't take back. So the Wall's no-slide lateral bar needs 0182 re-specified first (e.g. the best slide in
either axis, or the bar moved to the along-run slide), by the critic or the operator. The Show has no such test.

**2. The low line hold.** Keeping LAND's existing drift-kill on below 4 m (armed by the roll-out from inverted, ≤ 0.12 rad
down to 1.5 m; Lineup bit-identical) takes the sideways speed at touchdown down on both courses without a fly-back:

| no slide | main lat / vx at touchdown | low hold (with 0190's along-run aim on the Wall) |
|---|---|---|
| Show reference | +1.04 / −2.56 (97.3) | +1.07 / −2.53 (97.3; the reference rolls, so LAND's hold is off) |
| Show held · never · again 0.5 / 1.0 / 2.0 | −5.14 / −5.72 / −5.14 / −4.45 / −5.72 m; vx ≤ 0.30 | −4.37 / −5.17 / −4.37 / −4.06 / −5.17; vx ≤ 0.57 |
| Wall reference | +3.58 / −0.57 (97.7) | +3.44 / −0.59 (97.7, cutoff 4 → 3.5 m) |
| Wall held · never · again 0.5 / 1.0 / 2.0 | +6.06 / +7.24 / +6.06 / +6.09 / +7.24; vx up to 1.75 | +6.28 / +6.31 / +6.28 / +5.73 / +6.31; vx ≤ 1.17 |

It moves the lateral 0.5–1 m, not to 1.5 m, and it breaks the slide's model (eight `thumb-mastery` tests and `thumb-land`
0188; the list is in 0190's Builder attempt 1). The Show reference's −2.5 m/s slide-in is `autopilot.js`'s `steerToPad`
(the roll is a time-to-go velocity with no stop at the end), not LAND: it needs a lateral law that arrives at zero speed,
and a Show-only `level` change re-runs the Show's ref-hash.

**For the next run:** settle point 1 with the critic before building the Wall half. For the Show, Builder attempt 1's
advice stands (fly back only past `rowFar`); measured here, the held thumb passes `rowFar` at ≈ 3.75 s, 2.9 m up, 5.1 m
off the line, 1.8 s before touchdown: a 3.6 m fly-back in that time asks ≈ 4.4 m/s² sideways (≈ 0.45 rad of bank at 1 g)
below 3 m, where "level before the wheels touch" (`upW.y < 0.99` under 1.2 m) holds the sink. So the Show's line hold has to
start beside the row (outside `|x| < maxX + halfW` of each box still ahead), not after it.
