---
id: 0133
title: The descent band is green on a descent that lands soft, and on one thumb it names the pad, not a brake you don't have
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-11-02
pr: 219
by: critic
---

## Why
The landing panel's state box (`[data-d-state]`, `src/hud-landing.js:131`) uses amber, the HUD's caution colour, and
the word **"Brake"** for most of a descent that is already braking correctly and lands soft.

- **Sim:** the band computed per air tick with `predict` + `steadyStatus`, the same calls the page makes:
  - **The reference** (`createAutopilot('show')`) touches down at **0.82 m/s**, its 97.7 run. Its band reads **66 %
    amber "Brake"**, solid from 18 m (sink 11.8 m/s) to the ground.
  - **One thumb, pad held from the tap** touches down at **1.01 m/s** (86.0 "Stuck it"). It reads 8 % "Roll out ·
    now" and **69 % "Brake"**. It goes amber again at 5.3 m with 7 m/s sink while LAND is already setting it down.
  - **One thumb, lifted after the tap**, lands under auto-land at 1.33 m/s. It reads 23 % "Roll out · now" and 64 %
    "Brake".
- **Production** (`index-5Loasss6.js`, 390×844 touch, real CDP touches, every rendered frame from the release to the
  touchdown):
  - Pad held: "Brake" 35 of 48 frames, "Roll out · now" 6.
  - Pad lifted: "Brake" 38 of 51, "Roll out · now" 12, and never "On profile".
  - Screenshots: `docs/critique/2026-11-02-0940/a-6-air.jpg` (an amber boxed BRAKE at 18 ft over the row) and
    `b-5-release.jpg` ("ROLL OUT · NOW" next to "CARRYING YOU OVER THE ROW" and the pad's "HOLD · LAND").

**The cause:** `src/sim/predict.js:75–76` goes amber when `marginAhead < 0`. That's the warning that "the stop has to
start within WARN s". It stays amber after the stop *has* started and is on its plan, so a descent flown on the
profile reads as a caution all the way down.

**Why it breaks the illusion:** the real car's broadcast showed telemetry (DOWNFORCE / PITCH / ALTITUDE / G-FORCE,
REVEAL_RESEARCH §1, §2.2), not a caution light over a nominal brake. A caution that is on for two thirds of every good
landing teaches the player to ignore it, and then it means nothing on the run where it matters.

**On one thumb it's also an order the player can't follow:** a boxed amber "BRAKE" that looks like a button, and a
"Roll out · now" while the computer is the one rolling. The only control is the pad, whose verb is "Land". A
newcomer's first flight has three voices that disagree: the box, the cue line and the pad. The operator's focus
asks for the core loop on a phone first.

## What
- **`src/sim/predict.js`** (the band, not the brake law): amber means *this descent, flown on as it is, lands firmer
  than `SINK_SOFT`, or the stop isn't started and has to start within WARN*.
  - Once the down-jets are lifting (`aUp` > 0, or LAND engaged) and the stop at the current lift (or at `aPlan`)
    sets down at ≤ `SINK_SOFT`, the band is green.
  - Red is unchanged.
  - An un-braked free fall still turns amber ahead of the BRAKE line, as today. That's the warning a Pro player
    needs.
- **`src/hud-landing.js:131`:** on the one-thumb scheme, the state word names the pad's action. When the band asks
  for something, that's "Hold · Land". "Roll out · now" and "Brake" never show there, because there's no roll or
  brake control. The keyboard, classic and Advanced words are unchanged.
- No change to the sim's flight, scoring or the brake governor. Ref-hash, determinism, `naive-players` 32/32 and
  `naive-show` 54/54 are unchanged.

## Acceptance criteria
- [ ] **Unit** (a new `tests/unit/band*.test.js`, flying the Show headless with `predict` + `steadyStatus` per air
      tick, before the touchdown, height = `pos.y − comHeight`):
  - The reference (`createAutopilot('show')`) reads green on **≥ 80 %** of its air ticks after it is roof up, and
    never amber in the last 10 m. Today it's 34 % green.
  - One thumb with the pad held from the tap reads green on ≥ 80 % of its air ticks after roof up. Today it's 23 %.
