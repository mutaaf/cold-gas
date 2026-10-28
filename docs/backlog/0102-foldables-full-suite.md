---
id: 0102
title: Foldables, the full suite (umbrella) - the book-style fold and the flip phones in every screen state
status: in-progress
priority: P1
size: L
lens: platform
created: 2026-10-27
pr:
by: operator
---

## Why
The operator, 2026-10-27: **"we need a full suite of iPhone Duo and flip phone support."** 0075 (#98) made
the book-style fold seamless, but it used secondhand simulator sizes (one of them, 678×340, was wrong), and
it said nothing about flip phones (a tall 22:9 inner screen, a near-square cover screen, the half-folded
Flex Mode), about a fold while paused or on the results, or about the camera on these shapes. This note
holds the device facts and splits the work. Everything here is **emulated**: no physical device was used.

### The devices (sources)
**The book-style fold** (named here only; never in the UI, invariant 3.7). Apple's spec page
(https://www.apple.com/iphone-duo/specs/, primary): outer 5.4" 1398×2034 at 460 ppi, inner 7.6"
1878×2670 at 430 ppi, 120 Hz, A20 Pro. Apple's HIG for it
(https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo, primary): a game
is playable in every pose and fills the screen (change the aspect ratio, don't letterbox).

**What Safari gives a page, measured** by the operator on 2026-10-27 with a probe page in Safari 27 on the
simulated device in Xcode's Device Hub (not physical hardware; raw log kept with the operator):

| Pose | innerWidth×innerHeight (CSS px) | safe-area insets |
|---|---|---|
| open, upright | 669×871 | top 2, bottom 34 |
| open, sideways | 951×589 | top 2, bottom 34 |
| closed, upright | 382×580 | 0 (transiently right 84, then −84) |
| closed, sideways (one way) | 594×368 | left 84 |
| closed, sideways (other way) | 678×384–386 | bottom 34 (82 for a moment) |
| mid-swing, fold | 466×498 for 50–400 ms (sometimes longer) | right 84 |
| mid-swing, unfold sideways | 867×589 for ≈ 80 ms | top 2, bottom 34 |
| **installed (0081), open, upright** | 669×930 | top 61, bottom 34 |
| **installed, open, sideways** | 951×648 | (as in a tab) |
| **installed, closed, upright** | 466×657, alternating with 382×657 (466 − an 84 px side inset) | side 84 |
| **installed, closed, sideways** | 678×445 | left or right 84, bottom 34 |

Installed (`display-mode: standalone`), the events can come the other way round: `resize` first and
`orientationchange` 70–2000 ms later, with `screen.orientation.type` wrong in between (landscape-secondary
at 669×930). The safe-area insets lag the resize by a poll (≤ 500 ms) and pass through nonsense (right
−282, −84): read them after the size settles, and never let a negative inset move anything.

- UA `… (iPhone; CPU iPhone OS 18_7 like Mac OS X) … Version/27.0 Mobile/15E148 Safari/604.1`, platform
  iPhone, maxTouchPoints 5, DPR 3 on both screens, WebGL2 "Apple GPU" (8192 textures), 8 cores, no
  deviceMemory, `(pointer: coarse)` in every pose. So `deviceKind()` says 'phone' open or closed.
- `screen.width × screen.height` is **466×678 in every pose** (the outer screen) and never changes: nothing
  may size from `screen.*`. Open and closed are told apart by the viewport only.
- **No fold APIs at all**: no `window.viewport`, no segments (`env(viewport-segment-*)` falls back, the
  segment media queries are false), no `navigator.devicePosture`, the posture queries are false. WebKit's
  Safari 27.1 post (https://webkit.org/blog/18486/webkit-features-for-safari-27-1/, primary) lists both
  APIs behind feature flags (off by default). The inner screen has no crease to avoid.
- A fold or an unfold: `orientationchange` (and `screen.orientation`'s change), then `resize` 10–40 ms
  later, sometimes a second `resize` ≈ 400 ms after that at another size; `screen.orientation.type` can be
  stale for a few ms (portrait-primary at 951×589). No reload. So: re-lay out on the size once it settles,
  never on the orientation type.
- WebKit's own table (same post) gives 669×867 / 951×585 inner and 594×368 outer sideways with the toolbar
  showing, within 4 px of the measurements; it also gives 385×571 for each of two windows side by side.
- Unmeasured: half-open (Safari moves to the outer screen, per 0075's source; no posture is reported either
  way). Nothing was measured on physical hardware.

**Flip phones** (Chromium on Android). Panels from secondary sources (spec sheets): Galaxy Z Flip 7/8 inner
6.9" 1080×2520, cover 4.1" 948×1048; razr ultra 2025 inner 1224×2912, cover 4" 1272×1080. No primary
source gives Chrome's CSS viewport for any of them, and whether Chrome runs on a Flip's cover screen at all
is a Good Lock add-on matter (secondary). So the sizes are **estimates, designed for the cramped end**:
inner upright 360×748 (1080/3 wide, less Chrome's bars), inner sideways 800×300 (less the URL bar and the
status bar), cover 360×380 (a Flip's square less the URL bar) and 424×360 (a razr's wide cover).
Book-style Android folds (Galaxy Z Fold, Pixel Fold) open near-square: 744×780 (DevTools' Fold 6 spanned
744×860 less Chrome's bars).

**Chromium's fold APIs** (primary): Viewport Segments shipped in Chrome 138, desktop and Android
(https://developer.chrome.com/blog/viewport-segments-api-shipped): `window.viewport.segments`,
`env(viewport-segment-{top,bottom,left,right,width,height} X Y)`, `horizontal-viewport-segments` /
`vertical-viewport-segments`. Device Posture (`navigator.devicePosture.type` continuous | folded,
`@media (device-posture: folded)`) shipped in Chrome 132 (MDN browser-compat-data). For tests, the
DevTools protocol (https://chromedevtools.github.io/devtools-protocol/tot/Emulation/):
`Emulation.setDevicePostureOverride({ posture: { type } })` and a display feature on
`Emulation.setDeviceMetricsOverride` (`displayFeature: { orientation, offset, maskLength }`; the newer
`setDisplayFeaturesOverride` isn't in Playwright's Chromium 156, and `setDisplayFeaturesForTesting` doesn't
exist). Measured in Playwright's Chromium 156: the posture override flips `(device-posture: folded)` but
`navigator.devicePosture` is absent there, so code reads the media query; a horizontal display feature
gives two stacked segments and `(vertical-viewport-segments: 2)`.

### What 0075 already covered
A fold or unfold mid-run keeps the run (the camera re-fits at once, the drawing buffer once the size holds
for 150 ms, the transient size gets no buffer); the open screen's title and results in two columns, the
drills two by two, the theatre full screen; the compact band by its own width; a reported vertical hinge
keeps the band, the phase tab and the cue line off it; a horizontal one moves the cue line below it;
`dvh` sheets; five fold sizes in both audits.

### The split
- 0103 The book-style fold's measured screens are in the gate (viewports, insets, layout fixes).
- 0104 Flip phones: the tall inner screen both ways and the cover screen.
- 0105 Flex Mode and a reported hinge: the scene above the fold, the controls below.
- 0106 A fold mid-anything: a drastic change pauses a run, lets go of every touch, and re-lays out
  the pause sheet, the results and the replay.
- 0107 The camera keeps the car framed at the foldables' aspect ratios.

## What
The five tickets above, in order, one PR each, test-first.

## Acceptance criteria
- [ ] 0103, 0104, 0105, 0106 and 0107 shipped.
- [ ] AGENTS.md invariant 8 lists the foldables' viewports.

## Test plan
Each child ticket's own.

## Out of scope
Physical hardware (none available: everything is emulated). A layout per device. Detecting a device by
its UA.
