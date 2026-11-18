---
id: 0222
title: Box Office's session recorder stays off the wire in the countdown and the run, and loads after Jump is ready
status: ready
priority: P1
size: S
lens: performance
created: 2026-11-13
pr:
by: critic
---

## Why
The owner allowed Box Office analytics on 2026-11-12 (AGENTS.md §3.3). This ticket keeps every event they asked for.
What it fixes is *when* the work lands: today the loader's session recorder runs during the stunt.

The ads exception draws the line at "nothing in the countdown, a live run" (0117), and the run is the one place a phone
can't afford a stray upload or a main-thread pass.

Measured on production `d80db6c` (docs/critique/2026-11-13-0350.md, `boxoffice-requests.json`):
- **Setup:** Playwright Chromium (SwiftShader), 390×844 touch, an Android Chrome UA and `navigator.webdriver` hidden, so
  PostHog treats it like a phone.
- **Nothing reached the owner's PostHog.** Every non-static `/boxoffice/e/` call was answered locally.

| Window | Box Office requests | Uploaded |
|---|---|---|
| title | `config.js`, 1 event batch | 1.2 KB |
| countdown | 3 × `/e/s/` (recording, one full snapshot) + 2 events | **78 KB** |
| live (53 s) | **13 × `/e/s/`, one every ≈ 4.3 s**, + 2 events | **95 KB** |
| results | 2 × `/e/s/` | 30 KB |

- **The recorder serialises the HUD.** During live play the HUD made **53 DOM mutation records/s at ≈ 3.5 fps**, about
  **15 per frame**. At a phone's 60 fps that's on the order of 900/s for rrweb to process, on the main thread, mid-stunt.
- **First load over cellular (control.json focus 3).** The loader pulls **280 KB** (`array.js`, recorder, surveys,
  web-vitals, dead-clicks and exception autocapture) at 0.4–0.8 s, ahead of Rapier's wasm (1.3–1.8 s).
  - On a slow-4G link (1.6 Mbit/s, 150 ms RTT, cache off), time to an enabled Jump was 11.15 / 11.65 / 11.42 s with
    Box Office and 10.12 / 10.11 / 11.48 s with it blocked.
  - The median is **+1.3 s** for a first-time phone player.

## What
Everything here is our side only. The loader and its PostHog config live in the owner's box-office repo, which this
game doesn't edit.
- **`index.html`:** inject `/boxoffice/v1/insights.js` once the title is up and physics is ready (idle after
  `stage.ready`, the same moment as `startAds`), not at parse time. The `track()` queue in `src/insights.js` already
  holds events made before the loader lands.
- **`src/insights.js` + `setMode` in `src/main.js`:** on `countdown` / `live` / drill / Free Drive, call
  `window.posthog?.stopSessionRecording?.()`. On `title` / `results` / `replay`, call
  `window.posthog?.startSessionRecording?.()`. Both stay no-ops when the loader is absent, and nothing ever throws into
  the game.
- **Event batches:** `game_start` / `game_over` may stay queued and go out at results.
- **AGENTS.md §3.3:** add one line saying that Box Office is off the wire in a run, like Marquee.

## Acceptance criteria
- [ ] On production, a 390×844 touch Show run (UA and webdriver as in Why, uploads answered locally) makes **0
      `/boxoffice/` requests between `countdown` start and `results`**. The same holds for a Jump made the instant the
      title appears, and for `?play=jump`.
- [ ] Recording still covers the title and the results: ≥ 1 `/e/s/` upload after `results` is shown.
- [ ] `game_start` and `game_over` are still delivered for every Jump, with the same props (AGENTS.md §3.3).
- [ ] On the slow-4G profile above, the median of 3 time-to-enabled-Jump runs with Box Office is within **0.3 s** of
      the median with it blocked.
- [ ] e2e: a stand-in `window.posthog` records stop/start calls. The spec asserts `stopSessionRecording` before the
      first live tick and `startSessionRecording` on results, and that the loader script isn't in the DOM before
      `stage.ready`.
- [ ] Works at 390×844 touch and 1280×720 keyboard/mouse. No change to the sim, scores, vectors or `ref-hash`.

## Test plan
- Add `tests/e2e/insights.spec.js` (or extend `ads.spec.js`), with the stand-in posthog as above.
- Extend `tests/unit/privacy.test.js` if the §3.3 text changes.

## Out of scope
- Which events, which PostHog features (autocapture, heatmaps, surveys) and the recorder's masking: that's the
  owner's loader.
- Removing analytics.
- The iPhone app, which never loads it.
