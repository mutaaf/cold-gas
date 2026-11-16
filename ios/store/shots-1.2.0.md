# 1.2.0 screenshots: the plan (0268)

Captured **on main as it is** (the current look, which holds 120 Hz). #365 (the visuals leap: real sky, forged car) failed
the Duo device bench on 2026-11-16 (about 46 fps open, GPU 17.9 ms) and went back for optimisation, so 1.2.0 ships without
it; if it merges before 1.2.0 is submitted, these frames are shot again. Uploading goes to the 1.2.0 version only
(`node scripts/asc.mjs store-prep --shots <dir>`, a dry run first), and only when the owner says so.

## The story in the first three frames

The App Store shows three frames before anyone scrolls. They have to say what no template game says (guidelines 4.3 and 4.2.6):

1. **The stunt:** the car in the air over the parked row, its jets firing (the physics).
2. **The wreck:** the same jump missed, with debris in the air and dents on the car (the physics again, as the punchline: Wreck Club).
3. **The verdict:** the results with the judges' words and the "Judged on device" mark and receipt (Apple Intelligence).

Then the breadth: the first jump teaching itself, Roam and Free Drive, a challenge opened from a link, a landing, the valves,
the layout editor.

## Rules for every frame

- **Real gameplay, real UI.** Every frame is the app's own pixels from a Debug build on a simulator, launched with
  `-uitest` as `look-shots.sh` does; the run is a recorded or scripted one (`-autopilot`, `-script`), frozen with `-freeze <tick>` or picked from
  `scripts/store-capture.py`'s slowed run. Nothing is drawn over the game except Lobby's caption band and device frame.
