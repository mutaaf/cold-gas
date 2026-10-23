---
id: 0079
title: A new player knows the controls, sees the AI assist on every screen, gets coached, and the game adapts to them
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-10-22
pr: 103
by: operator
---

## Why
The operator: "the controls for a new user are not evident; we need the AI-assisted button to be evident
across all platforms, and make it harder or easier based on the user's performance, and auto-suggest
pointers (coach)."

Before this change a new player met the game with no word about its controls: they were in the pause
sheet, behind a "Controls" link on a touch title, and in key caps on the cue line once a run was going. The
flight tier was a chip that read "Assist", its meaning only in a hover title (useless on a touch screen),
and a click cycled it, mid-run too, changing the inputs of the run in flight. Rookie mode (0074) offered
an easier car after three crashes, but nothing ever offered a harder one, and nothing stepped down from
Pro. The coach's fixes sat in a block lower on the results sheet, which the judges' theatre covers on an
upright phone, in keyboard words ("Hold LAND (Shift)") whatever the device.

## What
- **How to fly** (`src/pointer.js` `howtoRows`, `index.html` `[data-screen="howto"]`): the first Jump on
  a device shows a short card before the run: this device's controls (touch one-thumb or two-thumb, the
  scheme actually active; keyboard; gamepad, from `src/input.js` lastDevice) for the four things that
  matter: drive & climb, let go, roll & land, brake (Pro and Advanced: roll out, brake at the BRAKE line;
  the Lineup: drive, lift off, roll, land). **Got it · Jump** or **Skip** starts the run; Escape skips;
  it's remembered (`localStorage coldgas_howto`). Any time from the title's **How to fly** and the pause
  sheet. A deep link (`?play=jump`) never waits for it. A browser under automation counts as a returning
  player (the audits and existing specs fly straight in; a spec sets `coldgas_howto = 'new'`).
- **The AI assist control** (`[data-assist-open]`, on the title and the results sheet, every device):
  "AI ASSIST · ON — rolls you out, levels and brakes" (or "OFF · PRO — you fly it; brake at the line ·
  ×1.08"), a status lamp, ≥ 44 px, keyboard reachable. A tap opens the **tier picker**
  (`[data-screen="assist"]`): three radios, each explained in words with its factor, and the **Adapt to
  me** switch. The top bar's `button[data-tier]` keeps its text (Assist / Pro ×1.08 / Advanced ×1.15)
  and now opens the picker instead of cycling. No tier is explained only in a hover title.
- **A run's tier is latched at its start** (`S.flyTier`): the picker, Rookie mode and Adapt to me change
  the next run's tier; the run in flight samples, scores and posts with the one it started with.
- **Adapt to me** (`src/adapt.js`, pure, generalising `src/rookie.js`; default on, a switch in the tier
  picker and the Controls sheet, `localStorage coldgas_adapt`): per session it counts crashes in a row
  (Rookie's streak, unchanged), crashes in a row on the current tier, and good runs in a row (clean,
  touched down at ≤ 1.5 m/s and ≤ 15° tilt, or beat the best on this device). Between runs only:
  - **easier, automatic**: 3 crashes in a row on Pro or Advanced step the tier down one level (Advanced
    → Pro → AI Assist) for the next run; the results say "AI Assist turned on: 3 crashes in a row on Pro."
    with **Undo**. Off, the tier stays put.
  - **easier, offered**: Rookie mode exactly as 0074 (from the third crash in a row), except on the sheet
    that just stepped down (one change at a time).
  - **harder, offered, never forced**: every 3 good runs in a row, one step: Easy driving → Standard
    first, then AI Assist → **Ready for Pro? ×1.08**, then Pro → Advanced ×1.15. One tap takes it and
    goes again.
- **The coach's pointer** (`src/pointer.js` `pickPointer`): after each run the coach's top fix as one
  large line on the sheet, under the run line ("Next run · Land sooner: hold Shift right after you let
  go"; on touch "hold LAND", one-thumb "hold the pad", a pad "hold B"), worded for the tier the next run
  flies. It never repeats a third time running (the next fix, or "Practise just this: Practice → 10 m
  up"); once last run's fix is fixed it says so ("Better: sink 3.1 m/s"). The next run's countdown says it
  again on the cue line ("Tip: …", about 2.5 s; a retry's "Go" waits behind it), so an upright phone
  whose sheet was under the theatre still gets it.
- **Live pointers**: for a player's first five runs, or after two crashes in a row with Adapt to me on,
  the cue line gives the one timely pointer before the mistake, from the predictor (read-only): "Let go
  now: press Space" on the ledge, "Land now: hold Shift" (Assist) as the descent leaves the green with LAND
  not held, "Brake now: press Space" (Pro, Advanced) at the BRAKE line. One per phase per run, through
  the cue line's existing hold. The rest of the cue line already names the device's control at each phase
  (`kbd()`); unchanged.
- No sim or scoring change. The board's rows can't show the tier: the Worker stores the card's facts
  only and is frozen (noted for a Worker ticket); the results' tier line shows it.

## Acceptance criteria
- [x] First Jump on a keyboard and on touch shows the card with that device's controls; Skip / Got it
      starts the run; a reload never shows it again; How to fly opens it any time; Escape closes it.
- [x] The card fits whole (no scroll, no overlap, text ≥ 11 px, buttons ≥ 44 px) at 382×580, 390×844,
      844×390, 678×340, 951×543 and 1280×720.
- [x] The AI assist control is visible, labelled in words, ≥ 44 px, operable by tap and keyboard on the
      title and the results at 390×844, 844×390 and 1280×720; the picker explains each tier and its
      factor; `button[data-tier]` still shows ×1.08 / ×1.15.
- [x] A tier change mid-run is for the next run; the run's card keeps the tier it started with.
- [x] 3 crashes in a row on Pro step to AI Assist with a banner and Undo; with Adapt to me off, no step
      and Rookie mode is offered instead.
- [x] 3 clean landings on AI Assist offer Pro ×1.08 (Easy driving: Standard first); one tap takes it.
- [x] The post-run pointer names the device's control (keyboard and touch) and the next countdown shows
      "Tip: …"; never the same pointer three runs running.
- [x] A new player's cue line says "Let go now: press Space" on the ledge.
- [x] title-audit and hud-audit: no new failures.

## Test plan
- `tests/unit/adapt.test.js`: outcomes, the step down (3, not 2; Adapt off; reset by a clean run or a
  change), Rookie unchanged, the offers (every 3 good runs; level first), live-pointer eligibility, storage.
- `tests/unit/pointer.test.js`: the device vocabulary, the how-to rows per device and tier, every coach
  fix worded on every device, the pick (no third repeat, the drill, "Better:"), the live pointers.
- `tests/e2e/coach-onboarding.spec.js`: the first-visit card (keyboard, touch), its fit at six sizes, the
  assist control at three sizes, the latched tier, the step down with Undo and Adapt off, the step-up
  offer, the pointer on desktop and phone with the next countdown's tip, the live "Let go now".
- Updated: none needed (`learn.spec.js`'s `button[data-tier]` ×1.15 and `rookie.spec.js` hold as they were).
