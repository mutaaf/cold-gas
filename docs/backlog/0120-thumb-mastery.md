---
id: 0120
title: One thumb can place the touchdown, and medals say how well
status: in-progress   # shipped once a PR number exists (check-backlog requires it); branch audit/thumb-mastery
priority: P1
size: L
lens: player-feel
created: 2026-10-30
pr:                  # local branch audit/thumb-mastery (not pushed)
by: operator
---

## Why
Measured on production (2026-10-30): `node scripts/play-human.mjs https://mutaafaziz.com/coldgas/ thumb 3`, a
cue-following phone player on the default scheme (one-thumb + Assist), scored **90.7 "Stuck it" on all three
runs**, padMiss 6.0–6.3 m, sink 1.0 m/s. The reference flight scores 94.0. The phone's default path had no
skill expression: whatever the thumb did, the run scored ≈ 90.7.

### The cause, with numbers
The one-thumb's inputs, and what each moved (Node, the page's own src/onethumb.js, the Show, Assist):

| What the thumb controls | Range tried | Total | Why it doesn't move |
|---|---|---|---|
| Climb hold / lapses | any | 90.3–91 | the crawl governor flies the curl |
| Tap timing on the ledge | 0.2–3 s hang | 90.3–91 | the car is stopped; the drive-off and the carry (5.5 m/s) are automatic; inversion is 10/10 either way |
| When LAND is held | from the tap, 26 m … 4 m, never | 89.3–91 | **auto-land** (vehicle.js `autoLand`) engages at ≈ 25 m on every flight, so any later hold changes nothing; holding from the tap brakes high over the row (gas 33–36 % vs 26 %, but clearance 4.5–6.5 m scores 7.2 not 9.7) |
| Where it lands | — | — | nothing on one thumb steers: the roll-out off the ledge kicks the car 5–6 m sideways and the 5.5 m/s carry lands ≈ 2.7 m long, so padMiss is 6–6.6 m on every run |

The categories of that run: climb 9.7–9.8, inversion 10, rotation 9.7–9.8, landing 9.5, **precision 7.2–7.4**,
**efficiency 5.2 (26 % gas)**, clearance 9.7. Everything but precision and gas is flown by the computer and
saturates; precision is the one place left for a thumb, and its band (`10·band(padMiss, 20, 1)`) is lenient:
1 m is worth only ≈ 0.9 total points per metre of miss (≈ 0.091 × 10 per precision point).

Also found: `scripts/human-phone.mjs --scheme=thumb` let go of the Wall on the tap itself, skipping the
drive-off and the push-off the page runs (main.js `noteRelease` lets go on LIFT on the deck or the first air
tick). Its thumb population therefore flew a different flight from the page (median 91 vs 90.3). Fixed here.

