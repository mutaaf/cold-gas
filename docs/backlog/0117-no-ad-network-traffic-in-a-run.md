---
id: 0117
title: The ad network stays off the wire in the countdown and the run (a quick Jump and ?play=jump)
status: shipped
priority: P0
size: S
lens: performance
created: 2026-10-30
pr: 183
by: critic
---

## Why
AGENTS.md §3.3 (the owner's ads rule, 2026-10-30) says: "Nothing in the countdown, a live run, a drill or Free
Drive". The Marquee calls follow that rule, and `tests/e2e/ads.spec.js` proves it. But that spec uses a stand-in
`window.marquee`, so it can't see what the real loader does. On production, the title banner's ad pipeline (the
third-party ad script, the consent script, the ad request and its iframes) runs into the countdown and the live
run whenever the player starts a run before it has finished. That is ≈ 430 KB, mostly script, fetched and parsed
on a phone during the run-up. It also requests an ad for a slot that is already `display: none`.

Measured on production `e053bc2` (docs/critique/2026-10-30-2200.md). The setup was Playwright on Chromium (SwiftShader),
390×844 touch, with the CDP network log, and each request bucketed by `S.mode` at the moment it finished.
Third-party means not under `mutaafaziz.com/coldgas/`:

| Start | Third-party in `title` | in `countdown` | in `live` | Ad request (`pagead/ads?`) |
|---|---|---|---|---|
| Jump at once on the title | 0 | 0 | **32 req, 427 KB (379 KB script)** | **live**, title + 7.4 s |
| Jump 2 s after the title | 11 req, 342 KB | **21 req, 97 KB** | 1 req | **countdown**, + 2.7 s |
| Jump 6 s after the title | 33 req, 427 KB | 0 | 0 | title, + 2.5 s |
| `?play=jump` (the launcher's deep link) | — | **17 req, 377 KB** | **15 req, 62 KB** | **countdown** |

At 1440×900 with Jump 0.5–3 s after the title, 27–28 requests landed in the countdown. AdSense inserted 8–9 iframes
in the countdown (MutationObserver). None was visible, because the title's slot is `display: none` by then
(`p390-ad-live.jpg`: nothing on screen). So this is network and main-thread work in the run, not a visible ad.

There are two causes in `src/main.js:619-620` (was 602-606 at `e053bc2`) and `src/ads.js:48`:
- `startAds` runs at idle after `stage.ready` whatever the mode, so under `?play=jump` it injects the loader during the
  countdown.
- `titleBanner` places the slot whenever the config resolves, even after the title has gone. Marquee then fills it.

## What
- `src/ads.js` / `src/main.js`: inject the loader and place the title banner only while `S.mode === 'title'` (or on the
  results, for the postrun and reroll slots). Under `?play=` the loader waits for the first title or results screen.
- If a run starts before the banner has been asked for, don't ask for it. Remove or skip the `[data-marquee="title"]`
  element, so no ad request is made for a hidden slot. Ask again on the next title.
- Nothing else about the slots changes (§3.3 stands as written).

## Acceptance criteria
- [ ] On production (the critic's per-mode network probe above): **0** third-party requests finish in `countdown` or
      `live` in each of four starts at 390×844 and 1440×900: Jump at once, Jump 2 s after the title, `?play=jump`, and
      Retry from the results.
- [ ] e2e (a stand-in loader, as `ads.spec.js` does): record the mode when the `/ads/v1/ads.js` script element is
      inserted and when `[data-marquee="title"]` is placed. Both happen only in `title` or `results`. Under `?play=jump` no
      script is inserted before the first results.
- [ ] A Jump pressed before the config resolves leaves no `[data-marquee="title"]` in the DOM through the run.
- [ ] The title banner still appears when the player stays on the title, and the postrun and reroll paths are unchanged
      (`ads.spec.js` green).
- [ ] Works at 390×844 touch and 1280×720 keyboard. `smoke.spec.js` own-origin rule holds locally.

## Test plan
Extend `tests/e2e/ads.spec.js`. Make the stand-in's script tag observable (a MutationObserver on `head` logging
`S.mode` for a `src` ending `/ads/v1/ads.js`, with `?marquee=1` so the loader is wanted locally). Add two cases:
an immediate Jump and `?play=jump`. Unit: a pure "may start ads now" gate in `src/ads.js` (mode → bool).

## Out of scope
Anything the Marquee loader or AdSense does on the title itself. Slot policy and the allowed host (operator's call,
§3.3).

## Critic note 2026-10-31
Still open on production `0856de8`. `startAds` is unchanged: it still runs at idle whatever the mode
(`src/main.js:619-620`), and `titleBanner` is unchanged (`src/ads.js:48`). This is the only P0 in the
critic's queue. The ticket's bars stand as written.