- **Captions claim only what this build does,** and what that frame shows. No "best", "#1", awards, ratings or review quotes.
  "Apple Intelligence" only in words, only on a frame whose receipt says Apple's on-device model; no Apple logo, badge or
  glyph. No brands, no real car names (AGENTS.md 3.7; Lobby's `avoid` list in `store/lobby.json`).
- **Status bar 9:41,** full battery (the scripts set it). No debug text, tick counters or test initials on screen.
- **One simulator at a time,** shut down after its frames (`look-shots.sh` does this; for `store-capture.py`, boot, capture,
  `xcrun simctl shutdown <udid>`). Never a physical iPhone.

## 6.9" iPhone (APP_IPHONE_67, 1320×2868 portrait): 8 frames

Simulator: `ColdGas Pro Max` (an iPhone 18 Pro Max: 1320×2868). Raw frames to `store/lobby/raw/iphone/`.

| # | Frame | How | Caption (Lobby `title` / `sub`) |
|---|---|---|---|
| 1 | **flight**: the Show, Assist, over the row with the jets lit | `store-capture.py <udid> <out> flight 0.25 -play -autopilot -course show`, pick the frame where `CAM phase` is air and the car is over the row; then pin it with `-play -autopilot -course show -freeze <tick>` | Clear the row. *Stick it.* / Ten cold-gas thrusters. One mark to land on. |
| 2 | **wreck**: the carry run that misses, 0.3 to 0.6 s after the first hit, debris in the air | `store-capture.py <udid> <out> wreck 0.25 -play -script crash-show-carry5`, pick from the frames after the impact | Or *wreck it.* / Miss, and the physics takes the car apart. |
| 3 | **judges**: the results of a landed run, the judges' words written, the receipt line in view | `look-shots.sh <out> store phone results` (portrait), or `-play -autopilot` and wait for the receipt | Judged *on your iPhone.* / Apple Intelligence writes the judges' words on the device. A fixed scorer sets every number. |
| 4 | **first jump**: a fresh install's guided jump, the "hold to climb" or "tap to let go" hint | `look-shots.sh … guide` (`-firstrun -play -freeze 400`; move the tick to the beat that reads best) | Your first jump *teaches itself.* / One tap to fly. One hint at each beat. |
| 5 | **roam**: the Show's set from the road, cones knocked over, the world beyond | `look-shots.sh … roam` (`-roam show`), or `-freedrive -fd-km 3 -fd-cruise 25` for the open road | Then just *drive.* / Roam the sets and on into a world built as you go. No timer, no score. |
| 6 | **challenge**: a friend's link opened in the app, their card and Take the challenge | `look-shots.sh … challenge` (`-open https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=…`) | Beat *their* score. / A friend's link opens the app on their jump. |
| 7 | **touchdown**: on the mark, dust off the tyres | `-play -autopilot -course show -freeze <touchdown tick>` (from frame 1's capture log) | Feel *every wheel* land. / A synced landing is one thump. A sloppy one is four. |
| 8 | **valves**: Advanced, the ten-valve deck, the car rolling | `-play -autopilot -course show -tier advanced -freeze <tick>` | Fly *ten valves* by hand. / Assist, Pro, Advanced: take the computer away one tier at a time. |

Spare, if a frame above fails review: the layout editor (`look-shots.sh … editor`: "Put every control *where your thumbs are.*")
or the Lineup's roll (`-course lineup`).

Check before keeping frame 3: the receipt must read "Words by Apple's on-device model … no data left the device". A simulator
on a Mac without Apple Intelligence falls back to the edge model; then that frame says so, and its caption must not mention
Apple Intelligence (use "Three judges. *Every number explained.*" instead, or capture on a Mac where it is on).

## 13" iPad (APP_IPAD_PRO_3GEN_129, 2064×2752 portrait): 7 frames

Simulator: `ColdGas iPad 13` (2064×2752). Raw frames to `store/lobby/raw/ipad/`. The same captures as the iPhone with the
iPad's side-grip deck: 1 flight, 2 wreck, 3 judges ("Judged *on your iPad.*"), 4 roam, 5 challenge, 6 valves (the split deck
at the side grips shows best here), 7 first jump. Portrait throughout, as 1.1.0's set was.

## iPhone Duo (APP_IPHONE_DUO): 6 frames, replacing 1.0's set

1.0's six frames predate the UI redesign, Roam, Free Drive and the judges on device: all six are replaced. The set takes
1398×2034 (the outer display) or 2007×2853 (the inner display, portrait), per `SHOT_SETS` in `scripts/asc.mjs`.

| # | Pose | Frame | How |
|---|---|---|---|
| 1 | open (flat), edge to edge | flight over the row, the controls on the side edges, nothing on the crease | `-window 951x669 -pose flat` with frame 1's freeze; inner display |
| 2 | tabletop | the scene on top, the console below (DRIVE · CLIMB · HANG · AIR · LAND) | `-window 669x951 -pose tabletop`, same freeze |
| 3 | open | the judges on the results, the receipt in view | `look-shots.sh <out> store duo results` |
| 4 | open | the wreck, debris across the whole display | frame 2's capture with `SHOT_DISPLAY=primary-1` |
| 5 | tabletop | Roam on the Show's set | `look-shots.sh … duo roam` |
| 6 | closed (outer) | the first jump's hint | `-firstrun -play -freeze 400`, no `-window` |

Size: tabletop on the inner display is 2007×2853 portrait and uploads as it is. Open is 2853×2007, landscape, which the set
does not take: Lobby frames it into 1398×2034 as it did 1.0's `7-book`. The simulator's inner display is black while the Duo
is closed (docs/NATIVE.md §8): unfold it in Device Hub before capturing from `primary-1`; `-window`/`-pose` alone lay out the
app but are still drawn on the outer display. Captions: "Open it. *Fly it.*" (1), "A console *in tabletop.*" (2), then the
iPhone set's captions for 3 to 6.

## Review before committing

Look at every frame at full size, then as a thumbnail: is the car legible, is the moment the right one (jets lit, debris in
the air, the receipt readable), nothing clipped by a notch, the island or the crease, no two frames alike, and every caption
true for this build. Then commit the raw frames under `store/lobby/raw/` and the new shot list in `store/lobby.json`, frame
them with Lobby into `ios/build/store-shots/{iphone-69,ipad-13,iphone-duo}/`, and run
`node scripts/asc.mjs store-prep --shots build/store-shots` (dry run) to see the upload it would make.

## As shot (2026-11-16, main, `-mute`)

Raw frames: `store/lobby/raw-1.2.0/{iphone,ipad,duo}` (JPEG, for Lobby; `store/lobby.json` lists the shots and captions). The
upload set, full-size PNGs in this order, goes in the gitignored `ios/build/store-shots/` and is made again from the same
launches. Each set was shot on its own fresh simulator (iPhone 18 Pro Max, iPad Pro 13" M5, iPhone Duo), deleted afterwards.

- **6.9" iPhone (9):** flight (Show, Assist, `-freeze 2700`), wreck (`crash-show-carry5`, `-freeze 3550`), judges, first
  jump (`-firstrun -freeze 1300`: "Hold the pad to climb"), Free Drive (3.8 km out), challenge, touchdown (`-freeze 3400`),
  valves (Advanced, `-freeze 2700`), layout editor.
- **13" iPad (8):** the same, without the editor.
- **iPhone Duo (6):** tabletop (scene on top, console below) first, then the closed screen's wreck, judges, first jump, Free
  Drive and flight.

What differs from the plan, and why:
- **Frame 3 shows the edge model, not Apple Intelligence.** The simulator on this Mac has no Apple Intelligence, so the receipt
  reads "Words by the edge model (@cf/google/gemma-…)". Its caption is "Every number, *explained.*", with no claim about the
  device. A frame with "Judged on device" needs a Mac whose simulator has Apple Intelligence, or the owner's go-ahead for a
  device capture.
- **On Assist the autopilot doesn't fire the lift jets over the row,** so frame 1 shows the car in the air over the row
  without plumes, and its caption says nothing about the jets being lit.
- **The scripted wreck is mild:** the car comes down on the end of the row and tumbles off it; there's little debris in
  frame. A bigger recorded crash would make a stronger second frame.
- **No Duo frame is open (edge to edge).** `-window 951x669 -pose flat` letterboxes the layout inside the outer screen;
  the inner display needs the Duo unfolded in Device Hub, which can't be scripted. 1.0's open frame (`raw/duo/7-book`) is
  the only one so far.
- Roam's frame was dropped: the world was still loading ("Raising the land") at the capture.
