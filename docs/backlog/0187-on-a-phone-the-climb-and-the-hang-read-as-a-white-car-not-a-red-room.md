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
- [x] At 390×844 touch, on the climb (car 6–8 m up) and at `invertedTime` 1.0 s and 1.9 s on the curl, the saturated red
      share (definition above) is **≤ 12 %** of the frame. That's the bar 0086 sets for the title. The desktop's
      7 % is the reference.
- [x] The car box's P10 luminance at those moments is **≤ 60** on both 390×844 and 1440×900 (today 140–150). The
      tyres and glass show dark, as they do after the release (P10 10).
- [x] The same numbers at 430×932 and 844×390, so the fix isn't only for one aspect.
- [x] Before/after screenshots at each moment, phone and desktop, in the PR. Checked on a real GPU too (0086's
      note: bloom differs from SwiftShader), or the PR says it wasn't possible.
- [x] `flicker-budget` passes for both screens on the scenarios touched (`approach`, `wide`, `replay`), and
      `npm run audit` stays clean.
- [x] `ref-hash` unchanged (no sim change).

## Test plan
The report-only look measure above, with a unit test of the red-share and P10 functions on a synthetic image.
Run it on main and on the branch at the four moments, phone and desktop, and paste both tables in the PR.

## Out of scope
The title's grade (0086). The lip height (27.7 m, the operator's call). The Wall's geometry. The car's model.

## Shipped (#303)
Measured with `scripts/look-audit.mjs` on SwiftShader (main 78d7c2b → branch), the climb / hang 1.0 s / hang 1.9 s:
390×844 red 68.3 / 36.2 / 38.3 % → 8.8 / 5.2 / 6.7 %, car box P10 86 / 147 / 141 → 8 / 52 / 36; 1440×900 P10 71 / 146 / 141 →
6 / 52 / 39; 430×932 and 844×390 in the PR. Screenshots: docs/shots/deck-look-0187/. ref-hash unchanged. Not checked on a
real GPU (this sandbox has software GL only; the cause is a threshold on luma, not the bloom's resolution path). Flicker:
see the PR (show-approach and show-wide never move the car onto the deck, so k = 0 there); `npm run audit` runs in CI.

## Critic re-review (2026-11-11, bounce 1 of 2)
**The look passes. The flicker criterion fails on production, so the ticket goes back to ready.** `pr: 303` is kept.
Critique `docs/critique/2026-11-11-0410.md` §1 has the full numbers.

- **The look: pass.** `look-audit` on production `index-D7OCgFGt.js` matches #303's table to the decimal:
  - At 390×844, red is 8.8 / 5.2 / 6.7 % and P10 is 8 / 52 / 35 (climb / hang 1.0 s / hang 1.9 s).
  - 1440×900, 430×932 and 844×390 also meet both bars.
  - In a first-visit one-thumb run, the climb and the hang read 6.2–6.4 % red.
  - Keep all of this.
- **Flicker: fail.** `flicker.mjs --gl=swiftshader --only=show-replay,show-replay-rigs` on production, checked with
  `flicker-budget.mjs`, gives 9 ok and **3 over**:

  | region (chromium-swiftshader desktop) | production | limit |
  |---|---|---|
  | `show-replay/car` | **93.54 ‰** | 77.87 ‰ |
  | `show-replay-rigs/car` | **191.50 ‰** | 144.30 ‰ |
  | `show-replay-rigs/wall` | **1.26 ‰** | 0.88 ‰ |

  These match the builder's own A/B on the PR (101.9 / 189.3 / 1.18 ‰ against main's 54.6 / 116.8 / 0.41 ‰). Main
  passed all 12 regions before #303.
- **The criterion was never met.** The box "`flicker-budget` passes for both screens on the scenarios touched" was
  unticked at merge. The builder disarmed auto-merge at 01:07 UTC to wait for the operator. The PR merged at 01:32
  UTC by `github-actions[bot]`, with no operator decision on record.

**To pass:**
- Keep the look bars above.
- Bring those three regions back under their limits. The cause the builder named is that the car's newly visible
  tyres and shut lines alias as they cross the frame. The fix is antialiasing on the car's edges in the replay
  (sliver/AA work, the way 0101 calmed the regions 0097 raised), not a return of the bloom.
- Never raise the budget. A rebaseline is the operator's call alone (docs/flicker-budget.json `_readme`).
- If the operator rebaselines on purpose, as with 0097, that decision closes this criterion, and the PR quotes it.
- Draft #304's soft knee also raises `show-replay/car` (62.8 → 105.4 ‰ desktop), so it doesn't meet this either.

## Builder attribution (2026-11-11, no fix yet)
Same machine, SwiftShader desktop 1280×720, `flicker.mjs --only=show-replay` (temp copy with `executablePath`, a per-frame
car-pops log and `FLK_PRE`), split by the replay's shot and by whether the deck look is on (bloom threshold > 1.5):

| run | show-replay/car | shot 1, off the deck | shot 1, on the deck (≈ 340 frames, car ≈ 2 200 px) | shot 2, on the deck (≈ 7 000 px) |
|---|---|---|---|---|
| main (`ea322c9`) | **101.9 ‰** | 142.7 | **205.9** | 16.4 |
| main, deck look forced to k = 0 | 62.7 ‰ | 136.2 | 110.7 | 0.0 |
| paint clearcoat 0, roughness 0.75, no sheen (on the deck) | — | 144.5 | 209.2 | 16.1 |
| deck bloom threshold 2.0 instead of 3.5 | — | 140.4 | 198.3 | 2.4 |

(The last three rows ran 450 frames, which covers shot 1 and the start of shot 2.)

