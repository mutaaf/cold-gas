---
id: 0230
title: The menus read as designed, not generated (one headline, one button, no grey subtitles)
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-13
pr:
by: operator
---

## Why
A real playtester, 2026-11-13: "The UI contains recognizable AI design tropes, particularly repetitive top-left headings and
unnecessary subtitles." They were right. Every screen of the iPhone app was the same stack: a small uppercase eyebrow, a
heading, a grey line under it, a glass card of identical rounded cards, then a row of equal-weight capsules. The title had a
tagline paragraph, three course cards each with a grey description, and a paragraph explaining the tier; the results put an
eyebrow over the coach's tip and a heading over the numbers; every sheet had a stock navigation bar; How to play labelled
each block and gave every fold a grey summary; What's new was an eyebrow, a grid of cards and an icon tile each. Fly, the
one thing a player came for, was a capsule the same weight as Roam. A night-time stunt show should look like one.

## What
iPhone (ios/ColdGas/UI/), no change to the sim, the scores or the haptics:
- **Title**: a playbill over the stage. The chosen event is the headline in big Michroma with the red mark beside it, the
  other two small in the same list (one tap swaps them, animated). Tier as three words with an underline in its colour
  (Pro and Advanced carry their ×1.08/×1.15). Today's objective in one line. **Fly** is the one tall ink button; Roam and
  Free Drive are quiet words under it; Practice, Board, How to play and Settings are four glyphs in one capsule in the
  corner. No tagline, no course descriptions, no tier paragraph (all three are VoiceOver hints now). Sideways, in tabletop
  and on the open Duo it is two columns, split round the crease. One entrance, top to bottom; Reduce Motion fades.
- **Results**: the verdict set in Michroma; no "WHAT COST YOU"/"NEXT RUN" eyebrow; the numbers row shows the numbers, not
  a heading; no "Tap a judge for their call"; Fly again is the tall ink button, Watch it / Challenge / Board / Home are
  quiet words under a hairline.
- **Pause**: no "PAUSED" card; Resume big, Restart · Edit controls · Home as words.
- **Sheets** (Board, Practice, How to play): a quiet close bar instead of the stock navigation bar. The board's events are
  its header (red mark under the chosen one), Today/All time one toggle. Practice is a numbered running order (01 On the
  ledge · its goal). How to play opens on HOLD · TAP · HOLD with no labels over it, and its folds show their names only.
- **Settings**: shorter footers (the judges' honesty line kept, 5½), Geist in the form.
- **What's new**: no eyebrow (the version is a small mark in the hero's corner); the callouts a numbered list, title run
  into its line, an arrow where it goes somewhere; Let's fly is the tall ink button.
- **HUD editor**: the panel says which layout it is and nothing else; the how-to line goes after the first change.
- Shared: `Theme.marquee`, `Tick` (the red mark), `MarqueeButton` (the screen's one button), `QuietButton`, `SheetBar`;
  `Accordion` shows its title, its summary or both.
- `ios/scripts/look-shots.sh`: every screen at four poses on simulators of its own, one at a time, shut down after;
  DEBUG `-sheet <name>` and `-paused` open a sheet or the pause for the shots.

Web (lighter): the title's "Test stand · Night" eyebrow is gone, and the Assist cell no longer grows a grey sub-line on
wide screens.

## Acceptance criteria
- [x] Before and after shots of every changed screen: docs/shots/0230/ (iPhone upright and sideways, the Duo open and tabletop; Free Drive and Roam unchanged, not committed).
- [x] Every function is still there (each course, tier, Fly, Roam, Free Drive, Practice, Board, How to play, Settings,
      Post, Watch it, Challenge, Home, Restart, Edit controls), each a 44 pt target with a VoiceOver label.
- [x] `make test` unchanged (no sim, scorer or haptics change); the UI tests' identifiers and labels kept (How to play's
      check moves to the `howto-steps` identifier).
- [x] Web: `npm run check:fast` green; the title's e2e and audits pass in CI.

## Test plan
`cd ios && make test`; an app build; `ios/scripts/look-shots.sh docs/shots/0230 after all`; `npm run check:fast`; CI.

## Out of scope
Free Drive's HUD and its loading veil (World/DriveView.swift is in another open PR); the run's HUD readouts (measured
instruments, left as they are); new fonts.
