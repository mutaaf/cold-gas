---
id: 0075
title: Built for the folding phone; a fold or an unfold mid-anything is seamless, the open screen is an upgrade
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-22
pr: 98
by: builder
---

## Why
The operator: "we need to utilize the iPhone Duo and its design guidelines and build some built-for-iPhone-Duo
features into this and use the fold states". The device (named here, never in the UI: invariant 3.7) has an
outer screen and an inner one; Apple's HIG for it asks for a UI that follows a pose change "without a visible
seam", no custom layout per pose, no fixed widths or hard breakpoints, elements displaced near the fold rather
than redesigned, related elements moving together, and the open screen used as an upgrade ("a rearrangement,
not a reduced feature set"; prefer even column counts).

What Safari gives a page (simulator measurements, secondhand, 2026): closed upright 382×580, closed sideways
678×340, open upright 669×825, open sideways 951×543 (CSS px, DPR 3). `screen.width` stays 466 after an
unfold. A fold or an unfold fires `resize` (and an orientation event) and does NOT reload; mid-swing there is
a transient 466×498 that no pose has. A half fold moves Safari to the outer screen (the closed viewport).
Safari has no Viewport Segments or Device Posture (the media queries are false); Chromium foldables do
(`horizontal-viewport-segments: 2`, `env(viewport-segment-*)`, `device-posture`). Every pose is
`pointer: coarse`. Closed, `100vh` is 598 (18 px too tall) and `100dvh`/`svh` 580.

Before this change: every window resize reallocated the drawing buffer and the composer's targets at once
(twice through a fold, once for the size no pose has); the open screen got the phone's one long scroll for the
title, the results and the drills; the open screen sideways cut the title's wordmark off under the top bar
(its block outgrew the height); closed sideways (678×340) the compact band wrapped N₂'s unit to a third line
and the phase tab sat on it; and a few sheets sized in `vh`.

## What
- `src/render/scene.js` `reshape()`, wired to `resize` in `src/main.js`: the camera takes the new shape at
  once (the next frame is drawn in the right proportions into the old buffer, which the browser scales: never
  stretched), and the drawing buffer and the composer's targets are reallocated once the size has held for
  150 ms. A fold's transient size costs a projection matrix, not a reallocation. No per-frame work.
- `src/hud-mode.js` `refitHudMode()`: on a settled resize the compact/full default follows the new shape,
  only while the player hasn't chosen (a choice is stored and never flipped).
- `src/styles.css`, an opened folding phone (touch, at least 600 × 500 and at most 1000 × 900: no phone,
  iPad or desktop we audit matches it, so nothing else moves): the title in two even columns (who you are on
  the left; the events with their descriptions, Free Drive and Jump on the right, under the right thumb);
  the results sheet in two balanced columns (each block whole; the section scrolls; the action row at the
  head of the first column); the drills two by two; the judges' theatre full screen as on a phone (beside a
  two-column sheet there is no room for it).
- The compact band, by its own width (a container query): a wide band (≥ 480 px: open sideways, a tablet
  sideways) shows one more instrument, PITCH; a very narrow one (≤ 260 px: closed sideways) keeps every
  reading on one line and the handle shows its chevron alone (still a 44 px target with its name).
- Progressive enhancement where a browser reports the hinge (Chromium's Viewport Segments): beside a
  vertical fold the band, the phase tab and the cue line keep their left edge and stop short of the fold;
  below a horizontal fold the cue line moves into the lower segment. Feature-detected, zero effect elsewhere.
- `vh` → `dvh` where a sheet or a block is sized by the height (damage map, Sandbox saves, title, scrims).
- `scripts/hud-audit.mjs` (set `fold`, and in `all`) and `scripts/title-audit.mjs`: the four poses and the
  transient, touch at 3×.
- No tent-pose layout: Safari can't detect it, and it isn't faked. No sim change.

## Acceptance criteria
- [x] A fold mid-run (closed → 466×498 → open and back, both orientations): same `S.run`, its tick
      advances, no reload (a window marker survives), the camera has the new aspect at once, the drawing
      buffer matches the new viewport once it settles, and the size no pose has gets no buffer of its own
      when it passes within the settle; the HUD has 0 overlaps and 0 boxes offscreen
      (`tests/e2e/fold.spec.js`).
- [x] The title and the results lay out in two columns open (669×825, 951×543) and one closed (382×580,
      678×340), nothing past the edges (`tests/e2e/fold.spec.js`).
- [x] A reported vertical fold (DevTools protocol display feature, Chromium): the band, the phase tab and
      the cue line keep off the hinge (`tests/e2e/fold.spec.js`).
- [x] The HUD default follows a new shape only while nothing is chosen (`tests/unit/hud-mode.test.js`).
- [x] `node scripts/hud-audit.mjs <url> <dir> all` (440 frames): 0 offscreen, 0 text < 11 px everywhere;
      contrast failures 2, the same two as main (Free Drive at 1180×820, the cue at 390×844s run-up); 0
      overlaps at every viewport in the compact HUD (the default on this device in every pose) and in the
      full HUD everywhere except closed sideways and mid-swing (below, out of scope).
- [x] `node scripts/title-audit.mjs`: 0 issues at every viewport including the five fold sizes (the
      wordmark rose under the top bar at 466×498 and the top bar ran 2 px off a 382 px screen before).
- [x] Works at 390×844 touch and 1280×720 keyboard (nothing there changes: the fold query doesn't match).

## Test plan
`tests/e2e/fold.spec.js` (new): the two mid-run folds, the four poses' title and results columns, the
reported hinge. `tests/unit/hud-mode.test.js`: refit follows the shape, keeps a choice. The HUD and title
audits at the fold sizes, screenshots looked at closed and open.

## Out of scope
The full instrument set (MORE) on a 340 px-tall screen: closed sideways (678×340) the full HUD overlaps
itself in every phase (28 overlaps: the attitude dial and the one-thumb pad, the mission row and the
vehicle panel, the descent and the strip, the cue line and LESS; the strip's seven cells get 239 px), and
at the 466×498 swing size the cue line meets the pad at the brake (2 frames). The same overlaps are on
main; the audit only now measures these sizes. It needs its own arrangement of the full set for very
short landscape (a follow-up ticket). The compact HUD, the default here, is clean at both sizes.
A tent pose (undetectable in Safari). A layout per pose. The top bar's icon buttons and the results sheet's
buttons (other tickets in flight).