## What
- **The touchdown slide** (src/onethumb.js, input side only). Holding the pad in the air, sliding the held
  thumb off where it pressed tilts the lift vector the way the reference pilot steers onto the pad
  (`steerToPad` limits: pitch ≤ 0.55, roll ≤ 0.45; with LAND's level law the stick is an attitude, ≈ 20°):
  up = further, down = shorter, sideways = sideways. Written as the ordinary `pitch` / `roll` channels, so a
  log replays and the Worker scores it bit-exactly; no sim or scorer change, **SIM_VERSION unchanged**. Safety
  gates (each found by a crash in the search): nothing while not roof up (a roll command upside down stops
  LAND's roll-out); nothing below 1.5 m, fading in to 2.5 m (a tilted set-down splits the wheels and raises the
  sink); along the run only once the whole car is 2.5 m past the row's far edge and carrying away from it
  (pulled back over the last car it set down on its roof: 3 contacts in 150 random policies before this gate);
  sideways anywhere unless a 2 s look-ahead (the car's velocity, falling at least as fast as now, plus the
  slide's push and the bank it already has) brings it in over a parked vehicle's side below its roof + 0.8 m
  (`flankAhead`; a slide back in beside the row met the semi's corner, then the last car's, in the
  human-phone populations, until this check). 15 % dead zone: a resting thumb keeps
  LAND's line hold. A thumb that never slides writes exactly the inputs it did before.
- **The sight** (src/thumb-aim.js, src/thumb-aim.css). In the air the pad becomes a sight: the centre is the
  predicted touchdown (src/sim/predict.js, the HUD's touchdown ring), the amber dot is the mark laid out in the
  car's own frame (up = along the nose), 6 px per metre; the small ink dot is the slide. "Put your thumb on the
  dot." The words step back while aiming. The dot dims when the slide can't act yet.
- **Medals** (src/medals.js, src/medals.css). Bronze / silver / gold per event and tier, best per device in
  localStorage `coldgas_medals`; a hairline row under the score (`<div data-medals>` in index.html) with the next
  target ("Silver at 90 · 1.3 to go"). `getMedals(course, tier)` for the title and the daily. Drills and the
  reference flight earn none.
- **Teaching** (src/pointer.js, thumb scheme only): the how-to's fourth row is "Aim & brake · hold, slide the pad ·
  Slide onto the amber dot to hit the mark"; the post-run pointer's `mark` and `clean` lines name the dot.

- **The Show's judging, SIM_VERSION 26 → 27** (src/sim/judge.js, a second commit, the orchestrator's decision after
  the input-only version below). Scores only: the physics is untouched (ref-hash: same hashes).
  - *Precision* is read off the pad's painted rings: `curve(padMiss, [[3.5,1],[5,0.85],[7,0.45],[12,0.15],[20,0]])`
    (was `band(padMiss, 20, 1)`, 74 % of the marks for a 6 m miss outside the 4 m ring; now 65 %).
  - *Gas left* is full marks from 45 % (was 50 %; the reference keeps 48 %).
  - *Clearance* no longer marks a safe crossing down like a timid one: 1.0 from 0.8 to 2 m, 0.85 at 6 m, 0.75 from 12 m
    (was 0.72 from 4.8 m, which docked the reference's 5 m).
  - *The panel's weights* move off the climb, the hang and the roll-out (Assist flies them to 9.7–10 for everyone:
    climb + inversion + rotation 0.28 / 0.54 / 0.36 → 0.12 / 0.32 / 0.18 for the Engineer / Coordinator / Designer)
    onto the mark (precision 0.14 / 0.05 / 0.12 → 0.36 / 0.28 / 0.34). Landing weights unchanged; gas 0.12/0.05/0.16
    → 0.10/0.08/0.14; clearance 0.12/0.20/0.14 → 0.08/0.16/0.10.
  - The Wall and the Lineup are judged as before.
  - *How it was chosen:* every run's telemetry from the five 300-player populations was dumped
    (`--dump=` on human-phone.mjs and human-show.mjs) and re-scored offline over a grid of precision curves (flat to
    2 / 2.5 / 3 / 3.5 m), gas bands (35–50 %), clearance curves and weight shifts. Constraints: never-aiming median
    80–86, careful median 91–94 with p90 ≥ 95, sloppy below careful, the reference above every thumb. Heavier gas
    weights (×1.5, ×2) failed: the careful thumb's gas (24–33 %) is no better than the careless one's, so gas weight
    only compressed the scale. A carry chosen by the thumb was not needed to reach the targets (not built).

### Medal bars ([bronze, silver, gold]), recalibrated for v27
| | Assist | Pro | Advanced |
|---|---|---|---|
| Show | 80 · 90 · 95 | 82 · 92 · 96.5 | 83 · 93 · 97.5 |
| Wall | 84 · 90 · 94 | 86 · 92 · 96 | 87 · 93 · 97.5 |
| Lineup | 72 · 84 · 90 | 75 · 87 · 93 | 77 · 89 · 95 |

Show/Assist from the v27 populations below: bronze 80 = the never-aiming thumb's floor (min 80.7); silver 90 =
aiming at all (careful p25 ≈ 91, sloppy median 90.3); gold 95 = the careful thumb's top decile (p90 95.7), under the
reference's 97.7. Wall/Assist from naive-players (65–87.3) and the reference (96); Lineup from the reference (92).
Pro/Advanced are ESTIMATES.

## Measurements
Node, the page's own src/onethumb.js, `scripts/human-phone.mjs 300 --scheme=thumb --skill=…` (the release as the page
flies it). Clean-landing scores, min · p10 · median · p90 · max:

| Population (300 each) | Land clean | before (main) | input only (v26) | **v27 judging** |
|---|---|---|---|---|
| never aims (`none`) | 300/300 | 89.3 · 89.3 · 90.3 · 90.3 · 90.3 | same | **80.7 · 81.7 · 83.7 · 86 · 86** |
| careful (thumb on the dot) | 300/300 | (no aim existed) | 89.3 · 90.3 · 91 · 91.7 · 93.7 | **80.7 · 82.7 · 93 · 95.7 · 96.3** |
| sloppy (×2–3 overshoot, upside-down reads, shaky) | 300/300 | — | 89.3 · 89.3 · 91 · 92 · 93.7 | **79.7 · 81.7 · 90.3 · 94 · 95.7** |
| classic two-thumb (`--scheme=classic`) | 289/300 (96 %) | median 87.7, p90 92 | same | **50 · 64.7 · 73 · 83.3 · 97.7** |
| keyboard (`human-show 300 assist --cues=new`) | 291/300 (97 %) | median 88 | same | **median 73** |
| reference (autopilot) | — | 94 | 94 | **97.7** |

Verdicts read sensibly: the never-aiming thumb is "Clean" (72–84) or "Stuck it" (84–86), never "Perfect 10" (≥ 92);
the careful median 93 is "Perfect 10". The careful/sloppy p10 (≈ 82) is the ≈ 23 % of careful flights (69/300) where
the slide never takes effect and the car lands ≈ 6 m off like `none`: some hold LAND only from 4–8 m (too late to aim
above the 1.5–2.5 m set-down floor), the rest hold early but are held by the safety gates (beside the row after the
roll-out kick, the flank check refuses the slide back in). Not investigated further.

The real page, `scripts/play-human.mjs <local preview> thumb 3 --skill=…` (before = production):

| Player (3 runs each) | v26 (input only) | **v27** |
|---|---|---|
| before, production, careless | 90.7 · 90.7 · 90.7 | — |
| careless (never slides) | 90.7 · 90.7 · 90.7 | **85.3 · 84.3 · 84.3** |
| careful (onto the dot, 260 ms late, every 0.3 s) | 91.3 · 92 · 91.3 | **88.3 · 92 · 90.7** (padMiss 4.5–5.5) |
| sloppy (2.5× too far, first second upside down, shaky) | 91.3 · 91.3 · 92 | **93 · 94 · 92.3** |

On the real page the scripted sloppy player beat the careful one: with the page's latency (a 40 ms read loop, 260 ms
reaction, 0.3 s re-reads, CDP touch) "thumb on the dot" is too gentle a gain to finish the correction before the
set-down floor, and the 2.5× overshoot acts as a higher gain. A 10 px/m sight (full command at ≈ 4.8 m) was tried:
Node careful 92.3 / sloppy 89.3 (more separation) but the page's careful runs were 82.7 · 83.7 · 92.3 (noisier), so
the sight stays at 6 px/m. Three page runs per player are too few to call; the Node populations are the measure.

