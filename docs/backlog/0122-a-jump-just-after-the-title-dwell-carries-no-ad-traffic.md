---
id: 0122
title: A Jump just after the title's ad dwell carries no ad traffic into the countdown or the run
status: shipped
priority: P1
size: M
lens: performance
created: 2026-10-31
pr: 193, NEWPR
by: critic
---

## Status (2026-11-03, shipped)
**Shipped in #NEWPR (owner's decision on #194, Option 1).** The title's slot is Marquee's same-origin frame
`/ads/v1/frame.html?app=coldgas&slot=title` (Marquee 2aba562, live). `src/ads.js` puts it in after the dwell and removes it the
moment the title goes, filled or not; removing the frame tears down its document and everything AdSense started in it. The
window.stop() cut from #193 is gone (nothing in the page's own document is AdSense's any more). Postrun and reroll stay in
the page. AdSense's policy pages forbid IFRAMEs only to manipulate targeting (support.google.com/adsense/answer/1354736,
/1354742); this frame is same-origin, framable only by our own pages (`frame-ancestors 'self'`), and refused to kids apps.

Probe (production page, Marquee and AdSense in test mode, this build's files routed in; Chromium SwiftShader, `?gfx=low`;
Jump is a DOM click on `[data-start]`, timed from the config request; third-party requests bucketed by `S.mode`):
| Jump at config + | frame placed | 3rd-party on the title (390×844 / 1440×900) | in `countdown` | in `live` |
|---|---|---|---|---|
| 3, 4, 5 s | not yet (dwell) | 0 / 0 | 0 | 0 |
| 6 s | yes | 3 req, 268 KB / 2 req, 76 KB | 0 | 0 |
| 7 s | yes | 10 req, 294 KB / 10 req, 294 KB | 0 | 0 |
| 8, 10, 14 s | yes | up to 16 req, 326 KB | 0 | 0 |

0 requests *started* and 0 *finished* in `countdown` or `live` in all 16 runs, no frame left in the run, no page
errors. AdSense runs in the frame on the title (the same ≈ 300 KB as before), so a player who stays still gets the
banner. e2e (`ads.spec.js`): a stand-in frame whose ad script takes 3 s, Jump at frame + 0.5 s: the script never
finishes and no stand-in request completes. Unit: placement after the dwell, removal on every way off the title, and
the height report (0 px until filled, capped at 90 px, other windows ignored).

## Status (2026-11-01, builder)
**Part one shipped in #193; the rest needs the operator.** If Jump comes while an ad network's script (AdSense's
stub, then the ≈ 250 KB implementation it adds) is still downloading, `window.stop()` now cancels it (once a session), so AdSense never runs (src/ads.js). Throttled probe (slow 4G, 4× CPU, 390×844),
production vs this build: Jump at slot + 0.5 s went from 26 req / 321 KB in `countdown` + 1 in `live` to **0 / 0** (the revised
check: + 0.3, + 0.8 and + 1.5 s all 0 / 0, no console errors). At slot + 2–3 s
and + 4 s, AdSense's script had already run, and the cascade it starts (consent, sodar, the ad request) is new requests that no
in-document call can prevent: 25 req / 74 KB and 14 / 116 KB, the same as production. Unthrottled, the script lands within about
0.1 s of placement, so the cut rarely fires there. Every remaining case needs the slot in a frame the game can remove (the
`proposal/` PR), so this ticket stays `in-progress` and isn't marked shipped. The AC below is not met yet.

## Why
AGENTS.md §3.3 says: "Nothing in the countdown, a live run, a drill or Free Drive". 0117 holds for a quick Jump, because
the title's slot waits `TITLE_DWELL_MS` (4 s) after the config. But once the dwell places the slot, the AdSense pipeline
takes several seconds to finish. If the player presses Jump in that time, the whole pipeline runs into the countdown and
the run-up. A player who reads the title for about 4–8 s and then jumps is the ordinary case, not an edge case.

Measured on production `index-CFSPxIcK.js` (docs/critique/2026-10-31-2215.md). The setup was Playwright on Chromium
(SwiftShader), `?gfx=low`, 390×844 touch, with each third-party request bucketed by the in-page `S.mode` when it
finished:

| Jump at | Third-party in `title` | in `countdown` | in `live` |
|---|---|---|---|
| config + 2 s (0117's case) | 0 | 0 | 0 |
| **config + 5 s** | 0 | **24 req, 393 KB** | **6 req** |
| config + 9 s | 30 req, 408 KB | 1 req, 0 KB | 0 |

At config + 5 s, `adsbygoogle.js` started on the title about 0.1 s before the click, and the ad request
(`pagead/ads?`) started in the countdown. An earlier probe on a slower page (four browsers in parallel) put 28–30
requests and 172–411 KB in the countdown the same way. The slot is `display: none` by then, so the ad is never seen.
The cost is about 0.4 MB of script fetched and parsed on a phone during the countdown, which works against the
lockdown's frame-pacing and battery goals.

The cause is in `src/ads.js:62-81`. Taking out the slot can't stop an AdSense download that has already started (the
#183 review note), so the dwell only narrows the window and doesn't close it.

## What
Make sure a Jump at any moment on the title leaves no ad-network work running in the countdown or the run. Pick one
of these and say why in the PR:
- **Hold the slot's ad request until the title is idle:** place the slot only after the dwell **and** a pointer-, key-
  and touch-free stretch long enough to cover the pipeline. Measure that stretch on a throttled phone profile and
  record the number in the PR. This only narrows the window.
- **Contain the slot so it can be cut off:** host the title's slot in a same-origin frame under `/ads/` that the game
  removes on Jump. A removed frame cancels its in-flight requests. This needs the operator, because it changes how
  Marquee renders a slot (§3.3). Write it up as a `proposal/` if you choose it.
- **Defer the countdown:** don't hold the countdown for an ad. That is never acceptable.

`src/ads.js`, `src/main.js` (the Jump path) and `tests/e2e/ads.spec.js`. Postrun and reroll are unchanged.

## Acceptance criteria
- [x] On production, using the critic's in-page probe above at 390×844 touch and 1440×900, Jump at config + 3, 4, 5, 6
      and 8 s each gives **0** third-party requests finishing in `countdown` or `live`. Hold every case 0117 already
      passes (Jump at once, config + 2 s, `?play=jump`, Retry).
- [x] e2e, with a stand-in loader whose fake ad request takes 3 s: a Jump at dwell + 0.5 s leaves no stand-in request
      pending or completed after `S.mode` leaves `title`.
- [x] The title banner still fills when the player stays on the title, and `ads.spec.js` stays green.
- [x] No frame-time regression on the title (perf probe within budget). hud-audit and title-audit stay clean.

## Test plan
Extend `tests/e2e/ads.spec.js` with the slow stand-in case. Add a unit test for the placement gate (dwell, idle, mode)
in `src/ads.js`.

## Out of scope
The postrun interstitial and the rewarded reroll. The allowed host and the slot list (the operator's call, §3.3).
