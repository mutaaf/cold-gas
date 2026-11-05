---
id: 0155
title: The privacy page says what production does: no analytics beacon on it, and the web game's ads named
status: ready
priority: P0
size: S
lens: platform
created: 2026-11-05
pr:
by: critic
---

## Why
`/coldgas/privacy` (#255, `public/privacy/index.html:30`) is the page the App Store listing links to. It says "Cold
Gas has no accounts, no ads and no tracking … Nothing goes to an advertising network, an analytics company or a data
broker." On production on 2026-11-05 (critique `docs/critique/2026-11-05-0354.md` §1):
- The page itself requests `static.cloudflareinsights.com` (Cloudflare Web Analytics, injected by the zone). The
  Worker sets `Cache-Control: no-transform` only on `/coldgas/` and `/coldgas/index.html` (`src/worker/index.js:539-542`,
  `PAGES`), and `/coldgas/privacy` is served with no `cache-control` at all.
- The web game loads Marquee's `/ads/v1/ads.js` (allowed: CLAUDE.md, AGENTS.md §3.3). `GET /ads/api/config?app=coldgas`
  answers `enabled: true` with the title slot `source: "network"` (AdSense, `test: true`), and the loader writes
  `pagead2.googlesyndication.com/…/adsbygoogle.js`. The 2026-11-04 critique saw Google ad hosts on the iPad title.
So "no ads" and "nothing goes to an advertising network" are false for the web game, and "no analytics company" is
false for the page that says it. A privacy page must be exactly true.

## What
- Stop the beacon on the page. `src/worker/` is frozen, so either a Workers static-assets `public/_headers` rule
  (`/coldgas/privacy*` → `Cache-Control: no-transform`, if Workers Builds honours it for this route), or a
  `proposal/` note asking the operator to add the privacy path to `PAGES`. Prove which one works on the preview.
- Make the words true. The web game shows ads from Google through Marquee, on menus and results only, never during a
  run, with rewarded ads only when the player asks. Name what those ads can receive (the ad network's own cookies and
  identifiers, under Google's policy), and that the iPhone app has none (docs/NATIVE.md). Keep the rest of the page.
  The operator wrote the wording, so put the new sentences in the PR body for their eye. If the auto-merge would land
  wording they haven't seen, open it as `proposal/` instead.

Operator, 2026-11-05: the words are fixed in #253 (the page now names the web game's ads and Cloudflare's analytics, and says
the iPhone app has neither). What's left here is stopping the beacon, then dropping the Cloudflare sentence, and the e2e check.

## Acceptance criteria
- [ ] Playwright at 390×844 on the preview: `/coldgas/privacy` makes **zero** requests to a host other than the
      page's own, and its response carries `no-transform`.
- [x] No sentence on the page is contradicted by `src/ads.js` or `/ads/api/config?app=coldgas`. It names the ads on
      the web, where they appear (menus and results, never in a run) and who serves them, and says the iPhone app
      shows none.
- [ ] An e2e or unit check fails if the page says "no ads" while `src/ads.js` still loads the loader on the web.
- [ ] The page still fits 390×844 with no horizontal scroll (`scrollWidth` 390) and keeps 4.5:1 text contrast.

## Test plan
- Add `tests/e2e/privacy.spec.js`: load `/coldgas/privacy`, collect hosts, assert own-origin only, and assert the
  page's text mentions the ads as long as `src/ads.js` exists.
- Check the beacon on the Cloudflare preview URL, not localhost, where nothing is injected.

## Out of scope
- Removing or changing the ads (the owner's decision, 2026-10-30).
- Zone-level Web Analytics settings outside this repo, unless the operator asks.