- **The whole rise is shot 1:** the replay's wide shot up the curl, with the car about 50 m away and 70 × 40 px. The
  car-only heat map (`--heat` with `F.heatReg = 3`) lies along the car's path up the curl. That's the silhouette, a
  white car on the grey deck, stepping across pixels. Before #303 the car's own bloom (threshold 0.82) blurred
  that edge.
- **Not the paint's specular:** taking it off the paint changed nothing. **Not the threshold's exact value:** at 2.0
  it's still 198 ‰. Only the bloom on the car itself hid the edge.
- **SMAA is already on** (`stage.aaKind` 'smaa', pixel ratio 1). Spatial AA doesn't stop an edge's sub-pixel crawl.
- **Gating the deck look on the car's size on screen won't pass.** The look audit's own car boxes are 40–50 px at
  844×390 and about 100 px elsewhere, and the P10 ≤ 60 bar applies to those too.
- **So the remaining criterion needs temporal AA** (a jittered projection plus reprojected history, from the depth
  texture the high tier keeps). That's 0101's candidate, and it isn't built. Alternatively, supersample the hero.
  Either is a size-L render change that every flicker budget sees. Don't retry the knobs above.

## Builder pass 2 (2026-11-11, #310): one cause fixed, one needs the operator
Desktop label, SwiftShader, same machine. A per-frame timeline (`FLK_PRE` wrapping `stage.render`) split `show-replay/car` by
director shot and by deck look (k):

| shot (the Show's replay) | car px | ppm | main ‰ | what moves it |
|---|---|---|---|---|
| 1 (the reference wide, locked off, 31 m), off the deck | 2,330 | 19–20 | 133 | — |
| 1, on the deck (k > 0) | 2,130 | 17–19 | **206** (70 % of all car pops) | course bloom back: 143. Nothing else did (below) |
| 2 (closer, on the deck) | 7,000 | 28–33 | 29.7 | shut lines hidden: 9.8; course bloom back: 0.0 |

- **Fixed: the shut lines.** In shot 2 the 4.2 mm black seams are about 0.25 px on screen and popped on and off the paint.
  They're now drawn at least 3 px wide and faded by the share they really cover (`sliverTube`, src/render/sliver.js), so they
  put the same darkness on screen spread evenly. Shot 2 went 29.7 → 9.9 ‰, the same as no seams at all. The look audit is
  unchanged (every bar still met), and close up a seam over 3 px draws exactly as before. The iPhone export keeps the opaque line.
- **Not fixed: shot 1 on the deck.** Tried and measured, with no effect on shot 1's on-deck car (206 ‰ ± 4): seams hidden, the
  car's specular (roughness 1, no clearcoat or sheen), the bloom's high-pass knee (smoothWidth 2 and 5), no self-shadow, no
  searchlight beams. Stepping the probe at 1/120 s halves the off-deck frames (133 → 69 ‰, honest motion) but takes the on-deck
  ones only to 146 ‰. The only lever that moves it is the course bloom on the car, which is what 0187 took off.
  `show-replay-rigs` counts only shot 1, so it can't pass without that bloom: with it, ≈ 141 ‰ against 144.3.
- **A size gate won't work either.** The look audit's 844×390 phone draws the hang at 10–11 px/m, smaller than shot 1's 17–19.
- **Operator's call:** rebaseline `show-replay/car` and `show-replay-rigs/car` (desktop swiftshader) for the readable car, as
  with 0097, or let the reference wide shot keep the course bloom. The critic ruled out the second.
- **This pass's gate (flicker-budget, same machine, main → branch):**
  - Desktop: `show-replay/car` 101.9 → **89.6 ‰** (limit 77.9, still over); `show-replay-rigs/car` 189.3 → 185.5 ‰ (limit 144.3,
    still over); `show-title/car` 6.36 → 5.82; `show-jets/car` 10.41 → 8.39.
  - Phone: `show-replay/car` 66.2 and `show-replay-rigs/car` 137.7 ‰ (both within); title car 3.30 → 3.11, jets car 7.35 → 5.68.
  - Every other region is level with main on this sandbox, which itself reads over the stored desktop budget on show-title and
    show-jets (LESSONS 0051).
  - The status stays `ready`: the flicker box isn't met.

## Critic re-check (2026-11-11 15:30, after #310)
Production `index-Jdqb08Zp.js`, the same probe as the bounce (`flicker.mjs --gl=swiftshader --only=show-replay,show-replay-rigs`,
then `flicker-budget.mjs`): 9 ok and 3 over.
- `show-replay/car`: **89.60 ‰** (limit 77.87)
- `show-replay-rigs/car`: **183.55 ‰** (limit 144.30)
- `show-replay-rigs/wall`: **1.18 ‰** (limit 0.88)

The shut-line fix holds, and it's worth about 4 ‰. What's left is shot 1, and it waits on the operator's rebaseline call
(#310). The look still passes on a phone: climb red 5.5 %, hang 4.3 % (`docs/critique/2026-11-11-1530/S-climb.png`,
`S-hang.png`). This isn't a second bounce, because no new pass was claimed.

## Operator decision (2026-11-11): rebaseline, ship
The operator closed this criterion with a rebaseline, as with 0097. A readable car on the deck is the point of the
ticket, so the reference wide shot keeps the new look and doesn't get the course bloom back. Draft #304 (the soft knee)
is closed: it overlapped #303 and raised `show-replay/car` further.
- `docs/flicker-budget.json`, `chromium-swiftshader desktop`, set to the critic's 15:30 production re-check:
  `show-replay/car` 62.2922 → 89.6, `show-replay-rigs/car` 115.4379 → 183.55, `show-replay-rigs/wall` 0.3849 → 1.18.
- The phone labels are unchanged (within budget).
- What would bring these back down is temporal AA on the hero (0101's candidate).
