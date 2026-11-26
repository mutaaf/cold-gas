---
id: 0370
title: A Lineup LIFT pressed past the line is named as late; a crashed run is never told "fly it the same again"
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-25
pr: 520
by: critic
---

## Why
0367 stopped the coach from calling a crashed Lineup run "Clean". Now, for one group of crashes, it tells the player to
repeat the exact run that crashed.

- **The population:** 200 keys players on the Lineup, Assist (`flyKeysLineup`, seed 777), on main `8405507`.
  The probe is `docs/critique/2026-11-25-2200/late-lift.mjs.txt` and its output is `late-lift.out.txt`.
- **The in-band players:** 90 of them reach the line at 22–34 km/h and hold LIFT ≥ 0.45 s, which is what the coach treats
  as "right". **7 of those 90 crash.**
- **What the coach tells all 7:** "Came down on the row: You reached the line at 30 km/h and held LIFT (Space) 0.5 s: the
  car peaked 7 m up and came down on the roofs. → **Your run-up and LIFT (Space) were right: fly it the same again.**"
  - The sim is deterministic, so a run flown the same again crashes the same again.
- **What actually decided it is when LIFT was pressed:**
  - **All 7 pressed LIFT 1.29–1.91 m past the line** (`LINEUP_LINE`, z 0.5).
  - **None of the 69 in-band players who pressed it earlier crashed.** The table below is from `late-lift.out.txt`:

    | LIFT pressed, past the line | Runs | Crashed |
    |---|---|---|
    | before 0.5 m | 47 | 0 |
    | 0.5 to 1.0 m | 13 | 0 |
    | 1.0 to 1.25 m | 9 | 0 |
    | 1.25 m or later | 21 | **7** |

  - In all 7 crashes, the nose meets the first car **0.20–0.26 s after lift-off, 0.7–1.1 m up**, with the car's centre at
    z 4.6. The first car starts at z 7. The nose takes 41–58 % of the damage.
  - The car hits on the way up. It does not "come down on the roofs". The bounce off the first car is what reaches 6–8 m,
    and that is the "peak" the coach reads back.
- **Where it comes from in `src/sim/coach.js` (`lineupWrecks`):**
  - `right = timed && kmh >= 0 && !speedOff && !shortHold` reads only the speed and the hold length, never where the hold
    began.
  - `readFlight` already finds the press (`liftFrom`) but doesn't keep its position.

**The bar:** in the reveal, the car took off "just short of the first vehicle" at 7–9 m/s and peaked 7–8 m over the row
(`docs/REVEAL_RESEARCH.md` §2.2, ESTIMATE/REPORTED). On this course the lift has to start at the line. A coach that tells
the player to repeat a crash is the opposite of a coach.

The operator's focus (1) asks for "skill that shows in the score" and for retry. A player who is told "you did it right"
and crashes again learns nothing, and is likely to quit.

**Number it moves:** `retry` after `wrecked-lineup`, and `landed-lineup` on the retry.

## What
- `src/sim/coach.js` `readFlight`: keep where LIFT was first pressed, relative to `LINEUP_LINE`, as `f.liftAtZ` (m past the
  line; negative is before it).
- `lineupWrecks`:
  - A crashed card is never `right`.
  - When the press began more than about 1 m past the line, the fix names it, for example: "You pressed LIFT (Space)
    1.3 m past the line: the nose met the first car on the way up. Press it on the line." The 1 m threshold is the
    builder's call from the population, and the PR says why.
  - Keep the speed fix ahead of it when the speed is off the band.
  - A crashed run that matches none of these gets the neutral crash line, never "fly it the same again".
- One thumb: the pad commits the lift itself (`src/onethumb.js`), so this finding is for keys, pad and touch-classic.
  Check whether a thumb run can press late and say so in the PR.
- Mirror it in `Coach.swift`, and regenerate `coach.json` (`npm run vectors`). This is a coach-only change: no sim, scorer
  or ref-hash change.
- If 0369 has landed, its contact-height wording for the detail line stands, and this ticket changes only the fix.

## Acceptance criteria
- [x] Over `flyKeysLineup` ×200 (seed 777), **0** crashed cards have a fix containing "fly it the same again". Today
      7 do.
- [x] Each of today's 7 runs (indices 1, 6, 90, 139, 152, 176, 182 in `late-lift.out.txt`) gets a first finding whose fix
      names the late press and the metres past the line.
- [x] No landed card's first finding changes. Show and Wall coach outputs are unchanged for every card in
      `tests/unit/coach*.test.js`.
- [ ] Production, 1440×900 keys, Assist: hold ↑ to about 29 km/h, then press Space 0.5 s once the car is 1.5 m past the
      cue. The sheet's WHAT HAPPENED and NEXT RUN both name the late press. Screenshot it.
- [x] `npm test` green. ref-hash unchanged (show `6b2cb98b`, wall `f1b9fab`, lineup `4fc4af6b`). naive-players 32/32.

## Built (builder, 2026-11-26)
- `readFlight` keeps `liftAtZ`: where the counted press began, m past `LINEUP_LINE` (the car's centre on its first tick).
- `LINEUP_LIFT_LATE` = 1.25 m (src/sim/aim-words.js). Re-measured on main after 0369 (same 7 runs): in the band, 0 of 69
  that pressed before 1.25 m crashed and 7 of 21 at 1.25 m or later did; 0.5–1.25 m is 0 of 22, so 1 m would name presses
  that never cost a crash.
- The fix: "Press LIFT (Space) on the line, not 1.3 m past it: the nose met the first car on the way up. Hold it about
  0.5 s, then roll." (the clause only for a hit on the way up); a speed off the band stays first. A crash that is otherwise
  in the band reads the neutral crash line. NEXT RUN: "Lift over the roofs: press Space on the line, not 1.3 m past it".
- One thumb: the pad commits the lift itself, so it never gets the finding (tested over 60 thumb runs; 0 of 200 thumb
  cards changed).
- Over 600 Lineup cards (keys, touch classic, thumb × 200): 40 crashed cards' fixes changed, 0 landed cards, 0 first ids.
- Coach.swift mirrors it; vectors gain `liftAtZ` and a `crash-lineup-late-lift` run whose coach rows carry the finding.
- Screenshots of the sheet (local build of this branch) at 1280×720 keys and 390×844 touch classic: WHAT HAPPENED and
  NEXT RUN both name "5.2 ft 1.6 m past it".

## Test plan
- Extend `tests/unit/coach-lineup.test.js`:
  - fly the keys population, then assert no crashed card says "same again";
  - assert that a press ≥ 1.25 m past the line is named, with its distance matching `f.liftAtZ` to 0.1 m.

## Out of scope
- The "No jump" verdict and the "came down on the roofs" detail for a hit on the way up (0369).
- The keys run-up speed (0363) and the Lineup's lift height (0362).
- Moving the cue or the line itself.
