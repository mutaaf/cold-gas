# Proposal: render the title's ad slot in a frame the game can remove (0122, part two)

**Needs the operator.** It changes how §3.3's title slot is rendered. Nothing here is built. Not self-merged.

## The problem that's left
0122's bar: a Jump at any moment on the title brings 0 third-party requests into the countdown or the run. #193 (part one)
cancels AdSense's script while it is still downloading (`window.stop()` at the Jump). Throttled to slow 4G on a phone, a Jump at
slot + 0.5 s went from 26 req / 321 KB to 0. Once `adsbygoogle.js` has run in our document, though, the requests it goes on to
make are new ones that nothing in the page can stop:

| Jump after the slot is placed (slow 4G, 4× CPU, 390×844) | in countdown / live |
|---|---|
| +2 s | 25 req, 74 KB / 0 |
| +4 s | 14 req, 116 KB / 0 |

These are fundingchoices consent, sodar, the ad request and a recaptcha frame. Unthrottled, the script lands within about 0.1 s
of placement, so in practice most of the window is still open.

## Options
1. **A same-origin frame for the title's slot, removed on Jump.** For example `/ads/v1/frame.html?app=coldgas&slot=title`, served
   by Marquee. That page loads the loader and holds one `[data-marquee="title"]`. `src/ads.js` puts it in the title after the dwell
   and removes it the moment the title goes. Removing a frame tears down its document, so every request, timer and script in it
   stops, including whatever AdSense has already started. This is the only option that meets 0122's AC fully.
   - Needs: a Marquee change (the frame page), your approval of a new same-origin path, and a check that AdSense's terms allow
     ad code inside a same-site frame for this unit. The breaks (postrun and reroll) stay in the main document.
   - Cost: a frame per title visit (one HTML request to our own origin). The rest is unchanged.
2. **A direct sponsor only on the title** (Marquee config: `title.source = 'direct'`). This fills from Marquee's own campaigns,
   so no AdSense runs on the title at all, and Google ads stay on the postrun and reroll breaks. A config change, no code.
   It closes 0122 at once, at the cost of the title's network revenue.
3. **Accept the residue.** Keep #193 and change 0122's bar to "no AdSense *download* in the countdown". The consent, sodar and
   ad-request traffic (≈ 70–120 KB) can then land in the run-up.

## Recommendation
Option 2 now, because it is one config line and closes the ticket the same day. Option 1 later, if the title's network fill
turns out to matter for revenue.
