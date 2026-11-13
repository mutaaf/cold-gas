---
id: 0220
title: The iPhone app's touch controls are the player's to arrange (a HUD layout editor, per tier and per screen shape)
status: in-progress
priority: P1
size: L
lens: player-feel
created: 2026-11-12
pr:
by: operator
---

## Why
The owner (2026-11-12): "the controls need to be roblox style or fortnite style flexible". 0210 shaped Pro and Advanced
for each screen, but the shape is ours. A player with big thumbs, a claw grip, a left hand, a case that eats the corner,
or a Duo held their own way can't move a thing. The mobile games people play most let every player arrange the HUD:
drag, size, fade, presets, a stick that follows the thumb. Cold Gas should too, as its own design: hairline glass, the
deck's own words, nothing copied.

## What
Runs on: the operator's Mac (Xcode, the simulators). iPhone app only; the web, the Worker and the sim are untouched.
- **The geometry, pure and tested** (`ColdGasLayout/HudLayout.swift`, `HudLayoutTests`). A layout is the player's
  changes over Deck's factory (0210): per control, its centre as a fraction of the controls rect, a size multiplier
  (0.6–1.8, never under 44 pt; the stick's ring and the thumb pad bigger) and an opacity (15–100 %).
  - Controls: the stick, the fan's slots A, B, C, Advanced's valve deck (whole, or its two halves), Assist's thumb pad.
  - Kept per tier (Assist, Pro, Advanced, Free Drive) and per shape (phone upright, phone sideways, Duo closed, Duo book,
    Duo open flat, Duo tabletop, iPad), the shape from the fold layout, never the device model.
  - Every placement is made legal: inside the controls rect (the safe area) by Deck's margin, and never across the
    fold band: a control dropped on the crease lands on the side it was dropped, or the other if that one has no room.
  - Snap guides: the rect's middle and margins, and every other control's centre and edges, within 8 pt.
  - Overlaps among controls on the glass together (the classic deck; the valve deck; the thumb pad) are found and
    flagged, not forbidden.
  - Presets as recipes on any shape: Thumbs (the factory), Claw (B and C up where the index fingers rest), Left-handed
    (the classic deck and the thumb pad mirrored; the valve deck keeps the car's left on the left), Minimal (85 %, 50 %).
    Mirror flips whatever is there. The save's older `hand: left` starts the mirror where nothing is saved for a shape.
- **The save** (`SaveData.hud`, `HudPrefs`): every field optional, each read on its own; junk costs only itself, an old
  save has the factory controls. `DeckGeometry.layout(size)` applies it, so the deck, the valve deck, the thumb pad, the
  cue's lift and the camera's carry check (CameraFraming) all follow the player's layout.
- **The editor** (`UI/HudEditor.swift`): Settings → Controls → Edit the layout, and Edit controls on the pause sheet. A
  canvas over the controls rect draws each control at its opacity with its tag and words; drag to move, two fingers to
  resize, a Size and an Opacity slider for the selected one, its own Reset; tier and deck (ground/valves, classic/one
  thumb) pickers; Presets, Mirror, Undo, Reset; the fold hatched, the safe area dashed, the guides drawn; a haptic tick
  on each snap; Save or Cancel (asks before discarding). VoiceOver: every control is an element named for what it does,
  its place and size as its value, and actions to move, size and fade it.
- **The stick** (Settings → Controls): Fixed (only a thumb on the ring), Floating (0210's: the ring comes to a thumb
  that lands beside it), or Follows the thumb (anywhere on its side, dragged along past the rim). A dead zone (0–40 %)
  and a sensitivity (0.5–2×) applied on the glass before the sampler's own shaping; the factory 0 and 1 are the
  identity, bit for bit.
- **The buttons**: tap BRAKE or BOOST to hold (tap again to let go; a latch lets go when its button leaves); RELEASE on
  the finger's lift (a 0.12 s LIFT from the lift, a tap's length). Each is only when presses happen, never what they are.
- **Free Drive** (the controls-layout API its drive controls use): tier `.drive` on the drive screen, the same
  `FlightDeck` with `look: true`: a finger on empty glass turns the chase camera round the car (DriveLook: sensitivity,
  invert, drifts back behind the car 1.2 s after the finger lifts). The one hook in the drive's files is DriveCamera's
  chase heading.
- Game controllers and keyboards are untouched (Hardware.swift).

## Acceptance criteria
- [x] The sim inputs and their meaning are unchanged: `make test` green (the run vectors, the live input vectors).
- [x] `HudLayoutTests`: the factory is Deck's, exactly; every preset on every measured shape keeps every control in the
      rect, off the fold, at least 44 pt, without overlaps; left-handed mirrors (and mirrors back); a drop on the Duo's
      crease lands beside it; snapping; overlaps only among controls shown together; sizes and opacity in range; the stick
      modes' zones; the stick's shaping is the identity at the factory settings; prefs round-trip and shrug off junk.
- [x] `HudSaves`: a save from before the editor decodes with the factory controls; layouts round-trip; a damaged HUD
      field costs only itself.
- [x] On one simulator: drag, resize, save, relaunch keeps it; preset switching; left-handed mirror; a full Pro and an
      Advanced run on the Wall with a custom layout, past the ledge (0210's old hang spot) to the results.
- [x] Screenshots of the editor and of two custom layouts on a phone sideways, the Duo tabletop and an iPad, looked at.
- [x] `make rules` passes; the app builds; the 1.2.0 notes carry a What's new card for it.

Verified on one simulator (an iPhone Pro Max, iOS 27.0; the Duo and the iPad laid out by `-window`/`-pose`):
`HudEditorUITests` passed by touch (drag, the Size and Opacity sliders, a pinch, Save, relaunch kept it, the Left-handed
preset, Mirror, Undo), then a whole Pro run on the Wall (left-handed) and a whole Advanced run on the Wall (Claw), both
past the ledge to the results. A launch with a preset and the editor open crashed on a NaN before the first layout
(a preset worked out on a zero-size rect); fixed and tested (`aRectWithNoSizeYetIsNeverNaN`).
Shots (docs/shots/hud-0220/, from `ios/scripts/hud-shots.sh`): the editor, Claw on the ledge (RELEASE up), Left-handed in
the air, Minimal on Advanced's valve deck, each on a phone sideways, the Duo tabletop and an iPad. All looked at.
Not yet: a hardware pass (a Duo's real fold and closed screen, a Pro Max, an iPad in the hand); VoiceOver driven by a
person; Free Drive's swipe-to-look on the simulator (the drive is being rebuilt in parallel).

## Test plan
`ios/Packages/ColdGasCore/Tests/ColdGasLayoutTests/HudLayoutTests.swift` and `Tests/ColdGasClientTests/HudSaveTests.swift`.
`ColdGasUITests/HudEditorUITests.swift` drives the editor by touch (drag, pinch, a preset, mirror, save, relaunch). Shots
use the DEBUG launch arguments `-hudEdit <tier>` (the editor at launch), `-hudPreset <name>` (a preset on every tier
and shape), `-hudReset`, `-hudStick <mode>`, with `-window`/`-pose` for the Duo.

## Out of scope
- Remapping a controller's buttons (the sampler reads the standard mapping; a remap is its own ticket).
- Moving the HUD's readouts (the gauges stay where the HUD puts them; they're not touched).
- A hardware pass on a Duo, a Pro Max and an iPad (feel, reach in the hand).
