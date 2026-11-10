---
id: 0187
title: On a phone, the climb and the hang show a white car on a grey deck, not a red room with a white smear
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-11-10
pr: 303
by: critic
---

## Why
The hang under the ledge is the reveal's signature image. The car crawled up the curl on suction and hung
upside down for about 10 s (REVEAL_RESEARCH §2.1.2), and the broadcast's close-up showed "a thick white slab
edge over a red-lit side fascia" (§2.1.1). The red there is thin LED edge strips on a light-grey concrete deck
(§1.1, "Set": "a dark tarmac pad lit by white floodlight pools … long red LED edge strips"). Most of our
players are on phones, and on a phone that moment is a red room with a white smear in it.

Critique 2026-11-10 16:00 measured production (`index-D9Vr38JO.js`) on SwiftShader, with the reference run
(`startRun('reveal')`) and one first-visit one-thumb run:

| moment | phone 390×844: saturated red share | desktop 1440×900: saturated red share | car box P10 / P50 luminance (both screens) |
|---|---|---|---|
| climb, car 6–8 m up (`r1-climb.png`) | **45.1 %** | — | — |
| on the curl, `invertedTime` 1.0 s (`phone-hang.png`, `desk-hang.png`) | **35.8 %** | 7.0 % | phone 150 / 197, desk 149 / 197 |
| on the curl, `invertedTime` 1.9 s, pitch 141° (`phone-hang2.png`, `desk-hang2.png`) | **38.3 %** | 6.4 % | phone 140 / 189, desk 140 / 189 |
| after the release (`phone-release.png`) | 24.2 % | — | 10 / 19 (the car reads) |
| the carry over the row (`r1-carry.png`) | 7.1 % | — | — |

"Saturated red share" counts pixels whose largest channel is red, with HSV saturation > 0.5 and value > 40/255.
"Car box" is the roadster's projected 4.4 × 2.0 × 1.2 m box in screen pixels.

- **The phone is 5–6× redder than the desktop at the same moment of the same run.** The renderer is the same,
  so this comes from the phone's framing (the camera is in front of the ring, and its glow fills a narrow
  frame) or from the bloom at a phone's resolution. It doesn't come from the scene's palette.
- **On both screens, nothing in the car's box is dark during the climb and the hang.** The 10th-percentile
  luminance is 140–150. The tyres, the glass and the shut lines don't show, so the car is two white quads with
  a red outline (`phone-hang2.png`, `desk-hang2.png`). Once it falls clear of the deck, the same car reads at
  once (P10 10).

0086 covers the title's red wash and puts in-run lighting out of scope. This ticket is the in-run half.

## What
- `src/render/director.js` and `src/render/scene.js` / `src/render/wall.js`: on a portrait phone during the
  climb and the hang, frame and light the deck so the red stays an edge accent. The levers are the LED ring's
  emissive spill and bloom into a narrow frame, and the camera's distance from the ring. A look and camera pass:
  no sim, no score, no layout change.
- The car on the deck reads as a car: its dark parts (tyres, glass, the shut lines) survive the searchlights and
  the bloom while it's on the curl.
- Add the measure to a script (`scripts/shots-show.mjs` or a new report-only `scripts/look-audit.mjs`): the red
  share of the frame and the car box's P10 luminance at the four moments above. Print it for phone and desktop.

## Acceptance criteria
- [ ] At 390×844 touch, on the climb (car 6–8 m up) and at `invertedTime` 1.0 s and 1.9 s on the curl, the saturated red
      share (definition above) is **≤ 12 %** of the frame. That's the bar 0086 sets for the title. The desktop's
      7 % is the reference.
- [ ] The car box's P10 luminance at those moments is **≤ 60** on both 390×844 and 1440×900 (today 140–150). The
      tyres and glass show dark, as they do after the release (P10 10).
- [ ] The same numbers at 430×932 and 844×390, so the fix isn't only for one aspect.
- [ ] Before/after screenshots at each moment, phone and desktop, in the PR. Checked on a real GPU too (0086's
      note: bloom differs from SwiftShader), or the PR says it wasn't possible.
- [ ] `flicker-budget` passes for both screens on the scenarios touched (`approach`, `wide`, `replay`), and
      `npm run audit` stays clean.
- [ ] `ref-hash` unchanged (no sim change).

## Test plan
The report-only look measure above, with a unit test of the red-share and P10 functions on a synthetic image.
Run it on main and on the branch at the four moments, phone and desktop, and paste both tables in the PR.

## Out of scope
The title's grade (0086). The lip height (27.7 m, the operator's call). The Wall's geometry. The car's model.
