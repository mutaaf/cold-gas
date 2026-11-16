---
id: 0249
title: On the iPhone a first launch flies in three seconds, the first jump is taught by playing, and the first landing is celebrated
status: shipped
priority: P0
size: L
lens: engagement
created: 2026-11-13
pr: 378
by: operator
---

## Why
Phase 2 playtester brief, 2026-11-13: "play first, reward immediately". A fresh install today opens on the title over the
looping reference flight of the Show (`Game.showTitleLoop()`, ios/ColdGas/Game/Game.swift:86), with no first-run handling
at all (no key, no onboarding; How to play is a sheet behind "?"). A newcomer can watch the demo loop indefinitely, and
nothing teaches the jump except a cue line during the run. The native app has no first-landing moment either: results open
with the same `.success` haptic for a landing and a crash (Game.swift:360).

## What
Runs on: the operator's Mac (Xcode, simulators and a device).
**Waits for the native UI redo:** an agent is redoing `ios/ColdGas/UI/` (the title, results and HUD; 0230, PR #368) right now.
Don't start until that has landed; build on its title (the playbill, the one tall Fly) and its results, not today's.
Depends on: 0245 (the vocabulary, for `first_input` and the funnel), 0246 (to measure it); mirrors 0247 and 0248 on the web
(same beats, same copy where it fits).
- **First-run state** in `SaveData` (ColdGasClient/Save.swift): `firstRun` until the first landed jump, plus counters (jumps,
  landings, sessions, first-landing date) that 0254's progress store adopts. A reinstall is a first run again.
- **A first launch plays.** With `firstRun`, the title's reference loop doesn't run; the car sits on the mark, the one
  primary action is "Fly" (the Show, Assist, one thumb), and nothing else asks for attention (Roam, Free Drive and the
  glyphs are there but quiet, as 0230 has them). The first touch anywhere on the title starts the countdown; the countdown
  is shortened to one beat for the guided jump. Target: interacting within 3 s of launch on an iPhone 15-class device.
  The reference loop stays for returning players, and "Watch the reference" stays one tap away.
- **The guided first jump, taught by playing** (one-thumb Assist, the Show): one short contextual hint at each beat, shown
  only when it is needed and gone the moment it's done, never a text wall: hold to climb (the pad breathes), tap to let go
  at the ledge, hold to land. The rotation is the flight computer's on Assist, so the hint at the flip is "let it roll",
  with a haptic tick at 180° and 360°. An assisted landing a newcomer can make (the existing Assist auto-land, roll-out and
  carry over the row, plus 0190/0194's landing on the mark once they ship; no sim change). Skippable from the first hint ("I've got it"), which ends `firstRun`'s hints.
- **The payoff:** the first landing gets its own moment: the beat's verdict, the score counting up, a Core Haptics
  pattern of its own (a rising swell into the "stuck it" settle, ColdGasCore/HapticScore.swift's landing taps unchanged),
  and the crowd/sound sting; then Fly again and Next are right there. No review prompt, no post form, no ad, no modal on
  that screen (the rating prompt is 0259 and never fires here).
- A wreck on the first jump is not a failure screen: one line of what to do ("Hold sooner to land") and Fly again is the
  one button; `firstRun` stays until a landing.
- Events through 0246: `first_input`, `jump_start`/`jump_end` with n, `first_landing`.

## Acceptance criteria
- [ ] UI test (ColdGasUITests): a fresh install's title shows no reference loop and one primary Fly; a tap starts the
      countdown; the hints appear one at a time and are skippable; a landed first jump shows the first-landing moment
      with Fly again and Next and no prompt or sheet over it.
- [ ] UI test: a second launch after a landing is the normal title with the reference loop.
- [ ] On the operator's iPhone, from a fresh install, the first touch on the pad comes within 3 s of the title appearing
      (time measured by `first_input`).
- [ ] Duo (open and tabletop), iPad, portrait and landscape screenshots of the hints and the moment
      (`ios/scripts/look-shots.sh`).
- [ ] No sim, scorer or vector change (`npm run vectors -- --check` clean); frame times unchanged.

## Test plan
ColdGasClient unit tests for the first-run state and counters; UI tests above; look-shots before and after.

## Out of scope
Licenses (0256); the results order beyond the first landing (0258); the rating prompt (0259); the web (0247, 0248).