- [ ] **Unit:** a free fall from the ledge with no brake input still goes amber **≥ 0.6 s before** it crosses
      `brakeBy`, and red before an un-survivable height (today's behaviour, pinned).
- [ ] **Unit:** a descent braked too late (the brake starts below `brakeBy`, so it touches down > `SINK_SOFT`) is amber
      or red from the brake's start to the touchdown.
- [ ] **e2e at 390×844 one thumb:** over the air frames, `[data-d-state]` never reads "Brake" or "Roll out · now".
      When the band isn't green it reads the pad's word. 1280×720 keyboard still shows "Brake" on a late brake.
- [ ] The PR has a before/after `a-6-air.jpg`-style frame at 390×844, and `hud-audit` and `title-audit` are clean.
- [ ] Ref-hash identical, `naive-players` 32/32, `naive-show` 54/54.

## Test plan
The unit tests above (a probe like this run's, in `tests/unit/`), plus an assertion folded into an existing one-thumb
flight e2e (`release-frame.spec.js` or `thumb-mastery.spec.js`) that samples `[data-d-state]` each frame from the
release to the touchdown.

## Out of scope
- Where the brake starts or how hard it brakes (0028 owns the 3.3 g at about 6.5 m).
- The tape's BRAKE line and the cue line's own words.
- Hiding the landing panel on one thumb. It's the descent instrument, and only its command word changes.

## Critic re-review (2026-11-02 15:40, bounce 1 of 2)
Most of it holds. "Brake" and "Roll out · now" never show on one thumb, the late hold's amber "Hold · Land"
is honest, and the reference is green. **What still fails is the first instant after the tap, on exactly
the flight this ticket is about: the pad held from the tap.**

**Production** (`index-C1O9yHfN.js`, 390×844 one thumb, real CDP touches, pad held from the tap to the ground,
every rendered frame from the release to the touchdown):
- **4 of 6 flights** read amber "Hold · Land" (`rgb(255,191,90)`) on the **first 5–6 air frames**, from
  27.3 m down to 25.3 m.
- **The pad was down** (`[data-onethumb].on`) on every one of those frames.
- **They landed soft:** 1.01 m/s, 86.0 Stuck it.
- **In short:** the box asks the player, in the caution colour, to do what they are already doing, on a
  descent that lands soft. The other two flights' frames happened to miss it.

**Sim** (this ticket's own harness, `band-soft.test.js` `flyThumb`, ticks before the first roof-up tick):
- **One thumb:** amber on **88 of 151 ticks (0.37 s, 26.9 → 25.5 m)**, then green to the ground at
  1.01 m/s.
- **The reference:** 0 of 168 in the same window.
- **Why the tests pass:** the unit criterion counts only "after roof up", and the e2e accepts "Hold ·
  Land" whatever the pad is doing.

**The bar (this ticket's Why):** amber means "this lands firm unless you act". On a pad held from the tap,
nothing needs to change, so the box must read On profile from the release.

**Still to meet:**
- [x] **Unit:** `band-soft.test.js`'s one-thumb flight held from the tap reads green on **100 % of its air
      ticks from the release** (not only after roof up), and still touches down ≤ `SINK_SOFT`.
- [x] **e2e (390×844 one thumb):** with the pad held from the tap, every air frame of `[data-d-state]` reads
      On profile. "Hold · Land" is allowed only on a frame where `[data-onethumb]` isn't `.on`.
- [x] Unchanged: the free-fall amber before `brakeBy`, the late-brake amber/red, the keyboard words,
      ref-hash, 32/32 and 54/54.

## Builder (2026-11-02, after bounce 1)
Cause: `brakeSink` (src/sim/predict.js) flew the stop at today's `upY` (−0.95 off the ledge), so LAND read as free
fall until the car was past level. With LAND engaged and a roll-out ahead (`tLevel > 0`) the stop is now flown roof
up after the roll-out's fall, which the model already accounted for. `band-soft.test.js`: the held-from-the-tap
flight is green on every air tick from the release (was 88 amber ticks); LAND engaged upside down 6 m up at 4 m/s
is never green. `touch.spec.js` samples `[data-d-state]` and `[data-onethumb].on` each rendered frame: every
held frame reads On profile (fails on main with six "Hold · Land" frames).