Gates: `node scripts/naive-players.mjs` 32/32 upright; `human-show 300 assist --cues=new` 291/300 = 97 %;
`human-phone --scheme=classic` 289/300 = 96 % (unchanged land rate; its scores fall, see above); `node scripts/ref-hash.mjs`
show 97.7 (was 94) / wall 96 / lineup 92, hashes fedae05c / bacb4720 / 8b2c2c9a (unchanged: no physics change);
`npm run determinism` on scripts/engine-logs.mjs's clean + crash logs and a careful one-thumb log: node, Chromium and
WebKit IDENTICAL (Firefox not installed here, skipped); `npm test` 565/565.

## Honest limits
- The input-only version (first commit) moved a careful thumb only ≈ +1 (91 vs 90.3): the slide's reach is bounded by
  the flank safety and the gas is the computer's. v27 makes the mark worth what it should: the same slide is now
  ≈ +9 (93 vs 83.7).
- Classic two-thumb and keyboard players score much lower (median 88 → 73): they land 10–11 m off the mark (median),
  which the old line forgave. Their land rates are unchanged. That is the intended reading (the mark matters), but it
  is a big visible change for desktop players; the panel's "what happened" already coaches the mark for them.
- Sloppy aiming isn't punished below never aiming: the gates turn a bad slide into no slide (sloppy median 90.3 vs
  careful 93, never-aiming 83.7).
- A keyboard player's best (98.3 in the population) can beat the reference (97.7); every thumb (max 96.3) stays under it.
- Gas: no one-thumb input changes it much (the computer hovers over the semi). A thumb-chosen carry is the next lever.

## Acceptance criteria
- [x] A one-thumb slide writes pitch / roll into the log; the log replays and scores bit-exactly (unit)
- [x] Never sliding writes no pitch / roll (unit); no constant full slide in 8 directions × 2 hold styles lands on the row (unit)
- [x] Gates: naive-players 32/32; human-show assist ≥ 95 %; human-phone thumb (none / careful / sloppy) and classic land rates in the table; determinism IDENTICAL
- [x] v27: never-aiming median 80–86 (83.7), careful 91–94 (93) with p90 ≥ 95 (95.7), sloppy below careful (90.3), reference on top (97.7)
- [x] Medal row under the score on the results (e2e), stored per device, hidden for the reference and drills
- [x] Works at 390×844 touch (e2e) and 1280×720 keyboard (the row is the same markup)

## Test plan
tests/unit/thumb-mastery.test.js (slide, gates, replay, medals, storage off); tests/unit/learn.test.js (SIM_VERSION 27, the Show reference 97.7 ± 0.5, deliberately moved from 94); tests/unit/pointer.test.js (thumb
pause rows); tests/e2e/thumb-mastery.spec.js (the sight comes on, a CDP touch slide reaches the thumb, the
medal row under the score and in localStorage, none for the reference).

## Out of scope
The Wall's and the Lineup's judging. The title / daily showing medals (they can call `getMedals`). A thumb-chosen carry.
