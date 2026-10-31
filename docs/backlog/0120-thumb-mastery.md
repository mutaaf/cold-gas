---
id: 0117
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
  target ("Silver at 91 · 0.7 to go"). `getMedals(course, tier)` for the title and the daily. Drills and the
  reference flight earn none.
- **Teaching** (src/pointer.js, thumb scheme only): the how-to's fourth row is "Aim & brake · hold and slide the
  pad"; the post-run pointer's `mark` and `clean` lines name the dot.

### Medal bars ([bronze, silver, gold])
| | Assist | Pro | Advanced |
|---|---|---|---|
| Show | 84 · 91 · 92.5 | 86 · 93 · 95 | 87 · 94 · 96.5 |
| Wall | 84 · 90 · 94 | 86 · 92 · 96 | 87 · 93 · 97.5 |
| Lineup | 72 · 84 · 90 | 75 · 87 · 93 | 77 · 89 · 95 |

Show/Assist from the populations below (one-thumb never sliding 89.3–90.3 → bronze; sliding onto the dot,
median 91 → silver; gold 92.5 = the careful thumb's top decile and the classic scheme's p90 (92), short of the
reference's 94). Wall/Assist from naive-players (65–87.3) and the
reference (96); Lineup from the reference (92). Pro/Advanced are ESTIMATES (the panel pays ×1.08/×1.15; the bars
rise by less, as the same flight is harder to fly).

## Measurements (before → after)
Node, the page's own src/onethumb.js, `scripts/human-phone.mjs 300 --scheme=thumb` (the release now as the page
flies it; "before" = main's onethumb.js with the corrected release model):

| Population (300 each) | Land clean | Clean scores min · p10 · median · p90 · max |
|---|---|---|
| before: every thumb (nothing to slide) | 300/300 | 89.3 · 89.3 · 90.3 · 90.3 · 90.3 |
| after: `--skill=none` (never slides) | 300/300 | 89.3 · 89.3 · 90.3 · 90.3 · 90.3 (identical inputs) |
| after: `--skill=careful` (thumb on the dot) | 300/300 | 89.3 · 90.3 · 91 · 91.7 · 93.7 |
| after: `--skill=sloppy` (×2–3 overshoot, upside-down reads, shaky) | 300/300 | 89.3 · 89.3 · 91 · 92 · 93.7 |
| after: `--skill=mixed` | 300/300 | 89.3 · 89.3 · 90.3 · 91.3 · 93.7 |
| 400 random slide policies (scratch search: hold time, gain, re-read period) | 400/400, no contact | 89.3 · 90 · 90.7 · 92 · 93.7 |

The real page, `scripts/play-human.mjs <local preview> thumb 3 --skill=…` (before = production):

| Player (3 runs each) | Scores | padMiss |
|---|---|---|
| before, production, careless (the only thumb player there was) | 90.7 · 90.7 · 90.7 | 6.1 |
| after, careless (never slides) | 90.7 · 90.7 · 90.7 | 6.1–6.3 |
| after, careful (onto the dot, 260 ms late, every 0.3 s) | 91.3 · 92 · 91.3 | 4.2–4.9 |
| after, sloppy (2.5× too far, first second upside down, shaky) | 91.3 · 91.3 · 92 | ≈ 4.5 |

Gates (sim untouched, so these can't move; run on this branch): `node scripts/naive-players.mjs` 32/32 upright
(before 32/32); `node scripts/human-show.mjs 300 assist --cues=new` 291/300 = 97 % (before 97 %);
`scripts/human-phone.mjs 300 --scheme=classic` 289/300 = 96 %, median 87.7 (unchanged); `node scripts/ref-hash.mjs`
show 94 / wall 96 / lineup 92, hashes fedae05c / bacb4720 / 8b2c2c9a (unchanged).

## Honest limits
The input-side headroom on one thumb is real but narrow, and smaller than the brief hoped for:
- Never sliding stays exactly where it was (89.3–90.3; the page's careless player 90.7). Sliding onto the dot moves
  the population median +0.7 (91), its top decile to 91.7–92 and its best to 93.7; the page's careful player went
  90.7 → 91.3–92. Most of what's left is gas (26–36 % vs the reference's 48 %), which the computer spends
  hovering over the semi's roof; no one-thumb input changes that without the scorer or the sim.
- Sloppy slides don't punish: the safety gates (needed for the 100 % land rate) turn a bad slide into no slide, so
  the sloppy population lands 89.3–93.7 (median 91), not in the 70s–80s. The spread a careless vs a careful thumb
  sees is ≈ 1–3 points, not 15.
- Getting a careless thumb into the 80s and a skilled one to 95+ needs the scorer (precision is 7.2/10 at a 6 m miss,
  outside the 4 m ring; auto-land and the roll-out flatten landing and rotation). Not shipped: it's an outcome change
  (SIM_VERSION, every board score moves). Estimate for `precision = 10·band(padMiss, 10, 0.8)` on the Wall/Show
  (≈ 0.91 total per precision point): never-slide (6.2 m) 90.3 → ≈ 87.4; careful (≈ 4.5 m) 91 → ≈ 89; the reference
  (1.5 m) 94 → ≈ 93.5. That only widens the gap to ≈ 2–4 points, because the slide's reach is limited by the
  flank safety, not by the scorer. A real fix is a design question for the owner (e.g. pay gas left more on Assist,
  or let the thumb choose the carry with a safe floor), worth its own ticket.

## Acceptance criteria
- [x] A one-thumb slide writes pitch / roll into the log; the log replays and scores bit-exactly (unit)
- [x] Never sliding writes no pitch / roll (unit); no constant full slide in 8 directions × 2 hold styles lands on the row (unit)
- [x] Gates: naive-players 32/32; human-show assist ≥ 95 %; human-phone thumb (none / careful / sloppy) land rates in the table
- [x] Medal row under the score on the results (e2e), stored per device, hidden for the reference and drills
- [x] Works at 390×844 touch (e2e) and 1280×720 keyboard (the row is the same markup)

## Test plan
tests/unit/thumb-mastery.test.js (slide, gates, replay, medals, storage off); tests/unit/pointer.test.js (thumb
pause rows); tests/e2e/thumb-mastery.spec.js (the sight comes on, a CDP touch slide reaches the thumb, the
medal row under the score and in localStorage, none for the reference).

## Out of scope
A scoring change (above). The title / daily showing medals (they can call `getMedals`).
