---
id: 0262
title: The title's ad frame carries no Cloudflare analytics beacon, and a production probe catches the next one
status: proposed
priority: P1
size: S
lens: platform
created: 2026-11-14
pr: 404
by: critic
---

## Why
AGENTS.md §3.3 allows two third parties on the web game: Google ads through Marquee, and Box Office analytics. Then it
says: "No other third party, analytics or tracker is allowed by this." The operator's note on 0155 (2026-11-05) settled
Cloudflare's own analytics: stop the beacon, then drop the privacy page's Cloudflare sentence. The sentence is gone
(`public/privacy/index.html` names PostHog through our relay and Google's ads, not Cloudflare).

The beacon is back on production, through a door the game opens itself. On the desktop title (1440×900, no input), once
the title's dwell places Marquee's slot frame (0122, `src/ads.js`), that frame loads Cloudflare Web Analytics:

| t (ms after load) | frame | request |
|---|---|---|
| 38 726 | coldgas page | `mutaafaziz.com/ads/v1/frame.html?app=coldgas&slot=title` |
| 39 841 | that frame | **`static.cloudflareinsights.com/beacon.min.js/vce70182…`** |
| 43 350 | that frame | `mutaafaziz.com/cdn-cgi/rum?` (the beacon's report) |

(`docs/critique/2026-11-14-0423/desktop-title-requests.jsonl`, production `index-B8Ihfxnp.js`, main `39c464d`.)

The cause is the one LESSONS 2026-11-05 recorded for the privacy page: `frame.html` is HTML served with
`cache-control: public, max-age=60` and no `no-transform` (curl with a browser UA, 2026-11-14), so the zone injects its
Web Analytics script. Every desktop player who waits ~38 s on the title is counted by an analytics company that the
privacy page doesn't name. Our tests can't see it: the loader only runs off localhost (§3.3), so the smoke test's
own-origin rule never meets the frame. The 2026-11-13 21:55 critique reported "only mutaafaziz.com" because its runs
left the title before the dwell. Phones didn't place the frame in 50 s on the title, so this is desktop and tablet.

**Critic, 2026-11-14 09:55: phones too, and sooner.** On production `index-d0nuuZHe.js` (main `97215bc`), at 390×844 touch
as a first visit with no input, the title placed the frame **7.4 s** after the game was ready (17.6 s after `goto`), and
the frame loaded `static.cloudflareinsights.com/beacon.min.js` at 17.7 s and reported to `/cdn-cgi/rum` at 19.1 s
(`docs/critique/2026-11-14-0955/phone-title-requests.jsonl`). The slot was 0 px tall (no fill), so the player saw no ad
and was still counted. Every first-visit phone player who reads the title for a few seconds before tapping Jump is beaconed.
`curl -sSI` of the frame still shows `cache-control: public, max-age=60` with no `no-transform`. A second `/cdn-cgi/rum`
from the same frame came at 57.5 s while that page was flying runs. That's most likely the beacon's unload report as
`src/ads.js` removed the frame for the run (unverified). The probe in What 2 should time it against `S.mode`.

**Critic, 2026-11-14 15:35: the second report is the unload, at the Jump, not in the run.** Production `index-Cu4812XR.js`
(main `5de2137`), 390×844 touch, first visit. The frame placed at 31.8 s, then beacon 33.1 s, then `/cdn-cgi/rum` 36.6 s,
all on the title. The Jump was clicked at 45.99 s (page clock). A second `/cdn-cgi/rum` started at 46.05 s, and the
frame was gone with `S.mode` at `countdown` by 46.06 s. Then nothing left the page for 15 s through countdown and live
(`docs/critique/2026-11-14-1535/phone-jump-requests.jsonl`). The last acceptance criterion holds today. The probe in
What 2 should allow a request that *started* within the title→countdown transition from the `/ads/` frame being
removed, or it will flag this unload on every run. After the beacon fix there is nothing to flag.

## What
1. **The fix lives in Marquee or the zone, not here** (`src/worker/` and the Marquee Worker are both outside a cloud
   agent's reach). Marquee should serve `/ads/v1/frame.html` with `cache-control: …, no-transform` (the same fix that
   cleaned `/coldgas/privacy`, #255), or the zone's Web Analytics should exclude `/ads/*`. Operator: ask on the Marquee
   repo, or flip the zone setting. Then report it here.
2. **In this repo (Builder):** add `scripts/prod-hosts.mjs`. It loads a URL at 1440×900 and at 390×844 touch, stays on
   the title for 60 s (past the dwell), then flies one reference Jump to its sheet. It lists every request with its
   host, its frame and `S.mode`, and exits non-zero on:
   - a host outside the allowance: `mutaafaziz.com`, plus Google's ad hosts (`*.googlesyndication.com`,
     `*.doubleclick.net`, `*.adtrafficquality.google`, `www.google.com/recaptcha`) only from a `/ads/` frame or loader;
   - any non-`mutaafaziz.com` request while `S.mode` is `countdown` or `live`.

   Name it in AGENTS.md §5. The Critic and the Keeper run it against production. It isn't a CI gate, because CI never
   loads the ad loader.
3. Don't change `src/ads.js`'s placement or the ads themselves (the owner's decision, 2026-10-30, and 0122).

> **Scout, 2026-11-17:** parked as `proposed`: the probe shipped (#404); the one open box needs Marquee or the operator to change the ad frame (not buildable here). The Critic re-checks it live.

## Acceptance criteria
- [x] `node scripts/prod-hosts.mjs https://mutaafaziz.com/coldgas/` runs and prints one line per request
      (t, host, frame, mode). It exits 1 today and names `static.cloudflareinsights.com` from
      `/ads/v1/frame.html` (paste the output in the PR).
- [x] It exits 0 on a page whose only third parties are Google's ad hosts from the `/ads/` frame (shown on today's
      phone title, or on a recorded fixture of today's log with the beacon line removed).
- [ ] After the operator or Marquee change: the same probe exits 0 on production, and
      `curl -sSI -A 'Mozilla/5.0 Chrome/130' 'https://mutaafaziz.com/ads/v1/frame.html?app=coldgas&slot=title'` shows
      `no-transform`. The Critic re-checks this live.
- [x] No request to a host other than `mutaafaziz.com` while `S.mode` is `countdown` or `live` (already true today:
      0 of 0 in the log above; the probe keeps it so).

**Builder, 2026-11-16:** the probe shipped (What 2). On production `cdde184` it exits 1 on both screens, naming
`static.cloudflareinsights.com` from `mutaafaziz.com/ads/v1/frame.html` (desktop 72.5 s, phone 36.6 s, both on the
title); the same log with that line removed exits 0 (`--log=`); 0 foreign requests in countdown or live. The third box
waits on What 1 (the operator or Marquee): the frame still answers `cache-control: public, max-age=60`.

## Test plan
A unit test for the probe's verdict function: an allowed log passes; logs fail with the beacon in the frame, with
Google ad hosts from the game page's own frame, or with any third party in `live`.

## Out of scope
- Box Office's PostHog modules (owner-allowed; their timing is 0222).
- The ad slots, the dwell and the rewarded flow.
- Rewording the privacy page to name Cloudflare (the operator's 11-05 call was to stop the beacon instead).

## Critic re-review
**2026-11-16 22:00 (bounce 1 of 2): the probe passes; production still beacons, so the ticket goes back to `ready`.**
- **What 2 passes.** `scripts/prod-hosts.mjs` (#404) ran on production `3ef26c7` and printed one line per request with
  t, host, frame and mode. It exited **1**: `static.cloudflareinsights.com` from `mutaafaziz.com/ads/v1/frame.html` on
  the title, at **39.56 s** on the desktop and **41.92 s** on the phone. There were 0 foreign requests in countdown or
  live (`docs/critique/2026-11-16-2150/prod-hosts.log`). Boxes 1, 2 and 4 hold.
- **Box 3 fails.** `curl -sSI -A 'Mozilla/5.0 Chrome/130'
  'https://mutaafaziz.com/ads/v1/frame.html?app=coldgas&slot=title'` still answers `cache-control: public, max-age=60`
  with no `no-transform`. Every player who waits on the title is still counted by Cloudflare Web Analytics.
- **Who can fix it: only the operator (What 1).** That means Marquee's frame header, or the zone's Web Analytics rule
  for `/ads/*`. A cloud Builder has nothing left to build here: **skip this ticket** until the operator reports
  What 1 done. Then the Critic re-runs the probe, and it must exit 0 on production.
